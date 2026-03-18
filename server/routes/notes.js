const express = require('express');
const db = require('../db/connection');
const router = express.Router();

/**
 * @swagger
 * /parishes/{slug}/notes:
 *   get:
 *     summary: Get notes for a parish
 *     description: Returns all user-submitted notes for a parish, newest first.
 *     tags: [Notes]
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema:
 *           type: string
 *         description: Parish slug
 *     responses:
 *       200:
 *         description: Array of notes with id, author, content, created_at
 *       404:
 *         description: Parish not found
 */
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

/**
 * @swagger
 * /parishes/{slug}/notes:
 *   post:
 *     summary: Create a note for a parish
 *     description: Adds a new user note to a parish. Author defaults to "Anonymous" if omitted.
 *     tags: [Notes]
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema:
 *           type: string
 *         description: Parish slug
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [content]
 *             properties:
 *               author:
 *                 type: string
 *                 description: Author name (optional, max 50 chars)
 *               content:
 *                 type: string
 *                 description: Note content
 *     responses:
 *       201:
 *         description: Created note
 *       400:
 *         description: Content is required
 *       404:
 *         description: Parish not found
 */
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

/**
 * @swagger
 * /notes/{id}:
 *   delete:
 *     summary: Delete a note
 *     description: Removes a note by its ID.
 *     tags: [Notes]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Note ID
 *     responses:
 *       200:
 *         description: Note deleted
 *       404:
 *         description: Note not found
 */
router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM notes WHERE id = ?').run(req.params.id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Note not found' });
  }
  res.json({ success: true });
});

module.exports = router;
