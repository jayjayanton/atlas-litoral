import {featureAt, loanPrincipal} from './model.js';

const $ = id => document.getElementById(id);
const number = new Intl.NumberFormat('es-EC');
const dollars = new Intl.NumberFormat('es-EC', {style:'currency', currency:'USD', maximumFractionDigits:0});
const percent = new Intl.NumberFormat('es-EC', {style:'percent', maximumFractionDigits:1});
const total = values => values.reduce((a, b) => a + b, 0);
const provinces = {'09':'Guayas', '24':'Santa Elena'};

async function readBlock(file) {
  const response = await fetch('./data/sectors/' + file);
  if (!response.ok) throw Error('Sectores');
  const data = new Uint8Array(await response.arrayBuffer());
  if (data[0] === 31 && data[1] === 139) {
    return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
  }
  return JSON.parse(new TextDecoder().decode(data));
}

function cell(row, value, detail) {
  const td = row.insertCell();
  td.append(document.createTextNode(value));
  if (detail) {
    const note = document.createElement('small');
    note.textContent = detail;
    td.append(note);
  }
}

export function initSectorProfiles({map, index, parishCatalog, cantons, state, selectArea, editFinance, changeTheme, isPicking}) {
  const parish = $('sector-parish'), zone = $('sector-zone'), sector = $('sector-id');
  const results = $('sector-results'), status = $('sector-status'), cache = new Map();
  const zones = Object.keys(index.zones).sort();
  const parishNames = new Map(parishCatalog.features.map(f => [f.properties.code, f.properties.name]));
  const cantonNames = new Map(cantons.map(f => [f.properties.code, f.properties.name]));
  const labels = ['Menos de ' + index.ageCuts[0], ...index.ageCuts.slice(0,-1).map((lo,i) => lo+'–'+(index.ageCuts[i+1]-1)), index.ageCuts.at(-1)+' o más'];
  const bands = ['Menos de '+dollars.format(index.incomeCuts[0]), ...index.incomeCuts.slice(0,-1).map((lo,i) => dollars.format(lo)+' a <'+dollars.format(index.incomeCuts[i+1])), dollars.format(index.incomeCuts.at(-1))+' o más'];
  const parishes = [...new Set(zones.map(z => z.slice(0,6)))];
  for (const canton of [...cantonNames.keys()].sort((a,b)=>cantonNames.get(a).localeCompare(cantonNames.get(b),'es'))) {
    const group = document.createElement('optgroup');
    group.label = cantonNames.get(canton)+' · '+provinces[canton.slice(0,2)];
    for (const code of parishes.filter(p => p.startsWith(canton))) group.append(new Option(parishNames.get(code) || code,code));
    if (group.children.length) parish.append(group);
  }
  const pane = map.createPane('census-sectors');
  pane.style.zIndex = 412;
  const overlay = L.featureGroup(), layers = new Map();
  let selectedRow, rows = [], currentZone = '', locationKey = '', generation = 0, lookup = 0;
  let financeKey = '', synchronizing = false;

  function getBlock(z) {
    const file = index.zones[z][0];
    if (!cache.has(file)) cache.set(file, readBlock(file).catch(error => { cache.delete(file); throw error; }));
    return cache.get(file);
  }
  function setZones(code) {
    parish.value = code;
    zone.replaceChildren(...zones.filter(z => z.startsWith(code)).map(z => new Option(z.slice(6),z)));
  }
  function paintSelection() {
    for (const [id, polygon] of layers) {
      const active = id === sector.value;
      polygon.setStyle({color:active?'#194b47':'#477d77',weight:active?3:1,fillColor:active?'#e9a34d':'#b8dbd1',fillOpacity:active?.67:.45});
      if (active) polygon.bringToFront();
    }
  }
  function showMap(zoom, scroll) {
    changeTheme();
    const bounds = (layers.get(sector.value) || overlay).getBounds();
    if (zoom && bounds.isValid()) map.fitBounds(bounds,{padding:[32,32],maxZoom:16,animate:false});
    if (scroll) $('map').scrollIntoView({block:'center'});
  }
  function profile() {
    if (!selectedRow) return;
    const [suffix, counts, , cartographicPopulation] = selectedRow;
    const f = state().finance, refs = index.provinces[zone.value.slice(0,2)];
    financeKey = JSON.stringify(f);
    const homes = counts.slice(4), residents = total(counts.slice(0,4)), hh = total(homes);
    const unknown = index.withoutAgeBySector[zone.value+suffix] || 0;
    const province = provinces[zone.value.slice(0,2)];
    results.hidden = false;
    $('sector-title').textContent = (parishNames.get(parish.value) || parish.value)+' · Zona '+zone.value.slice(6)+' · Sector '+suffix;
    $('sector-pop').textContent = number.format(residents);
    $('sector-homes').textContent = number.format(hh+unknown);
    $('sector-ref').textContent = 'Estimación para los '+number.format(hh)+' hogares con edad del representante identificada, usando la distribución de ingresos de '+province+'.';
    const list = $('sector-bands');
    list.replaceChildren();
    if (hh) bands.forEach((label,b) => {
      const share = total(homes.map((n,i) => n / hh * refs[i].shares[b]));
      const li = document.createElement('li'), track = document.createElement('span'), bar = document.createElement('i'), text = document.createElement('span');
      track.className = 'age-track'; bar.style.width = (share*100)+'%'; track.append(bar);
      text.textContent = percent.format(share); li.append(document.createTextNode(label), track, text); list.append(li);
    });
    else $('sector-ref').textContent = 'Sin hogares particulares con representante identificable en este sector.';
    $('sector-scenario').textContent = 'Cuota de '+f.share+' % del ingreso monetario del hogar, interés nominal anual de '+f.rate+' % y plazo de '+f.years+' años. P25–P75 muestra el 50 % central de la referencia provincial.';
    const body = $('sector-rows'); body.replaceChildren();
    refs.forEach(({n, quartiles}, i) => {
      const tr = body.insertRow();
      cell(tr, labels[i]+' años'); cell(tr, number.format(counts[i])); cell(tr, number.format(homes[i])); cell(tr, number.format(n),n<30?'Muestra pequeña':'');
      const q = quartiles.map(v => dollars.format(v));
      cell(tr, q[1], q[0]+' – '+q[2]);
      const principal = quartiles.map(v => dollars.format(loanPrincipal(v, f)));
      if (homes[i]) cell(tr, principal[1], principal[0]+' – '+principal[2]);
      else cell(tr, '—', 'Sin hogares en este grupo');
    });
    const notes = [];
    if (unknown) notes.push('Hogares sin edad de representante identificada en la base pública: '+number.format(unknown)+'. Se incluyen en el total censado y quedan fuera de la estimación por edad.');
    if (refs.some((r,i)=>r.n<30 && homes[i])) notes.push('La estimación incluye un grupo provincial con menos de 30 hogares encuestados. Interpreta sus cifras con especial cautela.');
    if (cartographicPopulation != null && residents !== cartographicPopulation) notes.push('La cartografía consigna '+number.format(cartographicPopulation)+' residentes. El desglose utiliza las '+number.format(residents)+' personas asignadas a este código en la base pública de edades.');
    $('sector-caution').textContent = notes.join(' ');
  }
  function pickRow(id, zoom = false) {
    selectedRow = rows.find(row => row[0] === id);
    if (!selectedRow) return;
    sector.value = id;
    profile(); paintSelection();
    if (zoom) showMap(true,false);
  }
  async function openZone(z, desired, zoom = false) {
    const version = ++generation;
    currentZone = z; zone.value = z; selectedRow = undefined; rows = [];
    results.hidden = true; sector.disabled = true; sector.replaceChildren();
    $('sector-map').disabled = true; overlay.clearLayers(); layers.clear();
    status.textContent = 'Cargando la zona censal…';
    try {
      const block = await getBlock(z);
      if (version !== generation) return;
      rows = block[z];
      for (const [id, , rings] of rows) {
        sector.add(new Option(id,id));
        const polygon = L.polygon(rings,{pane:'census-sectors',bubblingMouseEvents:false});
        polygon.bindTooltip('Zona '+z.slice(6)+' · Sector '+id, {sticky:true});
        polygon.on('click', e => {
          if (isPicking()) { map.fire('click',{latlng:e.latlng}); return; }
          lookup++; pickRow(id);
        });
        layers.set(id,polygon); overlay.addLayer(polygon);
      }
      status.textContent = '';
      sector.disabled = false; $('sector-map').disabled = false;
      pickRow(rows.some(r=>r[0]===desired)?desired:rows[0][0],zoom);
    } catch {
      if (version === generation) {
        status.textContent = 'No se pudo cargar la zona. ';
        const retry = document.createElement('button'); retry.className='linkbutton'; retry.textContent='Reintentar';
        retry.onclick=()=>openZone(z,desired,zoom); status.append(retry);
      }
    }
  }
  function syncCanton(code) {
    synchronizing = true;
    try { selectArea(code); } finally { synchronizing = false; }
    locationKey = state().canton+'|'+state().parish;
  }
  function openCode(code, zoom = true) {
    const z = code.slice(0,9);
    if (!index.zones[z]) return;
    syncCanton(code); setZones(code.slice(0,6));
    return openZone(z,code.slice(9),zoom);
  }
  async function locate(lat, lon, scroll = false) {
    const version = ++lookup;
    const possible = zones.filter(z => {
      const [,s,w,n,e] = index.zones[z];
      return lat>=s && lat<=n && lon>=w && lon<=e;
    });
    status.textContent='Localizando el sector…';
    try {
      for (const z of possible) {
        const block = await getBlock(z);
        if (version!==lookup) return;
        for (const [id, , rings] of block[z]) {
          const geometry = {type:'MultiPolygon',coordinates:rings.map(poly=>poly.map(ring=>ring.map(([y,x])=>[x,y])))};
          if (featureAt([{geometry}],lat,lon)) {
            await openCode(z+id,true);
            if (scroll && version===lookup) $('sectores').scrollIntoView({block:'start'});
            return;
          }
        }
      }
      if (version===lookup) status.textContent='El punto queda fuera de los sectores cartografiados.';
    } catch { if (version===lookup) status.textContent='No se pudieron consultar los límites del punto. Intenta de nuevo.'; }
  }
  function refresh() {
    const {canton, parish:p, finance, theme, project} = state();
    $('sector-building').hidden = !project;
    if (theme==='sectors' && !map.hasLayer(overlay)) overlay.addTo(map);
    if (theme!=='sectors' && map.hasLayer(overlay)) overlay.remove();
    const key = canton+'|'+p;
    if (!synchronizing && key!==locationKey) {
      lookup++; locationKey=key;
      const code = parishes.includes(p)?p:(parish.value.startsWith(canton)?parish.value:parishes.find(k=>k.startsWith(canton)));
      if (code && !currentZone.startsWith(code)) { setZones(code); openZone(zone.value); }
    }
    if (selectedRow && JSON.stringify(finance)!==financeKey) profile();
  }
  parish.onchange=()=>{lookup++; syncCanton(parish.value); setZones(parish.value); openZone(zone.value,undefined,state().theme==='sectors');};
  zone.onchange=()=>{lookup++; openZone(zone.value,undefined,state().theme==='sectors');};
  sector.onchange=()=>{lookup++; pickRow(sector.value,state().theme==='sectors');};
  $('sector-map').onclick=()=>showMap(true,true);
  $('sector-building').onclick=()=>{const p=state().project;if(p)locate(p.lat,p.lon,true);};
  $('sector-finance').onclick=editFinance;
  $('sector-controls').hidden=false; $('sector-option').disabled=false;
  const coverage = index.coverage;
  $('sector-coverage').textContent = number.format(coverage.mapped)+' sectores con perfiles en Guayas y Santa Elena. El INEC agrupa '+number.format(coverage.pooledResidents)+' personas y '+number.format(coverage.pooledHouseholds)+' hogares bajo códigos sin ubicación sectorial publicable. Se conservan en los totales territoriales del censo. La cartografía incluye '+number.format(coverage.shapes-coverage.mapped)+' polígonos adicionales sin conteo de edades vinculado.';
  refresh();
  return {refresh, openCode, locate, frame:()=>showMap(true,false), legend() {
    $('legend-title').textContent='Sectores censales · zona '+currentZone.slice(6);
    const link=document.createElement('a'); link.href='#sectores';link.textContent='Consultar hogares e ingresos';
    $('legend').replaceChildren(document.createTextNode('Toca un punto para consultar su sector. '),link);
  }};
}
