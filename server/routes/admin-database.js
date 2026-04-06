const express = require('express');
const { spawn } = require('child_process');
const multer = require('multer');
const { resolveDatabaseUrl, closePool } = require('../db/pg-query');
const { getDatabaseSummary } = require('../db/database-summary');

const router = express.Router();

const maxRestoreBytes = Number(process.env.ADMIN_DB_RESTORE_MAX_BYTES || 536870912); // 512 MiB default
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxRestoreBytes },
});

/**
 * pg_dump from PostgreSQL 17+ clients may emit SET transaction_timeout, which PG16 and earlier reject.
 * Strip those lines so restores into PG16 (e.g. docker compose postgres:16-alpine) succeed.
 */
function stripUnsupportedPgDumpSessionVars(sqlText) {
  return sqlText.replace(
    /^\s*SET\s+(SESSION\s+)?transaction_timeout\s*=[^;\r\n]*;?\s*\r?\n?/gim,
    ''
  );
}

function requireAdminToken(req, res, next) {
  const expected = process.env.ADMIN_RESTART_TOKEN;
  const provided = req.headers['x-admin-token'];
  if (!expected || !provided || provided !== expected) {
    return res.status(403).json({ ok: false, error: 'Forbidden' });
  }
  next();
}

/**
 * Plain SQL backup via pg_dump (includes DROP/CLEAN for round-trip restore).
 * Requires `pg_dump` on PATH (e.g. postgresql-client in Docker).
 */
router.get('/backup', requireAdminToken, (req, res) => {
  const url = resolveDatabaseUrl();
  const args = ['--clean', '--if-exists', '--no-owner', '--no-acl', url];
  const child = spawn('pg_dump', args, { stdio: ['ignore', 'pipe', 'pipe'] });

  let stderr = '';
  child.stderr.on('data', (c) => {
    stderr += String(c);
  });

  child.on('error', (err) => {
    if (err.code === 'ENOENT') {
      if (!res.headersSent) {
        return res.status(503).json({
          ok: false,
          error:
            'pg_dump not found. Install PostgreSQL client tools (e.g. postgresql-client / postgresql-client-common).',
        });
      }
    }
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: err.message || String(err) });
    }
  });

  child.on('spawn', () => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    res.setHeader('Content-Type', 'application/sql; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="jamaica-db-${stamp}.sql"`);
    child.stdout.pipe(res);
  });

  child.on('close', (code) => {
    if (code !== 0) {
      console.error('[admin-database] pg_dump exit', code, stderr.slice(0, 2000));
      if (!res.headersSent) {
        res.status(500).json({ ok: false, error: 'pg_dump failed', detail: stderr.slice(0, 4000) });
      } else {
        res.destroy();
      }
    }
  });
});

/**
 * Row counts for main tables — see admin **Database** tab.
 */
router.get('/summary', requireAdminToken, async (req, res, next) => {
  try {
    const summary = await getDatabaseSummary();
    res.json({ ok: true, ...summary });
  } catch (err) {
    next(err);
  }
});

/**
 * Restore from pg_dump plain SQL uploaded as multipart field `backup`.
 * Body field `confirm` must equal `RESTORE`.
 */
router.post('/restore', requireAdminToken, (req, res, next) => {
  upload.single('backup')(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          ok: false,
          error: `Backup file too large (max ${maxRestoreBytes} bytes). Set ADMIN_DB_RESTORE_MAX_BYTES or restore via psql CLI.`,
        });
      }
      return next(err);
    }

    const confirm = req.body && req.body.confirm;
    if (confirm !== 'RESTORE') {
      return res.status(400).json({ ok: false, error: 'confirm field must be exactly RESTORE' });
    }
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ ok: false, error: 'Missing backup file (multipart field name: backup)' });
    }

    // Long-running restore: do not let Node close the socket while psql runs.
    req.socket.setTimeout(0);

    // Drop pooled connections so psql can run DROP/CREATE without tripping idle clients (avoids process crashes).
    try {
      await closePool();
    } catch (e) {
      console.warn('[admin-database] closePool before restore:', e && e.message ? e.message : e);
    }

    const dbUrl = resolveDatabaseUrl();
    const child = spawn('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-f', '-'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderr = '';
    let stdout = '';
    child.stderr.on('data', (c) => {
      stderr += String(c);
    });
    child.stdout.on('data', (c) => {
      stdout += String(c);
    });

    let responded = false;

    child.on('error', (e) => {
      if (responded) return;
      responded = true;
      if (e.code === 'ENOENT') {
        return res.status(503).json({
          ok: false,
          error:
            'psql not found. Install PostgreSQL client tools (e.g. postgresql-client / postgresql-client-common).',
        });
      }
      return next(e);
    });

    const sqlText = stripUnsupportedPgDumpSessionVars(req.file.buffer.toString('utf8'));
    child.stdin.end(Buffer.from(sqlText, 'utf8'));

    child.on('close', (code) => {
      if (responded) return;
      responded = true;
      if (code !== 0) {
        return res.status(500).json({
          ok: false,
          error: `Restore failed (psql exited ${code})`,
          detail: (stderr || stdout).slice(0, 8000),
        });
      }
      res.json({ ok: true, message: 'Database restored from backup.' });
    });
  });
});

module.exports = router;
