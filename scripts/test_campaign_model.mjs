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

test('published sector income estimates use their household ages and an applied band', () => {
  const dataDir = new URL('../docs/data/', import.meta.url);
  const read = path => {
    const bytes = readFileSync(new URL(path, dataDir));
    return JSON.parse(path.endsWith('.gz') ? gunzipSync(bytes) : bytes);
  };
  const households = read('campaign-households.json.gz');
  const census = read('campaign-residents.json.gz');
  const velin = read('buildings.json')[0];
  const {provinces,zones} = read('sectors/index.json');
  const codes = census.sectors.map(s => s[0]);
  assert.deepEqual(Object.keys(households).sort(), codes.sort());
  const run = (rank,band) => rankSectors(census.sectors,velin,10,rank,3,null,households,{provinces,band});
  const cheap = run('population',1), high = run('population',4);
  assert.deepEqual(cheap.shortlist.map(s=>s.code), high.shortlist.map(s=>s.code));
  const total = rows => Math.round(rows.reduce((sum,row)=>sum+row.income.estimated,0));
  assert.equal(total(cheap.shortlist), 504);
  assert.equal(total(high.shortlist), 98);
  assert.equal(high.shortlist.reduce((sum,row)=>sum+row.income.eligible,0), 1440);
  const byIncome = run('income',4).shortlist;
  assert.equal(byIncome[2].code, '090150160001');
  assert.equal(total(byIncome), 101);
  for(const row of byIncome) {
    const zone = row.code.slice(0,9);
    const sector = read('sectors/'+zones[zone][0])[zone].find(([suffix])=>suffix===row.code.slice(9));
    assert.deepEqual(households[row.code],sector[1].slice(4));
  }
});

test('the income ranking excludes missing estimates and bands with no estimated households', () => {
  const records = [['090001',0,0,300,[20]], ['090002',0,0,200,[20]], ['240003',0,0,250,[10]]];
  const groups = prob => Array.from({length:4},()=>({shares:[prob]}));
  const provinces = {'09':groups(0),'24':groups(.5)};
  const households = {'090001':[0,0,0,0], '090002':[10,0,0,0], '240003':[2,4,6,8]};
  const plan = rankSectors(records,project,5,'income',3,null,households,{band:0,provinces});
  assert.equal(plan.rows.length,3);
  assert.deepEqual(plan.shortlist.map(r=>r.code),['240003']);
  assert.deepEqual(plan.shortlist[0].income,{eligible:20,estimated:10,share:.5});
});
