import NotesPanel from './NotesPanel';

function ParishDetail({ parish, notes, onAddNote, places, onFeatureClick }) {

  const handleFeatureClick = (featureName) => {
    if (!places || !places.length || !onFeatureClick) return;
    // Find a place whose name matches (case-insensitive, partial match)
    const lower = featureName.toLowerCase();
    const match = places.find(p => p.name.toLowerCase() === lower)
      || places.find(p => p.name.toLowerCase().includes(lower))
      || places.find(p => lower.includes(p.name.toLowerCase()));
    if (match) {
      onFeatureClick(match);
    }
  };

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
              <button
                key={i}
                className="feature-tag feature-tag-link"
                onClick={() => handleFeatureClick(f)}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      )}
      <NotesPanel notes={notes} onAddNote={onAddNote} />
    </div>
  );
}

export default ParishDetail;
