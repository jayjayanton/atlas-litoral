import {featureAt} from './model.js';
import {readCompressedJSON} from './compressed-json.js';

const $=id=>document.getElementById(id);
const names={canton:'Cantón',parish:'Parroquia',zone:'Zona censal',sector:'Sector censal'};
const total=values=>values.reduce((a,b)=>a+b,0);
const fmt=new Intl.NumberFormat('es-EC');

export function initTerritory({map,cantons,parishes,sectors,index,ages,cantonCode,setCanton,fitRegion,updateLegend,share,activePoint,alignSector}){
  const level=$('geo-level'),parish=$('parish-select'),zones=$('geo-zone'),ids=$('geo-sector');
  const options=[...level.options];
  options.find(o=>o.value==='parish').disabled=!parishes;
  for(const o of options.filter(o=>['zone','sector'].includes(o.value)))o.disabled=!sectors;
  const zoneCodes=Object.keys(index?.zones||{}).sort();
  const pane=map.createPane('territory-focus');pane.style.zIndex=625;
  const focus=L.layerGroup().addTo(map);
  let current=null,version=0,interiorPoints;
  const municipalSectors=new Map();
  async function sectorsInParish(area){
    const code=area.properties.code;
    if(municipalSectors.has(code))return municipalSectors.get(code);
    interiorPoints??=readCompressedJSON('./data/campaign-residents.json.gz')
      .then(data=>data.sectors.filter(row=>row[0].startsWith('090150')))
      .catch(error=>{interiorPoints=null;throw error;});
    const points=await interiorPoints;
    const result=new Set(points.filter(([,lat,lon])=>featureAt([area],lat,lon)).map(row=>row[0]));
    municipalSectors.set(code,result);return result;
  }
  function controls(){
    const fine=level.value==='zone'||level.value==='sector';
    $('geo-children').hidden=!fine;$('geo-sector-field').hidden=level.value!=='sector';
    const key=$('geo-boundary-key');
    key.hidden=!current;
    if(current)key.textContent='Límite de '+names[current.level].toLowerCase();
    document.querySelector('.admin-boundary-keys').classList.toggle('isolated',!!current);
    $('geo-share').hidden=!current;
    $('geo-facts').hidden=!current || current.level==='canton';
    $('canton-facts').hidden=!$('geo-facts').hidden;
  }
  function clear(){
    version++;current=null;focus.clearLayers();
    $('geo-status').replaceChildren();level.value='region';controls();
  }
  function reset(zoom=false){
    clear();parishes?.highlight(null);
    if(zoom)fitRegion();
    updateLegend();
  }
  function render(shape,details,zoom){
    current=details;
    const parts=shape.getLatLngs();
    const rings=L.LineUtil.isFlat(parts[0])?parts:parts.flat();
    const world=[[-85,-180],[-85,180],[85,180],[85,-180]];
    L.polygon([world,...rings],{pane:'territory-focus',stroke:false,fillColor:'#f3f6f5',fillOpacity:.96,fillRule:'evenodd',interactive:true,bubblingMouseEvents:false,smoothFactor:0}).addTo(focus);
    shape.setStyle({color:'#214d59',weight:2.4,opacity:1,fill:false,smoothFactor:0});
    shape.options.pane='territory-focus';shape.options.interactive=false;shape.addTo(focus);
    controls();
    $('geo-kind').textContent=names[details.level];$('geo-name').textContent=details.name;
    $('geo-path').textContent=details.path;
    $('geo-pop').textContent=details.population==null?'Sin desglose':fmt.format(details.population);
    $('geo-source').textContent=details.source;
    if(zoom){
      const box=$('legend').parentElement;
      const bottom=getComputedStyle(box).position==='static'?20:Math.min(box.offsetHeight+18,map.getSize().y*.33);
      map.fitBounds(shape.getBounds(),{paddingTopLeft:[20,20],paddingBottomRight:[20,bottom],maxZoom:18,animate:false});
    }
    updateLegend();alignSector(details);
  }
  function single(feature){return L.geoJSON(feature).getLayers()[0];}
  // A supplied code is authoritative, including links opened in a fresh browser.
  async function open(kind,code='',zoom=true,municipalParent=''){
    const run=++version,old=current;
    if(kind==='region'){reset(zoom);return;}
    if(!names[kind]||options.find(o=>o.value===kind)?.disabled)return;
    const census=kind==='zone'||kind==='sector';
    if(code){
      const valid=census?(kind==='zone'?/^\d{9}$/:/^\d{12}$/).test(code)&&index.zones[code.slice(0,9)]:
        kind==='canton'?cantons.has(code):(/^\d{6}$/.test(code)||code.startsWith('gye-'));
      if(!valid){clear();$('geo-status').textContent='El área solicitada no está disponible.';updateLegend();return;}
    }
    const parent=code?(code.startsWith('gye-')?'0901':code.slice(0,4)):cantonCode();
    if(!cantons.has(parent)){clear();$('geo-status').textContent='Cantón fuera de la cobertura del atlas.';updateLegend();return;}
    level.value=kind;current=null;focus.clearLayers();controls();
    if(parent!==cantonCode())setCanton(parent);
    const canton=cantons.get(parent),p=canton.properties;
    const path=p.province+' › '+p.name;
    const chosen=old?.canton===parent?old:null;
    function invalid(message){
      if(run!==version)return;
      clear();$('geo-status').textContent=message;updateLegend();
    }
    $('geo-status').textContent='';
    if(kind==='canton'){
      parishes?.highlight(null);
      render(single(canton),{level:kind,code:parent,canton:parent,name:p.name,path:p.province,population:p.population,source:'Censo 2022'},zoom);
      return;
    }
    if(code.startsWith('gye-')||municipalParent.startsWith('gye-'))await parishes.loadUrban();
    if(run!==version)return;
    const available=parishes.available();
    const requestedParish=municipalParent|| (code?(census?code.slice(0,6):code):parish.value);
    let area=available.find(f=>f.properties.code===requestedParish);
    if(code&&!area){invalid('No se pudo identificar esta parroquia con los límites disponibles.');return;}
    area??=available.find(f=>f.properties.kind==='Cabecera cantonal')||available[0];
    if(!area){invalid('No hay límites parroquiales disponibles para este cantón.');return;}
    const q=area.properties;
    if(parish.value!==q.code)parishes.highlight(area);
    if(kind==='parish'){
      const residents=ages?.[q.code];
      render(single(area),{level:kind,code:q.code,canton:parent,name:q.name,path:path+' · '+q.kind,population:residents?total(residents):null,
        source:residents?'Habitantes · Censo 2022':'El censo publica la población de esta parroquia urbana dentro de la cabecera cantonal.'},zoom);
      return;
    }
    const municipal=q.code.startsWith('gye-');
    ids.replaceChildren();ids.disabled=true;
    $('geo-status').textContent='Cargando sectores censales…';
    let rows,zone,eligible;
    try{
      if(municipal)eligible=await sectorsInParish(area);
      if(run!==version)return;
      const catalog=eligible?[...new Set([...eligible].map(id=>id.slice(0,9)))].sort():zoneCodes.filter(z=>z.startsWith(q.code));
      zone=code?code.slice(0,9):catalog.find(z=>z===zones.value)||catalog[0];
      zones.replaceChildren(...catalog.map(z=>new Option('Zona '+z.slice(6),z)));
      if(!catalog.includes(zone)){invalid('Esta zona no está disponible en la parroquia seleccionada.');return;}
      zones.value=zone;rows=await sectors.readZone(zone);
    }catch{
      if(run!==version)return;
      $('geo-status').textContent='No se pudo cargar la zona. ';
      const retry=document.createElement('button');retry.className='linkbutton';retry.textContent='Reintentar';
      retry.onclick=()=>open(kind,code,zoom,municipalParent);$('geo-status').append(retry);updateLegend();return;
    }
    if(run!==version)return;
    const choices=eligible?rows.filter(row=>eligible.has(zone+row[0])):rows;
    const previous=chosen?.level==='sector'&&chosen.code.startsWith(zone)?chosen.code.slice(9):null;
    const defaultId=choices.find(row=>row[0]===previous)?.[0]||choices[0]?.[0];
    const id=kind==='sector'?(code?code.slice(9):defaultId):null;
    const selectedRows=kind==='sector'?choices.filter(r=>r[0]===id):rows;
    if(!selectedRows.length){invalid('Ese sector no figura en la cartografía publicada.');return;}
    ids.replaceChildren(...choices.map(([suffix])=>new Option('Sector '+suffix,zone+suffix)));
    ids.disabled=false;if(id)ids.value=zone+id;
    $('geo-status').textContent=municipal?'Se listan los sectores con punto interior en '+q.name+'. El límite y la población corresponden a la unidad censal completa.':'';
    const number=kind==='sector'?id:zone.slice(6);
    render(L.polygon(selectedRows.flatMap(row=>row[2])),{level:kind,code:zone+(id||''),municipal:municipal?q.code:'',canton:parent,name:names[kind]+' '+number,
      path:path+' › '+q.name+(id?' › Zona '+zone.slice(6):''),population:total(selectedRows.map(row=>total(row[1].slice(0,4)))),
      source:'Residentes con código sectorial publicable · Censo 2022'},zoom);
  }
  async function atPoint(kind,point,location){
    if(!location.canton){
      clear();$('geo-status').textContent='El punto está fuera de Guayas y Santa Elena.';updateLegend();return;
    }
    if(kind==='canton')return open(kind,location.canton.code);
    if(kind==='parish'&&location.parish)return open(kind,location.parish.properties.code);
    if(!sectors)return;
    const ticket=++version;
    $('geo-status').textContent='Localizando el punto en la cartografía censal…';
    try{
      const code=await sectors.codeAt(point.lat,point.lon);
      if(ticket!==version)return;
      if(code)return open(kind,code.slice(0,kind==='zone'?9:kind==='parish'?6:12));
      clear();$('geo-status').textContent='El punto no coincide con un sector cartografiado.';updateLegend();
    }catch{
      if(ticket===version){clear();$('geo-status').textContent='No se pudo localizar el sector. Vuelve a consultar el punto.';updateLegend();}
    }
  }
  function legend(){
    if(!current||current.level==='canton')return false;
    $('legend-title').textContent=current.name;
    $('legend').textContent=current.population==null?'Población sin desglose propio':fmt.format(current.population)+' habitantes · Censo 2022';
    return true;
  }
  level.onchange=()=>{
    const point=activePoint();
    if(!current && point && level.value!=='region' && point.location.canton?.code===cantonCode()){
      atPoint(level.value,point.site,point.location);
    }else open(level.value);
  };
  zones.onchange=()=>open(level.value,level.value==='zone'?zones.value:'',true,parish.value.startsWith('gye-')?parish.value:'');
  ids.onchange=()=>open('sector',ids.value,true,parish.value.startsWith('gye-')?parish.value:'');
  $('geo-share').onclick=()=>{
    if(!current)return;
    const url=new URL(location.href);url.search='';url.searchParams.set('area',current.code);if(current.municipal)url.searchParams.set('parroquia',current.municipal);url.hash='explorar';share(url,current.name);
  };
  level.disabled=false;controls();
  return {clear,reset,open,atPoint,legend,get level(){return level.value;},get current(){return current;}};
}
