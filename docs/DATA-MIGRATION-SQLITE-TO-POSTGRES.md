# Migrating data from SQLite (`jamaica.db`) to PostgreSQL

If you have an existing deployment that used the legacy SQLite file (`jamaica.db`), you can move data into PostgreSQL after the app is configured with `DATABASE_URL`.

## Prerequisites

1. PostgreSQL running and empty database created (e.g. `jamaica`), matching `DATABASE_URL`.
2. Apply the application schema at least once so tables exist:
   - `npm run db:init` from the project root, or
   - start the API once so `applySchema` runs on boot.

## Option A: pgloader (recommended for one-off moves)

[pgloader](https://pgloader.io/) reads SQLite and loads into PostgreSQL with type mapping.

Example (adjust paths and connection strings):

```bash
pgloader sqlite:///path/to/jamaica.db postgresql://jamaica:password@127.0.0.1:5432/jamaica
```

Review pgloader’s report for any cast or index warnings. You may need to:

- Drop or rename conflicting objects if the target DB was partially initialized.
- Re-run `npm run db:init` on an **empty** database before pgloader if you want pgloader to own all table creation, **or** load into a DB that already has PostgreSQL-compatible DDL from `server/db/schema.postgresql.sql` and let pgloader append/truncate as appropriate (depends on pgloader options).

## Option B: SQLite dump + manual fixes

1. `sqlite3 jamaica.db .dump > dump.sql`
2. Edit the dump for PostgreSQL (types, `AUTOINCREMENT`, `INSERT OR IGNORE`, etc.) — this is tedious; prefer pgloader when possible.
3. Apply with `psql "$DATABASE_URL" -f dump.sql`.

## Option C: Application-level export (custom script)

For maximum control, a one-off Node script can open the old SQLite file with `better-sqlite3` **in a throwaway environment**, `SELECT` each table, and `INSERT` into PostgreSQL via `pg`. This repo no longer ships SQLite in production dependencies; install `better-sqlite3` only in a temporary directory or use the `sqlite3` CLI to export CSV and `COPY` into Postgres.

## After migration

- Point the API at PostgreSQL via `DATABASE_URL` only.
- Back up with `pg_dump` or the admin **Database backup & restore** UI (see [`DATABASE-AND-MAP-DATA.md`](./DATABASE-AND-MAP-DATA.md#backup-and-restore-postgresql)) — replace old “copy `jamaica.db`” habits.
- JSON caches (`.flight-cache.json`, `.weather-cache.json`) under `JAMAICA_DATA_DIR` are unchanged.

See also [`DATABASE-AND-MAP-DATA.md`](./DATABASE-AND-MAP-DATA.md) for schema and repopulation workflows.
