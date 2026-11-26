import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {incomeRangeProvinces} from '../docs/income-range.js';
import {estimatedShare} from '../docs/income-map.js';

const read = name => JSON.parse(readFileSync(new URL('../docs/data/' + name, import.meta.url)));
const data = read('parish-income-ranges.json');

test('all eight age and province groups reproduce the five published ENIGHUR probabilities', () => {
  const index = read('sectors/index.json');
  assert.deepEqual(data.ageCuts, index.ageCuts);
  assert.deepEqual(Object.keys(data.provinces).sort(), ['09', '24']);
  for (const [code, groups] of Object.entries(data.provinces)) {
    assert.deepEqual(groups.map(g => g.n), index.provinces[code].map(g => g.n));
  }
  const bounds = [0, ...index.incomeCuts, null];
  index.incomeCuts.concat(null).forEach((upper, band) => {
    const refs = incomeRangeProvinces(data, bounds[band], upper);
    for (const [code, groups] of Object.entries(refs)) {
      groups.forEach((g, i) => assert.equal(Number(g.shares[0].toFixed(9)), index.provinces[code][i].shares[band]));
    }
  });
});

test('a USD 1,800–2,200 custom range agrees with an independent weighted sum over survey records', () => {
  const expected = {
    '09': [0, .03544956726860305, .051377080015511084, .04361237832953597],
    '24': [0, 0, .03178118670894809, .029949453607774776]
  };
  const refs = incomeRangeProvinces(data, 1800, 2200);
  for (const [code, groups] of Object.entries(refs)) {
    groups.forEach((g, i) => assert.ok(Math.abs(g.shares[0] - expected[code][i]) < 1e-12));
  }
  const tarqui = read('guayaquil-urban-households.json').households['gye-TARQUI'].slice(0, 4);
  const share = estimatedShare(tarqui, refs['09'], 0);
  assert.equal((share * 100).toFixed(4), '4.0892');
  assert.equal(Math.round(share * tarqui.reduce((a,b) => a + b)), 9289);
});

test('exact lower bound, exclusive upper bound, gaps and empty trailing bins are handled consistently', () => {
  const tiny = {stepUSD:100, provinces:{'09':[{weights:[1, 2, 0, 1]}]}};
  const between = (lower, upper) => incomeRangeProvinces(tiny, lower, upper)['09'][0].shares[0];
  assert.equal(between(0, 100), .25);
  assert.equal(between(100, 200), .5);
  assert.equal(between(200, 300), 0);
  assert.equal(between(300, 400), .25);
  assert.equal(between(99000, 100000), 0);
  assert.equal(between(0, 100000), 1);
  assert.equal(between(100, null), .75);
});

test('reversed, equal, unaligned, nonnumeric and out-of-bounds entries are rejected', () => {
  for (const [lower, upper] of [[2000, 1800], [1800, 1800], [1800, 2010], [1850, 2200], [-100, 300],
    [0, 100100], [100100, null], [0, Infinity], [null, 2200], [NaN, 2200], ['1800', 2200], [0, undefined]]) {
    assert.throws(() => incomeRangeProvinces(data, lower, upper), RangeError);
  }
});
