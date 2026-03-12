// Maps API response (snake_case) to frontend (camelCase)
export function mapAirport(a) {
  return {
    id: a.id,
    code: a.code,
    icao: a.icao,
    name: a.name,
    shortName: a.short_name,
    type: a.type,
    lat: a.lat,
    lon: a.lon,
    parish: a.parish_slug,
    namedAfter: a.named_after,
    opened: a.opened,
    elevation: a.elevation,
    runway: a.runway,
    operator: a.operator,
    serves: a.serves,
    website: a.website,
    imageUrl: a.image_url,
    historicalFacts: a.historical_facts,
  };
}
