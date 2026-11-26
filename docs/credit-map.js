import {summarize,readParishLoans} from './credit-model.js';
import {normalize} from './model.js';

const $=id=>document.getElementById(id);
const integer=new Intl.NumberFormat('es-EC');
const usd=n=>'$'+integer.format(n);
const meanUSD=n=>new Intl.NumberFormat('es-EC',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}).format(n);
const palette={yes:'#137266',maybe:'#ecc781',no:'#becfca',missing:'#e6e8e6'};
const range=(a,b)=>a===b?integer.format(a):integer.format(a)+'–'+integer.format(b);

export function initCreditMap({map,features,parishCatalog,parishes,bankRow,state,redraw,fitRegion,selectCanton,download}){
  const canton=new Map(features.map(f=>[f.properties.code,f.properties]));
  const bank=features.flatMap(f=>{
    const v=bankRow(f);return v?[{code:f.properties.code,name:f.properties.name,groups:v.groups}]:[];
  });
  const localKey='atlasLitoral.v1.sepsHousing1';
  let seps;
  try{seps=JSON.parse(localStorage.getItem(localKey));}catch{}
  const mode=$('credit-level'),metric=$('credit-metric'),input=$('credit-limit');
  const pane=map.createPane('parish-credit');pane.style.zIndex=408;pane.style.pointerEvents='none';
  const strokes=L.geoJSON([],{pane:'parish-credit',interactive:false,style:f=>({
    color:'#6b8580',weight:.8,fillColor:palette[category(stats.get(f.properties.creditCode))],fillOpacity:.78
  })});
  const national=new Map((parishCatalog?.features||[]).map(f=>[f.properties.code,f]));
  let urban=[],geometries=new Map(),stats=new Map(),records=[],threshold=100000,paintKey='',revision=0;
  function category(s){
    if(!s)return 'missing';
    if(metric.value==='mean')return s.aboveMean?'yes':'no';
    return s.lower>0?'yes':s.upper>0?'maybe':'no';
  }
  function label(){
    return metric.value==='mean'?{yes:'Promedio superior',no:'Promedio igual o inferior',missing:'Sin dato'}
      :{yes:'Al menos uno confirmado',maybe:'Posible en cifras agrupadas',no:'Ninguno superior',missing:'Sin dato'};
  }
  function location(code){return canton.get(code.slice(0,4));}
  function dates(){return mode.value==='canton'?'ene–sep 2026':seps?.months.join(', ')||'';}
  function source(){return mode.value==='canton'?'Banca privada · SB':'Cooperativas y mutualistas · Archivo SEPS cargado';}
  function rebuild(){
    revision++;threshold=input.valueAsNumber;
    stats=new Map();geometries=new Map();
    const rows=mode.value==='canton'?bank:(seps?.rows||[]);
    if(!input.validity.valid||!Number.isFinite(threshold)){records=[];return;}
    records=rows.filter(row=>location(row.code)).map(row=>{
      const s=summarize(row.groups,threshold);stats.set(row.code,s);
      if(mode.value==='parish'){
        let f=national.get(row.code);
        if(!f && /^0901[0-4]\d$/.test(row.code))f=urban.find(u=>normalize(u.properties.name)===normalize(row.name));
        if(f)geometries.set(row.code,f);
      }
      return {...row,s};
    });
  }
  function visible(){return records.filter(r=>!state().province||location(r.code).province===state().province)
    .sort((a,b)=>metric.value==='mean'?b.s.mean-a.s.mean||b.s.n-a.s.n:b.s.lower-a.s.lower||b.s.n-a.s.n||a.name.localeCompare(b.name));}
  function list(){return visible().filter(r=>!$('credit-only').checked||category(r.s)==='yes');}
  function openArea(row){
    $('layer').value='credit';selectCanton(row.code.slice(0,4),mode.value==='canton');
    if(mode.value==='parish'){
      const f=geometries.get(row.code);
      if(f){parishes?.highlight(f);map.fitBounds(L.geoJSON(f).getBounds(),{padding:[22,22],maxZoom:15,animate:false});}
    }
    $('map').scrollIntoView({block:'center'});
  }
  function report(){
    const all=visible(),rows=list(),tbody=$('credit-rows'),valid=input.validity.valid&&Number.isFinite(threshold);
    const useParish=mode.value==='parish',ready=!useParish||!!seps;
    $('credit-data').hidden=!useParish;
    $('credit-project').hidden=!(state().project?.price>0);
    $('credit-map').disabled=!ready||!valid;
    $('credit-csv').disabled=!rows.length;
    $('credit-period').textContent=useParish?(seps?source()+' · '+seps.months.length+ (seps.months.length===1?' mes en el archivo · ':' meses en el archivo · ')+dates():'Sin cifras parroquiales cargadas.'):'Banca privada · Créditos originales inmobiliarios, VIS y VIP · Enero–septiembre de 2026.';
    $('credit-count').textContent=!valid?'Ingresa un monto entre $1 y $20.000.000.':!ready?'Carga el archivo mensual para comparar parroquias.':rows.length+' de '+all.length+' áreas con datos en la provincia o región seleccionada.';
    tbody.replaceChildren();
    for(const row of rows){
      const tr=tbody.insertRow(),geo=tr.insertCell(),p=location(row.code);
      if(!useParish || geometries.has(row.code)){
        const btn=document.createElement('button');btn.className='linkbutton';btn.textContent=row.name;btn.onclick=()=>openArea(row);geo.append(btn);
      }else geo.append(document.createTextNode(row.name+' · sin polígono vinculado'));
      const sub=document.createElement('small');sub.textContent=(useParish?p.name+' · ':'')+p.province+(state().projectCanton===p.code?' · Cantón del proyecto':'');geo.append(sub);
      for(const v of [integer.format(row.s.n),meanUSD(row.s.mean),range(row.s.lower,row.s.upper),row.s.mode||'Sin desglose completo'])tr.insertCell().textContent=v;
    }
    if(ready && valid && !rows.length){const cell=tbody.insertRow().insertCell();cell.colSpan=5;cell.textContent='Sin coincidencias con estos filtros.';}
  }
  function paint(){
    const {theme,province}=state(),active=theme==='credit';
    const key=[revision,theme,province,metric.value].join('|');
    if(key===paintKey)return;paintKey=key;
    if(map.hasLayer(strokes))map.removeLayer(strokes);strokes.clearLayers();
    if(!active||mode.value!=='parish')return;
    const shapes=visible().filter(r=>geometries.has(r.code)).map(r=>{
      const f=geometries.get(r.code);
      return {type:'Feature',properties:{creditCode:r.code},geometry:f.geometry};
    });
    // Draw smaller municipal polygons above the national cantonal seat.
    shapes.sort((a,b)=>Number(b.properties.creditCode.endsWith('50'))-Number(a.properties.creditCode.endsWith('50')));
    strokes.addData(shapes);strokes.addTo(map);
  }
  function legend(){
    $('legend-title').textContent=(mode.value==='canton'?'Cantón':'Parroquia')+' · Crédito > '+(Number.isFinite(threshold)?usd(threshold):'—');
    $('legend').replaceChildren();
    for(const [key,value] of Object.entries(label())){
      const span=document.createElement('span');span.className='key';const icon=document.createElement('i');
      icon.className='sw';icon.style.background=palette[key];span.append(icon,document.createTextNode(value));$('legend').append(span);
    }
    const edit=document.createElement('a');edit.href='#credito';edit.textContent='Cambiar umbral';$('legend').append(edit);
  }
  function refresh(){report();paint();}
  function apply(){rebuild();redraw();}
  input.oninput=apply;metric.onchange=apply;mode.onchange=apply;$('credit-only').onchange=report;
  $('credit-project').onclick=()=>{input.value=Math.round(state().project.price*(1-state().down/100));apply();};
  $('credit-map').onclick=()=>{$('layer').value='credit';redraw();fitRegion();$('map').scrollIntoView({block:'center'});};
  $('credit-file').onchange=async e=>{
    const file=e.target,files=[...file.files];if(!files.length)return;
    file.disabled=true;$('credit-import-status').textContent='Leyendo los archivos…';
    try{
      const next=await readParishLoans(files);seps=next;
      let msg='Datos cargados en este navegador.';
      try{localStorage.setItem(localKey,JSON.stringify(next));}catch{msg='Datos disponibles durante esta sesión.';}
      $('credit-import-status').textContent=msg;mode.value='parish';apply();
    }catch(error){$('credit-import-status').textContent=error.message;}
    finally{file.value='';file.disabled=false;}
  };
  $('credit-csv').onclick=()=>download('atlas_credito_por_destino.csv',[
    ['nivel','dpa','destino','provincia','fuente','periodo','umbral_usd_estricto','operaciones','monto_total_usd','media_usd','superiores_min','superiores_max','rango_mas_frecuente'],
    ...list().map(r=>[mode.value==='canton'?'Cantón':'Parroquia',r.code,r.name,location(r.code).province,source(),dates(),threshold,r.s.n,r.s.total/100,+(r.s.mean.toFixed(2)),r.s.lower,r.s.upper,r.s.mode])
  ]);
  rebuild();
  if(parishes)parishes.loadUrban().then(()=>{urban=parishes.urbanFeatures();if(mode.value==='parish')apply();});
  return {refresh,legend,fill:code=>mode.value==='canton'?palette[category(stats.get(code))]:palette.missing};
}
