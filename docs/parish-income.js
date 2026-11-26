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

function incomeForArea(counts, refs, band) {
  if (!counts || !refs) return null;
  const homes = counts.slice(0,4);
  const share = estimatedShare(homes, refs, band);
  if (!Number.isFinite(share)) return null;
  const eligibleHouseholds = homes.reduce((sum,n)=>sum+n,0);
  return {share, eligibleHouseholds, estimatedHouseholds:share*eligibleHouseholds,
    unknownHouseholds:counts[4], totalHouseholds:eligibleHouseholds+counts[4]};
}

export function queryCampaignParishes({point, method='nearby', referenceCode='', band, minShare=0, minScore=0,
                                       parishes, households, provinces, urbanParishes, urbanHouseholds, scores}) {
  const result = {rows:[], reference:null, scoredCount:0, matchedCount:0, maxScore:null};
  const useIncome = band!=null;
  const useScore = method!=='nearby';
  const hasPoint=Number.isFinite(point?.lat) && Number.isFinite(point?.lon) &&
    Math.abs(point.lat)<=90 && Math.abs(point.lon)<=180;
  if (!['nearby','similar','minimum'].includes(method) ||
      (!hasPoint && (!useScore || point!=null)) ||
      (useIncome && (!Number.isInteger(band) || band<0 || band>4)) ||
      (!useIncome && !useScore) || !Number.isFinite(minShare) || minShare<0 || minShare>1 ||
      (method==='minimum' && (!Number.isFinite(minScore) || minScore<0 || minScore>100))) return result;

  const municipal = urbanParishes!=null || urbanHouseholds!=null;
  if (municipal && (!urbanParishes?.length || (useIncome && !urbanHouseholds))) {
    throw new Error('Faltan los límites o los hogares de las parroquias urbanas.');
  }
  const candidates = municipal
    ? [...parishes.filter(f=>f.properties.code!=='090150'), ...urbanParishes] : parishes;
  const reference = method==='similar' && (referenceCode
    ? candidates.find(feature=>feature.properties.code===referenceCode)
    : hasPoint && featureAt(candidates,point.lat,point.lon));
  if (reference) {
    const {code,name} = reference.properties;
    const value=scores?.get(code);
    result.reference={code,name,score:value?.score??null,cells:value?.cells??0,validCells:value?.validCells??0};
  }
  if (method==='similar' && !Number.isFinite(result.reference?.score)) return result;

  const matches=[];
  for (const feature of candidates) {
    const {code,name,kind,canton} = feature.properties;
    if (reference && code===reference.properties.code) continue;
    const urban = code.startsWith('gye-');
    const value = useScore ? scores?.get(code) : null;
    if (useScore) {
      if (!Number.isFinite(value?.score)) continue;
      result.scoredCount++;
    }
    const income = useIncome ? incomeForArea((urban?urbanHouseholds:households)?.[code],provinces?.[canton.slice(0,2)],band) : null;
    if (useIncome && (!income || income.share<=0 || income.share<minShare)) continue;
    if (useScore) result.maxScore=Math.max(result.maxScore??0,value.score);
    if (method==='minimum' && value.score<minScore) continue;
    const km=hasPoint ? distanceToParish(point,feature) : null;
    if (hasPoint && !Number.isFinite(km)) continue;
    const row={code,name,kind,canton,municipal:urban,distanceKm:km,...income};
    if (useScore) Object.assign(row,value);
    if (reference) row.difference=value.score-result.reference.score;
    matches.push(row);
  }
  const byLocation=(a,b)=>a.distanceKm-b.distanceKm || a.code.localeCompare(b.code,'es');
  if (method==='similar') matches.sort((a,b)=>Math.abs(a.difference)-Math.abs(b.difference) || byLocation(a,b));
  else if (method==='minimum') matches.sort((a,b)=>b.score-a.score || byLocation(a,b));
  else matches.sort(byLocation);
  result.matchedCount=matches.length;
  result.rows=matches.slice(0,5);
  return result;
}

// Existing callers consume the five nearest income results as a list.
export function nearbyParishIncome(options) {
  return queryCampaignParishes({...options,method:'nearby'}).rows;
}
