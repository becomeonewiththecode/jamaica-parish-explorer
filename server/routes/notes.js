const express = require('express');
const db = require('../db/connection');
const router = express.Router();

// GET /api/parishes/:slug/notes
router.get('/:slug/notes', (req, res) => {
  const parish = db.prepare('SELECT id FROM parishes WHERE slug = ?').get(req.params.slug);
  if (!parish) {
    return res.status(404).json({ error: 'Parish not found' });
  }

  const notes = db.prepare(`
    SELECT id, author, content, created_at FROM notes
    WHERE parish_id = ? ORDER BY created_at DESC
  `).all(parish.id);

  res.json(notes);
});

// POST /api/parishes/:slug/notes
router.post('/:slug/notes', (req, res) => {
  const parish = db.prepare('SELECT id FROM parishes WHERE slug = ?').get(req.params.slug);
  if (!parish) {
    return res.status(404).json({ error: 'Parish not found' });
  }

  const { author, content } = req.body;
  if (!content || !content.trim()) {
    return res.status(400).json({ error: 'Content is required' });
  }

  const sanitizedAuthor = (author && author.trim()) || 'Anonymous';
  const sanitizedContent = content.trim();

  const result = db.prepare(`
    INSERT INTO notes (parish_id, author, content) VALUES (?, ?, ?)
  `).run(parish.id, sanitizedAuthor, sanitizedContent);

  const note = db.prepare('SELECT id, author, content, created_at FROM notes WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(note);
});

// DELETE /api/notes/:id
router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM notes WHERE id = ?').run(req.params.id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Note not found' });
  }
  res.json({ success: true });
});

module.exports = router;
