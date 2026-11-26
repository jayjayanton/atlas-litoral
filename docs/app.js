import {initBasemap, osmCredit} from './basemaps.js';
import {initProjectSelection} from './project-selection.js';
import {buildingSearch} from './building-search.js';
import {initCampaignMap} from './campaign-map.js';
import {initEarnings} from './earnings.js';
import {showAnalysis} from './explorer-ui.js';
import {initProvinceIncome,isSectorTheme} from './income-map.js';
import {parseCoordinates, validBuilding, sameBuilding, buildingList, buildingURL, buildingFromURL} from './buildings.js';
import {initialFinance,distanceKm,featureAt,maxPrice,median,normalize,parseSample,demandFields,loanFields,recentMatches} from './model.js';
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const link=(url,label)=>'<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">'+esc(label)+'</a>';
const num=n=>new Intl.NumberFormat('es-EC').format(n);
const money=n=>n==null?'—':'$'+num(Math.round(n));
const store='atlasLitoral.v1.';
function load(key,init){try{return JSON.parse(localStorage.getItem(store+key))??init;}catch{return init;}}
function save(key,value){try{localStorage.setItem(store+key,JSON.stringify(value));return true;}catch{say('No se pudo guardar en este navegador.');return false;}}
let selection, selectionChoices, markingPoint=false, markingTheme='';
let project=null,catalog,buildings,buildingState;
let finance=load('finance',initialFinance),requests=load('demand',[]),userLoans=load('loans',[]);
let territory,campaign,sectors,provinceIncome,demographics,creditMap,infrastructure,parishes,projectParish,earnings,parishIndex,pinSector,pinLookup;
let features,inc={},observed=[],bank={rows:[]},polys,cantonLines,cantonCasing,selected='0901',map,labels,streets,selectedPopup,picking=false,pending=null,matches={},dest=null;
let highlighted=null;
const layers={},colors=['#f7e5d0','#edc197','#d99270','#ad5a62','#713452'],empty='#ece6e2';
const financingURL='https://www.superbancos.gob.ec/estadisticas/portalestudios/volumen-de-credito/';
const incomeURL='https://www.ecuadorencifras.gob.ec/encuesta-nacional-de-ingresos-y-gastos-de-los-hogares-urbanos-y-rurales/';
const guideURL='https://www.ecuadorencifras.gob.ec/documentos/web-inec/Estadisticas_Sociales/enighur/2024-2025/Documento_Metodologico_ENIGHUR.pdf';
const publishedPrice='https://www.plusvalia.com/propiedades/clasificado/veclapin-departamentos-de-estreno-en-venta-en-via-a-la-costa-150862041.html';
let timeout;function say(s){$('toast').textContent=s;$('toast').style.display='block';clearTimeout(timeout);timeout=setTimeout(()=>$('toast').style.display='none',3900);}
const byCode=c=>features.find(f=>f.properties.code===c);
const scope=f=>f.properties.code==='0901'?'Guayaquil urbano':f.properties.province;
const withinProvince=f=>!$('province').value||f.properties.province===$('province').value;
function locate(lat,lon){
 const parish=parishes?.at(lat,lon);
 const canton=(parish && byCode(parish.properties.canton)) || featureAt(features,lat,lon);
 return {parish,canton:canton?.properties};
}
function areaLabel(canton,parish){
 if(!canton)return 'Fuera de la cobertura territorial del atlas';
 return [canton.province,canton.name,parish?.properties.name].filter(Boolean).join(' · ');
}
function projectState(){
 const current=project ? locate(project.lat,project.lon) : {};
 dest=current.canton || (pinSector && byCode(pinSector.slice(0,4))?.properties);projectParish=current.parish;
 matches=hasDemand()?recentMatches(requests,project,dest.code):{};
}
function campaignMatches(building){
 if(building === project)return hasDemand()?matches:null;
 if(!requests.length || !building?.sector || !(building.price>0 && building.rooms>0))return null;
 const canton=locate(building.lat,building.lon).canton;
 return canton?recentMatches(requests,building,canton.code):null;
}
function hasDemandInputs(){return !!(dest && project?.sector && project.price>0 && project.rooms>0);}
function hasDemand(){return requests.length>0 && hasDemandInputs();}
function demandNote(){
 if(!project)return 'Selecciona un proyecto para comparar solicitudes de compra.';
 if(!hasDemandInputs())return 'Para comparar solicitudes, el proyecto debe estar en Guayas o Santa Elena y tener sector, precio y dormitorios.';
 return 'Importa una muestra reciente con cantón de origen y destino para comparar solicitudes.';
}
function observedLoans(f){return bank.rows.find(r=>normalize(r.province)===normalize(f.properties.province)&&(normalize(r.canton)===normalize(f.properties.name)||(r.canton.includes('BUCAY')&&f.properties.code==='0927')));}
function metricValue(f){const c=f.properties.code;switch($('layer').value){case'population':return f.properties.population;case'loans':return observedLoans(f)?.operations??null;default:return hasDemand()?matches[c]??0:null;}}
function breaks(){return $('layer').value==='population'?[0,50000,100000,200000,500000]:$('layer').value==='loans'?[1,5,25,100,500]:[0,1,5,10,25];}
function fill(f){if($('layer').value==='overview')return '#f1e9df';if($('layer').value==='population'&&territory&&territory.level!=='canton')return '#e6cbbd';if(['ages','sectors','sector-income','income','site'].includes($('layer').value))return '#ede8e3';if(creditMap && $('layer').value==='credit')return creditMap.fill(f.properties.code);if(infrastructure?.supports($('layer').value))return infrastructure.fill($('layer').value,f.properties.code);const v=metricValue(f);if(v==null)return empty;const ix=breaks().filter(x=>v>=x).length-1;return colors[Math.max(0,ix)];}
function style(f){
 const theme=$('layer').value;
 const neutral=['overview','ages','sectors','sector-income','income','site'].includes(theme);
 const alpha=neutral?.025:['access','suitability'].includes(theme)?.24:.62;
 return {stroke:false,fillColor:fill(f),fillOpacity:withinProvince(f)?alpha:Math.min(alpha,.12)};
}
function cantonLine(f){
 if($('layer').value==='ages'&&territory?.level!=='canton')return {fill:false,color:'#465f65',weight:1,opacity:.65};
 const active=f.properties.code===highlighted&&(!territory||territory.level==='canton');
 return {fill:false,color:active?'#522e49':'#685867',weight:active?3:1.2,opacity:withinProvince(f)?(active?1:.73):.4};
}
function cantonHalo(f){
 if($('layer').value==='ages'&&territory?.level!=='canton')return {fill:false,color:'#fff',weight:2,opacity:.65};
 return {fill:false,color:'#fff',weight:f.properties.code===highlighted?5:2.5,opacity:withinProvince(f)?.82:.4};
}
function setSelection(code,move=false,keepArea=false){if(!byCode(code))return;
 selected=code;highlighted=code;
 if(!keepArea && (territory?.current?.canton!==code||move))territory?.clear();
 if($('province').value&&!withinProvince(byCode(code))){$('province').value='';for(const option of $('canton').options)option.hidden=false;}$('canton').value=code;render();if(move)map.fitBounds(layers[code].getBounds(),{padding:[22,22],maxZoom:11});}
const mapView=$('map-view'), allThemes=$('layer');
const quickThemes=[...allThemes.querySelectorAll('[data-quick-map]')];
mapView.replaceChildren(...quickThemes.map(option=>new Option(option.text,option.value)));

function syncMapView(){
 const active=allThemes.selectedOptions[0];
 if(!active)return;
 const previous=mapView.querySelector('[data-analysis-view]');
 if(previous && previous.value!==active.value)previous.remove();
 for(const option of quickThemes)mapView.querySelector('[value="'+option.value+'"]').disabled=option.disabled;
 if(!active.hasAttribute('data-quick-map')&&!mapView.querySelector('[data-analysis-view]')){
   const contextOption=new Option(active.text,active.value);
   contextOption.dataset.analysisView='';
   mapView.add(contextOption);
 }
 mapView.value=active.value;
}

function colorize(){if(markingPoint && markingTheme!==$('layer').value)setMarkingPoint(false);syncMapView();polys.setStyle(style);cantonCasing.setStyle(cantonHalo);cantonLines.setStyle(cantonLine);if(layers[selected])layers[selected].bringToFront();
 const theme=$('layer').value, provinceView=theme==='income', p=byCode(selected).properties;
 if(theme==='overview'){$('legend-title').textContent='Vista general';$('legend').textContent='Cantones de Guayas y Santa Elena';$('map-hint').textContent='Vista general · selecciona un cantón para consultar su ficha.';}
 const domain=p.province;
 $('income').textContent=inc[domain]?'$'+num(inc[domain].median):'Sin dato';
 $('income-scale').textContent='Referencia provincial · '+domain+' · ENIGHUR 2024–25';
 $('income-controls').hidden=theme!=='sector-income';
 $('site-card').hidden=theme!=='site';
 $('geo-pin').hidden=!project;
 $('profile-hot').hidden=!['hot-school','hot-hospital'].includes(theme);
 if(theme==='site')$('map-hint').textContent='Toca un punto para ver su aptitud. La ficha con el puntaje está debajo del mapa.';
 else territory?.controls();
 earnings?.refresh();creditMap?.refresh();demographics?.refresh();sectors?.refresh();
 provinceIncome?.refresh(provinceView,$('province').value);
 if(infrastructure){infrastructure.refresh();if(infrastructure.legend(theme))return;}
 if(theme==='population'&&territory&&territory.level!=='canton'){
   $('legend-title').textContent='Límites territoriales';
   $('legend').textContent={parish:'Parroquias y cabeceras cantonales',zone:'Zonas censales · INEC 2022',sector:'Zonas censales y, al acercar, sectores censales · INEC 2022'}[territory.level];return;
 }
 if(provinceView)return;
 if(sectors && isSectorTheme(theme)){sectors.legend();return;}
 if(demographics && $('layer').value==='ages'){demographics.legend();return;}
 if(creditMap && $('layer').value==='credit'){creditMap.legend();return;}
 if(theme==='overview')return;
 const choices=$('layer').value==='population'?['<50 mil','50 mil+','100 mil+','200 mil+','500 mil+']:$('layer').value==='loans'?['1–4','5–24','25–99','100–499','500+']:['0','1–4','5–9','10–24','25+'];
 $('legend-title').textContent=$('layer').value==='population'?'Habitantes · 2022':$('layer').value==='loans'?'Créditos por destino · ene–sep 2026':'Solicitudes de origen · 90 días';
 $('legend').innerHTML=choices.map((c,i)=>'<span class="key"><i class="sw" style="background:'+colors[i]+'"></i>'+c+'</span>').join('')+($('layer').value==='population'?'':'<span class="key"><i class="sw" style="background:'+empty+'"></i>S/d</span>');
}
function fitRegion(){const fs=features.filter(withinProvince);const b=L.latLngBounds([]);fs.forEach(f=>b.extend(layers[f.properties.code].getBounds()));map.fitBounds(b,{padding:[12,12],maxZoom:9});}
function openSiteMap(){
 const site=project;
 if(site)territory?.clear();
 $('layer').value='site';colorize();map.closePopup();
 if(site)map.setView([site.lat,site.lon],Math.max(13,map.getZoom()),{animate:false});
 $('map').scrollIntoView({block:'center'});
}
function setMarkingPoint(enabled){
 markingPoint=enabled;markingTheme=enabled?$('layer').value:'';
 $('mark-point-tip').hidden=$('map-marking-bar').hidden=!enabled;
 $('site-start').setAttribute('aria-expanded',String(enabled));
 $('mark-point-coords').value='';$('mark-point-error').textContent='';
 $('map').classList.toggle('pick-mode',enabled||picking);
 if(enabled){
   const multiple=$('select-several-projects').checked;
   $('mark-point-instruction').textContent=multiple?'Toca los lugares que quieres incluir y pulsa Terminar.':'Toca el lugar en el mapa.';
   $('map-marking-instruction').textContent=multiple?'Toca para añadir puntos':'Toca un lugar';
   $('cancel-mark-point').textContent=$('map-marking-finish').textContent=multiple?'Terminar':'Cancelar';
 }
}
function placeStudyPin(point,study=true){
 const keepPicking=markingPoint && $('select-several-projects').checked;
 if(!keepPicking)setMarkingPoint(false);
 if(study)$('layer').value='site';
 const item=selection.point(point.lat,point.lon);
 selection.choose(item,keepPicking?'another-point':'point');
 if(keepPicking){
   $('mark-point-coords').value='';$('mark-point-error').textContent='';
   const count=selection.items.length;
   $('map-marking-instruction').textContent=(count===1?'1 punto':count+' puntos')+' · Toca para añadir otro';
 }
}
function showBuildingAddress(){
 if(!project)return;
 const censusParish=pinSector && parishIndex?.get(pinSector.slice(0,6));
 const parish=projectParish?.properties || censusParish;
 $('project-where').textContent=project.lat.toFixed(5)+', '+project.lon.toFixed(5)+(project.reference?' · Acceso aproximado':project.source==='osm'?' · Edificio cartografiado en OSM':'');
 $('project-province').textContent=dest?.province||'Sin cobertura';
 $('project-canton').textContent=dest?dest.name+' · '+dest.code:'Sin cobertura';
 $('project-parish').textContent=parish ? parish.name+' · '+parish.kind : 'Sin límite disponible';
 const status=pinLookup==='loading'?'Buscando…':pinLookup==='error'?'Consulta no disponible':'Sin polígono en este punto';
 $('project-zone').textContent=pinSector?.slice(0,9)||status;
 $('project-sector').textContent=pinSector||status;
 $('project-sector-open').hidden=!pinSector;
 $('project-location-retry').hidden=pinLookup!=='error';
}
function resolveBuildingAddress(){
 const building=project;
 pinSector=null;pinLookup=sectors?'loading':'error';showBuildingAddress();
 if(parishes?.needsUrban(projectParish))parishes.loadUrban().then(()=>{
   if(project!==building)return;
   projectState();refreshMarker();showBuildingAddress();
 });
 if(!sectors)return;
 sectors.codeAt(building.lat,building.lon).then(code=>{
   if(project!==building)return;
   pinSector=code;pinLookup='ready';projectState();showBuildingAddress();refreshMarker();earnings?.refresh();
   if(territory?.isPoint)sectors.showPinSector(code);
 }).catch(()=>{
   if(project!==building)return;
   pinLookup='error';showBuildingAddress();earnings?.refresh();
 });
}
function projectFocus(){
 if(!project)return;
 sectors?.focusPin();territory?.showPoint(project.name);
 if(dest)setSelection(dest.code,false,true);else render();
 sectors?.showPinSector(pinSector);
 map.setView([project.lat,project.lon],16,{animate:false});
 $('map').scrollIntoView({block:'center'});
}
function refreshMarker(){
 if(!project || !selection)return;
 const sub=project.reference?'Acceso aproximado a Torres del Salado':project.temporary?'Punto marcado en el mapa':project.source==='osm'?'Punto interior del edificio · OpenStreetMap':'Ubicación del proyecto';
 const coords=project.lat.toFixed(5)+', '+project.lon.toFixed(5);
 const osm='https://www.openstreetmap.org/?mlat='+project.lat+'&mlon='+project.lon+'#map=17/'+project.lat+'/'+project.lon;
 selection.popup('<b>'+esc(project.name)+'</b><br>'+esc(areaLabel(dest,projectParish))+'<br>'+sub+'<br>'+coords+'<br>'+link(osm,'Abrir en OpenStreetMap'));
 $('project-name').textContent=project.name;
}
function mapInit(){
 map=L.map('map',{zoomAnimation:false,zoomSnap:.15,zoomDelta:.75,minZoom:4,maxZoom:19,scrollWheelZoom:true,zoomControl:false,attributionControl:false});
 L.control.zoom({position:'topright',zoomInTitle:'Acercar',zoomOutTitle:'Alejar'}).addTo(map);
 L.control.attribution({prefix:false,position:'bottomright'}).addTo(map).addAttribution(osmCredit).addAttribution('<a href="#datos">Fuentes</a>');
 for(const [key,z] of [['land',250],['rivers',370],['canton-outlines',413],['province-outlines',418],['labels',375]]){map.createPane(key);map.getPane(key).style.zIndex=z;map.getPane(key).style.pointerEvents='none';}
 polys=L.geoJSON({type:'FeatureCollection',features},{className:'canton-shape',style,onEachFeature:(f,l)=>{
  const p=f.properties;layers[p.code]=l;l.bindTooltip(()=>'Cantón '+esc(p.name)+' · '+esc(p.province)+($('layer').value==='income'&&inc[p.province]?' · Mediana provincial $'+num(inc[p.province].median):''),{sticky:true,direction:'top',offset:[0,-7]});

 }}).addTo(map);
 const cantonBorders={pane:'canton-outlines',interactive:false};
 cantonCasing=L.geoJSON(features,{...cantonBorders,style:cantonHalo}).addTo(map);
 cantonLines=L.geoJSON(features,{...cantonBorders,style:cantonLine}).addTo(map);
 const staticLabels=[['Guayaquil',-2.205,-79.88],['Daule',-1.86,-79.98],['Milagro',-2.125,-79.59],['Santa Elena',-2.165,-80.81],['Balzar',-1.367,-79.91],['Playas',-2.63,-80.39],['El Triunfo',-2.34,-79.39]];
 labels=L.layerGroup(staticLabels.map(([s,lat,lon])=>L.marker([lat,lon],{interactive:false,keyboard:false,pane:'labels',icon:L.divIcon({className:'map-label',html:s,iconSize:[70,16],iconAnchor:[35,2]})}))).addTo(map);
 L.marker([-2.54,-81.12],{interactive:false,keyboard:false,pane:'labels',icon:L.divIcon({className:'sea-label',html:'Océano Pacífico',iconSize:[135,22],iconAnchor:[70,15]})}).addTo(map);
 map.on('zoomend',()=>{if(streets&&map.getZoom()>=11&&!map.hasLayer(streets))streets.addTo(map);if(streets&&map.getZoom()<11&&map.hasLayer(streets))map.removeLayer(streets);});
 map.on('click',e=>{
   if(picking){pick(e.latlng);return;}
   const ll=map.wrapLatLng(e.latlng),point={lat:ll.lat,lon:ll.lng};
   if(markingPoint || $('layer').value==='site'){placeStudyPin(point,!markingPoint);return;}
   map.closePopup();
   if(territory)territory.atPoint(territory.level,point,locate(point.lat,point.lon),false);
   else {
     const f=featureAt(features,point.lat,point.lon);
     if(f){selected=f.properties.code;highlighted=selected;if(inc[f.properties.province]&&buildings)render();else showCanton(f.properties);cantonLines.setStyle(cantonLine);cantonCasing.setStyle(cantonHalo);}
   }
   infrastructure?.inspect(ll);
 });
 initBasemap(map,$('map').closest('.map-canvas'));
 fitRegion();
 $('all-map').onclick=fitRegion;
 $('map-preview').hidden=true;
 if(window.ResizeObserver){
   const observer=new ResizeObserver(()=>map.invalidateSize({pan:false,debounceMoveend:true}));
   observer.observe($('map'));
 }
}
function addMapContext(context,streetGeo,provinces){
 L.geoJSON(context,{filter:f=>f.properties.kind==='land',pane:'land',interactive:false,style:{weight:1,color:'#b5a3a0',fillColor:'#f1e8dc',fillOpacity:1}}).addTo(map);
 L.geoJSON(context,{filter:f=>f.properties.kind==='river',pane:'rivers',interactive:false,style:f=>f.properties.kind==='river'?{weight:1.2,color:'#79b0c3',opacity:.84}:{weight:1.1,color:'#ba9660',opacity:.67}}).addTo(map);
 streets=L.geoJSON(streetGeo,{pane:'rivers',interactive:false,style:{weight:1.15,color:'#9f977f',opacity:.9}});
 const provinceStyle={pane:'province-outlines',interactive:false,smoothFactor:0.7};
 L.geoJSON(provinces,{...provinceStyle,style:{fill:false,color:'#fff',weight:4.2,opacity:.85}}).addTo(map);
 L.geoJSON(provinces,{...provinceStyle,style:{fill:false,color:'#39444e',weight:2,opacity:.86}}).addTo(map);
 if(map.getZoom()>=11)streets.addTo(map);
}
function showCanton(p){
 $('canton-name').textContent=p.name;
 $('detail-prov').textContent=p.province+' · DPA '+p.code;
 $('pop').textContent=num(p.population);
}
function evidenceHTML(f){
 const sources=observed.filter(s=>s.code===f.properties.code),ln=observedLoans(f),c=f.properties.code;
 let result=sources.map(s=>'<div class="evidence-item"><b>'+num(s.value)+' '+esc(s.units)+'</b> · '+esc(s.area)+'<small>'+esc(s.period)+' · '+link(s.url,s.sourceName)+'</small><small>'+esc(s.note)+'</small>'+(s.records?.length?'<details><summary>Ver fichas individuales</summary>'+s.records.map(r=>link(r.url,r.id)).join('')+'</details>':'')+'</div>').join('');
 if(!result)result='<div class="evidence-item"><p>Sin muestra pública de ventas verificada para este cantón en el atlas.</p></div>';
 result+='<div class="evidence-item"><b>Crédito por destino</b><p>'+(ln?num(ln.operations)+' operaciones · monto promedio '+money(ln.mean_usd)+'.':'Sin fila en el corte seleccionado.')+' Banca privada, enero–septiembre de 2026. '+link(financingURL,'Ver fuente')+'</p></div>';
 result+='<div class="evidence-item"><b>Solicitudes por origen</b><p>'+(hasDemand()?num(matches[c]??0)+' solicitudes compatibles en el archivo importado (últimos 90 días).':demandNote())+'</p></div>';
 if(userLoans.some(r=>r.canton_destino===c)){const ls=userLoans.filter(r=>r.canton_destino===c),ds=ls.map(r=>r.fecha).sort();result+='<div class="evidence-item"><b>Muestra de crédito importada</b><p>Mediana '+money(median(ls.map(r=>r.monto_usd)))+' · '+num(ls.length)+' operaciones · '+ds[0]+' a '+ds.at(-1)+'.</p></div>';}
 return result;
}
function referenceKm(f){return project?Math.round(distanceKm(project.lat,project.lon,f.properties.labelPoint)):null;}
function filtered(){const term=normalize($('search').value),sort=$('sort').value;return features.filter(f=>withinProvince(f)&&normalize(f.properties.name+' '+f.properties.code).includes(term)).sort((a,b)=>{
 function val(f){return sort==='distance'?-distanceKm(project.lat,project.lon,f.properties.labelPoint):sort==='match'?matches[f.properties.code]??0:sort==='credit'?observedLoans(f)?.operations??-1:f.properties.population;}
 return (sort==='name'?0:val(b)-val(a))||a.properties.name.localeCompare(b.properties.name,'es');
});}
function table(){
 $('sort').querySelector('[value="distance"]').disabled=!project;
 if((!project && $('sort').value==='distance') || (!hasDemand() && $('sort').value==='match'))$('sort').value='population';
 const fs=filtered();$('rows').innerHTML=fs.map(f=>{const p=f.properties;return '<tr class="'+(p.code===selected?'active':'')+'"><td><button data-code="'+p.code+'">'+esc(p.name)+'</button></td><td>'+esc(p.province)+'</td><td>'+num(p.population)+'</td><td>'+(project?num(referenceKm(f))+' km':'—')+'</td><td>'+(hasDemand()?num(matches[p.code]??0):'—')+'</td><td>'+numOrDash(observedLoans(f)?.operations)+'</td></tr>';}).join('')||'<tr><td colspan="6">Sin coincidencias. Prueba con otro nombre o código.</td></tr>';
 $('table-count').textContent=fs.length+' de '+features.length+' cantones';$('rank-note').textContent=hasDemand()?'Solicitudes compatibles de la muestra importada en los últimos 90 días. Un cero se refiere únicamente a esa muestra.':demandNote();
 $('sort').querySelector('[value="match"]').disabled=!hasDemand();
}
const numOrDash=n=>n==null?'—':num(n);
function render(){
 campaign?.refresh();
 parishes?.refresh();
 const f=byCode(selected),p=f.properties,s=scope(f),v=inc[s],ln=observedLoans(f),custom=userLoans.filter(r=>r.canton_destino===p.code);
 showCanton(p);
 $('loan').textContent=money(ln?.median_usd??(custom.length?median(custom.map(x=>x.monto_usd)):null));$('loan-note').textContent=ln?.median_usd!=null?'Banca privada · '+ln.operations+' operaciones':custom.length?'Muestra importada · '+num(custom.length)+' operaciones':ln?'Datos agrupados · ver promedio':'Sin mediana publicada';
 $('power').textContent=money(v?maxPrice(v.median,finance):null);$('scenario-note').textContent=!v?'No se pudo cargar el ingreso de referencia.':'Para el hogar mediano de '+s+', con '+finance.down+' % de entrada, '+finance.years+' años, interés anual del '+finance.rate+' % y cuota del '+finance.share+' % del ingreso. Excluye gastos y deudas. Referencia de escenario.';
 $('project-budget').textContent=!project?'':!project.price?'Agrega el precio del edificio para calcular la entrada y el ingreso de referencia.':project.name+' · precio desde '+money(project.price)+'. Con estos supuestos, la entrada sería '+money(project.price*finance.down/100)+' y el ingreso mensual de referencia sería '+money(project.price/maxPrice(1,finance))+'.';
 $('evidence').innerHTML=evidenceHTML(f);colorize();table();refreshMarker();
}
function sourceHTML(){const urls=[
 ['https://sgrportal.gestionderiesgos.gob.ec/server/rest/services/Hosted/OT_PROVINCIAL_17072026/FeatureServer/0','CONALI · Límites provinciales','Contornos oficiales de Guayas y Santa Elena del 17 de julio de 2026, simplificados para el mapa.'],
 ['https://sgrportal.gestionderiesgos.gob.ec/server/rest/services/Hosted/OT_PARROQUIAL_17072026/FeatureServer/0','CONALI · Organización Territorial del Estado','Límites territoriales de la Organización Territorial del Estado interparroquiales, aprobados por el Directorio del CONALI en sesión ordinaria del 24 de marzo de 2022, 17 de enero de 2023 y 13 de marzo de 2026. Capa del 17 de julio de 2026, simplificada para el mapa. Incluye parroquias rurales y cabeceras cantonales.'],
 ['https://www.arcgis.com/home/item.html?id=91c3a260949a48fa8ede07dfde9ed69c','Municipio de Guayaquil · Límites parroquiales urbanos','Servicio municipal consultado en línea para mostrar las subdivisiones urbanas de Guayaquil. El mapa y la selección de parroquias sirven para orientarse. Los focos y la ficha de indicadores corresponden al cantón.'],
 [incomeURL,'INEC · ENIGHUR 2024–2025','Mediana ponderada del ingreso corriente monetario mensual del hogar (ing_mon_cor, peso Fexp). Guayas, Santa Elena y dominio urbano de Guayaquil.'],
 [guideURL,'Diseño y alcance de la ENIGHUR','El ingreso mostrado para los demás cantones se refiere a su provincia. El escenario financiero aplica cuota fija con amortización mensual y entrada disponible.'],
 [financingURL,'Superintendencia de Bancos · Volumen de crédito','Corte enero–septiembre de 2026. Banca privada, operaciones originales de crédito inmobiliario, VIS y VIP. La mediana se informa solo cuando se puede reconstruir de los grupos. Los cantones sin fila se muestran sin dato.'],
 ['https://www.censoecuador.gob.ec/wp-content/uploads/2024/01/Info_Guayas.pdf','INEC · Guayas','Población cantonal censada en 2022.'],
 ['https://www.censoecuador.gob.ec/wp-content/uploads/2024/01/Info_Santa_Elena.pdf','INEC · Santa Elena','Población cantonal censada en 2022.'],
 ['https://www.geoboundaries.org/api/current/gbOpen/ECU/ADM2/','geoBoundaries · INEC / OCHA ROLAC','Límites cantonales de 2019 simplificados para la visualización. CC BY 3.0 IGO.'],
 ['https://www.naturalearthdata.com/','Natural Earth','Costa y contexto regional de dominio público.'],
 ['https://www.openstreetmap.org/copyright','© OpenStreetMap contributors · ODbL','Ríos vía WaterwayMap, red vial del entorno del proyecto y entrada a Torres del Salado. El edificio de referencia se ubica en el acceso a la urbanización.'],
 [publishedPrice,'Plusvalía · VELIN Tower','Modelo inicial de tres dormitorios desde USD 180.000. Confirmar ubicación y precios con el propietario.']];
 return '<ul>'+urls.map(([u,t,d])=>'<li>'+link(u,t)+' · '+esc(d)+'</li>').join('')+'</ul><p class="mini">Las muestras de ventas y sus enlaces constan en la ficha de cada cantón. Una venta identifica el lugar de la propiedad. La residencia del comprador requiere una fuente independiente. Los edificios, el escenario y las muestras CSV se guardan en este navegador.</p>';
}
function dialog(title,body){$('modal-title').textContent=title;$('modal-body').innerHTML=body;if(!$('modal').open)$('modal').showModal();}
function close(){if($('modal').open)$('modal').close();}
function err(e){$('form-msg').textContent=e;}
function field(id,title,value,attrs=''){return '<label for="'+id+'">'+title+'</label><input id="'+id+'" '+attrs+' value="'+esc(value)+'">';}
function renderBuildings() {
 const select=$('building-select');
 const placeholder=new Option('Elegir proyecto guardado','');placeholder.disabled=true;
 select.replaceChildren(placeholder,...buildings.map(b=>new Option(b.name,b.id)));
 select.value=project && !project.temporary ? project.id : '';
 $('active-project').hidden=$('focus-project').hidden=$('project-budget').hidden=!project;
 $('edit').disabled=$('share-building').disabled=!project;
 $('edit').textContent=project?.temporary?'Guardar como proyecto':'Editar proyecto';
 selectionChoices=[...buildings,...(selection?.items||[]).filter(item=>item.temporary)];
}
function chooseLocation(location,view){
 const changed=location!==project;
 project=location;
 if(markingPoint && view!=='another-point')setMarkingPoint(false);
 if(changed){
   pinSector=pinLookup=null;projectState();
 }
 renderBuildings();map.closePopup();
 sectors?.focusPin();
 $('site-error').textContent='';
 $('site-coords').value=project?project.lat+', '+project.lon:'';
 if(!project){
   highlighted=null;territory?.overview();parishes?.highlight(null);
   render();return;
 }
 territory?.showPoint(project.name);
 if(dest)setSelection(dest.code,false,true);else {highlighted=null;render();}
 if(changed)resolveBuildingAddress();else sectors?.showPinSector(pinSector);
 if(view==='active')map.setView([project.lat,project.lon],16,{animate:false});
 if(view==='point')map.setView([project.lat,project.lon],Math.max(13,map.getZoom()),{animate:false});
}
function activateBuilding(building,writeItem=false,replacesId) {
 if(!building)return false;
 if(writeItem){
   const current=load('buildings',null)||buildingState;
   const saved=Array.isArray(current?.items)?current.items:[];
   const next={items:[...saved.filter(item=>item.id!==building.id),building]};
   if(!save('buildings',next))return false;
   buildingState=next;
   buildings=buildingList(catalog,next);
   close();
 }
 selection.choose(buildings.find(item=>item.id===building.id)||building,undefined,replacesId);
 return true;
}
function shareBuilding() {
 shareMapLink(buildingURL(location.href,project),'Compartir ubicación','El enlace abre el mapa en las coordenadas de '+project.name+'.');
}
function shareMapLink(url,title,description){
 dialog(title,'<p>'+esc(description)+'</p>'+
   field('share-url','Enlace del mapa',url.href,'type="url" readonly')+
   '<div class="actions"><button class="button primary" id="copy-building">Copiar enlace</button></div><p id="copy-status" role="status"></p>');
 $('copy-building').onclick=async()=>{
   try {await navigator.clipboard.writeText(url.href);$('copy-status').textContent='Enlace copiado.';}
   catch {$('share-url').select();$('copy-status').textContent='Copia el enlace seleccionado.';}
 };
}
function settings(p = project, coordinates = Number.isFinite(p.lat) ? p.lat + ', ' + p.lon : '', returnToCampaign = false) {
 const adding = !p.id || p.temporary;
 dialog(adding ? 'Nuevo proyecto' : 'Editar proyecto', '<form id="project-form">' +
   field('f-name','Nombre del proyecto',p.name,'maxlength="80" autocomplete="off"') +
   '<div id="building-matches" aria-label="Edificios encontrados"></div>' +
   field('f-coordinates','Ubicación del proyecto',coordinates,'placeholder="-2.18376, -79.97990" aria-describedby="coord-help"') +
   '<p id="coord-help">Elige un punto en el mapa, pega sus coordenadas o busca un edificio por nombre en <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>.</p>' +
   '<button class="linkbutton" type="button" id="pick">Elegir en el mapa</button>' +
   '<p id="f-location" role="status"></p>' +
   '<details id="building-details"><summary>Datos de venta opcionales</summary>' +
   field('f-sector','Sector buscado en las solicitudes',p.sector,'maxlength="80"') +
   '<div class="twocol"><div>'+field('f-price','Precio desde (USD)',p.price,'type="number" min="1" max="1000000000" step="0.01"')+
   '</div><div>'+field('f-rooms','Dormitorios',p.rooms,'type="number" min="1" max="50" step="1"')+'</div></div></details>' +
   '<p>Se guarda en este navegador. Puedes compartir el pin mediante un enlace.</p>' +
   '<p class="err" id="form-msg" role="alert"></p><div class="actions"><button class="button primary" type="submit">Guardar proyecto</button></div></form>');
 const coordinateInput=$('f-coordinates'), locationText=$('f-location');
 function preview(){
   const point=parseCoordinates(coordinateInput.value);
   if(!point){locationText.textContent='';return;}
   const {canton,parish}=locate(point.lat,point.lon);
   locationText.textContent=areaLabel(canton,parish);
 }
 coordinateInput.oninput=preview;preview();
 const search=adding?buildingSearch(buildings,code=>byCode(code)?.properties.name||code):null;
 function draft() {
   return {...p,name:$('f-name').value.trim(),sector:$('f-sector').value.trim(),
     price:$('f-price').valueAsNumber || null,rooms:$('f-rooms').valueAsNumber || null};
 }
 $('pick').onclick=()=>{
   if(markingPoint)setMarkingPoint(false);
   pending={building:draft(),coordinates:$('f-coordinates').value,returnToCampaign};
   close();map.closePopup();picking=true;$('pin-tip').hidden=false;$('map').classList.add('pick-mode');$('explorar').scrollIntoView({block:'start'});
 };
 $('project-form').onsubmit=async e=>{
   e.preventDefault();
   const form=e.currentTarget,building=draft(),typed=coordinateInput.value;
   let point=parseCoordinates(typed),candidate=search?.chosen;
   if(adding && !typed.trim() && building.name){
     const known=await search.exact(building.name);
     if(!form.isConnected || !$('modal').open || coordinateInput.value!==typed || $('f-name').value.trim()!==building.name)return;
     if(known.length!==1){
       return err(known.length?'Hay varios edificios con ese nombre. Elige una coincidencia o indica las coordenadas.':search.failed?'No se pudo cargar el catálogo. Ingresa las coordenadas o elige el punto.':'Nombre sin ubicación en el catálogo. Agrega las coordenadas o elige el punto en el mapa.');
     }
     candidate=known[0];point={lat:candidate.lat,lon:candidate.lon};building.name=candidate.name;
   }
   if(!point)return err('Revisa las coordenadas. Ejemplo: -2.18376, -79.97990. La latitud va primero (−90 a 90) y la longitud después (−180 a 180).');
   if(!building.name)building.name='Edificio · '+point.lat+', '+point.lon;
   Object.assign(building,point,{reference:!!p.reference && point.lat===p.lat && point.lon===p.lon});
   if((candidate?.source==='osm' && point.lat===candidate.lat && point.lon===candidate.lon) ||
      (p.source==='osm' && point.lat===p.lat && point.lon===p.lon))building.source='osm';
   else delete building.source;
   const duplicate=buildings.find(b=>b.id!==p.id && sameBuilding(building,b));
   if(duplicate&&adding){
     if(building.sector||building.price||building.rooms){
       if(!activateBuilding({...duplicate,sector:building.sector||duplicate.sector,price:building.price||duplicate.price,rooms:building.rooms||duplicate.rooms},true,p.temporary?p.id:null))return;
     }else {close();activateBuilding(duplicate,false,p.temporary?p.id:null);}
     if(returnToCampaign)showAnalysis('campana',true);
     return;
   }
   if(duplicate)return err('Ya existe un proyecto con ese nombre y esas coordenadas. Selecciónalo en el mapa.');
   delete building.temporary;
   building.id=p.id || crypto.randomUUID();
   if(!activateBuilding(building,true))return;
   if(returnToCampaign)showAnalysis('campana',true);
   say(adding?'Proyecto guardado.':'Proyecto actualizado.');
 };
}
function stopPick(){picking=false;$('pin-tip').hidden=true;$('map').classList.remove('pick-mode');}
function cancelPick(){stopPick();settings(pending.building,pending.coordinates,pending.returnToCampaign);}
function pick(ll){
 if(!picking)return;
 const point=map.wrapLatLng(ll);
 stopPick();settings(pending.building,point.lat.toFixed(6)+', '+point.lng.toFixed(6),pending.returnToCampaign);
}
function scenario(){dialog('Supuestos de compra','<form id="f-fin"><p>Escenario ilustrativo de cuota mensual fija. La simulación supone que el hogar ya dispone de la entrada. El resultado varía con el ingreso de referencia mostrado.</p><div class="twocol"><div>'+field('down','Entrada (%)',finance.down,'type="number" min="0" max="95" step="0.1" required')+'</div><div>'+field('years','Plazo (años)',finance.years,'type="number" min="1" max="40" step="1" required')+'</div><div>'+field('rate','Tasa nominal anual (%)',finance.rate,'type="number" min="0" max="50" step="0.01" required')+'</div><div>'+field('share','Cuota / ingreso (%)',finance.share,'type="number" min="1" max="80" step="0.1" required')+'</div></div><div class="actions"><button class="button primary" type="submit">Aplicar al escenario</button></div></form>');
 $('f-fin').onsubmit=e=>{e.preventDefault();const v=Object.fromEntries(['down','years','rate','share'].map(k=>[k,Number($(k).value)]));if(!save('finance',v))return;finance=v;close();render();say('Escenario actualizado.');};
}
function download(name,lines){function safe(v){let s=String(v??'');if(/^[=+@\-]/.test(s)&&!/^[-+]?\d+(\.\d+)?$/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
 const data='\uFEFF'+lines.map(row=>row.map(safe).join(',')).join('\r\n')+'\r\n',u=URL.createObjectURL(new Blob([data],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),2000);}
function exportData(){const header=['dpa','canton','provincia','poblacion_2022','distancia_referencia_recta_km','proyecto','latitud_proyecto','longitud_proyecto','dominio_ingreso','mediana_ingreso_mensual_usd_2024_2025','precio_escenario_usd','entrada_pct','tasa_nominal_pct','plazo_anios','cuota_sobre_ingreso_pct','solicitudes_compatibles_90d_en_muestra','operaciones_bancos_privados_ene_sep_2026','credito_medio_publico_usd','credito_mediano_publico_usd','operaciones_importadas','mediana_importada_usd'];const list=filtered().map(f=>{const p=f.properties,s=scope(f),m=observedLoans(f),v=inc[s]?.median,custom=userLoans.filter(x=>x.canton_destino===p.code);return [p.code,p.name,p.province,p.population,referenceKm(f),project?.name,project?.lat,project?.lon,s,v,v==null?'':Math.round(maxPrice(v,finance)),finance.down,finance.rate,finance.years,finance.share,hasDemand()?matches[p.code]??0:null,m?.operations,m?.mean_usd,m?.median_usd,custom.length||null,median(custom.map(x=>x.monto_usd))];});download('atlas_litoral_cantones.csv',[header,...list]);}
function imports(type='demand'){
 const isDemand=type==='demand',current=isDemand?requests:userLoans,fields=isDemand?demandFields:loanFields;
 dialog('Importar una muestra','<label for="typ">Tipo de registros</label><select id="typ"><option value="demand">Solicitudes de compra</option><option value="loans">Operaciones de crédito</option></select><p>'+(isDemand?'Una fila por solicitud anónima, con su cantón de origen y el cantón y sector donde desea comprar. Se cuentan coincidencias de sector, dormitorios, presupuesto y fecha en los últimos 90 días.':'Una fila por préstamo original, con monto y cantón de destino. La ficha muestra la mediana y el período de tu muestra aparte del corte público.')+'</p><p>Usa códigos DPA de cuatro dígitos, fecha AAAA-MM-DD y montos sin separador de miles. El CSV del directorio incluye los códigos. Usa un identificador anónimo interno.</p><button id="template" class="linkbutton">Descargar plantilla CSV</button><label for="file">Archivo CSV</label><input type="file" id="file" accept=".csv,text/csv"><p>El archivo reemplaza la muestra de este tipo y se guarda en este navegador. Registros actuales: '+num(current.length)+'.</p><p id="form-msg" class="err" role="status"></p><div class="actions"><button id="read-sample" class="button primary">Cargar muestra</button>'+(current.length?'<button id="clear-sample" class="button subtle">Quitar muestra</button>':'')+'</div>');
 $('typ').value=type;$('typ').onchange=e=>imports(e.target.value);$('template').onclick=()=>download(isDemand?'plantilla_solicitudes.csv':'plantilla_prestamos.csv',[fields]);
 $('read-sample').onclick=async()=>{const file=$('file').files[0];if(!file)return err('Selecciona un archivo CSV.');if(file.size>1500000)return err('Utiliza un CSV de hasta 1,5 MB.');try{const regs=parseSample(await file.text(),type,features);if(!save(type,regs))return err('No se pudo guardar la muestra. Reduce el archivo.');if(isDemand)requests=regs;else userLoans=regs;projectState();close();if(isDemand){$('layer').value='demand';$('sort').value='match';}render();say(num(regs.length)+' registros cargados.');}catch(e){err(e.message);}};
 if(current.length)$('clear-sample').onclick=()=>{if(!confirm('¿Quitar la muestra de este navegador?'))return;if(!save(type,[]))return;if(isDemand){requests=[];$('sort').value='population';}else userLoans=[];projectState();close();render();say('Muestra retirada.');};
}
function mapNotice(message){
 $('map-load-message').textContent=message;
 $('map-load-notice').hidden=false;
}
async function readLayer(name){
 const url='./data/'+name+'.json';
 const response=await fetch(url);
 if(!response.ok)throw Error('No se pudo cargar '+name);
 return response.json();
}
async function main(){
 if(!$('map-preview')){
   const url=new URL(location.href);
   if(!url.searchParams.has('actualizarMapa')){url.searchParams.set('actualizarMapa','1');location.replace(url);}
   return;
 }
 const geo=await readLayer('cantons');
 features=geo.features;
 mapInit();
 const names=['context','streets','provinces','buildings','incomes','evidence','mortgages','parishes','census-ages','sectors/index'];
 const [results,modules]=await Promise.all([
   Promise.allSettled(names.map(readLayer)),
   Promise.allSettled([
     import('./territory.js'),import('./parishes.js'),import('./demographics.js'),
     import('./sector-profiles.js'),import('./credit-map.js'),import('./campaign.js')
   ])
 ]);
 const [navigation,parishTools,ageTools,sectorTools,creditTools,campaignTools]=modules.map(r=>r.value);
 const unavailable=names.filter((_,i)=>results[i].status==='rejected');
 const emptyGeo={type:'FeatureCollection',features:[]};
 const [context=emptyGeo,streetGeo=emptyGeo,provinces=emptyGeo,publishedBuildings=[],incomes={},sales=[],mortgages={rows:[]},parishCatalog,censusAges,sectorIndex]=results.map(r=>r.value);
 inc=incomes;observed=sales;bank=mortgages;
 if(unavailable.length){
   const labels=['mapa base','calles','provincias','edificios','ingresos','ventas','créditos','parroquias','edades','sectores'];
   mapNotice('Datos pendientes de carga: '+unavailable.map(k=>labels[names.indexOf(k)]).join(', ')+'.');
 }
 addMapContext(context,streetGeo,provinces);
 catalog=publishedBuildings.filter(validBuilding);
 const example=catalog.find(building=>building.reference);
 if(example){
   $('try-project').textContent='Probar con '+example.name;
   $('try-project').onclick=()=>{
     activateBuilding(example);
     $('plan-selected-project').focus({preventScroll:true});
     $('project-selection').scrollIntoView({block:'start'});
   };
 }
 buildingState=load('buildings',null);
 if(!buildingState){
   const legacy=load('project',null);
   const known=validBuilding(legacy) && catalog.find(b=>sameBuilding(b,legacy));
   buildingState={items:[]};
   if(validBuilding(legacy)){
     buildingState.items.push({...legacy,id:known?.id || crypto.randomUUID()});
     save('buildings',buildingState);
   }
 }
 buildings=buildingList(catalog,buildingState);
 selection=initProjectSelection({map,onChange:chooseLocation,
   onMarkerPick:ll=>{
     if(picking){pick(ll);return true;}
     if(markingPoint){placeStudyPin({lat:ll.lat,lon:ll.lng},false);return true;}
     return false;
   },
   onPlan:()=>{setMarkingPoint(false);campaign?.useProject();showAnalysis('campana',true);}
 });
 const shared=buildingFromURL(location.href);
 const sharedRequest=new URL(location.href).searchParams.has('edificio');
 $('canton').innerHTML=features.slice().sort((a,b)=>a.properties.name.localeCompare(b.properties.name,'es')).map(f=>'<option value="'+f.properties.code+'">'+esc(f.properties.name)+'</option>').join('');$('canton').value=selected;
 renderBuildings();
 if(provinces.features.length&&provinces.features.every(f=>incomes[f.properties.name])){
   provinceIncome=initProvinceIncome(map,provinces,incomes);
 }else{
   $('layer').querySelector('[value="income"]').disabled=true;$('province-income-map').disabled=true;
 }
 parishIndex=new Map((parishCatalog?.features||[]).map(({properties:p})=>[p.code,p]));
 if(parishCatalog&&parishTools){
   parishes=parishTools.initParishes(map,parishCatalog.features,()=>byCode(selected).properties,setSelection,()=>{demographics?.refresh();sectors?.refresh();campaign?.refresh();});
 }else $('parish-note').textContent='No se pudieron cargar los límites parroquiales.';
 if(censusAges&&parishes&&ageTools){
   demographics=ageTools.initDemographics({map,data:censusAges,cantons:features,parishCatalog,index:sectorIndex,
     state:()=>({theme:$('layer').value,province:$('province').value,code:selected,territory,sectors}),colorize});
   $('age-option').disabled=false;$('age-body').hidden=false;$('age-status').hidden=true;
 }else $('age-status').textContent='No se pudo cargar la demografía censal. Recarga para reintentar.';
 if(sectorIndex&&parishes&&sectorTools){
   sectors=sectorTools.initSectorProfiles({map,index:sectorIndex,parishCatalog,cantons:features,
     state:()=>({theme:$('layer').value,province:$('province').value,canton:selected,parish:$('parish-select').value,finance,project,buildings}),
     focusBuilding:id=>{const b=selectionChoices.find(item=>item.id===id);if(b)activateBuilding(b);},
     selectArea:code=>{
       const area=territory?.current;
       const contained=area && code.startsWith(area.code);
       if(!contained)territory?.clear();
       setSelection(code.slice(0,4));
       if(!contained||!area.municipal)parishes.highlight(parishCatalog.features.find(f=>f.properties.code===code.slice(0,6)));
     },
     useForCampaign:code=>campaign?.useSector(code),editFinance:scenario,changeTheme:theme=>{$('layer').value=theme;colorize();},isPicking:()=>picking});
 }else $('sector-status').textContent='No se pudieron cargar los sectores. Recarga para reintentar.';
 function alignSector(area){
   if(isSectorTheme($('layer').value) && ['zone','sector'].includes(area?.level) && sectors.selectedCode()!==area.code)
     sectors.openCode(area.code,false);
 }
 if(!navigation){render();mapNotice('Puedes consultar cantones. Reintenta para cargar los demás niveles.');return;}
 territory=navigation.initTerritory({map,cantons:new Map(features.map(f=>[f.properties.code,f])),parishes,parishCatalog,sectors,index:sectorIndex,ages:censusAges?.agesByDpa,
   cantonCode:()=>selected,setCanton:code=>setSelection(code,false,true),fitRegion,alignSector,updateLegend:colorize,
   share:(url,name)=>{demographics?.addFilters(url);shareMapLink(url,'Compartir área','El enlace abre la vista de '+name+'.');}});
 earnings=initEarnings(()=>{
   if(territory.isPoint){
     if(!dest)return null;
     return {province:dest.code.slice(0,2),level:'sector',code:pinSector,label:pinSector?'Sector '+pinSector:'',pending:pinLookup==='loading'};
   }
   const area=territory.current;
   if(!area && !$('profile-empty').hidden)return null;
   const code=area?.code||selected;
   return {province:(area?.canton||selected).slice(0,2),level:area?.level||'canton',code,label:area?.name||byCode(selected).properties.name};
 },(code,lo,hi)=>demographics?.residentCount(code,lo,hi));
 $('project-location-retry').onclick=resolveBuildingAddress;
 $('project-sector-open').onclick=()=>{
   if(!pinSector)return;
   if($('layer').value==='site')$('layer').value='population';
   territory.open('sector',pinSector,false);
 };
 $('parish-select').onchange=()=>territory.parentParish($('parish-select').value);
 if(campaignTools)campaign=campaignTools.initCampaign({cantons:features,parishes:parishCatalog?.features,
   state:()=>({project,buildings:selectionChoices,selectionStarted:selection.started,sample:requests,localities:parishes?.urbanFeatures(),matches:hasDemand()?matches:null}),
   localityFor:row=>{
     const parishCode=row.code.slice(0,6);
     const urban=parishCode==='090150' && featureAt(parishes?.urbanFeatures() || [],row.lat,row.lon);
     return urban?'Parroquia urbana '+urban.properties.name:parishIndex.get(parishCode)?.name || '';
   },
   matchesForProject:campaignMatches,
   showOrigins:building=>{
     if(project!==building)activateBuilding(building);
     if($('province').value){$('province').value='';$('province').onchange();}
     $('search').value='';$('sort').value='match';table();showAnalysis('comparar',true);
   },
   updatePlanMap:initCampaignMap({cantons:features,context,streets:streetGeo,readZone:sectors?.readZone}),
   selectBuilding:id=>{const b=selectionChoices.find(item=>item.id===id);if(b){activateBuilding(b);showAnalysis('campana',true);}},
   pickOnMap:()=>{if(sectors){territory.browse('sector');sectors.frame();$('map').scrollIntoView({block:'center'});}else say('Los límites sectoriales no están disponibles.');},
   previewRadius:(code,lat,lon,km)=>{if(sectors){sectors.previewRadius(code,lat,lon,km);$('map').scrollIntoView({block:'center'});}else say('Los límites sectoriales no están disponibles.');},
   download});
 else $('campaign-status').textContent='No se pudo cargar la herramienta de campaña.';
 if(creditTools)creditMap=creditTools.initCreditMap({map,features,parishes,parishCatalog,bankRow:observedLoans,state:()=>({theme:$('layer').value,province:$('province').value,project,projectCanton:dest?.code,down:finance.down}),redraw:colorize,fitRegion,selectCanton:setSelection,download});
 if(!creditMap)$('layer').querySelector('[value="credit"]').disabled=true;
 const initialTheme=new URL(location.href).searchParams.get('capa');
 const linkedTheme=[...allThemes.options].find(option=>option.value===initialTheme);
 if(linkedTheme&&!linkedTheme.disabled)allThemes.value=initialTheme;
 $('source-items').innerHTML=sourceHTML()+'<p class="mini">Distancia de referencia: línea recta del pin a un punto interior de cada cantón; se usa para exploración geográfica. La distancia de viaje depende de la red vial.</p>';render();
 if(shared){
   const known=buildings.find(b=>sameBuilding(b,shared));
   activateBuilding(known||{...shared,id:crypto.randomUUID()},!known);
 }else if(sharedRequest)say('El enlace contiene coordenadas o un nombre no válidos.');
 if(sharedRequest){
   const url=new URL(location.href);
   for(const key of ['edificio','lat','lon','nivel'])url.searchParams.delete(key);
   history.replaceState(null,'',url);
 }
 $('add-building').disabled=$('building-select').disabled=false;
 $('add-building').onclick=()=>settings({name:''});
 $('campaign-add-building').disabled=false;
 $('campaign-add-building').onclick=()=>settings({name:''},'',true);
 $('building-select').onchange=e=>activateBuilding(buildings.find(b=>b.id===e.target.value));
 $('share-building').onclick=shareBuilding;
 if(!shared&&!new URL(location.href).searchParams.has('area')){
   territory.overview();earnings.refresh();
 }
 function chooseLayer(){
   map.closePopup();
   const theme=$('layer').value;
   colorize();
   if(territory.current)alignSector(territory.current);
   if(theme==='income'||theme==='hot-school'||theme==='hot-hospital')fitRegion();
 }
 $('province-income-map').onclick=()=>{territory.clear();$('layer').value='income';chooseLayer();$('explorar').scrollIntoView({block:'start'});};
 $('geo-pin').onclick=projectFocus;
 $('suit-start').onclick=openSiteMap;
 $('site-start').disabled=false;
 $('site-start').onclick=()=>setMarkingPoint(!markingPoint);
 $('cancel-mark-point').onclick=$('map-marking-finish').onclick=()=>{setMarkingPoint(false);$('site-start').focus({preventScroll:true});};
 for(const id of ['select-one-project','select-several-projects']){
   $(id).addEventListener('change',()=>{if(markingPoint)setMarkingPoint(false);});
 }
 $('mark-point-form').onsubmit=e=>{
   e.preventDefault();
   const point=parseCoordinates($('mark-point-coords').value);
   if(!point){$('mark-point-error').textContent='Revisa la latitud y la longitud.';return;}
   placeStudyPin(point,false);$(markingPoint?'mark-point-coords':'site-start').focus({preventScroll:true});
 };
 $('site-form').onsubmit=e=>{
   e.preventDefault();
   const point=parseCoordinates($('site-coords').value);
   if(!point){$('site-error').textContent='Revisa la latitud y la longitud en grados decimales.';return;}
   placeStudyPin(point);
 };
 allThemes.onchange=chooseLayer;
 mapView.disabled=false;
 mapView.onchange=async()=>{
   const theme=mapView.value;
   allThemes.value=theme;
   if(theme==='overview' && territory.level!=='canton'){
     territory.overview();
     parishes?.highlight(null);
     if(project)territory.showPoint(project.name);
   }
   chooseLayer();
   if(!isSectorTheme(theme)||!sectors)return;
   const point=project;
   const area=territory.current;
   if(!point&&area?.level!=='sector'){
     territory.browse('sector');
     sectors.frame(theme);
     return;
   }
   try{
     const code=area?.level==='sector'?area.code:await sectors.codeAt(point.lat,point.lon);
     if(allThemes.value!==theme||point!==project||area!==territory.current)return;
     if(code)await territory.open('sector',code,true);
     else {
       territory.browse('sector');
       $('geo-status').textContent='No hay datos censales para este punto. Toca otro sector del mapa.';
     }
   }catch{
     $('geo-status').textContent='No se pudo consultar el sector. Vuelve a elegir la ubicación.';
   }
 };
 document.querySelectorAll('[data-map-theme]').forEach(button=>{
   button.onclick=()=>{
     allThemes.value=button.dataset.mapTheme;
     territory.browse('canton');
     chooseLayer();
     fitRegion();
     $('explorar').scrollIntoView({block:'start'});
     mapView.focus({preventScroll:true});
   };
 });
 $('province').onchange=()=>{
   const kind=territory.level;
   if(!withinProvince(byCode(selected)))selected=features.filter(withinProvince).sort((a,b)=>b.properties.population-a.properties.population)[0].properties.code;
   for(const option of $('canton').options)option.hidden=!withinProvince(byCode(option.value));
   highlighted=null;$('canton').value=selected;parishes?.refresh();parishes?.highlight(null);
   territory.browse(kind);fitRegion();render();
 };
 $('canton').onchange=e=>territory.chooseCanton(e.target.value);
 $('all-map').onclick=()=>territory.reset(true);$('focus-project').onclick=projectFocus;$('p-link').onclick=projectFocus;
 $('rows').onclick=e=>{const b=e.target.closest('button[data-code]');if(b){territory.open('canton',b.dataset.code);$('explorar').scrollIntoView({block:'start'});}};
 $('search').oninput=table;$('sort').onchange=table;$('edit').onclick=()=>settings();$('close').onclick=close;$('cancel-pick').onclick=cancelPick;$('finance-open').onclick=scenario;$('import-open').onclick=$('campaign-import').onclick=()=>imports();$('csv-out').onclick=exportData;
 const cantonLink=new URL(location.href).searchParams.get('canton');
 if(!shared && cantonLink && byCode(cantonLink))territory.open('canton',cantonLink);
 if(!shared && isSectorTheme(initialTheme)){
   const id=new URL(location.href).searchParams.get('sector');
   if(/^\d{12}$/.test(id))territory.open('sector',id);
   else if(initialTheme==='sector-income')sectors?.frame(initialTheme);
 }
 const areaLink=new URL(location.href).searchParams.get('area');
 if(!shared && areaLink){
   const kind=areaLink.startsWith('gye-')?'parish':({4:'canton',6:'parish',9:'zone',12:'sector'})[areaLink.length];
   if(kind)territory.open(kind,areaLink,true,new URL(location.href).searchParams.get('parroquia')||'');
   else $('geo-status').textContent='El código del área no es válido.';
 }
 if(!shared && initialTheme==='ages')demographics?.startLink();
 infrastructure=await import('./infrastructure.js').then(({initInfrastructure})=>initInfrastructure({
   map, land:context.features.filter(f=>f.properties.kind==='land'), state:()=>({theme:$('layer').value,province:$('province').value,code:selected,features,project,projectInCoverage:!!dest,site:project,siteCanton:dest}),
   changeTheme:theme=>{$('layer').value=theme;colorize();},isPicking:()=>picking,fitRegion,selectCanton:code=>setSelection(code),download
 })).catch(error=>{console.warn('Capas de infraestructura:',error);$('hot-region').textContent=$('infra-status').textContent='No se pudo iniciar el análisis. Recarga para reintentar.';return null;});
 campaign?.setHospitals(infrastructure?.hospitals);
 if(infrastructure){
   sectors?.setFacilities(infrastructure.schools,infrastructure.hospitals);
   if(linkedTheme && !linkedTheme.disabled && allThemes.value==='overview')allThemes.value=linkedTheme.value;
   colorize();
 }
 document.addEventListener('keydown',e=>{if(e.key!=='Escape')return;if(picking){e.preventDefault();cancelPick();}else if(markingPoint){setMarkingPoint(false);$('site-start').focus();}});
}
main().catch(error=>{
 console.error(error);
 mapNotice($('map-preview').hidden?'No se pudieron cargar todas las herramientas.':'No se pudo abrir el mapa interactivo. Se muestra la vista regional.');
});
