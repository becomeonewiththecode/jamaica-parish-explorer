import NoteForm from './NoteForm';

function NotesPanel({ notes, onAddNote }) {
  return (
    <div className="notes-panel">
      <h3>Community Notes</h3>
      <NoteForm onSubmit={onAddNote} />
      {notes.length === 0 ? (
        <p className="no-notes">No notes yet. Be the first to share something!</p>
      ) : (
        <div className="notes-list">
          {notes.map(note => (
            <div key={note.id} className="note-card">
              <div className="note-header">
                <span className="note-author">{note.author}</span>
                <span className="note-date">
                  {new Date(note.created_at + 'Z').toLocaleDateString('en-US', {
                    year: 'numeric', month: 'short', day: 'numeric'
                  })}
                </span>
              </div>
              <p className="note-content">{note.content}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default NotesPanel;
