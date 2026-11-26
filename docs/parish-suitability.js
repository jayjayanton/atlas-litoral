import {weightedSuitability} from './suitability-model.js';

// The original road data are in metres. Delta coding stores the sorted distances
// compactly and keeps the full distribution for any user-entered road limit.
function meanRoadFactor(deltas, cells, limitKm) {
  if (!deltas.length || !Number.isFinite(limitKm) || limitKm < .1 || limitKm > 200) return null;
  const limit = limitKm * 1000;
  let metres = 0, within = 0, sum = 0;
  for (const delta of deltas) {
    metres += delta;
    if (metres >= limit) break;
    within++;
    sum += metres;
  }
  return Math.max(0, (within - sum / limit) / cells);
}

// Each group contains cells with the same available inputs. Averaging within
// these groups keeps a missing optional input from affecting unrelated presets.
export function scoreParishes(dataset, scenario) {
  const {weights, radius, scope, limit} = scenario;
  const ri = dataset.radiiKm.indexOf(radius);
  const hi = dataset.densityColumns.indexOf(scope);
  const result = new Map();
  for (const [code, groups] of Object.entries(dataset.parishes)) {
    let cells = 0, validCells = 0, sum = 0;
    for (const group of groups) {
      cells += group.count;
      if (ri < 0 || hi < 1) continue;
      const factors = group.means[ri];
      const road = weights?.[2] > 0 ? meanRoadFactor(group.roadDeltaM, group.count, limit) : null;
      const value = weightedSuitability([factors[0], factors[hi], road, ...factors.slice(4)], weights);
      if (value === null) continue;
      sum += value * group.count;
      validCells += group.count;
    }
    result.set(code, {score:validCells ? sum / validCells : null, cells, validCells});
  }
  return result;
}
