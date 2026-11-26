import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {distanceKm} from '../docs/model.js';
import {
  buildDensityGrid, criterionKeys, presets, suitabilityFactors, suitabilityScore,
  weightedSuitability, weightShares
} from '../docs/suitability-model.js';

test('the original three-criterion scenario is preserved with optional weights at zero', () => {
  const factors = suitabilityFactors(5, 0, 1.5, 10, 2, 3, [null, null, null], 5);
  assert.deepEqual(factors, [.5, 0, .5, null, null, null]);
  assert.equal(suitabilityScore(5, 0, 1.5, 10, 2, 3, [60, 20, 20]), 40);
  assert.equal(weightedSuitability(factors, presets.school), 40);
});

test('each optional criterion is independently adjustable and uses the selected proximity radius', () => {
  const distances = [.5, 2, 6];
  const factors = suitabilityFactors(1, 0, 1.5, 10, 2, 3, distances, 5);
  assert.equal(weightedSuitability(factors, presets.shopping), 90);
  assert.equal(weightedSuitability(factors, presets.city), 60);
  assert.equal(weightedSuitability(factors, presets.tourism), 0);
  const broader = suitabilityFactors(1, 0, 1.5, 10, 2, 3, distances, 10);
  assert.equal(weightedSuitability(broader, presets.tourism), 40);
  assert.equal(weightedSuitability(factors, [0, 0, 0, 30, 10, 0]), 82.5);
  assert.deepEqual(weightShares([0, 0, 0, 30, 10, 0]), [0, 0, 0, .75, .25, 0]);
});

test('missing values only invalidate the score when they have a positive weight', () => {
  const factors = suitabilityFactors(null, 0, null, 5, 0, 3, [0, null, 10], 2);
  assert.equal(weightedSuitability(factors, presets.shopping), 100);
  assert.equal(weightedSuitability(factors, presets.city), null);
  assert.equal(weightedSuitability(factors, [0, 0, 0, 1, 1, 0]), null);
  assert.equal(weightedSuitability(factors, [0, 1, 0, 0, 0, 0]), 0);
  assert.equal(weightedSuitability(factors, [0, 0, 0, 0, 0, 0]), null);
  assert.equal(weightShares([0, 0, 0, 0, 0, 0]), null);
});

test('regional cells join by coordinates and their amenity distances match pin calculations to the metre', () => {
  const data = new URL('../docs/data/infra/', import.meta.url);
  const read = name => JSON.parse(readFileSync(new URL(name, data), 'utf8'));
  const grid = read('grid.json');
  const density = read('density.json');
  const amenities = JSON.parse(gunzipSync(readFileSync(new URL('amenity-distances.json.gz', data))));
  const sites = read('site-amenities.json');
  const inventories = [
    ...['shopping', 'city'].map(type => sites.filter(([key]) => key === type).map(row => [row[4], row[3]])),
    read('attractions.json').map(point => [point.lon, point.lat])
  ];
  // Exercise coordinate-based joining even when the base grid is in another order.
  grid.cells.reverse();
  const {cells} = buildDensityGrid(grid, density, amenities);
  assert.equal(cells.length, grid.cells.length);
  for (const i of [0, Math.floor(cells.length / 2), cells.length - 1]) {
    const c = cells[i];
    inventories.forEach((locations, index) => {
      const closest = Math.min(...locations.map(point => distanceKm(c.lat, c.lon, point)));
      assert.ok(Math.abs(c.amenityKm[index] - closest) <= .000501, criterionKeys[3 + index]);
    });
  }
});
