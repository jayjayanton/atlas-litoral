import {initInfrastructure} from './infrastructure.js';
import {initialProject,initialFinance,distanceKm,featureAt,maxPrice,median,normalize,parseSample,demandFields,loanFields,recentMatches} from './model.js';
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const link=(url,label)=>'<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">'+esc(label)+'</a>';
const num=n=>new Intl.NumberFormat('es-EC').format(n);
const money=n=>n==null?'—':'$'+num(Math.round(n));
const store='atlasLitoral.v1.';
function load(key,init){try{return JSON.parse(localStorage.getItem(store+key))??init;}catch{return init;}}
function save(key,value){try{localStorage.setItem(store+key,JSON.stringify(value));return true;}catch{say('No se pudo guardar en este navegador.');return false;}}
let project=load('project',initialProject),finance=load('finance',initialFinance),requests=load('demand',[]),userLoans=load('loans',[]);
let infrastructure;
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
function projectState(){
 dest=featureAt(features,project.lat,project.lon)?.properties;
 matches=recentMatches(requests,project,dest?.code);
}
function observedLoans(f){return bank.rows.find(r=>normalize(r.province)===normalize(f.properties.province)&&(normalize(r.canton)===normalize(f.properties.name)||(r.canton.includes('BUCAY')&&f.properties.code==='0927')));}
function metricValue(f){const c=f.properties.code;switch($('layer').value){case'population':return f.properties.population;case'loans':return observedLoans(f)?.operations??null;default:return requests.length?matches[c]??0:null;}}
function breaks(){return $('layer').value==='population'?[0,50000,100000,200000,500000]:$('layer').value==='loans'?[1,5,25,100,500]:[0,1,5,10,25];}
function fill(f){if(infrastructure?.supports($('layer').value))return infrastructure.fill($('layer').value,f.properties.code);const v=metricValue(f);if(v==null)return empty;const ix=breaks().filter(x=>v>=x).length-1;return colors[Math.max(0,ix)];}
function style(f){const active=f.properties.code===selected;return {color:active?'#134b45':'#509182',weight:active?2.7:1.2,fillColor:fill(f),fillOpacity:withinProvince(f)?(['access','suitability'].includes($('layer').value)?.24:.65):.16,opacity:withinProvince(f)?1:.35};}
function setSelection(code,move=false){if(!byCode(code))return;selected=code;if($('province').value&&!withinProvince(byCode(code)))$('province').value='';$('canton').value=code;render();if(move)map.fitBounds(layers[code].getBounds(),{padding:[22,22],maxZoom:11});}
function colorize(){polys.setStyle(style);if(layers[selected])layers[selected].bringToFront();
 if(infrastructure){infrastructure.refresh();if(infrastructure.legend($('layer').value))return;}
 const choices=$('layer').value==='population'?['<50 mil','50 mil+','100 mil+','200 mil+','500 mil+']:$('layer').value==='loans'?['1–4','5–24','25–99','100–499','500+']:['0','1–4','5–9','10–24','25+'];
 $('legend-title').textContent=$('layer').value==='population'?'Habitantes · 2022':$('layer').value==='loans'?'Créditos por destino · ene–sep 2026':'Solicitudes de origen · 90 días';
 $('legend').innerHTML=choices.map((c,i)=>'<span class="key"><i class="sw" style="background:'+colors[i]+'"></i>'+c+'</span>').join('')+($('layer').value==='population'?'':'<span class="key"><i class="sw" style="background:'+empty+'"></i>S/d</span>');
}
function fitRegion(){const fs=features.filter(withinProvince);const b=L.latLngBounds([]);fs.forEach(f=>b.extend(layers[f.properties.code].getBounds()));map.fitBounds(b,{padding:[12,12],maxZoom:9});}
function projectFocus(){map.setView([project.lat,project.lon],12);marker.openPopup();}
function refreshMarker(){
 marker.setLatLng([project.lat,project.lon]);const sub=project.reference?'Acceso aproximado a Torres del Salado':'Punto elegido por el usuario';
 marker.bindPopup('<b>'+esc(project.name)+'</b><br>'+sub+'<br>'+project.lat.toFixed(5)+', '+project.lon.toFixed(5));$('project-name').textContent=project.name;$('project-where').textContent=(dest?.name??'Fuera de cobertura')+' · '+(project.reference?'acceso aproximado':'punto definido');
}
function mapInit(context,streetGeo){
 map=L.map('map',{zoomSnap:.15,zoomDelta:.75,minZoom:4,maxZoom:16,scrollWheelZoom:false,zoomControl:false,attributionControl:false,maxBounds:[[-8,-96],[4,-72]],maxBoundsViscosity:.75});
 L.control.zoom({position:'topright',zoomInTitle:'Acercar',zoomOutTitle:'Alejar'}).addTo(map);
 L.control.attribution({prefix:false,position:'bottomright'}).addTo(map).addAttribution('© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · <a href="#datos">Fuentes</a>');
 for(const [key,z] of [['land',250],['rivers',370],['labels',420]]){map.createPane(key);map.getPane(key).style.zIndex=z;map.getPane(key).style.pointerEvents='none';}
 L.geoJSON(context,{filter:f=>f.properties.kind==='land',pane:'land',interactive:false,style:{weight:1,color:'#9cb9b7',fillColor:'#eaf0e8',fillOpacity:1}}).addTo(map);
 L.geoJSON(context,{filter:f=>f.properties.kind==='river',pane:'rivers',interactive:false,style:f=>f.properties.kind==='river'?{weight:1.2,color:'#79b0c3',opacity:.84}:{weight:1.1,color:'#ba9660',opacity:.67}}).addTo(map);
 streets=L.geoJSON(streetGeo,{pane:'rivers',interactive:false,style:{weight:1.15,color:'#9f977f',opacity:.9}});
 polys=L.geoJSON({type:'FeatureCollection',features},{style,onEachFeature:(f,l)=>{
  const p=f.properties;layers[p.code]=l;l.bindTooltip(esc(p.name)+' · '+esc(p.province),{sticky:true,direction:'top',offset:[0,-7]});
  l.on('click',e=>{if(picking){L.DomEvent.stopPropagation(e);pick(e.latlng);return;}setSelection(p.code);});
 }}).addTo(map);
 const staticLabels=[['Guayaquil',-2.205,-79.88],['Daule',-1.86,-79.98],['Milagro',-2.125,-79.59],['Santa Elena',-2.165,-80.81],['Balzar',-1.367,-79.91],['Playas',-2.63,-80.39],['El Triunfo',-2.34,-79.39]];
 labels=L.layerGroup(staticLabels.map(([s,lat,lon])=>L.marker([lat,lon],{interactive:false,keyboard:false,pane:'labels',icon:L.divIcon({className:'map-label',html:s,iconSize:[70,16],iconAnchor:[35,2]})}))).addTo(map);
 L.marker([-2.54,-81.12],{interactive:false,keyboard:false,pane:'labels',icon:L.divIcon({className:'sea-label',html:'Océano Pacífico',iconSize:[135,22],iconAnchor:[70,15]})}).addTo(map);
 marker=L.marker([project.lat,project.lon],{title:'Proyecto activo',icon:L.divIcon({className:'',html:'<span class="pm">●</span>',iconSize:[22,22],iconAnchor:[11,11]})}).addTo(map);
 map.on('zoomend',()=>{if(map.getZoom()>=11&&!map.hasLayer(streets))streets.addTo(map);if(map.getZoom()<11&&map.hasLayer(streets))map.removeLayer(streets);});
 map.on('click',e=>{if(picking){pick(e.latlng);return;}infrastructure?.inspect(e.latlng);});fitRegion();
}
function evidenceHTML(f){
 const sources=observed.filter(s=>s.code===f.properties.code),ln=observedLoans(f),c=f.properties.code;
 let result=sources.map(s=>'<div class="evidence-item"><b>'+num(s.value)+' '+esc(s.units)+'</b> · '+esc(s.area)+'<small>'+esc(s.period)+' · '+link(s.url,s.sourceName)+'</small><small>'+esc(s.note)+'</small>'+(s.records?.length?'<details><summary>Ver fichas individuales</summary>'+s.records.map(r=>link(r.url,r.id)).join('')+'</details>':'')+'</div>').join('');
 if(!result)result='<div class="evidence-item"><p>Sin muestra pública de ventas verificada para este cantón en el atlas.</p></div>';
 result+='<div class="evidence-item"><b>Crédito por destino</b><p>'+(ln?num(ln.operations)+' operaciones · monto promedio '+money(ln.mean_usd)+'.':'Sin fila en el corte seleccionado.')+' Banca privada, enero–septiembre de 2026. '+link(financingURL,'Ver fuente')+'</p></div>';
 result+='<div class="evidence-item"><b>Solicitudes por origen</b><p>'+(requests.length?num(matches[c]??0)+' solicitudes compatibles en el archivo importado (últimos 90 días).':'Pendiente de registros con cantón de origen y destino solicitado. Importa una muestra para comparar territorios.')+'</p></div>';
 if(userLoans.some(r=>r.canton_destino===c)){const ls=userLoans.filter(r=>r.canton_destino===c),ds=ls.map(r=>r.fecha).sort();result+='<div class="evidence-item"><b>Muestra de crédito importada</b><p>Mediana '+money(median(ls.map(r=>r.monto_usd)))+' · '+num(ls.length)+' operaciones · '+ds[0]+' a '+ds.at(-1)+'.</p></div>';}
 return result;
}
function filtered(){const term=normalize($('search').value),sort=$('sort').value;return features.filter(f=>withinProvince(f)&&normalize(f.properties.name+' '+f.properties.code).includes(term)).sort((a,b)=>{
 function val(f){return sort==='distance'?-distanceKm(project.lat,project.lon,f.properties.labelPoint):sort==='match'?matches[f.properties.code]??0:sort==='credit'?observedLoans(f)?.operations??-1:f.properties.population;}
 return (sort==='name'?0:val(b)-val(a))||a.properties.name.localeCompare(b.properties.name,'es');
});}
function table(){
 const fs=filtered();$('rows').innerHTML=fs.map(f=>{const p=f.properties;return '<tr class="'+(p.code===selected?'active':'')+'"><td><button data-code="'+p.code+'">'+esc(p.name)+'</button></td><td>'+esc(p.province)+'</td><td>'+num(p.population)+'</td><td>'+num(Math.round(distanceKm(project.lat,project.lon,p.labelPoint)))+' km</td><td>'+(requests.length?num(matches[p.code]??0):'—')+'</td><td>'+numOrDash(observedLoans(f)?.operations)+'</td></tr>';}).join('')||'<tr><td colspan="6">Sin coincidencias. Prueba con otro nombre o código.</td></tr>';
 $('table-count').textContent=fs.length+' de '+features.length+' cantones';$('rank-note').textContent=requests.length?'Solicitudes compatibles de la muestra importada en los últimos 90 días. Un cero se refiere únicamente a esa muestra.':'Ordena por población o por actividad bancaria. El ranking de compradores se activa al importar solicitudes recientes con origen conocido.';
 $('sort').querySelector('[value="match"]').disabled=!requests.length;
}
const numOrDash=n=>n==null?'—':num(n);
function render(){
 const f=byCode(selected),p=f.properties,s=scope(f),v=inc[s],ln=observedLoans(f),custom=userLoans.filter(r=>r.canton_destino===p.code);
 $('detail-prov').textContent=p.province+' · DPA '+p.code;$('pop').textContent=num(p.population);$('income').textContent=money(v.median);$('income-scale').textContent=(p.code==='0901'?'Dominio urbano':'Referencia provincial')+' · '+s;
 $('loan').textContent=money(ln?.median_usd??(custom.length?median(custom.map(x=>x.monto_usd)):null));$('loan-note').textContent=ln?.median_usd!=null?'Banca privada · '+ln.operations+' operaciones':custom.length?'Muestra importada · '+num(custom.length)+' operaciones':ln?'Datos agrupados · ver promedio':'Sin mediana publicada';
 $('power').textContent=money(maxPrice(v.median,finance));$('scenario-note').textContent='Para el hogar mediano de '+s+', con '+finance.down+' % de entrada, '+finance.years+' años, interés anual del '+finance.rate+' % y cuota del '+finance.share+' % del ingreso. Excluye gastos y deudas. Referencia de escenario.';
 const required=project.price / maxPrice(1,finance);$('project-budget').textContent=project.name+' · precio desde '+money(project.price)+'. Con estos supuestos, la entrada sería '+money(project.price*finance.down/100)+' y el ingreso mensual de referencia sería '+money(required)+'.';
 $('evidence').innerHTML=evidenceHTML(f);colorize();table();refreshMarker();
}
function sourceHTML(){const urls=[
 [incomeURL,'INEC · ENIGHUR 2024–2025','Mediana ponderada del ingreso corriente monetario mensual del hogar (ing_mon_cor, peso Fexp). Guayas, Santa Elena y dominio urbano de Guayaquil.'],
 [guideURL,'Diseño y alcance de la ENIGHUR','El ingreso mostrado para los demás cantones se refiere a su provincia. El escenario financiero aplica cuota fija con amortización mensual y entrada disponible.'],
 [financingURL,'Superintendencia de Bancos · Volumen de crédito','Corte enero–septiembre de 2026. Banca privada, operaciones originales de crédito inmobiliario, VIS y VIP. La mediana se informa solo cuando se puede reconstruir de los grupos. Los cantones sin fila se muestran sin dato.'],
 ['https://www.censoecuador.gob.ec/wp-content/uploads/2024/01/Info_Guayas.pdf','INEC · Guayas','Población cantonal censada en 2022.'],
 ['https://www.censoecuador.gob.ec/wp-content/uploads/2024/01/Info_Santa_Elena.pdf','INEC · Santa Elena','Población cantonal censada en 2022.'],
 ['https://www.geoboundaries.org/api/current/gbOpen/ECU/ADM2/','geoBoundaries · INEC / OCHA ROLAC','Límites cantonales de 2019 simplificados para la visualización. CC BY 3.0 IGO.'],
 ['https://www.naturalearthdata.com/','Natural Earth','Costa y contexto regional de dominio público.'],
 ['https://www.openstreetmap.org/copyright','© OpenStreetMap contributors · ODbL','Ríos vía WaterwayMap, red vial del entorno del proyecto y entrada a Torres del Salado. El pin inicial corresponde al acceso a la urbanización.'],
 [publishedPrice,'Plusvalía · VELIN Tower','Modelo inicial de tres dormitorios desde USD 180.000. Confirmar ubicación y precios con el propietario.']];
 return '<ul>'+urls.map(([u,t,d])=>'<li>'+link(u,t)+' · '+esc(d)+'</li>').join('')+'</ul><p class="mini">Las muestras de ventas y sus enlaces constan en la ficha de cada cantón. Una venta identifica el lugar de la propiedad. La residencia del comprador requiere una fuente independiente. El escenario, el proyecto y las muestras CSV se guardan en este navegador.</p>';
}
function dialog(title,body){$('modal-title').textContent=title;$('modal-body').innerHTML=body;if(!$('modal').open)$('modal').showModal();}
function close(){if($('modal').open)$('modal').close();}
function err(e){$('form-msg').textContent=e;}
function field(id,title,value,attrs=''){return '<label for="'+id+'">'+title+'</label><input id="'+id+'" '+attrs+' value="'+esc(value)+'">';}
function settings(p=project){
 dialog('Configurar proyecto','<form id="project-form"><p>Ubica el edificio con un pin o coordenadas WGS84. El punto inicial de VELIN es la entrada a Torres del Salado.</p>'+field('f-name','Nombre del proyecto',p.name,'maxlength="80" required')+field('f-sector','Sector buscado en las solicitudes',p.sector,'maxlength="80" required')+'<div class="twocol"><div>'+field('f-price','Precio desde (USD)',p.price,'type="number" min="1" max="1000000000" step="0.01" required')+'</div><div>'+field('f-rooms','Dormitorios',p.rooms,'type="number" min="1" max="50" step="1" required')+'</div></div><div class="twocol"><div>'+field('f-lat','Latitud',p.lat,'type="number" min="-90" max="90" step="any" required')+'</div><div>'+field('f-lng','Longitud',p.lon,'type="number" min="-180" max="180" step="any" required')+'</div></div><p class="err" id="form-msg"></p><div class="actions"><button class="button primary" type="submit">Guardar proyecto</button><button class="button subtle" type="button" id="pick">Elegir en el mapa</button></div></form>');
 function formValue(){const lat=Number($('f-lat').value),lon=Number($('f-lng').value);return {name:$('f-name').value.trim(),sector:$('f-sector').value.trim(),price:Number($('f-price').value),rooms:Number($('f-rooms').value),lat,lon,reference:p.reference&&lat===initialProject.lat&&lon===initialProject.lon};}
 $('pick').onclick=()=>{pending=formValue();close();picking=true;$('pin-tip').hidden=false;$('map').classList.add('pick-mode');$('explorar').scrollIntoView({block:'start'});};
 $('project-form').onsubmit=e=>{e.preventDefault();const v=formValue();if(!v.name||!v.sector)return err('Indica un nombre y un sector.');const hit=featureAt(features,v.lat,v.lon);if(!hit)return err('El punto debe quedar en un cantón de Guayas o Santa Elena.');if(!save('project',v))return;project=v;projectState();close();setSelection(hit.properties.code);projectFocus();say('Proyecto actualizado.');};
}
function stopPick(){picking=false;$('pin-tip').hidden=true;$('map').classList.remove('pick-mode');}
function pick(ll){if(!featureAt(features,ll.lat,ll.lng)){say('Elige un punto dentro de un cantón del atlas.');return;}stopPick();settings({...pending,lat:+ll.lat.toFixed(6),lon:+ll.lng.toFixed(6),reference:false});}
function scenario(){dialog('Supuestos de compra','<form id="f-fin"><p>Escenario ilustrativo de cuota mensual fija. La simulación supone que el hogar ya dispone de la entrada. El resultado varía con el ingreso de referencia mostrado.</p><div class="twocol"><div>'+field('down','Entrada (%)',finance.down,'type="number" min="0" max="95" step="0.1" required')+'</div><div>'+field('years','Plazo (años)',finance.years,'type="number" min="1" max="40" step="1" required')+'</div><div>'+field('rate','Tasa nominal anual (%)',finance.rate,'type="number" min="0" max="50" step="0.01" required')+'</div><div>'+field('share','Cuota / ingreso (%)',finance.share,'type="number" min="1" max="80" step="0.1" required')+'</div></div><div class="actions"><button class="button primary" type="submit">Aplicar al escenario</button></div></form>');
 $('f-fin').onsubmit=e=>{e.preventDefault();const v=Object.fromEntries(['down','years','rate','share'].map(k=>[k,Number($(k).value)]));if(!save('finance',v))return;finance=v;close();render();say('Escenario actualizado.');};
}
function download(name,lines){function safe(v){let s=String(v??'');if(/^[=+@\-]/.test(s)&&!/^[-+]?\d+(\.\d+)?$/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
 const data='\uFEFF'+lines.map(row=>row.map(safe).join(',')).join('\r\n')+'\r\n',u=URL.createObjectURL(new Blob([data],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),2000);}
function exportData(){const header=['dpa','canton','provincia','poblacion_2022','distancia_referencia_recta_km','proyecto','latitud_proyecto','longitud_proyecto','dominio_ingreso','mediana_ingreso_mensual_usd_2024_2025','precio_escenario_usd','entrada_pct','tasa_nominal_pct','plazo_anios','cuota_sobre_ingreso_pct','solicitudes_compatibles_90d_en_muestra','operaciones_bancos_privados_ene_sep_2026','credito_medio_publico_usd','credito_mediano_publico_usd','operaciones_importadas','mediana_importada_usd'];const list=filtered().map(f=>{const p=f.properties,s=scope(f),m=observedLoans(f),v=inc[s].median,custom=userLoans.filter(x=>x.canton_destino===p.code);return [p.code,p.name,p.province,p.population,Math.round(distanceKm(project.lat,project.lon,p.labelPoint)),project.name,project.lat,project.lon,s,v,Math.round(maxPrice(v,finance)),finance.down,finance.rate,finance.years,finance.share,requests.length?matches[p.code]??0:null,m?.operations,m?.mean_usd,m?.median_usd,custom.length||null,median(custom.map(x=>x.monto_usd))];});download('atlas_litoral_cantones.csv',[header,...list]);}
function imports(type='demand'){
 const isDemand=type==='demand',current=isDemand?requests:userLoans,fields=isDemand?demandFields:loanFields;
 dialog('Importar una muestra','<label for="typ">Tipo de registros</label><select id="typ"><option value="demand">Solicitudes de compra</option><option value="loans">Operaciones de crédito</option></select><p>'+(isDemand?'Una fila por solicitud anónima, con su cantón de origen y el cantón y sector donde desea comprar. Se cuentan coincidencias de sector, dormitorios, presupuesto y fecha en los últimos 90 días.':'Una fila por préstamo original, con monto y cantón de destino. La ficha muestra la mediana y el período de tu muestra aparte del corte público.')+'</p><p>Usa códigos DPA de cuatro dígitos, fecha AAAA-MM-DD y montos sin separador de miles. El CSV del directorio incluye los códigos. Usa un identificador anónimo interno.</p><button id="template" class="linkbutton">Descargar plantilla CSV</button><label for="file">Archivo CSV</label><input type="file" id="file" accept=".csv,text/csv"><p>El archivo reemplaza la muestra de este tipo y se guarda en este navegador. Registros actuales: '+num(current.length)+'.</p><p id="form-msg" class="err" role="status"></p><div class="actions"><button id="read-sample" class="button primary">Cargar muestra</button>'+(current.length?'<button id="clear-sample" class="button subtle">Quitar muestra</button>':'')+'</div>');
 $('typ').value=type;$('typ').onchange=e=>imports(e.target.value);$('template').onclick=()=>download(isDemand?'plantilla_solicitudes.csv':'plantilla_prestamos.csv',[fields]);
 $('read-sample').onclick=async()=>{const file=$('file').files[0];if(!file)return err('Selecciona un archivo CSV.');if(file.size>1500000)return err('Utiliza un CSV de hasta 1,5 MB.');try{const regs=parseSample(await file.text(),type,features);if(!save(type,regs))return err('No se pudo guardar la muestra. Reduce el archivo.');if(isDemand)requests=regs;else userLoans=regs;projectState();close();if(isDemand){$('layer').value='demand';$('sort').value='match';}render();say(num(regs.length)+' registros cargados.');}catch(e){err(e.message);}};
 if(current.length)$('clear-sample').onclick=()=>{if(!confirm('¿Quitar la muestra de este navegador?'))return;if(!save(type,[]))return;if(isDemand){requests=[];$('sort').value='population';}else userLoans=[];projectState();close();render();say('Muestra retirada.');};
}
async function main(){
 const names=['cantons','context','incomes','evidence','mortgages','streets'];const [geo,context,incomes,sales,mortgages,streetGeo]=await Promise.all(names.map(async n=>{const r=await fetch('./data/'+n+'.json');if(!r.ok)throw Error(n);return r.json();}));
 features=geo.features;inc=incomes;observed=sales;bank=mortgages;
 if(!featureAt(features,Number(project.lat),Number(project.lon)))project={...initialProject};
 projectState();selected=dest?.code??'0901';
 $('canton').innerHTML=features.slice().sort((a,b)=>a.properties.name.localeCompare(b.properties.name,'es')).map(f=>'<option value="'+f.properties.code+'">'+esc(f.properties.name)+'</option>').join('');$('canton').value=selected;
 mapInit(context,streetGeo);$('source-items').innerHTML=sourceHTML()+'<p class="mini">Distancia de referencia: línea recta del pin a un punto interior de cada cantón; se usa para exploración geográfica. La distancia de viaje depende de la red vial.</p>';render();
 $('layer').onchange=colorize;$('province').onchange=()=>{if(!withinProvince(byCode(selected))){selected=features.filter(withinProvince).sort((a,b)=>b.properties.population-a.properties.population)[0].properties.code;$('canton').value=selected;}fitRegion();render();};
 $('canton').onchange=e=>setSelection(e.target.value,true);$('all-map').onclick=()=>{fitRegion();};$('focus-project').onclick=projectFocus;$('p-link').onclick=projectFocus;
 $('rows').onclick=e=>{const b=e.target.closest('button[data-code]');if(b){setSelection(b.dataset.code,true);$('explorar').scrollIntoView({block:'start'});}};
 $('search').oninput=table;$('sort').onchange=table;$('edit').onclick=()=>settings();$('close').onclick=close;$('cancel-pick').onclick=()=>{stopPick();settings(pending);};$('finance-open').onclick=scenario;$('import-open').onclick=()=>imports();$('csv-out').onclick=exportData;
 infrastructure=await initInfrastructure({
   map, state:()=>({theme:$('layer').value,province:$('province').value,code:selected,features,project}),
   changeTheme:theme=>{$('layer').value=theme;colorize();},isPicking:()=>picking,fitRegion,selectCanton:code=>setSelection(code),download
 }).catch(error=>{console.warn('Capas de infraestructura:',error);$('infra-status').textContent='No se pudo iniciar el análisis. Recarga para reintentar.';return null;});
 if(infrastructure)colorize();
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&picking){stopPick();settings(pending);}});
}
main().catch(e=>{console.error(e);$('map').textContent='No se pudo cargar la cartografía. Recarga la página para reintentar.';});
