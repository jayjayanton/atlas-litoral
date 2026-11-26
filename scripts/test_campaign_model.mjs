import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {gunzipSync} from 'node:zlib';
import {rankSectors} from '../docs/campaign-model.js';

const project = {lat: 0, lon: 0};
const sectors = [
  ['02', 0.01, 0, 300, [30]],
  ['01', 0.01, 0, 300, [60]],
  ['03', 0.02, 0, 400, [20]],
  ['04', 1, 1, 500, [130]]
];

test('uses the whole radius as the denominator; resolves equal populations by distance and code', () => {
  const plan = rankSectors(sectors, project, 10, 'population', 2, 0);
  assert.deepEqual(plan.rows.map(row => row.code), ['03', '01', '02']);
  assert.equal(plan.total, 1000);
  assert.equal(plan.pilot, 700);
  assert.equal(plan.group, 110);
  assert.equal(plan.pilotGroup, 80);
});

test('proximity and cohort use distinct priorities; an empty or undersized radius has no extra sectors', () => {
  assert.deepEqual(rankSectors(sectors, project, 10, 'near', 3).shortlist.map(row => row.code), ['01', '02', '03']);
  assert.equal(rankSectors(sectors, project, 10, 'cohort', 1, 0).shortlist[0].code, '01');
  assert.equal(rankSectors(sectors, project, 0.1, 'near', 3).shortlist.length, 0);
  const all = rankSectors(sectors, project, 10, 'population', 5);
  assert.equal(all.shortlist.length, 3);
  assert.equal(all.total, all.group);
  assert.equal(all.pilot, all.total);
});

test('pairs distinct non-pilot sectors in priority order; breaks population ties by distance difference then code', () => {
  const ties = [
    ['p1', 0.01, 0, 500, [20]],
    ['p2', 0.03, 0, 490, [20]],
    ['c2', 0.01, 0, 480, [20]],
    ['c1', 0.01, 0, 480, [20]],
    ['c3', 0.03, 0, 480, [20]]
  ];
  const plan = rankSectors(ties, project, 10, 'population', 2);
  assert.deepEqual(plan.pairs.map(pair => [pair.pilot.code, pair.reference.code]), [['p1', 'c1'], ['p2', 'c3']]);
  const partial = rankSectors(ties, project, 10, 'population', 4);
  assert.equal(partial.pairs.length, 1);
  assert.equal(partial.pairs[0].pilot.code, 'p1');
  assert(!partial.shortlist.some(row => row.code === partial.pairs[0].reference.code));
  assert.deepEqual(rankSectors(ties, project, 10, 'population', 5).pairs, []);
});

test('reproduces the published 2022 reference example at ten kilometers', () => {
  const dataDir = new URL('../docs/data/', import.meta.url);
  const census = JSON.parse(gunzipSync(readFileSync(new URL('campaign-residents.json.gz', dataDir))));
  const buildings = JSON.parse(readFileSync(new URL('buildings.json', dataDir)));
  const velin = buildings.find(b => b.id === 'velin-tower');
  const result = rankSectors(census.sectors, velin, 10, 'population', 3);
  assert.equal(result.rows.length, 3532);
  assert.equal(result.total, 1493878);
  assert.equal(result.pilot, 4910);
  assert.deepEqual(result.pairs.map(pair => pair.reference.code), ['090150160001', '090150270002', '090150584002']);
  assert.equal(result.pairs.reduce((sum, pair) => sum + pair.reference.residents, 0), 3014);
  assert.deepEqual(result.shortlist.map(row => row.code), ['090150235005', '090150225001', '090150411001']);
});
