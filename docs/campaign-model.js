import {distanceKm} from './model.js';
import {estimatedShare} from './income-map.js';

function comparisonSectors(shortlist, candidates) {
  const available = new Set(candidates);
  const pairs = [];
  for (const pilot of shortlist) {
    if (!available.size) break;
    function compare(a, b) {
      return Math.abs(a.residents - pilot.residents) - Math.abs(b.residents - pilot.residents)
        || Math.abs(a.distance - pilot.distance) - Math.abs(b.distance - pilot.distance)
        || a.code.localeCompare(b.code);
    }
    let best;
    for (const candidate of available) {
      if (!best || compare(candidate, best) < 0) best = candidate;
    }
    pairs.push({pilot, reference: best});
    available.delete(best);
  }
  return pairs;
}

export function sectorIncome(code, households, income) {
  const homes = households?.[code], refs = income?.provinces?.[code.slice(0,2)];
  if (!homes || !refs) return null;
  const share = estimatedShare(homes, refs, income.band);
  if (!Number.isFinite(share)) return null;
  const eligible = homes.reduce((sum,n) => sum+n, 0);
  return {eligible, estimated:share*eligible, share};
}

export function rankSectors(sectors, project, radiusKm, order, limit, ageIndex = null, households = null, income = null) {
  const rows = [];
  for (const [code, lat, lon, residents, ages] of sectors) {
    const distance = distanceKm(project.lat, project.lon, [lon, lat]);
    if (distance > radiusKm) continue;
    const count = ageIndex === null ? residents : ages[ageIndex];
    rows.push({code, lat, lon, residents, count, distance, income:sectorIncome(code,households,income)});
  }

  rows.sort((a, b) => {
    if (order === 'income') {
      const delta = (b.income?.estimated ?? -1) - (a.income?.estimated ?? -1);
      if (delta) return delta;
    }
    if (order === 'population' && a.residents !== b.residents) return b.residents - a.residents;
    if (order === 'cohort' && a.count !== b.count) return b.count - a.count;
    return a.distance - b.distance || a.code.localeCompare(b.code);
  });

  const shortlist = (order === 'income' ? rows.filter(row => row.income?.estimated > 0) : rows).slice(0, limit);
  const total = rows.reduce((sum, row) => sum + row.residents, 0);
  const pilot = shortlist.reduce((sum, row) => sum + row.residents, 0);
  const group = rows.reduce((sum, row) => sum + row.count, 0);
  const pilotGroup = shortlist.reduce((sum, row) => sum + row.count, 0);
  const pairs = comparisonSectors(shortlist, rows.slice(shortlist.length));
  return {rows, shortlist, total, pilot, group, pilotGroup, pairs};
}
