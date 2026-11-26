import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import test from 'node:test';
import {featureAt} from '../docs/model.js';
import {groupMunicipalParishes} from '../docs/parishes.js';
import {scoreParishes} from '../docs/parish-suitability.js';
import {buildDensityGrid, presets, suitabilityFactors, weightedSuitability} from '../docs/suitability-model.js';

const source = new URL('../docs/data/', import.meta.url);
function read(name) {
  const data = readFileSync(new URL(name, source));
  return JSON.parse(name.endsWith('.gz') ? gunzipSync(data) : data);
}
const input = read('infra/parish-suitability.json.gz');
const defaultScenario = {scope:'all', radius:5, limit:3, weights:presets.balanced};

test('empty parishes keep an unavailable score; invalid scenarios are not zeroes', () => {
  const scores = scoreParishes(input, defaultScenario);
  assert.equal(scores.size, 80);
  assert.equal([...scores.values()].filter(v=>!v.cells).length, 7);
  assert.deepEqual(scores.get('gye-OLMEDO'), {score:null, cells:0, validCells:0});
  assert.equal(scores.get('gye-TARQUI').cells, 561);
  const officialCells = [...scores].filter(([code])=>!code.startsWith('gye-'))
    .reduce((total,[,area])=>total+area.cells, 0);
  assert.equal(officialCells, input.coverage.officialCells);
  assert.equal(officialCells+input.coverage.ambiguousOfficial+input.coverage.unassignedOfficial, input.coverage.gridCells);
  for (const change of [{radius:4}, {scope:'unlisted'}, {weights:[0,0,0,0,0,0]}, {limit:201}]) {
    const result = scoreParishes(input, {...defaultScenario, ...change}).get('gye-TARQUI');
    assert.deepEqual(result, {score:null, cells:561, validCells:0});
  }
});

test('inactive unavailable inputs retain cells; active inputs use the same set of cells for all weights', () => {
  const fixture = {radiiKm:[5], densityColumns:['school','all','public','private'], parishes:{sample:[
    {count:2, means:[[1,0,0,0,.5,.1,.8]], roadDeltaM:[0,1000]},
    {count:1, means:[[.4,0,0,0,null,.2,null]], roadDeltaM:[]}
  ]}};
  const score = weights => scoreParishes(fixture, {...defaultScenario,weights,limit:1}).get('sample');
  assert.equal(score([100,0,0,0,0,0]).validCells, 3);
  assert.equal(score([100,0,0,0,0,0]).score, 80);
  assert.deepEqual(score([50,0,50,0,0,0]), {score:75,cells:3,validCells:2});
  assert.deepEqual(score([0,0,0,100,0,0]), {score:50,cells:3,validCells:2});
});

test('published parish means match the original cell scorer over the actual Tarqui geometry', () => {
  const density = read('infra/density.json');
  const {cells, maxima} = buildDensityGrid(read('infra/grid.json'), density, read('infra/amenity-distances.json.gz'));
  const urban = groupMunicipalParishes(read('guayaquil-urban.json').features);
  const tarqui = urban.filter(f=>f.properties.code==='gye-TARQUI');
  const seat = read('parishes.json').features.filter(f=>f.properties.code==='090150');
  const local = cells.filter(c=>c.code==='0901' && featureAt(tarqui,c.lat,c.lon) && featureAt(seat,c.lat,c.lon));
  assert.equal(local.length, 561);
  for (const scenario of [defaultScenario,
    {radius:2,scope:'public',limit:1.2345,weights:[10,31,43,2,27,6]},
    {radius:10,scope:'private',limit:0.15,weights:presets.road},
    {radius:10,scope:'all',limit:200,weights:presets.tourism},
    {radius:2,scope:'private',limit:NaN,weights:[10,35,0,20,45,30]}]) {
    const ri = density.radiiKm.indexOf(scenario.radius), hi = density.columns.indexOf(scenario.scope);
    const sum = local.reduce((total,c)=>{
      const row = c.counts[ri];
      const factors = suitabilityFactors(row[0],row[hi],c.roadKm,maxima[ri][0],maxima[ri][hi],
        scenario.limit,c.amenityKm,scenario.radius);
      return total + weightedSuitability(factors,scenario.weights);
    }, 0);
    const result = scoreParishes(input, scenario).get('gye-TARQUI');
    assert.equal(result.validCells, local.length);
    assert.ok(Math.abs(result.score - sum/local.length) < 1e-10);
  }
});
