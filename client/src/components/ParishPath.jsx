function ParishPath({ slug, name, fillColor, svgPath, isActive, onSelect, onHoverStart, onHoverEnd }) {
  return (
    <path
      className={`parish ${isActive ? 'active' : ''}`}
      d={svgPath}
      fill={fillColor}
      onClick={() => onSelect(slug)}
      onMouseEnter={(e) => onHoverStart(slug, name, e)}
      onMouseMove={(e) => onHoverStart(slug, name, e)}
      onMouseLeave={onHoverEnd}
    />
  );
}

export default ParishPath;
