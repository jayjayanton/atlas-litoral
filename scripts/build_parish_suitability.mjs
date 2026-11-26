// Run from any directory with: node scripts/build_parish_suitability.mjs
// Attribute each existing regional grid centre to at most one census parish
// and, inside Guayaquil's seat, at most one separately reported municipal parish.
import {readFileSync, writeFileSync} from 'node:fs';
import {gzipSync, gunzipSync} from 'node:zlib';
import {featureAt} from '../docs/model.js';
import {groupMunicipalParishes} from '../docs/parishes.js';
import {buildDensityGrid, densityFactor, proximity} from '../docs/suitability-model.js';

const data = new URL('../docs/data/', import.meta.url);
function read(name) {
  const bytes = readFileSync(new URL(name, data));
  return JSON.parse(name.endsWith('.gz') ? gunzipSync(bytes) : bytes);
}

function bounds(feature) {
  const points = feature.geometry.coordinates.flat(feature.geometry.type === 'Polygon' ? 1 : 2);
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const [x, y] of points) {
    west = Math.min(west, x); south = Math.min(south, y);
    east = Math.max(east, x); north = Math.max(north, y);
  }
  return {feature, west, south, east, north};
}

function uniqueArea(candidates, cell) {
  let match;
  for (const {feature, west, south, east, north} of candidates) {
    if (cell.lon < west || cell.lon > east || cell.lat < south || cell.lat > north) continue;
    if (!featureAt([feature], cell.lat, cell.lon)) continue;
    if (match) return null; // Overlapping simplified boundaries cannot give a unique assignment.
    match = feature.properties.code;
  }
  return match;
}

const grid = read('infra/grid.json'), density = read('infra/density.json');
const {cells, maxima} = buildDensityGrid(grid, density, read('infra/amenity-distances.json.gz'));
const scale = read('infra/density-scale.json');
if (JSON.stringify(maxima) !== JSON.stringify(scale.maxima) ||
    JSON.stringify(density.radiiKm) !== JSON.stringify(scale.radiiKm) ||
    density.columns.join(',') !== 'school,all,public,private' ||
    density.columns.join(',') !== scale.columns.join(',')) {
  throw Error('The regional density grid and suitability scale differ.');
}
const official = read('parishes.json').features, urban = groupMunicipalParishes(read('guayaquil-urban.json').features);
const cantons = new Map(), municipal = urban.map(bounds);
for (const feature of official) {
  const code = feature.properties.canton;
  if (!cantons.has(code)) cantons.set(code, []);
  cantons.get(code).push(bounds(feature));
}
const buckets = new Map([...official, ...urban].map(f => [f.properties.code, new Map()]));
const coverage = {gridCells:cells.length, officialCells:0, ambiguousOfficial:0, unassignedOfficial:0, urbanCells:0};

function add(code, cell) {
  const distances = [cell.roadKm, ...cell.amenityKm];
  const availability = distances.map(n => Number.isFinite(n) && n >= 0 ? 1 : 0).join('');
  const groups = buckets.get(code);
  if (!groups.has(availability)) {
    groups.set(availability, {count:0, means:scale.radiiKm.map(() => Array(7).fill(0)), roadDeltaM:[]});
  }
  const group = groups.get(availability);
  group.count++;
  if (availability.startsWith('1')) {
    const metres = Math.round(cell.roadKm * 1000);
    if (Math.abs(metres / 1000 - cell.roadKm) > 1e-10) throw Error('Road distance has sub-metre precision.');
    group.roadDeltaM.push(metres);
  }
  scale.radiiKm.forEach((radius, ri) => {
    const counts = cell.counts[ri], max = maxima[ri];
    const values = [...counts.map((count, i) => densityFactor(count, max[i])),
      ...cell.amenityKm.map(km => proximity(km, radius))];
    values.forEach((value, i) => {
      if (value === null) group.means[ri][i] = null;
      else group.means[ri][i] += value;
    });
  });
}
for (const cell of cells) {
  const code = uniqueArea(cantons.get(cell.code) || [], cell);
  if (!code) {
    if (code === null) coverage.ambiguousOfficial++;
    else coverage.unassignedOfficial++;
    continue;
  }
  add(code, cell); coverage.officialCells++;
  if (code === '090150') {
    const local = uniqueArea(municipal, cell);
    if (local) { add(local, cell); coverage.urbanCells++; }
  }
}
const parishes = {};
for (const [code, groups] of buckets) {
  parishes[code] = [...groups.values()];
  for (const group of parishes[code]) {
    group.means = group.means.map(row => row.map(sum => sum === null ? null : sum / group.count));
    group.roadDeltaM.sort((a,b) => a-b);
    group.roadDeltaM = group.roadDeltaM.map((metres, i, sorted) => metres - (sorted[i-1] || 0));
  }
}
const result = {spacingKm:grid.spacingKm, radiiKm:scale.radiiKm, densityColumns:scale.columns, coverage, parishes};
writeFileSync(new URL('infra/parish-suitability.json.gz', data), gzipSync(JSON.stringify(result), {level:9}));
console.log(coverage, 'Parishes without centres:', Object.keys(parishes).filter(code => !parishes[code].length));
