// Rebuild the Guayaquil municipal estimates from the same boundaries and
// census-sector interior points the atlas uses to locate projects in a parish.
import {readFileSync, writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {featureAt} from '../docs/model.js';
import {groupMunicipalParishes} from '../docs/parishes.js';

const data = new URL('../docs/data/', import.meta.url);
function read(name) {
  const bytes = readFileSync(new URL(name, data));
  return JSON.parse(name.endsWith('.gz') ? gunzipSync(bytes) : bytes);
}

const areas = groupMunicipalParishes(read('guayaquil-urban.json').features);
const households = Object.fromEntries(areas.map(f => [f.properties.code, [0, 0, 0, 0, 0]]));
const points = new Map(read('campaign-residents.json.gz').sectors
  .filter(([code]) => code.startsWith('090150'))
  .map(([code, lat, lon]) => [code, [lat, lon]]));
const {zones, withoutAgeBySector} = read('sectors/index.json');
const files = new Set(Object.entries(zones)
  .filter(([zone]) => zone.startsWith('090150'))
  .map(([, [name]]) => name));
const coverage = {mappedSectors:0, assignedSectors:0, mappedHouseholds:0, assignedHouseholds:0};

for (const name of files) {
  for (const [zone, rows] of Object.entries(read('sectors/' + name))) {
    if (!zone.startsWith('090150')) continue;
    for (const [suffix, counts] of rows) {
      const code = zone + suffix;
      const values = [...counts.slice(4), withoutAgeBySector[code] || 0];
      const total = values.reduce((sum, n) => sum + n, 0);
      coverage.mappedSectors++;
      coverage.mappedHouseholds += total;
      const point = points.get(code);
      if (!point) continue;
      const matches = areas.filter(f => featureAt([f], ...point));
      // An unmatched or ambiguous point stays unassigned, including at a boundary.
      if (matches.length !== 1) continue;
      const bucket = households[matches[0].properties.code];
      values.forEach((n, i) => { bucket[i] += n; });
      coverage.assignedSectors++;
      coverage.assignedHouseholds += total;
    }
  }
}
if (!coverage.assignedSectors || Object.values(households).flat().reduce((a,b) => a+b, 0) !== coverage.assignedHouseholds) {
  throw new Error('Municipal household counts do not reconcile.');
}
writeFileSync(new URL('guayaquil-urban-households.json', data), JSON.stringify({households, coverage}) + '\n');
console.log(coverage);
