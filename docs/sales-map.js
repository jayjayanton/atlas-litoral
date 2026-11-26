import {initBasemap, osmCredit} from './basemaps.js';
import {median, normalize, todayEC} from './model.js';
import {parseSaleCsv} from './sales-import.js';
import {saleReferences} from './sales-references.js';

const dollars = new Intl.NumberFormat('es-EC', {style:'currency', currency:'USD', maximumFractionDigits:0});
const numbers = new Intl.NumberFormat('es-EC', {maximumFractionDigits:2});
const dates = new Intl.DateTimeFormat('es-EC', {day:'numeric', month:'short', year:'numeric', timeZone:'UTC'});
const dateLabel = iso => dates.format(new Date(iso + 'T00:00:00Z'));

function element(tag, text) {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}

function link(text, url) {
  const anchor = element('a', text);
  anchor.href = url;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  return anchor;
}

function source(value) {
  try {
    const url = new URL(value);
    if (['https:', 'http:'].includes(url.protocol)) return link('Ver fuente', url.href);
  } catch { /* The source can also be a short document reference. */ }
  return document.createTextNode(value);
}

function lastYearStart(today) {
  const [year, month, day] = today.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year-1, month, 0)).getUTCDate();
  return new Date(Date.UTC(year-1, month-1, Math.min(day, lastDay)+1)).toISOString().slice(0,10);
}

function addLocalRoads(map) {
  // The same national OSM download is used by the main atlas. Draw only lines
  // in western Guayaquil on this map; the local streets remain if it is offline.
  fetch('./data/infra/roads.geojson').then(response => {
    if (!response.ok) throw Error('Red vial');
    return response.json();
  }).then(data => {
    const roads = [];
    for (const feature of data.features) {
      const {type, coordinates} = feature.geometry;
      const parts = type === 'LineString' ? [coordinates] : coordinates;
      const local = parts.filter(line => line.some(([lon,lat]) =>
        lon >= -80.36 && lon <= -79.87 && lat >= -2.4 && lat <= -1.98));
      if (local.length) roads.push({...feature, geometry:{type:'MultiLineString', coordinates:local}});
    }
    L.geoJSON(roads, {pane:'sales-local', interactive:false, style:{color:'#a17849', weight:2, opacity:.8}}).addTo(map);
  }).catch(() => { /* The bundled base and points render independently. */ });
}

export function initSalesMap({context, streets} = {}) {
  const byId = id => document.getElementById(id);
  const panel = byId('ventas-costa'), container = byId('sales-map');
  const form = byId('sales-form'), file = byId('sales-file'), period = byId('sales-period');
  const area = byId('sales-area'), clear = byId('sales-clear'), status = byId('sales-import-status');
  const summary = byId('sales-summary'), table = byId('sales-table');
  const tableWrap = byId('sales-table-wrap'), resetView = byId('sales-fit');
  let dataset = [], visible = [], map, markers, bounds, revision = 0;
  const pinById = new Map();

  function fit(target = bounds) {
    if (target?.isValid()) map.fitBounds(target, {padding:[64,40], maxZoom:15, animate:false});
  }

  function prepareMap() {
    if (map) return;
    map = L.map(container, {scrollWheelZoom:false, attributionControl:false, maxZoom:18});
    L.control.attribution({prefix:false}).addTo(map).addAttribution(osmCredit).addAttribution('Natural Earth');
    L.control.scale({imperial:false}).addTo(map);
    const localPane = map.createPane('sales-local');
    localPane.style.zIndex = '250';
    localPane.style.pointerEvents = 'none';
    if (context) {
      L.geoJSON(context, {pane:'sales-local', interactive:false, filter:f=>f.properties.kind==='land',
        style:{color:'#c7bca8', weight:1, fillColor:'#f5efdf', fillOpacity:1}}).addTo(map);
      L.geoJSON(context, {pane:'sales-local', interactive:false, filter:f=>f.properties.kind==='river',
        style:{color:'#80a5b5', weight:1.4}}).addTo(map);
    }
    if (streets) L.geoJSON(streets, {pane:'sales-local', interactive:false, style:{color:'#a69a85', weight:1}}).addTo(map);
    markers = L.layerGroup().addTo(map);
    addLocalRoads(map);
    initBasemap(map, container);
    if (window.ResizeObserver) new ResizeObserver(()=>map.invalidateSize({pan:false})).observe(container);
  }

  function plot() {
    if (!panel.open) return;
    prepareMap();
    map.invalidateSize({pan:false});
    markers.clearLayers();
    pinById.clear();
    bounds = L.latLngBounds([]);
    for (const reference of saleReferences) {
      const point = [reference.lat, reference.lon];
      const popup = element('div', '');
      popup.append(element('strong', reference.name), element('p', 'Ubicación de referencia de la urbanización.'),
        link('Ver publicación', reference.url), document.createTextNode(' · '), link('Ver ubicación de referencia', reference.mapUrl));
      const title = 'Referencia · ' + reference.name;
      const icon = L.divIcon({className:'sales-reference-marker', html:'R', iconSize:[26,26], iconAnchor:[13,13]});
      L.marker(point, {icon, title, alt:title}).bindPopup(popup)
        .bindTooltip(element('span', reference.name), {permanent:!visible.length, direction:'bottom', offset:[0,13]}).addTo(markers);
      // Keep the default close-up focused on the applied set when sales exist.
      if (!visible.length) bounds.extend(point);
    }
    const groups = new Map();
    for (const feature of visible) {
      const key = feature.geometry.coordinates.join(',');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(feature);
    }
    for (const rows of groups.values()) {
      const [lon,lat] = rows[0].geometry.coordinates;
      const title = rows.length===1 ? rows[0].properties.nombre : rows.length + ' cierres en esta ubicación';
      const popup = element('div', '');
      for (const [index, {properties:p}] of rows.entries()) {
        if (index) popup.append(document.createElement('hr'));
        popup.append(element('strong', p.nombre),
          element('p', dateLabel(p.fecha_cierre) + ' · ' + dollars.format(p.precio_cierre_usd)),
          source(p.fuente));
      }
      const icon = L.divIcon({className:'sales-close-marker', html:String(rows.length), iconSize:[28,28], iconAnchor:[14,14]});
      const pin = L.marker([lat,lon], {icon, title, alt:title, zIndexOffset:100}).bindTooltip(element('span', title))
        .bindPopup(popup, {maxHeight:200}).addTo(markers);
      for (const row of rows) pinById.set(row.id, pin);
      bounds.extend([lat,lon]);
    }
    fit();
  }

  function renderTable() {
    if (!table) return;
    table.replaceChildren();
    if (tableWrap) tableWrap.hidden = !visible.length;
    for (const {id, properties:p} of visible) {
      const row = table.insertRow();
      const button = element('button', p.nombre);
      button.type = 'button';
      button.className = 'linkbutton';
      button.setAttribute('aria-label', 'Ver en el mapa · ' + p.nombre);
      button.onclick = () => {
        const pin = pinById.get(id);
        if (!pin) return;
        map.setView(pin.getLatLng(), Math.max(15, map.getZoom()), {animate:false});
        pin.openPopup();
        container.scrollIntoView({block:'nearest'});
      };
      row.insertCell().append(button);
      for (const text of [dateLabel(p.fecha_cierre), dollars.format(p.precio_cierre_usd),
        p.area_util_m2 ? numbers.format(p.area_util_m2)+' m²' : 'Sin dato',
        p.area_util_m2 ? dollars.format(p.precio_cierre_usd/p.area_util_m2) : 'Sin dato']) {
        row.insertCell().textContent = text;
      }
      row.insertCell().append(source(p.fuente));
    }
  }

  function render() {
    const recent = period.value==='12m', start = lastYearStart(todayEC());
    const areaValue = area?.value || '';
    visible = dataset.filter(({properties:p}) => (!recent || p.fecha_cierre>=start) &&
      (!areaValue || normalize(p.urbanizacion)===areaValue)).sort((a,b) =>
        b.properties.fecha_cierre.localeCompare(a.properties.fecha_cierre) || a.id.localeCompare(b.id));
    clear.hidden = !dataset.length;
    summary.replaceChildren();
    if (visible.length) {
      const properties = visible.map(row=>row.properties);
      const prices = properties.map(p=>p.precio_cierre_usd);
      const perMeter = properties.filter(p=>p.area_util_m2>0).map(p=>p.precio_cierre_usd/p.area_util_m2);
      const list = element('dl', '');
      list.className = 'sales-metrics';
      const metrics = [
        ['Cierres en la muestra', numbers.format(prices.length)],
        ['Precio mediano de cierre', dollars.format(median(prices))],
        ['Mediana por m² útil', perMeter.length ? dollars.format(median(perMeter))+'/m²' : 'Sin datos de área']
      ];
      if (prices.length>=2) {
        const low = prices.reduce((a,b)=>Math.min(a,b));
        const high = prices.reduce((a,b)=>Math.max(a,b));
        metrics.push(['Precios observados', dollars.format(low)+' – '+dollars.format(high)]);
      }
      for (const [label,value] of metrics) {
        const metric = element('div','');
        metric.append(element('dt',label), element('dd',value));
        list.append(metric);
      }
      const endDate = dateLabel(properties[0].fecha_cierre), earliest = dateLabel(properties.at(-1).fecha_cierre);
      const datesShown = endDate===earliest ? endDate : earliest+' – '+endDate;
      summary.append(list, element('small','Fechas de los cierres: '+datesShown+'. Con área útil: '+perMeter.length+' de '+prices.length+'.'));
    } else {
      summary.textContent = dataset.length
        ? 'Ningún cierre coincide con estos filtros. Prueba con otro periodo o urbanización.'
        : 'Importa cierres con fecha y precio final para calcular la mediana de tu muestra.';
    }
    renderTable();
    plot();
  }

  function populateAreas(previous) {
    if (!area) return;
    const names = new Map();
    for (const {properties:p} of dataset) {
      if (p.urbanizacion) names.set(normalize(p.urbanizacion), p.urbanizacion);
    }
    area.replaceChildren(new Option('Todas las urbanizaciones', ''));
    for (const [key,label] of [...names].sort((a,b)=>a[1].localeCompare(b[1],'es'))) area.add(new Option(label,key));
    area.value = names.has(previous) ? previous : '';
  }

  form.addEventListener('input', () => {
    ++revision;
    status.textContent = 'Cambios sin aplicar. Pulsa Mostrar ventas.';
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const ticket = ++revision;
    const upload = file.files[0];
    if (!upload && !dataset.length) {
      status.textContent = 'Elige un archivo CSV con las ventas que quieres mostrar.';
      return;
    }
    if (upload) {
      try {
        const parsed = parseSaleCsv(await upload.text());
        if (ticket!==revision) return;
        const previous = area?.value;
        dataset = parsed.features;
        populateAreas(previous);
        file.value = '';
      } catch (error) {
        if (ticket===revision) status.textContent = error.message || 'No se pudo leer el archivo CSV.';
        return;
      }
    }
    render();
    status.textContent = visible.length+' de '+dataset.length+' cierres de tu archivo en la consulta.';
  });
  clear.onclick = () => {
    ++revision;
    dataset = [];
    file.value = '';
    period.value = '12m';
    populateAreas('');
    render();
    status.textContent = 'Se quitaron los cierres de esta sesión.';
  };
  if (resetView) resetView.onclick = () => {
    const all = L.latLngBounds(saleReferences.map(r=>[r.lat, r.lon]));
    if (bounds?.isValid()) all.extend(bounds);
    fit(all);
  };
  panel.addEventListener('toggle', () => { if (panel.open) plot(); });
  function followHash() {
    if (location.hash!=='#ventas-costa') return;
    for (let current=panel; current; current=current.parentElement) {
      if (current.tagName==='DETAILS') current.open = true;
    }
  }
  window.addEventListener('hashchange', followHash);
  followHash();
  render();
}
