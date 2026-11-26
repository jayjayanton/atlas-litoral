import {createScoreSurface,surfaceLegend} from './score-surface.js';
import {readCompressedJSON} from './compressed-json.js';
import {initSuitability} from './suitability.js';
import {initSchoolFees} from './school-fees.js';
import {accessibility,defaults,nearestFacility,nearestRoad,ownership,roadLines} from './access-model.js';
import {distanceKm} from './model.js';

const $=id=>document.getElementById(id);
const fmt=(n,d=1)=>new Intl.NumberFormat('es-EC',{maximumFractionDigits:d}).format(n);
const escape=text=>String(text??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const symbols={school:['#6562b2','Escuela'],public:['#0d7195','Hospital público'],private:['#bd455e','Hospital privado'],unknown:['#5f6668','Hospital sin sector registrado']};
const hospitalSources={'MSP / IEDG':'MSP / IEDG · julio de 2026','SNGR':'SNGR · registro 2023','SNGR / ACHPE':'SNGR · registro 2023 / ACHPE · consulta nov. 2026'};
const rateColors=['#f1eee4','#d4dfab','#9bc286','#449382','#185c68'];
const rateScales={
  school:{cuts:[6,9,12,16],labels:['<6','6–<9','9–<12','12–<16','16 o más']},
  hospital:{cuts:[0,.05,.10,.20],labels:['0','>0–<0,05','0,05–<0,10','0,10–<0,20','0,20 o más']}
};
const clusterText={hot:'Foco de valores altos',cold:'Foco de valores bajos',none:'Sin agrupación significativa',unknown:'Sin datos suficientes'};
const isHot=theme=>theme==='hot-school'||theme==='hot-hospital';
const appThemes=t=>isHot(t)||t==='suitability'||t==='access'||t==='site'||t==='fees'||t==='regional-fees';
const km=n=>n==null?'Sin dato':n<.05?'menos de 50 m':n<1?'≈ '+fmt(Math.round(n*100)*10,0)+' m':'≈ '+fmt(n,1)+' km';

export async function initInfrastructure({map,land,state,changeTheme,isPicking,fitRegion,selectCanton,download,onScenarioChange}){
  async function loadLayer(name){
    const file=name==='roads'?'roads.geojson':name+'.json';
    const response=await fetch('./data/infra/'+file);
    if(!response.ok)throw Error('No se pudo cargar '+name);
    return response.json();
  }
  const catalog=['schools','hospitals','roads','hotspots','sources','school-fees','density-scale','attractions','site-amenities'];
  const values=await Promise.all(catalog.map(k=>loadLayer(k).catch(e=>{console.warn('Atlas:',e);return null;})));
  const [schools,hospitals,roads,hotspots,metadata,feeData,scale,attractions,siteAmenityRows]=values;
  const siteAmenities={shopping:[],city:[]};
  for(const [kind,name,,lat,lon] of siteAmenityRows||[])siteAmenities[kind]?.push({name,lat,lon});
  let grid,surface,gridTask,positions={},accessLoading=false;
  function loadGrid(){
    if(!gridTask)gridTask=loadLayer('grid').then(data=>{
      const result=createScoreSurface(map,land,state().features,data);
      positions=Object.fromEntries(data.columns.map((c,i)=>[c,i]));grid=data;surface=result;
      return {grid,surface};
    }).catch(e=>{gridTask=null;throw e;});
    return gridTask;
  }
  async function loadRegional(){
    const [base,density,amenities]=await Promise.all([
      loadGrid(),loadLayer('density'),
      readCompressedJSON('./data/infra/amenity-distances.json.gz').catch(()=>null)
    ]);
    return {...base,density,amenities};
  }
  let fees,suitability;
  const available={school:schools!==null,public:!!hospitals?.some(x=>ownership(x.sector)==='public'),private:!!hospitals?.some(x=>ownership(x.sector)==='private'),unknown:!!hospitals?.some(x=>ownership(x.sector)==='unknown'),roads:roads!==null};
  const criteria=defaults.map(o=>({...o}));
  const nearestCache=new Map();
  const allRoadLines=roads?roadLines(roads):[];
  const points=[...(schools??[]).map(p=>({...p,kind:'school'})),...(hospitals??[]).map(p=>({...p,kind:ownership(p.sector)}))];
  let modelVersion=0,layerKey='',renderFrame,roadLayer;
  for(const [p,z] of [['infra-roads',412],['infra-points',460]]){
    const pane=map.createPane(p);pane.style.zIndex=z;
    if(p!=='infra-points')pane.style.pointerEvents='none';
  }
  const pointGroup=L.layerGroup().addTo(map);
  if(roads){
    roadLayer=L.geoJSON(roads,{pane:'infra-roads',interactive:false,renderer:L.canvas({pane:'infra-roads',padding:.2}),style:f=>{
      const major=/motorway|trunk|primary/i.test(f.properties.class??'');
      return {color:major?'#a85b1b':'#b98554',weight:major?2:1.15,opacity:major?.81:.62};
    }});
    if($('ol-roads').checked)roadLayer.addTo(map);
  }
  for(const [kind,ok] of Object.entries(available)){
    const input=$('ol-'+kind);input.disabled=!ok;if(!ok)input.checked=false;
    input.onchange=()=>{if(kind==='roads'){
      if(roadLayer){if(input.checked)roadLayer.addTo(map);else roadLayer.remove();}
    }else queuePoints();};
  }
  $('unknown-label').hidden=!available.unknown;
  function queuePoints(){
    if(renderFrame)cancelAnimationFrame(renderFrame);
    renderFrame=requestAnimationFrame(drawPoints);
  }
  function drawPoints(){
    pointGroup.clearLayers();
    if(!Object.keys(symbols).some(k=>$('ol-'+k).checked))return;
    const zoom=map.getZoom(),bounds=map.getBounds().pad(.05),step=zoom>=13?17:zoom>=10?30:46,groups=new Map();
    for(const point of points){
      if(!$('ol-'+point.kind).checked||!bounds.contains([point.lat,point.lon]))continue;
      const px=map.project([point.lat,point.lon],zoom),key=Math.floor(px.x/step)+','+Math.floor(px.y/step);
      const group=groups.get(key)??{rows:[],lat:0,lon:0};
      group.rows.push(point);group.lat+=point.lat;group.lon+=point.lon;groups.set(key,group);
    }
    for(const group of groups.values()){
      const n=group.rows.length,first=group.rows[0],pt=[group.lat/n,group.lon/n],single=n===1;
      const kinds=[...new Set(group.rows.map(p=>p.kind))];
      const label=single?first.name:(n+' establecimientos');
      const color=kinds.length===1?symbols[first.kind][0]:'#334f58',size=single?16:(n>=100?34:26);
      const icon=single?'<span class="single-'+(first.kind==='school'?'school':'hospital')+'" style="width:100%;height:100%"><i class="geo-symbol '+first.kind+'"></i></span>':'<span class="cluster-pin" style="width:100%;height:100%;--pt:'+color+'">'+(n>=1000?fmt(n/1000,1)+'k':n)+'</span>';
      const mark=L.marker(pt,{pane:'infra-points',title:label,keyboard:true,icon:L.divIcon({className:'',html:icon,iconSize:[size,size],iconAnchor:[size/2,size/2]})}).addTo(pointGroup);
      mark.bindTooltip(escape(label),{direction:'top'});
      mark.on('click',()=>{
        if(isPicking()||state().theme==='site'){map.fire('click',{latlng:mark.getLatLng()});return;}
        map.fire('click',{latlng:mark.getLatLng()});
        if(!single&&zoom<15){
          const box=document.createElement('div'),button=document.createElement('button');
          box.textContent=label+' · ';button.type='button';button.className='linkbutton';button.textContent='Acercar al grupo';
          button.onclick=()=>{map.closePopup();map.setView(pt,Math.min(16,zoom+2));};
          box.append(button);L.popup({autoPan:false}).setLatLng(pt).setContent(box).openOn(map);return;
        }
        const inner=group.rows.map(p=>'<b>'+escape(p.name)+'</b><br><small>'+escape(symbols[p.kind][1])+' · '+escape(p.sector||'Sin clasificar')+(p.locality?' · '+escape(p.locality):'')+'<br>'+escape(p.kind==='school'?'Ministerio de Educación · ago 2026':hospitalSources[p.source]||p.source||'Ver fuentes del inventario')+'</small>'+(p.kind==='school'&&fees?'<br>'+fees.popup(p):'')).join('<hr>');
        L.popup({maxHeight:230,autoPan:false}).setLatLng(pt).setContent('<div class="address-popup">'+inner+'</div>').openOn(map);
      });
    }
  }
  map.on('moveend zoomend',queuePoints);
  $('national-roads').disabled=!roadLayer;
  $('national-roads').onclick=()=>{if(!roadLayer)return;$('ol-roads').checked=true;roadLayer.addTo(map);map.fitBounds(roadLayer.getBounds(),{padding:[12,12],maxZoom:7});$('explorar').scrollIntoView({block:'start'});};
  $('criteria-input').innerHTML=criteria.map(c=>'<div class="criteria-row"><label for="w-'+c.key+'">'+c.name+'</label><input id="w-'+c.key+'" aria-label="Peso de '+c.name+'" type="number" min="0" max="100" step="1" value="'+c.weight+'"><input id="lim-'+c.key+'" aria-label="Límite en kilómetros de '+c.name+'" type="number" min="0.1" max="200" step="0.1" value="'+c.limit+'"></div>').join('');
  const saved=(()=>{try{return JSON.parse(localStorage.getItem('atlasLitoral.access.v1'));}catch{return null;}})();
  for(const c of criteria){
    const w=$('w-'+c.key),lim=$('lim-'+c.key);
    if(saved?.[c.key]&&Number.isFinite(saved[c.key].weight)&&Number.isFinite(saved[c.key].limit)&&saved[c.key].weight>=0&&saved[c.key].weight<=100&&saved[c.key].limit>=.1&&saved[c.key].limit<=200){w.value=saved[c.key].weight;lim.value=saved[c.key].limit;}
    w.oninput=lim.oninput=updateCriteria;
  }
  if(['all','public','private'].includes(saved?.scope))$('health-scope').value=saved.scope;
  $('health-scope').onchange=updateCriteria;
  let validCriteria=true;
  function updateCriteria(){
    for(const c of criteria){
      c.weight=$('w-'+c.key).valueAsNumber;c.limit=$('lim-'+c.key).valueAsNumber;
    }
    validCriteria=criteria.every(c=>Number.isFinite(c.weight)&&c.weight>=0&&c.weight<=100&&Number.isFinite(c.limit)&&c.limit>=.1&&c.limit<=200)&&criteria.some(c=>c.weight>0);
    $('criteria-message').textContent=validCriteria?'':'Indica pesos de 0 a 100, al menos uno positivo, y límites entre 0,1 y 200 km.';
    if(validCriteria){try{localStorage.setItem('atlasLitoral.access.v1',JSON.stringify({...Object.fromEntries(criteria.map(c=>[c.key,{weight:c.weight,limit:c.limit}])),scope:$('health-scope').value}));}catch{}}
    modelVersion++;refresh();
  }
  function pinDistances(proj,scope=$('health-scope').value){
    const key=[proj.lat,proj.lon,scope].join('|');
    if(nearestCache.has(key))return nearestCache.get(key);
    const out={school:nearestFacility(proj.lat,proj.lon,schools??[]),hospital:nearestFacility(proj.lat,proj.lon,hospitals??[],scope==='all'?null:scope),road:nearestRoad(proj.lat,proj.lon,allRoadLines),tourism:nearestFacility(proj.lat,proj.lon,attractions??[]),shopping:nearestFacility(proj.lat,proj.lon,siteAmenities.shopping),city:nearestFacility(proj.lat,proj.lon,siteAmenities.city)};
    if(nearestCache.size>=16)nearestCache.clear();nearestCache.set(key,out);return out;
  }
  function updatePin(){
    const {project,projectInCoverage}=state();
    $('show-services').textContent=project?'Ver servicios cercanos':'Elegir edificio';
    $('show-services').disabled=!!project&&(!projectInCoverage||!points.length);
    $('analysis-project').hidden=!project;
    $('access-score-box').hidden=!project;
    if(!projectInCoverage){
      $('analysis-project').textContent=project?.name || 'Accesibilidad en el mapa';$('access-score').textContent='—';
      $('access-summary').textContent=project?'Edificio fuera de la cobertura de Guayas y Santa Elena.':'Selecciona un edificio para consultar los servicios cercanos.';
      $('nearby-list').replaceChildren();return;
    }
    const near=pinDistances(project),d=Object.fromEntries(Object.entries(near).map(([k,v])=>[k,v?.km??null]));
    const score=validCriteria?accessibility(d,criteria):null;
    $('analysis-project').textContent=project.name;
    $('access-score').textContent=score==null?'—':fmt(score,0);
    $('access-summary').textContent=(project.reference?'Origen: acceso aproximado a Torres del Salado. ':'Origen: pin del proyecto. ')+'Distancias en línea recta a registros disponibles.';
    $('nearby-list').innerHTML=criteria.map(c=>{
      const item=near[c.key]?.item,name=item?.name||item?.ref||item?.class||'Tramo sin nombre';
      return '<div class="near-record"><b>'+escape(c.name)+' · '+km(d[c.key])+'</b>'+(item?' · '+escape(name):' · Sin cobertura para este criterio')+'</div>';
    }).join('');
  }
  function cellDistances(row){
    const scope=$('health-scope').value,h=scope==='all'?'hospitalKm':scope==='public'?'publicHospitalKm':'privateHospitalKm';
    return {school:row[positions.schoolKm],hospital:row[positions[h]],road:row[positions.roadKm]};
  }
  function drawGrid(theme,province){
    if(theme==='access' && !grid){
      if(!accessLoading){
        accessLoading=true;
        loadGrid().then(()=>{if(state().theme==='access'){layerKey='';refresh();legend('access');}})
          .catch(()=>{if(state().theme==='access')$('legend').textContent='No se pudo cargar la malla. Vuelve a seleccionar esta capa para reintentar.';})
          .finally(()=>{accessLoading=false;});
      }
      return;
    }
    const key=[theme,province,modelVersion].join('|');
    if(key===layerKey)return;
    layerKey=key;
    if(theme!=='access'||!grid||!validCriteria){surface?.clear('access');return;}
    const allowed=new Set(state().features.filter(f=>!province||f.properties.province===province).map(f=>f.properties.code));
    const scores=grid.cells.map(row=>allowed.has(row[positions.code])?accessibility(cellDistances(row),criteria):null);
    surface.draw('access',scores,allowed);
  }
  function inspect(ll){
    if(state().theme==='suitability'){if(surface?.covers(ll))suitability?.inspect(ll);return;}
    if(state().theme!=='access'){
      if($('ol-roads').checked&&map.getZoom()>=10){
        const near=nearestRoad(ll.lat,ll.lng,allRoadLines);
        const tolerance=distanceKm(ll.lat,ll.lng,(()=>{const p=map.layerPointToLatLng(map.latLngToLayerPoint(ll).add([8,0]));return [p.lng,p.lat];})());
        if(near&&near.km<=tolerance)L.popup({autoPan:false}).setLatLng(ll).setContent('<b>Vía principal</b><br>'+escape(near.item.name||near.item.ref||'Tramo sin nombre')+(near.item.ref?' · '+escape(near.item.ref):'')).openOn(map);
      }
      return;
    }
    if(!grid||!validCriteria||!surface.covers(ll))return;
    let best=null,min=Infinity;
    const {province,features}=state();
    const allowed=new Set(features.filter(f=>!province||f.properties.province===province).map(f=>f.properties.code));
    for(const row of grid.cells){
      if(!allowed.has(row[positions.code]))continue;
      const lon=row[positions.lon],lat=row[positions.lat];if(Math.abs(lon-ll.lng)>.03||Math.abs(lat-ll.lat)>.03)continue;
      const d=distanceKm(ll.lat,ll.lng,[lon,lat]);if(d<min){min=d;best=row;}
    }
    if(!best||min>grid.spacingKm*.72)return;
    const ds=cellDistances(best),score=accessibility(ds,criteria);
    L.popup().setLatLng([best[positions.lat],best[positions.lon]]).setContent('<b>Muestra cercana de la malla · '+(score==null?'Sin dato':fmt(score,0)+'/100')+'</b><br>Escuela: '+km(ds.school)+'<br>Hospital: '+km(ds.hospital)+'<br>Vía principal: '+km(ds.road)).openOn(map);
  }
  function hotspotData(code,kind){return hotspots?.cantons[code]?.[kind];}
  const hotPane=map.createPane('significant-clusters');hotPane.style.zIndex=424;hotPane.style.pointerEvents='none';
  const hotLines=L.layerGroup().addTo(map);
  let hotKey='';
  function markClusters(theme,province){
    const key=theme+'|'+province;
    if(key===hotKey)return;
    hotKey=key;hotLines.clearLayers();
    if(!isHot(theme))return;
    const kind=theme==='hot-school'?'school':'hospital';
    for(const feature of state().features){
      if(province&&feature.properties.province!==province)continue;
      const cluster=hotspotData(feature.properties.code,kind)?.cluster;
      if(cluster!=='hot'&&cluster!=='cold')continue;
      L.geoJSON(feature,{pane:'significant-clusters',interactive:false,style:{fill:false,color:cluster==='hot'?'#7a2158':'#3457ae',weight:4,dashArray:'8 5',lineCap:'butt'}}).addTo(hotLines);
    }
  }
  function updateHot(){
    const {code,features}=state(),kind=$('hot-kind').value,stat=hotspotData(code,kind),name=features.find(f=>f.properties.code===code)?.properties.name??code;
    const high=features.filter(f=>hotspotData(f.properties.code,kind)?.cluster==='hot').map(f=>f.properties.name);
    const low=features.filter(f=>hotspotData(f.properties.code,kind)?.cluster==='cold').map(f=>f.properties.name);
    $('hot-region').textContent=!hotspots?'No se pudieron cargar las tasas cantonales. Recarga la página para reintentar.':(high.length||low.length)?[high.length?'Focos altos: '+high.join(', '):'',low.length?'Focos bajos: '+low.join(', '):''].filter(Boolean).join('. ')+'.':'Ningún foco significativo en los 28 cantones (q ≤ 0,05).';
    if(isHot(state().theme)){
      $('profile-hot-title').textContent=(kind==='school'?'Escuelas':'Hospitales MSP')+' · cantón '+name;
      $('profile-hot-value').textContent=stat?num(stat.count)+' establecimientos · '+fmt(stat.rate,3)+' por 10.000 habitantes. '+clusterText[stat.cluster]+'.':'Sin datos para este cantón.';
    }
    if(!stat||stat.cluster==='unknown'){$('hotspot-result').textContent=name+' · sin precisión suficiente para esta prueba.';return;}
    $('hotspot-result').innerHTML='<b>'+escape(name)+' · '+escape(clusterText[stat.cluster])+'</b><br>'+num(stat.count)+' registros · '+fmt(stat.rate,2)+' por 10.000 hab.'+(stat.z!=null&&stat.q!=null?' · z '+fmt(stat.z,2)+' · q '+fmt(stat.q,3):'')+'.';
  }
  function num(n){return fmt(n,0);}
  function refresh(){
    const {theme,province}=state();
    if(isHot(theme))$('hot-kind').value=theme==='hot-school'?'school':'hospital';
    markClusters(theme,province);drawGrid(theme,province);updatePin();updateHot();fees?.refresh();suitability?.refresh();
  }
  function fill(theme,code){
    if(theme==='fees')return '#e9ece7';
    if(theme==='regional-fees')return fees?.regionalColor(code)??'#e3e7e3';
    if(theme==='access'||theme==='suitability'||theme==='site')return '#e3e9df';
    const kind=theme==='hot-hospital'?'hospital':'school';
    const rate=hotspotData(code,kind)?.rate;
    if(rate==null)return '#c2c5c9';
    const band=rateScales[kind].cuts.filter(cut=>cut===0?rate>0:rate>=cut).length;
    return rateColors[band];
  }
  function linkToTool(hash,label){
    const link=document.createElement('a');link.href=hash;link.textContent=label;
    $('legend').append(link);
  }
  function legend(theme){
    if(!appThemes(theme))return false;
    if(theme==='fees'||theme==='regional-fees'){fees?.legend(theme);return true;}
    if(theme==='site'){suitability?.siteLegend();return true;}
    if(theme==='suitability'){suitability?.legend();return true;}
    if(theme==='access'){
      if(grid)surfaceLegend('Aptitud de proximidad · 0–100',grid.spacingKm);
      else {$('legend-title').textContent='Aptitud por accesibilidad';$('legend').textContent='Cargando la malla regional…';}
      linkToTool('#infra','Ajustar accesibilidad');
      return true;
    }
    const kind=theme==='hot-school'?'school':'hospital';
    $('legend-title').textContent=(kind==='school'?'Escuelas':'Hospitales MSP')+' por 10.000 habitantes · cantones';
    const keys=rateScales[kind].labels.map((label,i)=>'<span class="key"><i class="sw" style="background:'+rateColors[i]+'"></i>'+label+'</span>');
    const scope=state().features.filter(f=>!state().province||f.properties.province===state().province);
    const hot=scope.filter(f=>hotspotData(f.properties.code,kind)?.cluster==='hot');
    const note=hot.length?'Focos altos significativos: '+hot.map(f=>f.properties.name).join(' y ')+'.':'Sin focos significativos en los '+scope.length+' cantones de la vista.';
    $('map-hint').textContent=note+' El color indica '+(kind==='school'?'escuelas':'hospitales MSP')+' por 10.000 habitantes.';
    $('legend').innerHTML=keys.join('')+'<span class="hot-legend-note">'+(hot.length?'<i class="hot-line"></i>':'')+escape(note)+'</span>';
    linkToTool('#focos','Consultar focos cantonales');
    return true;
  }
  $('hot-kind').onchange=()=>{if(isHot(state().theme))changeTheme('hot-'+$('hot-kind').value);else updateHot();};
  $('show-access').disabled=$('grid-opt').disabled=false;
  $('show-hotspot').disabled=$('hs-opt').disabled=$('hh-opt').disabled=!hotspots;
  function viewTheme(t){changeTheme(t);fitRegion();$('explorar').scrollIntoView({block:'start'});}
  $('show-access').onclick=()=>viewTheme('access');
  $('show-services').onclick=()=>{
    if(!state().project){
      const select=$('building-select');
      select.scrollIntoView({block:'center'});select.focus({preventScroll:true});return;
    }
    for(const key of Object.keys(symbols))if(available[key])$('ol-'+key).checked=true;
    const p=state().project;map.setView([p.lat,p.lon],13);queuePoints();$('explorar').scrollIntoView({block:'start'});
  };
  $('show-hotspot').onclick=()=>viewTheme('hot-'+$('hot-kind').value);
  const failed=catalog.filter((k,i)=>values[i]===null);
  $('infra-status').textContent=failed.length?'Faltan capas por cargar: '+failed.join(', ')+'. Recarga para reintentar.':'';
  if(metadata){
    const anchor=(url,title,download=false)=>'<a href="'+escape(url)+'" '+(download?'download':'target="_blank" rel="noopener noreferrer"')+'>'+escape(title)+'</a>';
    const list=metadata.layers.map(layer=>'<li><b>'+escape(layer.title)+'</b> · '+escape(layer.period)+'. '+escape(layer.note)+' '+layer.links.map(q=>anchor(q.url,q.label,q.download)).join(' · ')+'</li>').join('');
    $('infra-doc').innerHTML='<ul>'+list+'</ul>'+metadata.method.map(x=>'<p>'+escape(x)+'</p>').join('')+'<p>'+anchor('./data/infra/grid.json','Descargar distancias de la malla',true)+' · '+anchor('./data/infra/hotspots.json','Descargar pruebas cantonales',true)+'</p>';
  }
  const hospitalScope=hotspots?.method?.hospitalScope;
  if(hospitalScope){const note=document.createElement('p');note.className='mini';note.textContent='Focos hospitalarios: '+hospitalScope;document.querySelector('.hotspot-info').append(note);}
  fees=initSchoolFees({schools,data:feeData,map,state,changeTheme,selectCanton,fitRegion,download});
  try{
    suitability=initSuitability({map,state,changeTheme,selectCanton,scale,loadRegional,schools,hospitals,siteAmenities,download,pinDistances,onScenarioChange});
  }catch(error){onScenarioChange?.(null);console.warn('Aptitud ponderada:',error);$('suit-status').textContent='No se pudo iniciar el análisis de densidad.';}
  updateCriteria();queuePoints();
  return {refresh,fill,legend,inspect,supports:appThemes,schools,hospitals};
}
