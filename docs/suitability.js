import {surfaceLegend} from './score-surface.js';
import {countInRadius,buildDensityGrid,isValidWeights,presets,suitabilityScore} from './suitability-model.js';
import {distanceKm} from './model.js';

const $=id=>document.getElementById(id);
const labels=['Densidad de escuelas','Densidad de hospitales','Cercanía a vías'];
const storageKey='atlasLitoral.density.v1';
const number=new Intl.NumberFormat('es-EC',{maximumFractionDigits:2});
const scoreFormat=new Intl.NumberFormat('es-EC',{maximumFractionDigits:1});
const show=n=>Number.isFinite(n)?number.format(n):'Sin dato';
const showScore=n=>Number.isFinite(n)?scoreFormat.format(n):'—';
const densityDisplay=(n,area)=>Number.isFinite(n)?show(n/area):'Sin dato';
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function initSuitability({map,state,changeTheme,selectCanton,grid,density,schools,hospitals,roadDistance,download,surface}){
  if(!grid||!density){$('suit-status').textContent='No se pudo cargar la malla de aptitud.';return null;}
  const {cells,maxima}=buildDensityGrid(grid,density);
  const regions=new Map(state().features.map(f=>[f.properties.code,f]));
  const col=Object.fromEntries(density.columns.map((key,i)=>[key,i]));
  const scopeSelect=$('suit-scope'),radiusSelect=$('suit-radius'),limitInput=$('suit-road-limit'),zone=$('suit-area'),preset=$('suit-preset');
  const store=(()=>{try{return JSON.parse(localStorage.getItem(storageKey));}catch{return null;}})();
  const weights=isValidWeights(store?.weights)?[...store.weights]:[...presets.balanced];
  if(density.radiiKm.includes(store?.radius))radiusSelect.value=String(store.radius);
  if(['all','public','private'].includes(store?.scope))scopeSelect.value=store.scope;
  if(Number.isFinite(store?.limit)&&store.limit>=.1&&store.limit<=200)limitInput.value=store.limit;

  $('suit-weights').innerHTML=labels.map((label,i)=>'<div class="suit-weight"><label for="suit-w-'+i+'">'+label+'</label><input type="range" min="0" max="100" step="1" id="suit-slide-'+i+'" aria-label="Deslizador de '+label+'"><input type="number" min="0" max="100" step="1" id="suit-w-'+i+'" aria-label="Peso de '+label+'"><output id="suit-share-'+i+'" aria-label="Peso normalizado de '+label+'"></output></div>').join('');
  const roadsAtPin=new Map(),countsAtPin=new Map();
  let areaProvince=null,seriesKey=null,mapKey=null,projectKey=null,ranking=[],pendingFrame=0;
  let radius,scope,roadLimit,ri,hcol,valid,area;

  function synchronizeArea(province){
    if(areaProvince===province)return;
    const old=zone.value;areaProvince=province;
    const fs=state().features.filter(f=>!province||f.properties.province===province)
      .sort((a,b)=>a.properties.name.localeCompare(b.properties.name,'es'));
    zone.replaceChildren(new Option(province?'Toda la provincia · '+province:'Guayas y Santa Elena',''),
      ...fs.map(f=>new Option(f.properties.name,f.properties.code)));
    if(fs.some(f=>f.properties.code===old))zone.value=old;
  }
  function readControls(){
    radius=Number(radiusSelect.value);scope=scopeSelect.value;roadLimit=limitInput.valueAsNumber;
    ri=density.radiiKm.indexOf(radius);hcol=col[scope];area=Math.PI*radius*radius;
    valid=ri>=0&&hcol!==undefined&&isValidWeights(weights)&&Number.isFinite(roadLimit)&&roadLimit>=.1&&roadLimit<=200;
    const sum=weights.reduce((a,b)=>a+b,0);
    labels.forEach((_,i)=>{$('suit-share-'+i).textContent=isValidWeights(weights)?show(100*weights[i]/sum)+' %':'—';});
    preset.value=Object.keys(presets).find(k=>presets[k].every((v,i)=>weights[i]===v))||'custom';
    $('suit-message').textContent=valid?'':'Usa pesos entre 0 y 100 con al menos uno positivo y un límite vial entre 0,1 y 200 km.';
    $('suit-export').disabled=$('suit-map').disabled=!valid;
    if(valid){try{localStorage.setItem(storageKey,JSON.stringify({weights,scope,radius,limit:roadLimit}));}catch{}}
  }
  function score(s,h,d){
    return suitabilityScore(s,h,d,maxima[ri][col.school],maxima[ri][hcol],roadLimit,weights);
  }
  function buildRanking(province){
    if(!valid)return [];
    const result=[];
    for(const [index,c] of cells.entries()){
      if(zone.value&&c.code!==zone.value)continue;
      if(province&&regions.get(c.code).properties.province!==province)continue;
      const s=c.counts[ri][col.school],h=c.counts[ri][hcol],value=score(s,h,c.roadKm);
      if(value!==null)result.push({cell:c,index,s,h,value});
    }
    return result.sort((a,b)=>b.value-a.value||a.cell.code.localeCompare(b.cell.code)||a.cell.lat-b.cell.lat||a.cell.lon-b.cell.lon);
  }
  function projectSummary(project){
    $('suit-pin-name').textContent=project.name;
    if(!state().projectInCoverage){$('suit-score').textContent='—';$('suit-pin-facts').textContent='Edificio fuera de la cobertura de Guayas y Santa Elena.';return;}
    if(!valid){$('suit-score').textContent='—';$('suit-pin-facts').textContent='Ajusta los parámetros del escenario.';return;}
    const coord=project.lat+','+project.lon;
    const key=[coord,radius,scope].join('|');
    if(!countsAtPin.has(key)){
      if(countsAtPin.size>=36)countsAtPin.clear();
      countsAtPin.set(key,[countInRadius(project.lat,project.lon,schools,radius),countInRadius(project.lat,project.lon,hospitals,radius,scope)]);
    }
    if(!roadsAtPin.has(coord)){if(roadsAtPin.size>=12)roadsAtPin.clear();roadsAtPin.set(coord,roadDistance(project));}
    const [s,h]=countsAtPin.get(key),d=roadsAtPin.get(coord);
    $('suit-score').textContent=showScore(score(s,h,d));
    $('suit-pin-facts').innerHTML='<p>'+ (project.reference?'Acceso aproximado a Torres del Salado':'Pin del proyecto')+' · radio de '+radius+' km</p><ul class="suit-parts"><li><b>'+show(s)+' escuelas</b> · '+densityDisplay(s,area)+' por km²</li><li><b>'+show(h)+' hospitales</b> · '+densityDisplay(h,area)+' por km²</li><li><b>Vía principal</b> · '+show(d)+' km en línea recta</li></ul>';
  }
  function rankTable(){
    $('suit-count').textContent=valid?'Se muestran '+Math.min(5,ranking.length)+' de '+number.format(ranking.length)+' puntos de la malla. Cada punto abre su ubicación en el mapa.':'';
    $('suit-top').innerHTML=ranking.slice(0,5).map(({cell:c,s,h,value},i)=>{
      const name=regions.get(c.code).properties.name;
      return '<tr><td><button data-ranking="'+i+'" class="linkbutton">Ver punto '+(i+1)+' · '+escape(name)+'</button><span class="suit-coord">'+c.lat.toFixed(4)+', '+c.lon.toFixed(4)+'</span></td><td><strong>'+showScore(value)+'</strong></td><td>'+s+'</td><td>'+h+'</td><td>'+show(c.roadKm)+' km</td></tr>';
    }).join('')||'<tr><td colspan="5">Sin resultados para la selección.</td></tr>';
  }
  function draw(){
    if(!valid||state().theme!=='suitability'){surface.clear('suitability');return;}
    const scores=new Array(cells.length),codes=new Set();
    for(const r of ranking){scores[r.index]=r.value;codes.add(r.cell.code);}
    surface.draw('suitability',scores,codes);
  }
  function refresh(){
    const {province,theme,project}=state();
    synchronizeArea(province);
    const scenario=[radius,scope,roadLimit,weights.join(','),zone.value,province].join('|');
    if(seriesKey!==scenario){
      seriesKey=scenario;ranking=buildRanking(province);rankTable();
    }
    const pinKey=[scenario,project.lat,project.lon,project.name,project.reference].join('|');
    if(projectKey!==pinKey){projectKey=pinKey;projectSummary(project);}
    const target=theme==='suitability'?scenario:'hidden';
    if(mapKey!==target){mapKey=target;draw();}
  }
  function showPoint(r){
    const c=r.cell;
    L.popup().setLatLng([c.lat,c.lon]).setContent('<b>'+escape(regions.get(c.code).properties.name)+' · muestra de la malla · '+showScore(r.value)+'/100</b><br>Radio de '+radius+' km<br>Escuelas: '+r.s+' ('+densityDisplay(r.s,area)+'/km²)<br>Hospitales: '+r.h+' ('+densityDisplay(r.h,area)+'/km²)<br>Vía principal: '+show(c.roadKm)+' km').openOn(map);
  }
  function inspect(ll){
    if(!valid)return;
    let near=null,nearest=grid.spacingKm*.72;
    for(const r of ranking){
      if(Math.abs(r.cell.lat-ll.lat)>.03||Math.abs(r.cell.lon-ll.lng)>.03)continue;
      const d=distanceKm(ll.lat,ll.lng,[r.cell.lon,r.cell.lat]);
      if(d<=nearest){nearest=d;near=r;}
    }
    if(near)showPoint(near);
  }
  function legend(){
    surfaceLegend('Aptitud ponderada · 0–100');
  }
  function update(){
    if(pendingFrame){cancelAnimationFrame(pendingFrame);pendingFrame=0;}
    readControls();map.closePopup();refresh();
  }
  function updateOnFrame(){
    if(!pendingFrame)pendingFrame=requestAnimationFrame(()=>{pendingFrame=0;update();});
  }
  labels.forEach((_,i)=>{
    const field=$('suit-w-'+i),slider=$('suit-slide-'+i);
    field.value=slider.value=weights[i];
    slider.oninput=()=>{weights[i]=Number(slider.value);field.value=slider.value;updateOnFrame();};
    field.oninput=()=>{
      weights[i]=field.valueAsNumber;
      if(Number.isFinite(weights[i])&&weights[i]>=0&&weights[i]<=100)slider.value=field.value;
      update();
    };
  });
  preset.onchange=()=>{
    const values=presets[preset.value];
    if(!values)return;
    values.forEach((v,i)=>{weights[i]=v;$('suit-w-'+i).value=$('suit-slide-'+i).value=v;});
    update();
  };
  scopeSelect.onchange=radiusSelect.onchange=zone.onchange=update;limitInput.oninput=update;
  $('suit-map').onclick=()=>{
    changeTheme('suitability');
    const group=state().features.filter(f=>(!zone.value||f.properties.code===zone.value)&&(!state().province||f.properties.province===state().province));
    map.fitBounds(L.geoJSON(group).getBounds(),{padding:[12,12],maxZoom:11});
    $('explorar').scrollIntoView({block:'start'});
  };
  $('suit-top').onclick=event=>{
    const button=event.target.closest('button[data-ranking]');if(!button)return;
    const r=ranking[Number(button.dataset.ranking)];if(!r)return;
    changeTheme('suitability');selectCanton(r.cell.code);
    map.setView([r.cell.lat,r.cell.lon],11);showPoint(r);$('explorar').scrollIntoView({block:'start'});
  };
  $('suit-export').onclick=()=>{
    const sums=weights.reduce((a,b)=>a+b,0);
    const heads=['rango','dpa','canton','latitud','longitud','aptitud_0_100','escuelas_en_radio','hospitales_en_radio','escuelas_por_km2','hospitales_por_km2','distancia_via_km','radio_km','red_hospitalaria','limite_vial_km','peso_escuelas_pct','peso_hospitales_pct','peso_vias_pct','max_escuelas_regional_en_radio','max_hospitales_regional_en_radio'];
    download('atlas_litoral_aptitud_ponderada.csv',[heads,...ranking.map(({cell:c,s,h,value},i)=>[
      i+1,c.code,regions.get(c.code).properties.name,c.lat,c.lon,Number(value.toFixed(4)),s,h,Number((s/area).toFixed(5)),Number((h/area).toFixed(5)),c.roadKm,radius,scopeSelect.selectedOptions[0].textContent,roadLimit,...weights.map(w=>Number((100*w/sums).toFixed(4))),maxima[ri][col.school],maxima[ri][hcol]
    ])]);
  };
  $('suit-opt').disabled=false;$('suit-body').hidden=false;$('suit-status').textContent='';
  readControls();refresh();
  return {refresh,legend,inspect};
}
