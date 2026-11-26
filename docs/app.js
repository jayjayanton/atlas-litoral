import {initSectorProfiles} from './sector-profiles.js';
import {initDemographics} from './demographics.js';
import {initCreditMap} from './credit-map.js';
import {initParishes} from './parishes.js';
import {parseCoordinates, validBuilding, sameBuilding, buildingList, buildingURL, buildingFromURL} from './buildings.js';
import {initInfrastructure} from './infrastructure.js';
import {initialFinance,distanceKm,featureAt,maxPrice,median,normalize,parseSample,demandFields,loanFields,recentMatches} from './model.js';
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const link=(url,label)=>'<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">'+esc(label)+'</a>';
const num=n=>new Intl.NumberFormat('es-EC').format(n);
const money=n=>n==null?'—':'$'+num(Math.round(n));
const store='atlasLitoral.v1.';
function load(key,init){try{return JSON.parse(localStorage.getItem(store+key))??init;}catch{return init;}}
function save(key,value){try{localStorage.setItem(store+key,JSON.stringify(value));return true;}catch{say('No se pudo guardar en este navegador.');return false;}}
let project=null,catalog,buildings,buildingState,otherMarkers;
let finance=load('finance',initialFinance),requests=load('demand',[]),userLoans=load('loans',[]);
let sectors,demographics,creditMap,infrastructure,parishes,projectParish,viewRevision=0;
let features,inc,observed,bank,polys,selected='0901',map,marker,labels,streets,selectedPopup,picking=false,pending=null,matches={},dest=null;
const layers={},colors=['#d6e8dc','#9fcab7','#5fa592','#2b7c73','#155b56'],empty='#e3e7e3';
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
function areaLabel(canton,parish,level){
 if(!canton)return 'Fuera de Guayas y Santa Elena · Se mostrará el pin.';
 const region=canton.province+' · Cantón '+canton.name;
 if(level!=='parish')return region;
 return region+' · '+(parish ? parish.properties.kind+' '+parish.properties.name : 'Sin límite parroquial disponible. Se mostrará el cantón.');
}
function projectState(){
 const current=project ? locate(project.lat,project.lon) : {};
 dest=current.canton;projectParish=current.parish;
 matches=hasDemand()?recentMatches(requests,project,dest.code):{};
}
function hasDemandInputs(){return !!(dest && project.sector && project.price>0 && project.rooms>0);}
function hasDemand(){return requests.length>0 && hasDemandInputs();}
function demandNote(){
 if(!project)return 'Selecciona un edificio para comparar solicitudes de compra.';
 if(!hasDemandInputs())return 'Para comparar solicitudes, el edificio debe estar en Guayas o Santa Elena y tener sector, precio y dormitorios.';
 return 'Importa una muestra reciente con cantón de origen y destino para comparar solicitudes.';
}
function observedLoans(f){return bank.rows.find(r=>normalize(r.province)===normalize(f.properties.province)&&(normalize(r.canton)===normalize(f.properties.name)||(r.canton.includes('BUCAY')&&f.properties.code==='0927')));}
function metricValue(f){const c=f.properties.code;switch($('layer').value){case'population':return f.properties.population;case'loans':return observedLoans(f)?.operations??null;default:return hasDemand()?matches[c]??0:null;}}
function breaks(){return $('layer').value==='population'?[0,50000,100000,200000,500000]:$('layer').value==='loans'?[1,5,25,100,500]:[0,1,5,10,25];}
function fill(f){if(['ages','sectors'].includes($('layer').value))return '#e5e9e8';if(creditMap && $('layer').value==='credit')return creditMap.fill(f.properties.code);if(infrastructure?.supports($('layer').value))return infrastructure.fill($('layer').value,f.properties.code);const v=metricValue(f);if(v==null)return empty;const ix=breaks().filter(x=>v>=x).length-1;return colors[Math.max(0,ix)];}
function style(f){const active=f.properties.code===selected;return {color:active?'#134b45':'#509182',weight:active?2.7:1.2,fillColor:fill(f),fillOpacity:withinProvince(f)?(['access','suitability'].includes($('layer').value)?.24:.65):.16,opacity:withinProvince(f)?1:.35};}
function setSelection(code,move=false){if(!byCode(code))return;viewRevision++;selected=code;if($('province').value&&!withinProvince(byCode(code)))$('province').value='';$('canton').value=code;render();if(move)map.fitBounds(layers[code].getBounds(),{padding:[22,22],maxZoom:11});}
function colorize(){polys.setStyle(style);if(layers[selected])layers[selected].bringToFront();
 $('map-heading').textContent=$('layer').value==='sectors'?'Mapa de sectores censales':'Mapa territorial';
 creditMap?.refresh();demographics?.refresh();sectors?.refresh();
 if(infrastructure){infrastructure.refresh();if(infrastructure.legend($('layer').value))return;}
 if(sectors && $('layer').value==='sectors'){sectors.legend();return;}
 if(demographics && $('layer').value==='ages'){demographics.legend();return;}
 if(creditMap && $('layer').value==='credit'){creditMap.legend();return;}
 const choices=$('layer').value==='population'?['<50 mil','50 mil+','100 mil+','200 mil+','500 mil+']:$('layer').value==='loans'?['1–4','5–24','25–99','100–499','500+']:['0','1–4','5–9','10–24','25+'];
 $('legend-title').textContent=$('layer').value==='population'?'Habitantes · 2022':$('layer').value==='loans'?'Créditos por destino · ene–sep 2026':'Solicitudes de origen · 90 días';
 $('legend').innerHTML=choices.map((c,i)=>'<span class="key"><i class="sw" style="background:'+colors[i]+'"></i>'+c+'</span>').join('')+($('layer').value==='population'?'':'<span class="key"><i class="sw" style="background:'+empty+'"></i>S/d</span>');
}
function fitRegion(){viewRevision++;const fs=features.filter(withinProvince);const b=L.latLngBounds([]);fs.forEach(f=>b.extend(layers[f.properties.code].getBounds()));map.fitBounds(b,{padding:[12,12],maxZoom:9});}
function frameBuilding(){
 const pin=[project.lat,project.lon];
 if(!dest || !project.focusArea){
   parishes?.highlight(null);
   map.setView(pin,12,{animate:false});
   return;
 }
 const parish=project.focusArea==='parish'?projectParish:null;
 parishes?.highlight(parish);
 const area=parish?L.geoJSON(parish).getBounds():layers[dest.code].getBounds();
 const bounds=L.latLngBounds([area.getSouthWest(),area.getNorthEast(),pin]);
 const legendHeight=$('legend').parentElement.offsetHeight;
 const bottomPadding=Math.min(legendHeight+20,map.getSize().y*.35);
 map.fitBounds(bounds,{paddingTopLeft:[20,24],paddingBottomRight:[20,bottomPadding],maxZoom:parish?16:13,animate:false});
}
function projectFocus(){
 if(!project)return;
 const building=project;
 if(dest)setSelection(dest.code);
 viewRevision++;
 $('map').scrollIntoView({block:'center'});
 frameBuilding();
 marker.openPopup();
 if(project.focusArea==='parish' && parishes?.needsUrban(projectParish)){
   const revision=viewRevision;
   parishes.loadUrban().then(()=>{
     if(project!==building)return;
     projectState();refreshMarker();
     if(revision===viewRevision && selected===dest?.code &&
        $('parish-outlines').checked && projectParish?.properties.kind==='Parroquia urbana')frameBuilding();
   });
 }
}
function refreshMarker(){
 if(!project)return;
 if(!marker){
   marker=L.marker([project.lat,project.lon],{zIndexOffset:1000,title:'Proyecto activo',icon:L.divIcon({className:'',html:'<span class="pm">●</span>',iconSize:[22,22],iconAnchor:[11,11]})}).addTo(map);
   marker.on('click',()=>{if(picking)pick(marker.getLatLng());});
 }
 marker.setLatLng([project.lat,project.lon]);const sub=project.reference?'Acceso aproximado a Torres del Salado':'Punto elegido por el usuario';
 const coords=project.lat.toFixed(5)+', '+project.lon.toFixed(5);
 const osm='https://www.openstreetmap.org/?mlat='+project.lat+'&mlon='+project.lon+'#map=17/'+project.lat+'/'+project.lon;
 const area=areaLabel(dest,projectParish,project.focusArea);
 const popup='<b>'+esc(project.name)+'</b><br>'+esc(area)+'<br>'+sub+'<br>'+coords+'<br>'+link(osm,'Abrir en OpenStreetMap');
 if(marker.getPopup())marker.setPopupContent(popup);
 else marker.bindPopup(popup,{autoPan:false});
 marker.getElement().title=project.name;marker.getElement().setAttribute('aria-label',project.name);$('project-name').textContent=project.name;$('project-where').textContent=area+(project.reference?' · Acceso aproximado':'');
}
function mapInit(context,streetGeo,provinces){
 map=L.map('map',{zoomAnimation:false,zoomSnap:.15,zoomDelta:.75,minZoom:4,maxZoom:19,scrollWheelZoom:false,zoomControl:false,attributionControl:false});
 L.control.zoom({position:'topright',zoomInTitle:'Acercar',zoomOutTitle:'Alejar'}).addTo(map);
 L.control.attribution({prefix:false,position:'bottomright'}).addTo(map).addAttribution('© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · <a href="#datos">Fuentes</a>');
 for(const [key,z] of [['land',250],['rivers',370],['province-outlines',418],['labels',420]]){map.createPane(key);map.getPane(key).style.zIndex=z;map.getPane(key).style.pointerEvents='none';}
 L.geoJSON(context,{filter:f=>f.properties.kind==='land',pane:'land',interactive:false,style:{weight:1,color:'#9cb9b7',fillColor:'#eaf0e8',fillOpacity:1}}).addTo(map);
 L.geoJSON(context,{filter:f=>f.properties.kind==='river',pane:'rivers',interactive:false,style:f=>f.properties.kind==='river'?{weight:1.2,color:'#79b0c3',opacity:.84}:{weight:1.1,color:'#ba9660',opacity:.67}}).addTo(map);
 streets=L.geoJSON(streetGeo,{pane:'rivers',interactive:false,style:{weight:1.15,color:'#9f977f',opacity:.9}});
 polys=L.geoJSON({type:'FeatureCollection',features},{style,onEachFeature:(f,l)=>{
  const p=f.properties;layers[p.code]=l;l.bindTooltip(esc(p.name)+' · '+esc(p.province),{sticky:true,direction:'top',offset:[0,-7]});
  l.on('click',e=>{if(picking){L.DomEvent.stopPropagation(e);pick(e.latlng);return;}if($('layer').value!=='sectors')setSelection(p.code);});
 }}).addTo(map);
 const provinceStyle={pane:'province-outlines',interactive:false,smoothFactor:0.7};
 L.geoJSON(provinces,{...provinceStyle,style:{fill:false,color:'#f7faf6',weight:4.8,opacity:.88}}).addTo(map);
 L.geoJSON(provinces,{...provinceStyle,style:{fill:false,color:'#243947',weight:2.9,opacity:1}}).addTo(map);
 map.on('movestart zoomstart',()=>{viewRevision++;});
 const staticLabels=[['Guayaquil',-2.205,-79.88],['Daule',-1.86,-79.98],['Milagro',-2.125,-79.59],['Santa Elena',-2.165,-80.81],['Balzar',-1.367,-79.91],['Playas',-2.63,-80.39],['El Triunfo',-2.34,-79.39]];
 labels=L.layerGroup(staticLabels.map(([s,lat,lon])=>L.marker([lat,lon],{interactive:false,keyboard:false,pane:'labels',icon:L.divIcon({className:'map-label',html:s,iconSize:[70,16],iconAnchor:[35,2]})}))).addTo(map);
 L.marker([-2.54,-81.12],{interactive:false,keyboard:false,pane:'labels',icon:L.divIcon({className:'sea-label',html:'Océano Pacífico',iconSize:[135,22],iconAnchor:[70,15]})}).addTo(map);
 otherMarkers=L.layerGroup().addTo(map);
 map.on('zoomend',()=>{if(map.getZoom()>=11&&!map.hasLayer(streets))streets.addTo(map);if(map.getZoom()<11&&map.hasLayer(streets))map.removeLayer(streets);});
 map.on('click',e=>{if(picking){pick(e.latlng);return;}if($('layer').value==='sectors'){sectors?.locate(e.latlng.lat,e.latlng.lng);return;}infrastructure?.inspect(e.latlng);});fitRegion();renderBuildings();
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
 parishes?.refresh();
 const f=byCode(selected),p=f.properties,s=scope(f),v=inc[s],ln=observedLoans(f),custom=userLoans.filter(r=>r.canton_destino===p.code);
 $('detail-prov').textContent=p.province+' · DPA '+p.code;$('pop').textContent=num(p.population);$('income').textContent=money(v.median);$('income-scale').textContent=(p.code==='0901'?'Dominio urbano':'Referencia provincial')+' · '+s;
 $('loan').textContent=money(ln?.median_usd??(custom.length?median(custom.map(x=>x.monto_usd)):null));$('loan-note').textContent=ln?.median_usd!=null?'Banca privada · '+ln.operations+' operaciones':custom.length?'Muestra importada · '+num(custom.length)+' operaciones':ln?'Datos agrupados · ver promedio':'Sin mediana publicada';
 $('power').textContent=money(maxPrice(v.median,finance));$('scenario-note').textContent='Para el hogar mediano de '+s+', con '+finance.down+' % de entrada, '+finance.years+' años, interés anual del '+finance.rate+' % y cuota del '+finance.share+' % del ingreso. Excluye gastos y deudas. Referencia de escenario.';
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
 otherMarkers.clearLayers();
 const select=$('building-select');
 const placeholder=new Option('Seleccionar edificio','');
 placeholder.disabled=true;
 select.replaceChildren(placeholder);
 $('active-project').hidden=$('focus-project').hidden=$('project-budget').hidden=!project;
 $('edit').disabled=$('share-building').disabled=!project;
 for(const b of buildings) {
   select.add(new Option(b.name,b.id));
   if(!project || b.id===project.id)continue;
   const pin=L.marker([b.lat,b.lon],{title:b.name,alt:b.name,
     icon:L.divIcon({className:'',html:'<span class="saved-building-marker"></span>',iconSize:[17,17],iconAnchor:[8,8]})});
   pin.bindTooltip(esc(b.name),{direction:'top',offset:[0,-9]});
   pin.on('click',()=>{if(picking)pick(pin.getLatLng());else activateBuilding(b);});
   pin.addTo(otherMarkers);
 }
 select.value=project?.id || '';
}
function activateBuilding(building, writeItem=false) {
 const stored=load('buildings',null);
 const current=stored || buildingState;
 const items=Array.isArray(current?.items)?current.items:[];
 const next={items:writeItem?[...items.filter(b=>b.id!==building.id),building]:items};
 if(writeItem && !save('buildings',next))return false;
 buildingState=next;
 buildings=buildingList(catalog,next);
 project=buildings.find(b=>b.id===building.id) || building;
 projectState();renderBuildings();
 if(!dest)render();
 if(writeItem)close();
 projectFocus();return true;
}
function shareBuilding() {
 const url=buildingURL(location.href,project);
 dialog('Compartir ubicación', '<p>El enlace abre el mapa en las coordenadas de '+esc(project.name)+'. Incluye el nombre y la ubicación.</p>'+
   field('share-url','Enlace del edificio',url.href,'type="url" readonly')+
   '<div class="actions"><button class="button primary" id="copy-building">Copiar enlace</button></div><p id="copy-status" role="status"></p>');
 $('copy-building').onclick=async()=>{
   try {await navigator.clipboard.writeText(url.href);$('copy-status').textContent='Enlace copiado.';}
   catch {$('share-url').select();$('copy-status').textContent='Copia el enlace seleccionado.';}
 };
}
function settings(p = project, coordinates = Number.isFinite(p.lat) ? p.lat + ', ' + p.lon : '') {
 const adding = !p.id;
 dialog(adding ? 'Agregar edificio' : 'Editar edificio', '<form id="project-form">' +
   field('f-name','Nombre del edificio',p.name,'maxlength="80" required') +
   field('f-coordinates','Coordenadas (latitud, longitud)',coordinates,'placeholder="-2.18376, -79.97990" aria-describedby="coord-help" required') +
   '<p id="coord-help">Pega las coordenadas de Google Maps en grados decimales o elige el punto en el mapa.</p>' +
   '<button class="linkbutton" type="button" id="pick">Elegir en el mapa</button>' +
   '<label for="f-level">Zoom al guardar</label><select id="f-level"><option value="parish">Parroquia</option><option value="canton">Cantón</option></select>' +
   '<p id="f-location" role="status"></p>' +
   '<details id="building-details"><summary>Datos de venta opcionales</summary>' +
   field('f-sector','Sector buscado en las solicitudes',p.sector,'maxlength="80"') +
   '<div class="twocol"><div>'+field('f-price','Precio desde (USD)',p.price,'type="number" min="1" max="1000000000" step="0.01"')+
   '</div><div>'+field('f-rooms','Dormitorios',p.rooms,'type="number" min="1" max="50" step="1"')+'</div></div></details>' +
   '<p>Se guarda en este navegador. Puedes compartir el pin mediante un enlace.</p>' +
   '<p class="err" id="form-msg" role="alert"></p><div class="actions"><button class="button primary" type="submit">Guardar edificio</button></div></form>');
 const level=$('f-level'), coordinateInput=$('f-coordinates'), locationText=$('f-location');
 level.value=p.focusArea || 'parish';
 function preview(){
   const point=parseCoordinates(coordinateInput.value);
   if(!point){locationText.textContent='';return;}
   const {canton,parish}=locate(point.lat,point.lon);
   locationText.textContent=areaLabel(canton,parish,level.value);
   if(level.value==='parish' && parishes?.needsUrban(parish)){
     parishes.loadUrban().then(()=>{if(locationText.isConnected)preview();});
   }
 }
 coordinateInput.oninput=preview;level.onchange=preview;preview();
 function draft() {
   return {...p,focusArea:level.value,name:$('f-name').value.trim(),sector:$('f-sector').value.trim(),
     price:$('f-price').valueAsNumber || null,rooms:$('f-rooms').valueAsNumber || null};
 }
 $('pick').onclick=()=>{
   pending={building:draft(),coordinates:$('f-coordinates').value};
   close();map.closePopup();picking=true;$('pin-tip').hidden=false;$('map').classList.add('pick-mode');$('explorar').scrollIntoView({block:'start'});
 };
 $('project-form').onsubmit=e=>{
   e.preventDefault();
   const point=parseCoordinates($('f-coordinates').value),building=draft();
   if(!building.name)return err('Indica el nombre del edificio.');
   if(!point)return err('Revisa las coordenadas. Ejemplo: -2.18376, -79.97990. La latitud va primero (−90 a 90) y la longitud después (−180 a 180).');
   Object.assign(building,point,{reference:!!p.reference && point.lat===p.lat && point.lon===p.lon});
   const duplicate=buildings.find(b=>b.id!==p.id && sameBuilding(building,b));
   if(duplicate)return err('Ya existe un edificio con ese nombre y esas coordenadas. Selecciónalo en el mapa.');
   building.id=p.id || crypto.randomUUID();
   if(!activateBuilding(building,true))return;
   say(adding?'Edificio agregado.':'Edificio actualizado.');
 };
}
function stopPick(){picking=false;$('pin-tip').hidden=true;$('map').classList.remove('pick-mode');}
function cancelPick(){stopPick();settings(pending.building,pending.coordinates);}
function pick(ll){
 if(!picking)return;
 const point=map.wrapLatLng(ll);
 stopPick();settings(pending.building,point.lat.toFixed(6)+', '+point.lng.toFixed(6));
}
function scenario(){dialog('Supuestos de compra','<form id="f-fin"><p>Escenario ilustrativo de cuota mensual fija. La simulación supone que el hogar ya dispone de la entrada. El resultado varía con el ingreso de referencia mostrado.</p><div class="twocol"><div>'+field('down','Entrada (%)',finance.down,'type="number" min="0" max="95" step="0.1" required')+'</div><div>'+field('years','Plazo (años)',finance.years,'type="number" min="1" max="40" step="1" required')+'</div><div>'+field('rate','Tasa nominal anual (%)',finance.rate,'type="number" min="0" max="50" step="0.01" required')+'</div><div>'+field('share','Cuota / ingreso (%)',finance.share,'type="number" min="1" max="80" step="0.1" required')+'</div></div><div class="actions"><button class="button primary" type="submit">Aplicar al escenario</button></div></form>');
 $('f-fin').onsubmit=e=>{e.preventDefault();const v=Object.fromEntries(['down','years','rate','share'].map(k=>[k,Number($(k).value)]));if(!save('finance',v))return;finance=v;close();render();say('Escenario actualizado.');};
}
function download(name,lines){function safe(v){let s=String(v??'');if(/^[=+@\-]/.test(s)&&!/^[-+]?\d+(\.\d+)?$/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
 const data='\uFEFF'+lines.map(row=>row.map(safe).join(',')).join('\r\n')+'\r\n',u=URL.createObjectURL(new Blob([data],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),2000);}
function exportData(){const header=['dpa','canton','provincia','poblacion_2022','distancia_referencia_recta_km','proyecto','latitud_proyecto','longitud_proyecto','dominio_ingreso','mediana_ingreso_mensual_usd_2024_2025','precio_escenario_usd','entrada_pct','tasa_nominal_pct','plazo_anios','cuota_sobre_ingreso_pct','solicitudes_compatibles_90d_en_muestra','operaciones_bancos_privados_ene_sep_2026','credito_medio_publico_usd','credito_mediano_publico_usd','operaciones_importadas','mediana_importada_usd'];const list=filtered().map(f=>{const p=f.properties,s=scope(f),m=observedLoans(f),v=inc[s].median,custom=userLoans.filter(x=>x.canton_destino===p.code);return [p.code,p.name,p.province,p.population,referenceKm(f),project?.name,project?.lat,project?.lon,s,v,Math.round(maxPrice(v,finance)),finance.down,finance.rate,finance.years,finance.share,hasDemand()?matches[p.code]??0:null,m?.operations,m?.mean_usd,m?.median_usd,custom.length||null,median(custom.map(x=>x.monto_usd))];});download('atlas_litoral_cantones.csv',[header,...list]);}
function imports(type='demand'){
 const isDemand=type==='demand',current=isDemand?requests:userLoans,fields=isDemand?demandFields:loanFields;
 dialog('Importar una muestra','<label for="typ">Tipo de registros</label><select id="typ"><option value="demand">Solicitudes de compra</option><option value="loans">Operaciones de crédito</option></select><p>'+(isDemand?'Una fila por solicitud anónima, con su cantón de origen y el cantón y sector donde desea comprar. Se cuentan coincidencias de sector, dormitorios, presupuesto y fecha en los últimos 90 días.':'Una fila por préstamo original, con monto y cantón de destino. La ficha muestra la mediana y el período de tu muestra aparte del corte público.')+'</p><p>Usa códigos DPA de cuatro dígitos, fecha AAAA-MM-DD y montos sin separador de miles. El CSV del directorio incluye los códigos. Usa un identificador anónimo interno.</p><button id="template" class="linkbutton">Descargar plantilla CSV</button><label for="file">Archivo CSV</label><input type="file" id="file" accept=".csv,text/csv"><p>El archivo reemplaza la muestra de este tipo y se guarda en este navegador. Registros actuales: '+num(current.length)+'.</p><p id="form-msg" class="err" role="status"></p><div class="actions"><button id="read-sample" class="button primary">Cargar muestra</button>'+(current.length?'<button id="clear-sample" class="button subtle">Quitar muestra</button>':'')+'</div>');
 $('typ').value=type;$('typ').onchange=e=>imports(e.target.value);$('template').onclick=()=>download(isDemand?'plantilla_solicitudes.csv':'plantilla_prestamos.csv',[fields]);
 $('read-sample').onclick=async()=>{const file=$('file').files[0];if(!file)return err('Selecciona un archivo CSV.');if(file.size>1500000)return err('Utiliza un CSV de hasta 1,5 MB.');try{const regs=parseSample(await file.text(),type,features);if(!save(type,regs))return err('No se pudo guardar la muestra. Reduce el archivo.');if(isDemand)requests=regs;else userLoans=regs;projectState();close();if(isDemand){$('layer').value='demand';$('sort').value='match';}render();say(num(regs.length)+' registros cargados.');}catch(e){err(e.message);}};
 if(current.length)$('clear-sample').onclick=()=>{if(!confirm('¿Quitar la muestra de este navegador?'))return;if(!save(type,[]))return;if(isDemand){requests=[];$('sort').value='population';}else userLoans=[];projectState();close();render();say('Muestra retirada.');};
}
async function main(){
 const names=['cantons','context','incomes','evidence','mortgages','streets','buildings','provinces','parishes','census-ages','sectors/index'];
 const [geo,context,incomes,sales,mortgages,streetGeo,publishedBuildings,provinces,parishCatalog,censusAges,sectorIndex]=await Promise.all(names.map(async n=>{
   try{
     const r=await fetch('./data/'+n+'.json');
     if(!r.ok)throw Error(n);
     return await r.json();
   }catch(error){
     if(n==='parishes'||n==='census-ages'||n==='sectors/index')return null;
     throw error;
   }
 }));
 features=geo.features;inc=incomes;observed=sales;bank=mortgages;
 catalog=publishedBuildings.filter(validBuilding);
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
 const shared=buildingFromURL(location.href);
 const sharedRequest=new URL(location.href).searchParams.has('edificio');
 $('canton').innerHTML=features.slice().sort((a,b)=>a.properties.name.localeCompare(b.properties.name,'es')).map(f=>'<option value="'+f.properties.code+'">'+esc(f.properties.name)+'</option>').join('');$('canton').value=selected;
 mapInit(context,streetGeo,provinces);
 if(parishCatalog){
   parishes=initParishes(map,parishCatalog.features,()=>byCode(selected).properties,setSelection,()=>{demographics?.refresh();sectors?.refresh();});
 }else $('parish-note').textContent='No se pudieron cargar los límites parroquiales.';
 if(censusAges&&parishCatalog){
   demographics=initDemographics({map,data:censusAges,cantons:features,parishCatalog,parishes,
     state:()=>({theme:$('layer').value,province:$('province').value,code:selected}),selectCanton:setSelection,colorize,isPicking:()=>picking});
   $('age-option').disabled=false;$('age-body').hidden=false;$('age-status').hidden=true;
 }else $('age-status').textContent='No se pudo cargar la demografía censal. Recarga para reintentar.';
 if(sectorIndex && parishCatalog){
   sectors=initSectorProfiles({map,index:sectorIndex,parishCatalog,cantons:features,
     state:()=>({theme:$('layer').value,province:$('province').value,canton:selected,parish:$('parish-select').value,finance,project,buildings}),
     selectArea:code=>{setSelection(code.slice(0,4));parishes.highlight(parishCatalog.features.find(f=>f.properties.code===code.slice(0,6)));},
     editFinance:scenario,changeTheme:()=>{$('layer').value='sectors';colorize();},isPicking:()=>picking});
 }else $('sector-status').textContent='No se pudieron cargar los sectores. Recarga para reintentar.';
 creditMap=initCreditMap({map,features,parishes,parishCatalog,bankRow:observedLoans,state:()=>({theme:$('layer').value,province:$('province').value,project,projectCanton:dest?.code,down:finance.down}),redraw:colorize,fitRegion,selectCanton:setSelection,download});
 const initialTheme=new URL(location.href).searchParams.get('capa');
 if(initialTheme==='credit'||(initialTheme==='sectors'&&sectors)||(initialTheme==='ages'&&demographics))$('layer').value=initialTheme;
 $('source-items').innerHTML=sourceHTML()+'<p class="mini">Distancia de referencia: línea recta del pin a un punto interior de cada cantón; se usa para exploración geográfica. La distancia de viaje depende de la red vial.</p>';render();
 if(shared){
   const known=buildings.find(b=>sameBuilding(b,shared));
   const changed=!!known && !!shared.focusArea && shared.focusArea!==known.focusArea;
   activateBuilding(known?{...known,...shared}:{...shared,id:crypto.randomUUID()},!known || changed);
 }else if(sharedRequest)say('El enlace contiene coordenadas o un nombre no válidos.');
 if(sharedRequest){
   const url=new URL(location.href);
   for(const key of ['edificio','lat','lon','nivel'])url.searchParams.delete(key);
   history.replaceState(null,'',url);
 }
 $('add-building').disabled=$('building-select').disabled=false;
 $('add-building').onclick=()=>settings({name:''});
 $('building-select').onchange=e=>activateBuilding(buildings.find(b=>b.id===e.target.value));
 $('share-building').onclick=shareBuilding;
 $('layer').onchange=()=>{if($('layer').value==='sectors'&&sectors)sectors.frame();else colorize();};$('province').onchange=()=>{if(!withinProvince(byCode(selected))){selected=features.filter(withinProvince).sort((a,b)=>b.properties.population-a.properties.population)[0].properties.code;$('canton').value=selected;}fitRegion();render();};
 $('canton').onchange=e=>setSelection(e.target.value,true);$('all-map').onclick=()=>{fitRegion();};$('focus-project').onclick=projectFocus;$('p-link').onclick=projectFocus;
 $('rows').onclick=e=>{const b=e.target.closest('button[data-code]');if(b){setSelection(b.dataset.code,true);$('explorar').scrollIntoView({block:'start'});}};
 $('search').oninput=table;$('sort').onchange=table;$('edit').onclick=()=>settings();$('close').onclick=close;$('cancel-pick').onclick=cancelPick;$('finance-open').onclick=scenario;$('import-open').onclick=()=>imports();$('csv-out').onclick=exportData;
 const cantonLink=new URL(location.href).searchParams.get('canton');
 if(!shared && cantonLink && byCode(cantonLink))setSelection(cantonLink,true);
 if(!shared && initialTheme==='sectors'){const id=new URL(location.href).searchParams.get('sector');if(/^\d{12}$/.test(id))sectors?.openCode(id);}
 if(!shared && initialTheme==='ages')demographics?.openParish(new URL(location.href).searchParams.get('parroquia'));
 infrastructure=await initInfrastructure({
   map, land:context.features.filter(f=>f.properties.kind==='land'), state:()=>({theme:$('layer').value,province:$('province').value,code:selected,features,project,projectInCoverage:!!dest}),
   changeTheme:theme=>{$('layer').value=theme;colorize();},isPicking:()=>picking,fitRegion,selectCanton:code=>setSelection(code),download
 }).catch(error=>{console.warn('Capas de infraestructura:',error);$('infra-status').textContent='No se pudo iniciar el análisis. Recarga para reintentar.';return null;});
 if(infrastructure){
   sectors?.setFacilities(infrastructure.schools,infrastructure.hospitals);
   const requested=new URL(location.href).searchParams.get('capa');
   if(['access','suitability'].includes(requested) && !$('layer').querySelector('[value="'+requested+'"]').disabled)$('layer').value=requested;
   colorize();
 }
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&picking){e.preventDefault();cancelPick();}});
}
main().catch(e=>{console.error(e);$('map').textContent='No se pudo cargar la cartografía. Recarga la página para reintentar.';});
