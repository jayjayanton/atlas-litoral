import {distanceKm,median,normalize} from './model.js';

const $=id=>document.getElementById(id);
const title={published:'Precio publicado por el plantel',maximum:'Máximo autorizado'};
const palette=['#fff2c4','#ecbc80','#c67d79','#7b5487','#47345e'];
const bins=[0,100,250,500,800];
const brackets=['< $100','$100–<250','$250–<500','$500–<800','$800 o más'];
const usd=new Intl.NumberFormat('es-EC',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2});
const money=n=>Number.isFinite(n)?usd.format(n):'Sin dato';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const anchor=s=>'<a href="'+esc(s.url)+'" target="_blank" rel="noopener noreferrer">'+esc(s.label)+'</a>';
const priceColor=n=>Number.isFinite(n)?palette[bins.filter(x=>x<=n).length-1]:'#a2a5a4';

export function schoolCampuses(schools){
  const groups=new Map(),byId=new Map();
  for(const s of schools){
    if(!['Particular','Fiscomisional'].includes(s.sector)||!['09','24'].includes(s.code?.slice(0,2)))continue;
    const key=[s.code,normalize(s.name),s.lat,s.lon].join('|');
    if(!groups.has(key))groups.set(key,s);
    byId.set(s.id,groups.get(key));
  }
  return {all:[...groups.values()],byId};
}
export function feeSummary(rows){
  const prices=key=>new Map(rows.filter(r=>Number.isFinite(r[key])).map(r=>[r.amie,r[key]]));
  const monthly=prices('monthly'),enrollment=prices('enrollment');
  return {monthlyN:rows.filter(r=>Number.isFinite(r.monthly)).length,enrollmentN:rows.filter(r=>Number.isFinite(r.enrollment)).length,
    monthly:monthly.size>=3?median([...monthly.values()]):null,enrollment:enrollment.size>=3?median([...enrollment.values()]):null};
}
export function annualFee(r){
  return Number.isFinite(r.monthly)&&Number.isFinite(r.enrollment)&&Number.isInteger(r.installments)&&r.installments>0?r.enrollment+r.monthly*r.installments:null;
}
export function initSchoolFees({schools,data,map,state,changeTheme,selectCanton,fitRegion,download}){
  if(!data||!schools){$('fee-status').textContent='No se pudo cargar el inventario de tarifas. Recarga la página para reintentar.';return null;}
  const sierraSites=new Set(data.sierraSiteIds);
  const siteRegime=s=>sierraSites.has(s.id)?'sierra':'costa';
  const campusesByRegime=Object.fromEntries(['costa','sierra'].map(regime=>[regime,schoolCampuses(schools.filter(s=>siteRegime(s)===regime))]));
  const campuses=period=>campusesByRegime[data.regimes[period]];
  const options=(sel,items)=>sel.replaceChildren(...items.map(([value,label])=>new Option(label,value)));
  const periods=Object.entries(data.periods);
  options($('fee-period'),periods);
  const region=new Map(state().features.map(f=>[f.properties.code,f.properties.name]));
  options($('fee-canton'),[...region].sort((a,b)=>a[1].localeCompare(b[1],'es')));
  const allRows=data.rows.map(r=>({...r,site:campuses(r.period).byId.get(r.siteId)})).filter(r=>r.site&&data.sources[r.source]);
  const averages=new Map(data.cantons.map(r=>[r.code,r.meanMonthlyBachilleratoUSD]));
  let total;
  const pins=L.layerGroup().addTo(map);
  const pane=map.createPane('school-fees');pane.style.zIndex='485';
  let subset=[],bySite=new Map(),byCanton=new Map(),selection='',lastView='',lastPins='',filterKey='';
  function scope(){return [$('fee-period').value,$('fee-basis').value,$('fee-grade').value];}
  function setBasis(){
    const old=$('fee-basis').value;
    const itemRows=allRows.filter(r=>r.period===$('fee-period').value);
    const keys=Object.keys(title).filter(b=>itemRows.some(r=>r.basis===b));
    options($('fee-basis'),keys.map(b=>[b,title[b]]));
    if(keys.includes(old))$('fee-basis').value=old;
  }
  function rebuild(){
    const [period,basis,grade]=scope();filterKey=scope().join('|');
    total=new Map();
    for(const s of campuses(period).all)total.set(s.code,(total.get(s.code)||0)+1);
    subset=allRows.filter(r=>r.period===period&&r.basis===basis&&r.grades.includes(grade));
    bySite=new Map(subset.map(r=>[r.site.id,r]));
    byCanton=new Map();
    for(const r of subset){
      if(!byCanton.has(r.site.code))byCanton.set(r.site.code,[]);
      byCanton.get(r.site.code).push(r);
    }
    lastView='';lastPins='';selection='';map.closePopup();
    changeTheme(state().theme);
  }
  function facts(r){
    const yearly=annualFee(r),source=data.sources[r.source];
    return '<p class="fee-facts">Pensión mensual <b>'+money(r.monthly)+'</b> · Matrícula <b>'+money(r.enrollment)+'</b></p>'+
      (yearly===null?'':'<p class="fee-facts"><b>'+money(yearly)+'</b> por estudiante al año · matrícula + '+r.installments+' pensiones. Equivale a '+money(yearly/12)+' mensuales al distribuir el gasto en 12 meses.</p>')+
      '<small>'+esc(r.label)+' · '+esc(title[r.basis])+' · '+esc(data.periods[r.period])+' · AMIE '+esc(r.amie)+'</small><br>'+anchor(source)+(r.note?'<p class="mini">'+esc(r.note)+'</p>':'');
  }
  function popup(s){
    if(!region.has(s.code)){
      const point=data.buffer[s.id],[period,basis,grade]=scope();
      const value=point&&point.levels.find(x=>x.grades.includes(grade));
      if(value&&period!=='coast2627'&&point.regime===data.regimes[period]&&basis==='maximum')return facts({...value,source:data.ministrySource,amie:point.amie,basis,period});
      return '<small>Zona exterior · sin tarifa para la selección.</small>';
    }
    const campus=campuses($('fee-period').value).byId.get(s.id),r=campus&&bySite.get(campus.id);
    if(r)return '<div class="fee-popup">'+facts(r)+'</div>';
    return '<small>'+esc(!['Particular','Fiscomisional'].includes(s.sector)?'Fuera del inventario de tarifas particulares y fiscomisionales.':'Sin tarifa documentada para los filtros seleccionados.')+'</small>';
  }
  function refreshPins(){
    const {theme,province,features}=state(),key=[theme,province,filterKey].join('|');
    if(lastPins===key)return;
    lastPins=key;pins.clearLayers();
    if(theme!=='fees')return;
    const codes=new Set(features.filter(f=>!province||f.properties.province===province).map(f=>f.properties.code));
    for(const r of subset){
      const s=r.site;if(!codes.has(s.code))continue;
      const icon=L.divIcon({className:'',html:'<span class="fee-dot" style="background:'+priceColor(r.monthly)+'"></span>',iconSize:[17,17],iconAnchor:[8,8]});
      const pin=L.marker([s.lat,s.lon],{pane:'school-fees',icon,title:s.name+' · '+money(r.monthly),keyboard:true}).addTo(pins);
      pin.on('click',()=>{
        selectCanton(s.code);selection=s.id;$('fee-school').value=s.id;showBudget();
        L.popup({maxHeight:255}).setLatLng([s.lat,s.lon]).setContent('<b>'+esc(s.name)+'</b>'+facts(r)).openOn(map);
      });
    }
  }
  function showBudget(){
    const r=bySite.get(selection);
    if(!r){$('fee-budget').textContent='Sin planteles con tarifa documentada para esta selección.';return;}
    const project=state().project;
    const km=distanceKm(project.lat,project.lon,[r.site.lon,r.site.lat]);
    $('fee-budget').innerHTML=facts(r)+'<p class="mini">'+esc(new Intl.NumberFormat('es-EC',{maximumFractionDigits:2}).format(km))+' km en línea recta desde '+esc(project.name)+'.</p>';
  }
  function refresh(){
    refreshPins();
    const {code,project}=state(),key=[code,project.lat,project.lon,project.name,filterKey].join('|');
    if(lastView===key)return;
    lastView=key;
    const rows=(byCanton.get(code)||[]).slice();
    rows.sort((a,b)=>distanceKm(project.lat,project.lon,[a.site.lon,a.site.lat])-distanceKm(project.lat,project.lon,[b.site.lon,b.site.lat])||a.site.name.localeCompare(b.site.name,'es'));
    const st=feeSummary(rows);
    const average=averages.get(code);
    $('fee-reference').textContent=region.get(code)+' · '+(Number.isFinite(average)?money(average)+' de pensión mensual promedio.':'sin promedio publicado.')+' Corte de mayo de 2026 · Ministerio de Educación, vía PRIMICIAS.';
    $('fee-canton').value=code;$('fee-area').textContent=region.get(code);
    $('fee-monthly').textContent=Number.isFinite(st.monthly)?money(st.monthly):'—';
    $('fee-registration').textContent=Number.isFinite(st.enrollment)?money(st.enrollment):'—';
    $('fee-coverage').textContent=st.monthlyN+' con pensión y '+st.enrollmentN+' con matrícula entre '+(total.get(code)||0)+' sedes de referencia. Las medianas requieren tres instituciones con importes comparables.';
    options($('fee-school'),rows.length?rows.map(r=>[r.site.id,r.site.name]):[['','Sin tarifas en la selección']]);
    if(!rows.some(r=>r.site.id===selection))selection=rows[0]?.site.id||'';
    $('fee-school').value=selection;$('fee-school').disabled=!rows.length;showBudget();
    $('fee-rows').innerHTML=[...region].sort((a,b)=>a[1].localeCompare(b[1],'es')).map(([c,name])=>{
      const v=feeSummary(byCanton.get(c)||[]);
      return '<tr><td>'+esc(name)+'</td><td>'+(total.get(c)||0)+'</td><td>'+v.monthlyN+'</td><td>'+ (v.monthly===null?'—':money(v.monthly))+'</td><td>'+v.enrollmentN+'</td><td>'+(v.enrollment===null?'—':money(v.enrollment))+'</td><td>'+money(averages.get(c))+'</td></tr>';
    }).join('');
  }
  function legend(theme){
    const regional=theme==='regional-fees';
    $('legend-title').textContent=regional?'Promedio cantonal · bachillerato · mayo 2026':'Pensión mensual por plantel · USD';
    $('legend').innerHTML=[...brackets.map((s,i)=>[palette[i],s]),[regional?'#e3e7e3':'#a2a5a4',regional?'Sin dato':'Solo matrícula']].map(([c,s])=>'<span class="key"><i class="sw" style="background:'+c+'"></i>'+s+'</span>').join('');
  }
  $('fee-period').onchange=()=>{setBasis();if($('fee-period').value==='coast2627')$('fee-basis').value='published';rebuild();};
  $('fee-grade').onchange=$('fee-basis').onchange=rebuild;
  $('fee-canton').onchange=()=>selectCanton($('fee-canton').value);
  $('fee-school').onchange=()=>{selection=$('fee-school').value;showBudget();};
  $('fee-download').onclick=()=>{
    const header=['id_sede','amie','institucion','canton_dpa','canton','latitud','longitud','periodo_o_corte','grado_de_referencia','nivel_en_fuente','tipo_tarifa','pension_mensual_usd','matricula_usd','cuotas_documentadas','total_anual_usd','fuente','url','observacion'];
    const grade=$('fee-grade').selectedOptions[0].textContent;
    download('atlas_litoral_tarifas_escolares.csv',[header,...subset.map(r=>[r.site.id,r.amie,r.site.name,r.site.code,region.get(r.site.code),r.site.lat,r.site.lon,data.periods[r.period],grade,r.label,title[r.basis],r.monthly,r.enrollment,r.installments,annualFee(r),data.sources[r.source].label,data.sources[r.source].url,r.note])]);
  };
  $('fee-reg-download').onclick=()=>{
    const scopeLabels=[$('fee-period').selectedOptions[0].textContent,$('fee-grade').selectedOptions[0].textContent,title[$('fee-basis').value]];
    download('atlas_litoral_comparacion_escolar.csv',[['dpa','canton','periodo_o_corte','grado','tipo_tarifa','sedes_referencia','con_pension','mediana_pension_usd','con_matricula','mediana_matricula_usd','promedio_bachillerato_mayo_2026_usd','fuente_promedio'],...[...region].map(([c,n])=>{const v=feeSummary(byCanton.get(c)||[]);return [c,n,...scopeLabels,total.get(c)||0,v.monthlyN,v.monthly,v.enrollmentN,v.enrollment,averages.get(c),data.regionalSource];})]);
  };
  $('regional-fee-opt').disabled=false;
  $('fee-region-map').onclick=()=>{changeTheme('regional-fees');fitRegion();$('explorar').scrollIntoView({block:'start'});};
  $('fee-map').onclick=()=>{changeTheme('fees');fitRegion();$('explorar').scrollIntoView({block:'start'});};
  $('fee-opt').disabled=$('fee-map').disabled=!allRows.length;
  $('fee-status').hidden=true;$('fee-content').hidden=false;
  setBasis();rebuild();refresh();
  return {refresh,legend,popup,regionalColor:code=>Number.isFinite(averages.get(code))?priceColor(averages.get(code)):'#e3e7e3'};
}
