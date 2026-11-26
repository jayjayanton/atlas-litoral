import {readCSV, todayEC} from './model.js';

const required = ['id', 'nombre', 'tipo', 'estado', 'fecha_cierre', 'precio_cierre_usd', 'latitud', 'longitud', 'fuente'];
// Coarse coordinate check west of Guayaquil, not an administrative corridor boundary.
const bounds = {south:-2.36, north:-2.02, west:-80.32, east:-79.92};

export function parseSaleCsv(text, asOf = todayEC()) {
  const [headers = [], ...rows] = readCSV(text);
  const missing = required.filter(field => !headers.includes(field));
  if (missing.length) throw Error('Faltan columnas de la plantilla: ' + missing.join(', ') + '.');
  if (headers.some(field => !required.includes(field) && !['area_util_m2', 'urbanizacion'].includes(field)) ||
      new Set(headers).size !== headers.length) {
    throw Error('Usa las columnas de la plantilla una sola vez cada una.');
  }
  if (!rows.length) throw Error('Agrega al menos una venta a la plantilla.');
  const ids = new Set();
  const features = rows.map((row, index) => {
    function fail(message) { throw Error('Fila ' + (index + 2) + '. ' + message); }
    if (row.length !== headers.length) fail('Revisa el número de columnas y el separador del CSV.');
    const fields = Object.fromEntries(headers.map((field, i) => [field, row[i]]));

    const {id, nombre, fuente, fecha_cierre, urbanizacion = ''} = fields;
    if (!id || ids.has(id)) fail('Indica un id anónimo y único por compraventa.');
    if (!nombre || !fuente) fail('Indica la urbanización o edificio en nombre y el documento de cierre en fuente.');
    if ([id, nombre, fuente, urbanizacion].some(value => /[<>\x00-\x1f\x7f]/.test(value))) {
      fail('Usa texto sencillo sin etiquetas ni saltos de línea en id, nombre, urbanizacion y fuente.');
    }
    if (/^\s*(?:javascript|data|vbscript)\s*:/i.test(fuente)) fail('Indica una referencia documental o un enlace web de la fuente.');
    if (fields.tipo.toLowerCase() !== 'departamento') fail('La columna tipo debe indicar departamento.');
    if (fields.estado.toLowerCase() !== 'cierre_verificado') {
      fail('Usa cierre_verificado en estado solo cuando la fuente confirme la venta, su fecha y el precio final.');
    }
    const date = new Date(fecha_cierre + 'T00:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha_cierre) || !Number.isFinite(date.getTime()) ||
        !date.toISOString().startsWith(fecha_cierre) || fecha_cierre > asOf) {
      fail('Usa una fecha de cierre real hasta hoy en formato AAAA-MM-DD.');
    }

    function decimal(field, pattern) {
      const value = fields[field];
      if (!pattern.test(value)) fail('Revisa ' + field + '. Escribe un número sin separador de miles.');
      const number = Number(value.replace(',', '.'));
      if (!Number.isFinite(number)) fail('Revisa el número en ' + field + '.');
      return number;
    }
    const money = /^\d+(?:[.,]\d{1,2})?$/;
    const coordinate = /^-?\d+(?:[.,]\d+)?$/;
    const precio_cierre_usd = decimal('precio_cierre_usd', money);
    if (precio_cierre_usd <= 0) fail('El precio final de cierre debe ser mayor que cero.');
    const area_util_m2 = fields.area_util_m2 ? decimal('area_util_m2', /^\d+(?:[.,]\d+)?$/) : null;
    if (area_util_m2 !== null && area_util_m2 <= 0) fail('Indica un área útil positiva en m² o deja la celda vacía.');
    const lat = decimal('latitud', coordinate), lon = decimal('longitud', coordinate);
    if (lat < bounds.south || lat > bounds.north || lon < bounds.west || lon > bounds.east) {
      fail('Revisa las coordenadas de Vía a la Costa (WGS84): latitud −2,36 a −2,02 y longitud −80,32 a −79,92.');
    }
    ids.add(id);
    return {
      type:'Feature', id, geometry:{type:'Point', coordinates:[lon, lat]},
      properties:{id, nombre, urbanizacion, tipo:'departamento', estado:'cierre_verificado', fecha_cierre, precio_cierre_usd, fuente, area_util_m2}
    };
  });
  return {type:'FeatureCollection', features};
}
