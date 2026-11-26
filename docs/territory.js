import {estimatedShare} from './income-map.js';
import {featureAt} from './model.js';
import {readCompressedJSON} from './compressed-json.js';

const $ = id => document.getElementById(id);
const names = {canton:'Cantón', parish:'Parroquia', zone:'Zona censal', sector:'Sector censal'};
const articles = {canton:'un cantón', parish:'una parroquia', zone:'una zona censal', sector:'un sector censal'};
const fmt = new Intl.NumberFormat('es-EC');
const percent = new Intl.NumberFormat('es-EC', {style:'percent', maximumFractionDigits:1});
const total = counts => counts.reduce((a,b) => a+b, 0);
const ageLabels = ['0–24 años','25–45 años','46–59 años','60 años o más'];
const ageBands = ages => ages && [ages.slice(0,25), ages.slice(25,46), ages.slice(46,60), ages.slice(60)].map(total);

export function initTerritory({map,cantons,parishes,parishCatalog,sectors,index,ages,cantonCode,setCanton,fitRegion,updateLegend,share,alignSector}){
  const level=$('geo-level'), parish=$('parish-select'), zones=$('geo-zone'), ids=$('geo-sector');
  const buttons=[...document.querySelectorAll('[data-level]')];
  const zoneCodes=Object.keys(index?.zones||{}).sort();
  const incomeBand=$('sector-profile-band');
  if(index){
    const cuts=index.incomeCuts;
    const labels=['Menos de $'+fmt.format(cuts[0]),...cuts.slice(0,-1).map((n,i)=>'$'+fmt.format(n)+' a menos de $'+fmt.format(cuts[i+1])),'$'+fmt.format(cuts.at(-1))+' o más'];
    incomeBand.replaceChildren(...labels.map((label,i)=>new Option(label,String(i))));
    incomeBand.value='1';
  }
  function incomeEstimate(){
    const visible=current?.level==='sector'&&!!current.homes;
    $('sector-income-card').hidden=!visible;
    if(!visible)return;
    const share=estimatedShare(current.homes,index.provinces[current.code.slice(0,2)],Number(incomeBand.value));
    $('sector-profile-estimate').textContent=share===null?'Sin hogares con edad del representante publicada.':percent.format(share)+' de los hogares con edad del representante publicada · '+incomeBand.options[incomeBand.selectedIndex].text+'.';
  }
  incomeBand.onchange=incomeEstimate;
  const group=L.layerGroup().addTo(map), boundaries=L.layerGroup().addTo(map);
  for(const [name,z] of [['territory-boundaries',417],['territory-focus',425]]){
    const pane=map.createPane(name);pane.style.zIndex=z;pane.style.pointerEvents='none';
  }
  const canvas=L.canvas({pane:'territory-boundaries',padding:.1});
  let pointName=null,current=null,shape,noMatch=false,revision=0,outlineRevision=0,zoneTask,pointsTask,lastBorders='';
  const municipalSectors=new Map();
  function zoneOutlines(){
    zoneTask??=readCompressedJSON('./data/zone-outlines.json.gz').catch(e=>{zoneTask=null;throw e;});
    return zoneTask;
  }
  async function eligibleSectors(area){
    if(!area?.properties.code.startsWith('gye-'))return null;
    const code=area.properties.code;
    if(!municipalSectors.has(code)){
      pointsTask??=readCompressedJSON('./data/campaign-residents.json.gz').catch(e=>{pointsTask=null;throw e;});
      const data=await pointsTask;
      municipalSectors.set(code,new Set(data.sectors.filter(([id,lat,lon])=>id.startsWith('090150')&&featureAt([area],lat,lon)).map(row=>row[0])));
    }
    return municipalSectors.get(code);
  }
  function paintBorders(){
    const kind=level.value, view=map.getBounds(), province=$('province').value;
    const agesActive=$('layer').value==='ages';
    const key=[kind,agesActive,province,map.getZoom(),view.toBBoxString(),parishes?.urbanFeatures().length].join('|');
    if(key===lastBorders)return;
    lastBorders=key;
    const ticket=++outlineRevision;
    boundaries.clearLayers();
    if(agesActive)return;
    const style={pane:'territory-boundaries',renderer:canvas,interactive:false,fill:false,color:'#594563',weight:1.4,opacity:.85};
    if(kind==='parish'&&parishCatalog){
      const areas=[...parishCatalog.features,...parishes.urbanFeatures()].filter(f=>!province||cantons.get(f.properties.canton)?.properties.province===province);
      L.geoJSON(areas,{pane:style.pane,renderer:canvas,interactive:false,style}).addTo(boundaries);
    }
    if(kind==='zone'||kind==='sector'){
      zoneOutlines().then(data=>{
        if(ticket!==outlineRevision)return;
        const visible=[];
        for(const z of zoneCodes){
          const [,s,w,n,e]=index.zones[z];
          if((!province||cantons.get(z.slice(0,4)).properties.province===province)&&view.intersects([[s,w],[n,e]]))visible.push(...data[z]);
        }
        L.polygon(visible,{...style,color:'#536079',weight:map.getZoom()<10?.65:1.6}).addTo(boundaries);
      }).catch(()=>{if(ticket===outlineRevision){lastBorders='';$('geo-status').textContent='No se pudieron dibujar los límites de zona. Todavía puedes consultar un punto.';}});
    }
  }
  map.on('moveend',paintBorders);
  function controls(){
    const kind=level.value, fine=kind==='zone'||kind==='sector';
    buttons.forEach(b=>{b.disabled=level.querySelector('[value="'+b.dataset.level+'"]').disabled;b.setAttribute('aria-pressed',String(kind===b.dataset.level));});
    $('parish-field').hidden=kind==='canton';
    $('geo-children').hidden=!fine;$('geo-sector-field').hidden=kind!=='sector';
    const empty=!current&&(kind!=='canton'||noMatch);
    $('profile-empty').hidden=!!pointName||!empty;$('profile-stats').hidden=!!pointName||empty;
    $('geo-facts').hidden=!current||current.level==='canton';
    $('canton-facts').hidden=!!pointName||empty||!$('geo-facts').hidden;
    $('geo-share').hidden=$('geo-zoom').hidden=!current;
    $('geo-boundary-key').hidden=!current;
    if(current)$('geo-boundary-key').textContent='Área seleccionada';
    const hint='Toca '+articles[kind]+' para ver su ficha.';
    $('map-hint').textContent=hint+(kind==='sector'?' Acerca el mapa para distinguir los sectores.':'');
    $('profile-prompt').textContent=hint;
    const title=current?(kind==='zone'||kind==='sector'?names[kind]+' '+current.code:names[kind]+' · '+current.name):('Cantón · '+cantons.get(cantonCode()).properties.name);
    const pop=current?current.population:cantons.get(cantonCode()).properties.population;
    $('selection-label').textContent=pointName?'Edificio · '+pointName:empty?'Selecciona '+articles[kind]:title+(pop==null?'':' · '+fmt.format(pop)+' hab.');
    $('profile-link').hidden=!pointName&&empty;
    incomeEstimate();paintBorders();
  }
  function displayAges(bands){
    const list=$('profile-ages');list.replaceChildren();
    const residents=bands&&total(bands);
    $('age-profile-note').textContent=bands?'Fuente: Censo 2022.':'Sin desglose de edades para esta delimitación.';
    if(!bands)return;
    bands.forEach((n,i)=>{
      const row=document.createElement('li'),name=document.createElement('span'),value=document.createElement('span'),bar=document.createElement('i');
      const share=residents?n/residents:0;
      name.textContent=ageLabels[i];value.textContent=fmt.format(n)+' · '+(residents?percent.format(share):'—');
      bar.style.setProperty('--share',(100*share)+'%');row.append(name,value,bar);list.append(row);
    });
  }
  function cantonAges(code){
    const children=Object.entries(ages||{}).filter(([id])=>id.startsWith(code));
    return children.length?children.reduce((sum,[,series])=>ageBands(series).map((n,i)=>n+sum[i]),[0,0,0,0]):null;
  }
  function clear(kind='canton'){
    revision++;pointName=null;noMatch=false;current=shape=null;group.clearLayers();level.value=names[kind]?kind:'canton';
    $('geo-status').textContent='';controls();
    if(level.value==='canton')displayAges(cantonAges(cantonCode()));
  }
  function reset(zoom=false){
    browse(level.value);if(zoom)fitRegion();
  }
  function fit(layer){
    if(layer)map.fitBounds(layer.getBounds(),{padding:[22,22],maxZoom:18,animate:false});
  }
  function render(layer,details,zoom){
    pointName=null;noMatch=false;current=details;shape=layer;group.clearLayers();
    const rings=layer.getLatLngs();
    for(const [color,weight] of [['#fff',6],['#864214',3.4]]){
      L.polygon(rings,{pane:'territory-focus',interactive:false,color,weight,fill:false,smoothFactor:.5}).addTo(group);
    }
    controls();displayAges(details.bands);
    $('geo-kind').textContent='Ficha de '+names[details.level].toLowerCase();
    $('geo-name').textContent=details.name;$('geo-path').textContent=details.path+' · '+details.code;
    $('geo-pop').textContent=details.population==null?'Sin desglose':fmt.format(details.population);
    $('geo-source').textContent=details.source;
    if(zoom)fit(layer);
    updateLegend();alignSector(details);
  }
  const single=f=>L.geoJSON(f).getLayers()[0];
  function options(menu,label,values,prefix,cut,value=''){
    menu.replaceChildren(new Option(label,''),...values.map(code=>new Option(prefix+' '+code.slice(cut),code)));
    menu.value=value;menu.disabled=!values.length;
  }
  function zoneList(prefix,eligible,selected=''){
    const list=eligible?[...new Set([...eligible].map(id=>id.slice(0,9)))].sort():zoneCodes.filter(z=>z.startsWith(prefix));
    options(zones,'Elegir zona',list,'Zona',prefix.length===6?6:0,selected);
    options(ids,'Elegir sector',[],'Sector',9);
  }
  function browse(kind){
    const previousZone=zones.value;
    clear(kind);
    if(kind==='canton')parishes?.highlight(null);
    if(kind==='zone'||kind==='sector'){
      const prefix=parish.value||cantonCode();
      const eligible=municipalSectors.get(prefix);
      zoneList(prefix,eligible,previousZone);
      if(kind==='sector'&&zones.value)prepareZone(zones.value,false);
      else if(prefix.startsWith('gye-')&&!eligible)parentParish(prefix,false);
    }
    if(kind==='parish')parishes?.loadUrban().then(paintBorders);
    updateLegend();
  }
  function missing(message){
    clear(level.value);noMatch=true;controls();$('geo-status').textContent=message;updateLegend();
  }
  async function open(kind,code,zoom=true,municipal=''){
    if(kind==='region'){reset(zoom);return;}
    if(!names[kind]||level.querySelector('[value="'+kind+'"]').disabled)return;
    if(!code){browse(kind);return;}
    const ticket=++revision;
    const parent=code.startsWith('gye-')?'0901':code.slice(0,4), canton=cantons.get(parent);
    if(!canton){missing('El área está fuera de la cobertura del atlas.');return;}
    level.value=kind;
    if(parent!==cantonCode())setCanton(parent);
    const p=canton.properties, path=p.province+' › '+p.name;
    $('geo-status').textContent='';
    if(kind==='canton'){
      parishes?.highlight(null);
      render(single(canton),{level:kind,code:parent,canton:parent,name:p.name,path:p.province,population:p.population,bands:cantonAges(parent),source:'Censo 2022'},zoom);return;
    }
    try{
      if(code.startsWith('gye-')||municipal.startsWith('gye-'))await parishes.loadUrban();
      if(ticket!==revision)return;
      const parishCode=municipal||(kind==='parish'?code:code.slice(0,6));
      const area=parishes.available().find(f=>f.properties.code===parishCode);
      if(!area){missing('Sin límite parroquial disponible para este punto.');return;}
      const q=area.properties;parishes.highlight(area);
      if(kind==='parish'){
        const series=ages?.[q.code];
        render(single(area),{level:kind,code:q.code,canton:parent,name:q.name,path:path+' · '+q.kind,bands:ageBands(series),population:series?total(series):null,source:series?'habitantes · Censo 2022':'El INEC agrupa esta parroquia urbana en la cabecera cantonal.'},zoom);return;
      }
      const zone=code.slice(0,9);
      if(!index.zones[zone]){missing('La zona no figura en la cartografía censal.');return;}
      $('geo-status').textContent='Cargando la ficha censal…';
      const [rows,eligible,outlines]=await Promise.all([sectors.readZone(zone),eligibleSectors(area),kind==='zone'?zoneOutlines().catch(()=>null):null]);
      if(ticket!==revision)return;
      const children=rows.map(row=>zone+row[0]).filter(id=>!eligible||eligible.has(id));
      const selectedRows=kind==='zone'?rows:rows.filter(row=>zone+row[0]===code&&children.includes(code));
      if(!selectedRows.length){missing('El sector no figura en la cartografía disponible.');return;}
      zoneList(q.code,eligible,zone);options(ids,'Elegir sector',children,'Sector',9,kind==='sector'?code:'');
      const bands=selectedRows.reduce((s,row)=>s.map((n,i)=>n+row[1][i]),[0,0,0,0]);
      $('geo-status').textContent='';
      render(L.polygon(outlines?.[zone]||selectedRows.flatMap(row=>row[2])),{level:kind,code,canton:parent,municipal,name:names[kind]+' '+code.slice(kind==='zone'?6:9),path:path+' › '+q.name+(kind==='sector'?' › Zona '+zone.slice(6):''),bands,homes:kind==='sector'?selectedRows[0][1].slice(4):null,population:total(bands),source:'residentes con código sectorial publicado · Censo 2022'},zoom);
    }catch{
      if(ticket===revision)missing('No se pudo cargar esta área. Vuelve a seleccionarla.');
    }
  }
  async function atPoint(kind,point,location,zoom=true){
    const ticket=++revision;
    if(kind==='canton'){
      if(location.canton)return open(kind,location.canton.code,zoom);
    }else if(kind==='parish'){
      const census=$('layer').value==='ages';
      let area=census?featureAt(parishCatalog.features,point.lat,point.lon):location.parish;
      if(!census&&parishes?.needsUrban(area)){
        await parishes.loadUrban();if(ticket!==revision)return;
        area=parishes.at(point.lat,point.lon);
      }
      if(area)return open(kind,area.properties.code,zoom);
    }else if(sectors){
      $('geo-status').textContent='Localizando el punto…';
      try{
        const id=await sectors.codeAt(point.lat,point.lon);
        if(ticket!==revision)return;
        if(id)return open(kind,kind==='zone'?id.slice(0,9):id,zoom);
      }catch{if(ticket===revision)missing('No se pudo consultar este punto. Intenta de nuevo.');return;}
    }
    missing('Sin '+names[kind].toLowerCase()+' cartografiado en este punto. Elige otra ubicación.');
  }
  async function parentParish(code,zoom=true){
    const kind=level.value;
    if(kind==='parish'&&code)return open(kind,code,zoom);
    clear(kind);
    const area=parishes.available().find(f=>f.properties.code===code);
    parishes.highlight(area);
    if(!area){zoneList(cantonCode(),null);updateLegend();return;}
    if(zoom)fit(single(area));
    const ticket=revision;
    try{const eligible=await eligibleSectors(area);if(ticket===revision)zoneList(code,eligible);}
    catch{if(ticket===revision)missing('No se pudieron cargar las zonas de esta parroquia.');}
    updateLegend();
  }
  async function prepareZone(zone,zoom=true){
    const municipal=parish.value.startsWith('gye-')?parish.value:'';
    if(level.value==='zone'&&zone)return open('zone',zone,zoom,municipal);
    clear(level.value);
    if(!zone){options(ids,'Elegir sector',[],'Sector',9);updateLegend();return;}
    const ticket=revision;
    try{
      const rows=await sectors.readZone(zone);if(ticket!==revision)return;
      if(zoom)fit(L.polygon(rows.flatMap(r=>r[2])));
      const eligible=municipalSectors.get(municipal);
      options(ids,'Elegir sector',rows.map(r=>zone+r[0]).filter(id=>!eligible||eligible.has(id)),'Sector',9);
    }catch{if(ticket===revision)missing('No se pudieron cargar los sectores.');}
    updateLegend();
  }
  function chooseCanton(code){
    if(level.value==='canton')return open('canton',code,true);
    const kind=level.value;clear(kind);setCanton(code);parishes?.highlight(null);
    zoneList(code,null);fit(single(cantons.get(code)));updateLegend();
  }
  level.querySelector('[value="parish"]').disabled=!parishes;
  for(const kind of ['zone','sector'])level.querySelector('[value="'+kind+'"]').disabled=!sectors;
  level.onchange=()=>{
    if($('layer').value==='site')$('layer').value='population';
    browse(level.value);
  };
  buttons.forEach(b=>b.onclick=()=>{level.value=b.dataset.level;level.onchange();});
  zones.onchange=()=>prepareZone(zones.value);
  ids.onchange=()=>ids.value?open('sector',ids.value,true,parish.value.startsWith('gye-')?parish.value:''):browse('sector');
  $('geo-zoom').onclick=()=>fit(shape);
  $('geo-share').onclick=()=>{
    if(!current)return;
    const url=new URL(location.href);url.search='';url.searchParams.set('area',current.code);
    if(current.municipal)url.searchParams.set('parroquia',current.municipal);
    url.hash='explorar';share(url,current.name);
  };
  level.disabled=false;clear();
  return {clear,reset,open,browse,atPoint,chooseCanton,parentParish,controls,zoneOutlines,
    showPoint(name){clear(level.value);pointName=name;controls();},get isPoint(){return !!pointName;},
    get level(){return level.value;},get current(){return current;}};
}
