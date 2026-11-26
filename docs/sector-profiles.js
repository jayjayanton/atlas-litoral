import {readCompressedJSON} from './compressed-json.js';
import {featureAt, loanPrincipal, normalize} from './model.js';

const $ = id => document.getElementById(id);
const number = new Intl.NumberFormat('es-EC');
const dollars = new Intl.NumberFormat('es-EC', {style:'currency', currency:'USD', maximumFractionDigits:0});
const percent = new Intl.NumberFormat('es-EC', {style:'percent', maximumFractionDigits:1});
const total = values => values.reduce((a, b) => a + b, 0);
const provinces = {'09':'Guayas', '24':'Santa Elena'};

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
  const canton = $('sector-canton'), parish = $('sector-parish'), zone = $('sector-zone'), sector = $('sector-id');
  const results = $('sector-results'), status = $('sector-status'), cache = new Map();
  const zones = Object.keys(index.zones).sort();
  const parishAreas = new Map(parishCatalog.features.map(f => [f.properties.code, f]));
  const parishLabel = code => {
    const p = parishAreas.get(code)?.properties;
    if (!p) return code;
    const cantonName=cantonNames.get(p.canton);
    const name=normalize(p.name)===normalize(cantonName)?cantonName:p.name;
    return p.kind+(p.kind==='Cabecera cantonal'?' de ':' ')+name;
  };
  const parishArea = () => L.geoJSON(parishAreas.get(parish.value)).getBounds();
  const cantonNames = new Map(cantons.map(f => [f.properties.code, f.properties.name]));
  const labels = ['Menos de ' + index.ageCuts[0], ...index.ageCuts.slice(0,-1).map((lo,i) => lo+'–'+(index.ageCuts[i+1]-1)), index.ageCuts.at(-1)+' o más'];
  const bands = ['Menos de '+dollars.format(index.incomeCuts[0]), ...index.incomeCuts.slice(0,-1).map((lo,i) => dollars.format(lo)+' a <'+dollars.format(index.incomeCuts[i+1])), dollars.format(index.incomeCuts.at(-1))+' o más'];
  const parishes = [...new Set(zones.map(z => z.slice(0,6)))];
  for (const province of Object.keys(provinces)) {
    const group = document.createElement('optgroup');
    group.label = provinces[province];
    const ids = [...cantonNames.keys()].filter(k=>k.startsWith(province));
    ids.sort((a,b)=>cantonNames.get(a).localeCompare(cantonNames.get(b),'es'));
    for (const id of ids) group.append(new Option(cantonNames.get(id),id));
    canton.append(group);
  }
  function setParishes(code) {
    canton.value = code;
    parish.replaceChildren(...parishes.filter(p=>p.startsWith(code)).map(p=>new Option(parishLabel(p),p)));
  }
  // Draw boundary casings above roads and below their ink. Only the sector fills receive clicks.
  for (const [name,z] of [['neighbor-sectors',419],['sector-casing',420],['census-sectors',421],['selected-sector',422],['sector-place',423]]) {
    const pane=map.createPane(name);
    pane.style.zIndex=z;
    if (name!=='census-sectors') pane.style.pointerEvents='none';
  }
  const overlay = L.featureGroup(), layers = new Map(), placeMarker=L.layerGroup();
  const zoneCasing=L.layerGroup(), selectedBorder=L.layerGroup();
  const outline={fill:false,interactive:false,opacity:1,lineJoin:'round'};
  const casing={...outline,color:'#ffffff'};
  const sectorInk={color:'#075862',weight:2.8,opacity:1};
  const neighbors=L.layerGroup(), shapeBounds=new WeakMap();
  let neighborState='', neighborView='', neighborRevision=0;
  function updateNeighbors() {
    const {theme,province}=state();
    const bounds=map.getBounds(), zoom=map.getZoom();
    const key=[theme,currentZone,province,zoom,bounds.toBBoxString()].join('|');
    if (key===neighborView) return;
    neighborView=key;
    const version=++neighborRevision;
    neighbors.clearLayers();
    neighborState='';
    if (theme!=='sectors') {neighbors.remove();return;}
    neighbors.addTo(map);
    if (zoom<13) {neighborState='zoom';legend();return;}
    const visible=zones.filter(z=>{
      const [,s,w,n,e]=index.zones[z];
      return z!==currentZone && (!province || provinces[z.slice(0,2)]===province) && bounds.intersects([[s,w],[n,e]]);
    });
    async function draw() {
      const batches=await Promise.all(visible.map(async z=>(await getBlock(z))[z]));
      if(version!==neighborRevision)return;
      const polygons=[];
      for(const batch of batches) for(const [, , rings] of batch) {
        let extent=shapeBounds.get(rings);
        if(!extent){extent=L.latLngBounds(rings);shapeBounds.set(rings,extent);}
        if(bounds.intersects(extent)) polygons.push(rings);
        if(polygons.length>420){neighborState='zoom';legend();return;}
      }
      if(polygons.length) {
        const rings=polygons.flat();
        L.polygon(rings,{...casing,pane:'neighbor-sectors',weight:5}).addTo(neighbors);
        L.polygon(rings,{...outline,pane:'neighbor-sectors',color:'#384554',weight:2.5,dashArray:'6 5',lineCap:'butt'}).addTo(neighbors);
      }
      neighborState=polygons.length?'visible':'';legend();
    }
    draw().catch(()=>{if(version===neighborRevision){neighborState='unavailable';neighborView='';legend();}});
  }
  map.on('moveend',updateNeighbors);
  let selectedRow, rows = [], currentZone = '', locationKey = '', generation = 0, lookup = 0;
  let financeKey = '', synchronizing = false;
  let facilities = [], points = [], buildingList, anchors = new Map(), matchedPlace;
  const query = $('sector-place'), matches = $('sector-matches');
  const zoneNumber = () => 'Zona '+currentZone.slice(6);
  const parentLabel = () => provinces[parish.value.slice(0,2)]+' › Cantón '+cantonNames.get(canton.value)+' › '+parishLabel(parish.value);
  function buildPointIndex() {
    buildingList = state().buildings;
    points = [...(buildingList || []).map(b=>({...b, kind:'Edificio',sectorLabel:b.sector})), ...facilities]
      .map(p=>({...p, search:normalize([p.name,p.sectorLabel,p.locality].filter(Boolean).join(' '))}));
    markPlaces();
    if (document.activeElement===query) searchPlaces();
  }
  function searchPlaces() {
    const words = normalize(query.value).split(' ').filter(Boolean);
    matches.replaceChildren(); matches.hidden = true;
    $('place-status').textContent = '';
    if (words.join('').length < 2) return;
    const found = points.filter(p=>words.every(word=>p.search.includes(word))).slice(0,9);
    for (const p of found.slice(0,8)) {
      const li = document.createElement('li'), button = document.createElement('button');
      button.type='button';
      const meta = document.createElement('small');
      meta.textContent = [p.kind,p.sectorLabel || p.locality].filter(Boolean).join(' · ');
      button.append(document.createTextNode(p.name),meta);
      button.onclick=()=>{
        query.value=p.name; matches.hidden=true; $('place-status').textContent='';
        locate(p.lat,p.lon,false,p);
      };
      li.append(button); matches.append(li);
    }
    matches.hidden = !found.length;
    $('place-status').textContent = !found.length?'Sin coincidencias en el catálogo. Puedes elegir un punto en el mapa.':found.length>8?'Se muestran ocho lugares. Escribe más para precisar la búsqueda.':'';
  }
  query.oninput=searchPlaces;
  query.onkeydown=e=>{
    if(e.key==='ArrowDown'){e.preventDefault();matches.querySelector('button')?.focus();}
    if(e.key==='Enter' && !matches.hidden){e.preventDefault();matches.querySelector('button')?.click();}
    if(e.key==='Escape'){matches.hidden=true;$('place-status').textContent='';}
  };
  function markPlaces() {
    anchors = new Map();
    if (!rows.length) return;
    const zoneBounds=overlay.getBounds();
    const candidates = points.filter(p=>zoneBounds.contains([p.lat,p.lon]));
    for (const [id,poly] of layers) {
      const bounds=poly.getBounds(), nearby=candidates.filter(p=>bounds.contains([p.lat,p.lon]));
      const shape=nearby.length ? [poly.toGeoJSON()] : [];
      const inside=nearby.filter(p=>featureAt(shape,p.lat,p.lon));
      anchors.set(id,inside);
    }
    rows.forEach(([id,counts],i)=>{
      const first=anchors.get(id)?.[0];
      sector.options[i+1].text='Sector '+id+' · '+(first?.name || number.format(total(counts.slice(0,4)))+' residentes');
    });
    if (selectedRow) describe();
  }
  function describe() {
    const id=selectedRow[0], sites=anchors.get(id)||[];
    $('sector-title').textContent=zoneNumber()+' · Sector '+id;
    $('sector-path').textContent=parentLabel();
    const named = matchedPlace ? [matchedPlace,...sites.filter(p=>p.name!==matchedPlace.name)] : sites;
    placeMarker.clearLayers();
    const ref=matchedPlace || sites.find(p=>p.kind==='Edificio');
    if(ref){
      const dot=L.circleMarker([ref.lat,ref.lon],{pane:'sector-place',radius:5,color:'#fff',weight:2,fillColor:'#174a70',fillOpacity:1,interactive:false});
      const label=document.createElement('span'); label.textContent=ref.name;
      dot.bindTooltip(label,{permanent:true,direction:'top',offset:[0,-6],className:'sector-place-label'}).addTo(placeMarker);
    }
    $('sector-landmarks').textContent = named.length ? (named.length>1?'Aquí se ubican ':'Aquí se ubica ')+named.slice(0,2).map(p=>p.name+(p.kind==='Edificio' && p.sector?' ('+p.sector+')':'')).join(' · ')+(ref?.reference?' · Acceso aproximado.':'') : '';
  }

  function getBlock(z) {
    const file = index.zones[z][0];
    if (!cache.has(file)) cache.set(file, readCompressedJSON('./data/sectors/' + file).catch(error => { cache.delete(file); throw error; }));
    return cache.get(file);
  }
  function setZones(code) {
    setParishes(code.slice(0,4));
    parish.value = code;
    zone.replaceChildren(...zones.filter(z => z.startsWith(code)).map(z => new Option('Zona '+z.slice(6),z)));
  }
  function paintSelection() {
    selectedBorder.clearLayers();
    for (const [id, polygon] of layers) {
      const active = id === sector.value;
      polygon.setStyle({...sectorInk,fillColor:active?'#e9a34d':'#b8dbd1',fillOpacity:active?.4:.22});
      if (active) {
        const rings=polygon.getLatLngs();
        L.polygon(rings,{...casing,pane:'selected-sector',weight:9}).addTo(selectedBorder);
        L.polygon(rings,{...outline,pane:'selected-sector',weight:5,color:'#681d46'}).addTo(selectedBorder);
      }
    }
  }
  function showMap(zoom, scroll) {
    changeTheme();
    const bounds = layers.get(sector.value)?.getBounds() || parishArea();
    if (zoom && bounds.isValid()) fit(bounds);
    if (scroll) $('map').scrollIntoView({block:'center'});
  }
  function fit(bounds) {
    const box=$('legend').parentElement;
    const bottom=getComputedStyle(box).position==='static'?20:Math.min(box.offsetHeight+18,map.getSize().y*.35);
    map.fitBounds(bounds,{paddingTopLeft:[20,20],paddingBottomRight:[20,bottom],maxZoom:17,animate:false});
  }
  function legend() {
    $('legend-title').textContent = selectedRow ? zoneNumber()+' · Sector '+selectedRow[0]+' seleccionado' : 'Selecciona un sector censal';
    const where=document.createElement('span');where.className='sector-legend-area';
    where.textContent = parentLabel()+(selectedRow?'':' › '+zoneNumber());
    const items=[where];
    function key(label,style) {
      const span=document.createElement('span'), chip=document.createElement('i');
      span.className='key';chip.className='sw '+style;span.append(chip,label);items.push(span);
    }
    if (selectedRow) key('Sector seleccionado','selected-sector-key');
    key('Sectores de la zona'+(rows.length?' ('+number.format(rows.length)+')':''),'zone-sectors-key');
    if (neighborState==='visible') key('Sectores de otras zonas','neighbor-sectors-key');
    if (neighborState==='zoom' || neighborState==='unavailable') {
      const note=document.createElement('small');note.className='sector-legend-area';
      note.textContent=neighborState==='zoom'?'Acércate para ver los sectores vecinos.':'No se cargaron los límites vecinos.';
      items.push(note);
    }
    const link=document.createElement('a');link.href='#sectores';
    link.textContent=selectedRow?'Ver hogares e ingresos':'Buscar por lugar o código';
    items.push(link);$('legend').replaceChildren(...items);
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
    describe();
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
  function pickRow(id, zoom = false, place) {
    matchedPlace = place;
    selectedRow = rows.find(row => row[0] === id);
    if (!selectedRow) return;
    sector.value = id;
    profile(); paintSelection();
    status.textContent=''; $('sector-map').textContent='Ver sector en el mapa';
    if (state().theme==='sectors') legend();
    if (zoom) showMap(true,false);
  }
  async function openZone(z, desired, zoom = false, place) {
    const version = ++generation;
    currentZone = z; zone.value = z; selectedRow = undefined; rows = [];
    results.hidden = true; sector.disabled = true; sector.replaceChildren(new Option('Seleccionar sector',''));
    matchedPlace=undefined; placeMarker.clearLayers(); selectedBorder.clearLayers(); zoneCasing.clearLayers(); $('sector-map').textContent='Elegir en el mapa';
    $('sector-map').disabled = false; $('sector-zone-map').disabled = true; overlay.clearLayers(); layers.clear();
    updateNeighbors();
    if (state().theme==='sectors') legend();
    status.textContent = 'Cargando la zona censal…';
    try {
      const block = await getBlock(z);
      if (version !== generation) return;
      rows = block[z];
      const zoneRings=rows.flatMap(row=>row[2]);
      L.polygon(zoneRings,{...casing,pane:'sector-casing',weight:5.6}).addTo(zoneCasing);
      for (const [id, , rings] of rows) {
        sector.add(new Option('Sector '+id,id));
        const polygon = L.polygon(rings,{...sectorInk,pane:'census-sectors',bubblingMouseEvents:false});
        polygon.bindTooltip(()=>{const label=document.createElement('span');label.textContent='Sector '+id+' · '+zoneNumber()+' · '+cantonNames.get(canton.value);return label;},{sticky:true});
        polygon.on('click', e => {
          if (isPicking()) { map.fire('click',{latlng:e.latlng}); return; }
          lookup++; pickRow(id);
        });
        layers.set(id,polygon); overlay.addLayer(polygon);
      }
      status.textContent = '';
      sector.disabled = false; $('sector-zone-map').disabled = false;
      markPlaces();
      if (desired && layers.has(desired)) pickRow(desired,zoom,place);
      else {
        status.textContent=desired?'Ese código de sector no figura en la zona. Elige un punto u otro código.':'Elige un lugar, toca el mapa o selecciona un sector por su código.';
        paintSelection();
        if (state().theme==='sectors') legend();
        if (zoom) {changeTheme();fit(overlay.getBounds());}
      }
    } catch {
      if (version === generation) {
        status.textContent = 'No se pudo cargar la zona. ';
        const retry = document.createElement('button'); retry.className='linkbutton'; retry.textContent='Reintentar';
        retry.onclick=()=>openZone(z,desired,zoom,place); status.append(retry);
      }
    }
  }
  function syncCanton(code) {
    synchronizing = true;
    try { selectArea(code); } finally { synchronizing = false; }
    locationKey = state().canton+'|'+state().parish;
  }
  function openCode(code, zoom = true, place) {
    const z = code.slice(0,9);
    if (!index.zones[z]) {status.textContent='Zona censal fuera de la cobertura del atlas.';return;}
    syncCanton(code); setZones(code.slice(0,6));
    return openZone(z,code.slice(9),zoom,place);
  }
  async function locate(lat, lon, scroll = false, place) {
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
            await openCode(z+id,true,place);
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
    if (buildingList!==state().buildings) buildPointIndex();
    $('sector-building').hidden = !project;
    if(project) $('sector-building').textContent='Ubicar '+project.name;
    for (const group of [zoneCasing,overlay,selectedBorder,placeMarker]) {
      if (theme==='sectors' && !map.hasLayer(group)) group.addTo(map);
      if (theme!=='sectors' && map.hasLayer(group)) group.remove();
    }
    const key = canton+'|'+p;
    if (!synchronizing && key!==locationKey) {
      lookup++; locationKey=key;
      const code = parishes.includes(p)?p:(parish.value.startsWith(canton)?parish.value:parishes.find(k=>k.startsWith(canton)));
      if (code && !currentZone.startsWith(code)) { setZones(code); openZone(zone.value); }
    }
    updateNeighbors();
    if (selectedRow && JSON.stringify(finance)!==financeKey) profile();
  }
  canton.onchange=()=>{setParishes(canton.value);parish.onchange();};
  parish.onchange=()=>{lookup++; syncCanton(parish.value); setZones(parish.value); openZone(zone.value,undefined,state().theme==='sectors');};
  zone.onchange=()=>{lookup++; openZone(zone.value,undefined,state().theme==='sectors');};
  sector.onchange=()=>{lookup++; if(sector.value) pickRow(sector.value,state().theme==='sectors');else openZone(currentZone,undefined,state().theme==='sectors');};
  $('sector-zone-map').onclick=()=>{changeTheme();fit(overlay.getBounds());$('map').scrollIntoView({block:'center'});};
  $('sector-map').onclick=()=>showMap(true,true);
  $('sector-building').onclick=()=>{const p=state().project;if(p)locate(p.lat,p.lon,true,{...p,kind:'Edificio'});};
  $('sector-finance').onclick=editFinance;
  $('sector-controls').hidden=false; $('sector-option').disabled=false;
  const coverage = index.coverage;
  $('sector-coverage').textContent = number.format(coverage.mapped)+' sectores con perfiles en Guayas y Santa Elena. El INEC agrupa '+number.format(coverage.pooledResidents)+' personas y '+number.format(coverage.pooledHouseholds)+' hogares bajo códigos sin ubicación sectorial publicable. Se conservan en los totales territoriales del censo. La cartografía incluye '+number.format(coverage.shapes-coverage.mapped)+' polígonos adicionales sin conteo de edades vinculado.';
  refresh();
  return {refresh, openCode, locate, frame:()=>showMap(true,false), legend, setFacilities(schools,hospitals) {
    facilities = [[schools,'Escuela'],[hospitals,'Hospital']].flatMap(([list,kind])=>(list||[])
      .filter(p=>cantonNames.has(p.code)).map(p=>({...p,kind})));
    buildPointIndex();
  }};
}
