export function parseCoordinates(text) {
  const raw = String(text ?? '').trim();
  const decimal = '[+-]?(?:[0-9]+(?:[.][0-9]+)?|[.][0-9]+)';
  const pair = new RegExp('^(' + decimal + ')(?:\\s*,\\s*|\\s+)(' + decimal + ')$');
  const normalized = raw.includes(';') ? raw.replace(/,/g, '.').replace(';', ' ') : raw;
  const match = normalized.match(pair);
  if (!match) return null;
  const lat = Number(match[1]), lon = Number(match[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? {lat, lon} : null;
}

export function validBuilding(b) {
  return b && typeof b.name === 'string' && b.name.trim().length > 0 &&
    Number.isFinite(b.lat) && Math.abs(b.lat) <= 90 &&
    Number.isFinite(b.lon) && Math.abs(b.lon) <= 180;
}

export function sameBuilding(a, b) {
  return a.name.trim().toLowerCase() === b.name.trim().toLowerCase() &&
    a.lat === b.lat && a.lon === b.lon;
}

export function buildingList(catalog, saved) {
  const all = new Map();
  for (const b of [...catalog, ...(Array.isArray(saved?.items) ? saved.items : [])]) {
    if (validBuilding(b) && typeof b.id === 'string' && b.id) all.set(b.id, b);
  }
  return [...all.values()];
}

export function buildingURL(href, b) {
  const url = new URL(href);
  url.search = '';
  url.searchParams.set('edificio', b.name);
  url.searchParams.set('lat', b.lat);
  url.searchParams.set('lon', b.lon);
  const level={parish:'parroquia',canton:'canton',zone:'zona',sector:'sector'}[b.focusArea];
  if (level) url.searchParams.set('nivel',level);
  url.hash = 'explorar';
  return url;
}

export function buildingFromURL(href) {
  const params = new URL(href).searchParams;
  const name = params.get('edificio')?.trim();
  const point = parseCoordinates([params.get('lat'), params.get('lon')].join(','));
  if (!name || name.length > 80 || !point) return null;
  const level = params.get('nivel');
  const focusArea = level==='canton'?'canton':level==='parroquia'?'parish':level==='zona'?'zone':level==='sector'?'sector':undefined;
  return focusArea ? {name, ...point, focusArea} : {name, ...point};
}
