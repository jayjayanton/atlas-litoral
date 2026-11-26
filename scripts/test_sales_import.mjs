import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {parseSaleCsv} from '../docs/sales-import.js';

const fields = readFileSync(new URL('../docs/data/plantilla-ventas.csv', import.meta.url), 'utf8').trim().split(',');
const sample = {id:'prueba-1', nombre:'Edificio de prueba', tipo:'departamento', estado:'cierre_verificado',
  fecha_cierre:'2025-08-15', precio_cierre_usd:'110000.25', latitud:'-2.18', longitud:'-79.98',
  fuente:'Referencia ficticia de prueba', area_util_m2:'85', urbanizacion:'Urbanización de prueba'};
const cutoff = '2025-08-15';
function csv(rows, columns = fields, delimiter = ',') {
  const encode = cell => '"' + String(cell).replaceAll('"', '""') + '"';
  return '\uFEFF' + [columns, ...rows.map(r => columns.map(k => r[k] ?? ''))]
    .map(row => row.map(encode).join(delimiter)).join('\r\n');
}

test('Spanish decimal commas, quoted content and reordered columns produce valid GeoJSON', () => {
  const name = 'Edificio "Prueba", ala B';
  const data = csv([{...sample, nombre:name, precio_cierre_usd:'110000,25'}], [...fields].reverse(), ';');
  const {features:[sale]} = parseSaleCsv(data, cutoff);
  assert.deepEqual(sale.geometry, {type:'Point', coordinates:[-79.98, -2.18]});
  assert.equal(sale.id, 'prueba-1');
  assert.equal(sale.properties.nombre, name);
  assert.equal(sale.properties.precio_cierre_usd, 110000.25);
  assert.equal(sale.properties.area_util_m2, 85);
  assert.equal(sale.properties.urbanizacion, sample.urbanizacion);
  const basic = parseSaleCsv(csv([sample], fields.filter(k => k !== 'area_util_m2' && k !== 'urbanizacion')), cutoff);
  assert.equal(basic.features[0].properties.area_util_m2, null);
  assert.equal(basic.features[0].properties.urbanizacion, '');
});

test('rejects listings, insufficient evidence and invalid or future closes with row context', () => {
  for (const override of [{estado:'anuncio'}, {fuente:''}, {fuente:'<img onerror=foo>'}, {fuente:'javascript:foo'}, {urbanizacion:'<section>'},
    {tipo:'casa'}, {fecha_cierre:'2025-02-30'}, {fecha_cierre:'2025-08-16'}, {precio_cierre_usd:'0'},
    {precio_cierre_usd:'125.000'}, {area_util_m2:'-2'}, {longitud:'-2.18', latitud:'-79.98'}, {latitud:'0'}]) {
    assert.throws(() => parseSaleCsv(csv([{...sample, ...override}]), cutoff), /Fila 2/);
  }
  assert.throws(() => parseSaleCsv(csv([sample, sample]), cutoff), /Fila 3.*único/);
});

test('template, schema and missing columns cannot be mistaken for an import', () => {
  assert.throws(() => parseSaleCsv(csv([]), cutoff), /al menos una venta/);
  assert.throws(() => parseSaleCsv(csv([sample], fields.filter(k => k !== 'fuente')), cutoff), /Faltan columnas.*fuente/);
  assert.throws(() => parseSaleCsv(csv([sample], [...fields, 'id']), cutoff), /una sola vez/);
  assert.throws(() => parseSaleCsv(csv([sample]) + ',"extra"', cutoff), /Fila 2.*columnas/);
});
