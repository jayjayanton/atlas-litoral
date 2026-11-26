import {featureAt} from './model.js';

// CONALI maps each cantonal seat as one area. The municipal service provides
// the internal urban boundaries of Guayaquil and sometimes splits a parish into parts.
const guayaquilService = 'https://services7.arcgis.com/NWWHhu45fOJtCgG3/arcgis/rest/services/LIMITE_PARROQUIAS_URBANAS/FeatureServer/0';
async function municipalParishes() {
  const query = new URLSearchParams({where:'1=1',outFields:'Nam',outSR:'4326',maxAllowableOffset:'.00008',geometryPrecision:'5',f:'geojson'});
  const response = await fetch(guayaquilService+'/query?'+query, {signal:AbortSignal.timeout(8000)});
  if (!response.ok) throw Error('Parroquias municipales');
  const json = await response.json();
  const groups = new Map();
  for (const f of json.features) {
    const name = f.properties.Nam.trim();
    const rings = f.geometry.type==='Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(...rings);
  }
  return Array.from(groups, ([name,polygons])=>({
    type:'Feature', properties:{code:'gye-'+name,canton:'0901',name,kind:'Parroquia urbana'},
    geometry:{type:'MultiPolygon',coordinates:polygons}
  }));
}

export function initParishes(map, catalog, getCanton, setCanton) {
  const select = document.getElementById('parish-select');
  const label = document.getElementById('parish-label');
  const toggle = document.getElementById('parish-outlines');
  const note = document.getElementById('parish-note');
  const pane = map.createPane('parish-outlines');
  pane.style.zIndex = 416; pane.style.pointerEvents = 'none';
  const layer = L.geoJSON([], {pane:'parish-outlines',interactive:false,style:feature=>{
    const active = feature.properties.code===select.value;
    return {color:active?'#7c3748':'#554865',weight:active?2.7:1.3,dashArray:active?null:'5 4',fill:false};
  }}).addTo(map);
  let previousCode, visible=[], urbans=[], municipalState='idle';
  let municipalRequest;
  function loadUrban() {
    if (!municipalRequest) {
      municipalState='loading';
      municipalRequest=municipalParishes()
        .then(rows=>{urbans=rows;municipalState='ready';})
        .catch(()=>{municipalState='failed';})
        .finally(()=>{if(getCanton().code==='0901')refresh(true);});
    }
    return municipalRequest;
  }
  function at(lat,lon) {
    return featureAt(urbans,lat,lon) || featureAt(catalog,lat,lon);
  }
  function highlight(feature) {
    select.value=feature?.properties.code || '';
    if(feature)toggle.checked=true;
    paint();
  }
  function paint() {
    layer.clearLayers();
    if (toggle.checked) layer.addData(visible);
  }
  function zoom() {
    const picked = visible.find(f=>f.properties.code===select.value);
    if (picked) {
      toggle.checked=true;
      map.fitBounds(L.geoJSON(picked).getBounds(),{padding:[20,20],maxZoom:15});
    } else {
      setCanton(getCanton().code,true);
    }
    paint();
  }
  function refresh(force=false) {
    const {code,name}=getCanton();
    if (previousCode===code && !force) return;
    const previous=previousCode===code?select.value:'';
    previousCode=code;
    visible=catalog.filter(f=>f.properties.canton===code);
    if(code==='0901')visible=visible.concat(urbans);
    visible.sort((a,b)=>a.properties.name.localeCompare(b.properties.name,'es'));
    label.textContent='Parroquia · '+name;
    select.replaceChildren(new Option('Todo el cantón',''),...visible.map(({properties:p})=>new Option(p.name+' · '+p.kind,p.code)));
    if(visible.some(f=>f.properties.code===previous)) select.value=previous;
    note.textContent=code==='0907'
      ? 'CONALI agrupa aquí Eloy Alfaro, El Recreo y Divino Niño en una sola cabecera.'
      : code==='0901' && municipalState==='failed'
        ? 'Los límites urbanos municipales no están disponibles en este momento.'
        : '';
    paint();
    if(code==='0901' && municipalState==='idle')loadUrban();
  }
  select.onchange=zoom;toggle.onchange=paint;
  select.disabled=false;toggle.disabled=false;refresh();
  return {refresh,at,highlight,loadUrban,urbanFeatures:()=>urbans,
    needsUrban:feature=>feature?.properties.code==='090150' && ['idle','loading'].includes(municipalState)
  };
}
