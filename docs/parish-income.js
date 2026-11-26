import {estimatedShare} from './income-map.js';
import {distanceKm, featureAt} from './model.js';

// Use the nearest edge of each part, including holes and offshore islands.
// Project the short boundary segments onto the project's local tangent plane,
// then measure the distance to the nearest point on the sphere.
function distanceToParish(point, feature) {
  const {lat, lon} = point;
  if (featureAt([feature], lat, lon)) return 0;
  const {type, coordinates} = feature.geometry;
  const polygons = type === 'Polygon' ? [coordinates] : coordinates;
  const longitudeScale = Math.cos(lat * Math.PI / 180);
  let bestSquared = Infinity, nearest;
  for (const polygon of polygons) for (const ring of polygon) {
    for (let i = 1; i < ring.length; i++) {
      const [x, y] = ring[i-1], [nextX, nextY] = ring[i];
      const dx = (nextX-x)*longitudeScale, dy = nextY-y;
      const px = (lon-x)*longitudeScale, py = lat-y;
      const lengthSquared = dx*dx + dy*dy;
      const t = lengthSquared ? Math.max(0, Math.min(1, (px*dx + py*dy)/lengthSquared)) : 0;
      const squared = (px-t*dx)**2 + (py-t*dy)**2;
      if (squared < bestSquared) {
        bestSquared = squared;
        nearest = [x + t*(nextX-x), y + t*dy];
      }
    }
  }
  return nearest ? distanceKm(lat, lon, nearest) : Infinity;
}

// minShare and share are fractions. Estimated household counts retain their
// precision for filtering and rendering. Official parish counts include pooled
// census sectors. The optional municipal breakdown replaces their parent area.
export function nearbyParishIncome({point, band, minShare=0, parishes, households, provinces,
                                   urbanParishes, urbanHouseholds}) {
  if (!Number.isFinite(point?.lat) || !Number.isFinite(point?.lon) ||
      Math.abs(point.lat)>90 || Math.abs(point.lon)>180 ||
      !Number.isInteger(band) || band<0 || band>4 ||
      !Number.isFinite(minShare) || minShare<0 || minShare>1) return [];
  const municipal = urbanParishes!=null || urbanHouseholds!=null;
  if (municipal && (!urbanParishes?.length || !urbanHouseholds)) {
    throw new Error('Faltan los límites o los hogares de las parroquias urbanas.');
  }
  const candidates = municipal
    ? [...parishes.filter(f=>f.properties.code!=='090150'), ...urbanParishes] : parishes;
  const matches = [];
  for (const feature of candidates) {
    const {code, name, kind, canton} = feature.properties;
    const urban = code.startsWith('gye-');
    const counts = (urban ? urbanHouseholds : households)[code];
    if (!counts) continue;
    const homes = counts.slice(0,4);
    const share = estimatedShare(homes, provinces[canton.slice(0,2)], band);
    if (share===null || share<=0 || share<minShare) continue;
    const km = distanceToParish(point, feature);
    if (!Number.isFinite(km)) continue;
    const eligibleHouseholds = homes.reduce((sum,n)=>sum+n,0);
    const unknownHouseholds = counts[4];
    matches.push({code, name, kind, canton, municipal:urban, distanceKm:km, share,
      estimatedHouseholds:share*eligibleHouseholds, eligibleHouseholds, unknownHouseholds,
      totalHouseholds:eligibleHouseholds+unknownHouseholds});
  }
  return matches.sort((a,b)=>a.distanceKm-b.distanceKm || a.code.localeCompare(b.code,'es')).slice(0,5);
}
