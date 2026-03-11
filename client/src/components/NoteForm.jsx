import { useState } from 'react';

function NoteForm({ onSubmit }) {
  const [author, setAuthor] = useState('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!content.trim()) return;
    setSubmitting(true);
    try {
      await onSubmit(author.trim() || 'Anonymous', content.trim());
      setAuthor('');
      setContent('');
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="note-form" onSubmit={handleSubmit}>
      <input
        type="text"
        placeholder="Your name (optional)"
        value={author}
        onChange={(e) => setAuthor(e.target.value)}
        maxLength={50}
      />
      <textarea
        placeholder="Share something about this parish..."
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={3}
        required
        maxLength={1000}
      />
      <button type="submit" disabled={submitting || !content.trim()}>
        {submitting ? 'Adding...' : 'Add Note'}
      </button>
    </form>
  );
}

export default NoteForm;
