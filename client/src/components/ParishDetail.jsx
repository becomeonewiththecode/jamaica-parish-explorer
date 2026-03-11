import NotesPanel from './NotesPanel';

function ParishDetail({ parish, notes, onAddNote }) {
  return (
    <div id="parish-detail">
      <div className="parish-header">
        <h2>{parish.name}</h2>
        <span className="county">{parish.county}</span>
      </div>
      <div className="stats-grid">
        <div className="stat-card">
          <div className="label">Population</div>
          <div className="value">{parish.population}</div>
        </div>
        <div className="stat-card">
          <div className="label">Capital</div>
          <div className="value">{parish.capital}</div>
        </div>
        <div className="stat-card">
          <div className="label">Area</div>
          <div className="value">{parish.area}</div>
        </div>
        <div className="stat-card">
          <div className="label">County</div>
          <div className="value">{parish.county.replace('County of ', '')}</div>
        </div>
      </div>
      <div
        className="description"
        dangerouslySetInnerHTML={{ __html: parish.description }}
      />
      {parish.features && parish.features.length > 0 && (
        <div className="notable-features">
          <h3>Notable Features</h3>
          <div className="features-list">
            {parish.features.map((f, i) => (
              <span key={i} className="feature-tag">{f}</span>
            ))}
          </div>
        </div>
      )}
      <NotesPanel notes={notes} onAddNote={onAddNote} />
    </div>
  );
}

export default ParishDetail;
