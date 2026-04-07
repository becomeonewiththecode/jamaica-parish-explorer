const landingVariants = [
  {
    id: 'roots',
    label: 'Roots & Rhythm',
    headline: 'Land of Reggae, Freedom, and One Love',
    subhead:
      'A warm, soulful opening experience inspired by roots reggae, proud culture, and the pulse of Jamaica.',
    bullets: ['Live the rhythm of every parish', 'Blue Mountains backdrop and roots energy', 'Freedom, welcome, and one love spirit'],
    quote: 'Out of many, one people.',
    cta: 'Start The Journey'
  },
  {
    id: 'sunrise',
    label: 'Sunrise Escape',
    headline: 'Sunshine, Sea Breeze, and Easy Joy',
    subhead:
      'A bright travel-first concept focused on beaches, nature, and effortless discovery across the island.',
    bullets: ['Curated coastal and inland highlights', 'Simple route from curiosity to adventure', 'Designed for first-time and return visitors'],
    quote: 'Good vibes. Golden skies. Jamaica.',
    cta: 'Explore Jamaica'
  },
  {
    id: 'unity',
    label: 'Out of Many',
    headline: 'Many Voices, One Island Spirit',
    subhead:
      'A community-centered homepage concept celebrating Jamaica as welcoming, diverse, and proudly connected.',
    bullets: ['Culture, food, music, and history together', 'Built around people and local perspective', 'Invites discovery with warmth and respect'],
    quote: 'Out of many, one.',
    cta: 'Enter The Island Map'
  }
];

function LandingShowcase({ selectedVariant, onVariantChange, onEnterExplorer }) {
  const active = landingVariants.find((variant) => variant.id === selectedVariant) || landingVariants[0];

  return (
    <div className={`landing-showcase landing-${active.id}`}>
      <div className="landing-overlay" />
      <main className="landing-content">
        <p className="landing-eyebrow">Jamaica Parish Explorer</p>
        {active.id === 'roots' && (
          <div className="roots-scene" aria-hidden="true">
            <div className="roots-circle-layout">
              <img className="roots-img roots-img-main" src="/landing/roots-rasta.png" alt="" />
              <img className="roots-img roots-img-smoke" src="/landing/roots-smoke.png" alt="" />
              <img className="roots-img roots-img-crew" src="/landing/roots-crew.png" alt="" />
              <img className="roots-img roots-img-profile" src="/landing/roots-art-profile.png" alt="" />
              <img className="roots-img roots-img-emancipation" src="/landing/roots-emancipation.png" alt="" />
              <img className="roots-img roots-img-flag" src="/landing/roots-flag-leaves.png" alt="" />
              <img className="roots-img roots-img-waterfall" src="/landing/roots-waterfall.png" alt="" />
              <div className="roots-music-symbol">♪ ♫</div>
              <div className="roots-freedom-tag">Freedom</div>
            </div>
          </div>
        )}
        <h1>{active.headline}</h1>
        <p className="landing-subhead">{active.subhead}</p>
        <ul className="landing-bullets">
          {active.bullets.map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ul>
        <p className="landing-quote">{active.quote}</p>
        <button className="landing-primary-cta" onClick={onEnterExplorer}>
          {active.cta}
        </button>
      </main>

      <aside className="landing-picker" aria-label="Landing page concepts">
        <p className="landing-picker-title">Choose a concept</p>
        <div className="landing-picker-options">
          {landingVariants.map((variant) => (
            <button
              key={variant.id}
              className={`landing-picker-option ${variant.id === active.id ? 'active' : ''}`}
              onClick={() => onVariantChange(variant.id)}
            >
              <span>{variant.label}</span>
            </button>
          ))}
        </div>
      </aside>
    </div>
  );
}

export default LandingShowcase;
