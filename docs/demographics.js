import {readCompressedJSON} from './compressed-json.js';

const $ = id => document.getElementById(id);
const number = new Intl.NumberFormat('es-EC');
const percent = new Intl.NumberFormat('es-EC',{style:'percent',maximumFractionDigits:2});
const palette = ['#e9f1cf','#b3d99b','#6ebca0','#2c8887','#134b65'];
const presets = {working:[25,45],older:[60,120],sixty:[60,60],all:[0,120]};
const levels = {canton:'Cantones',parish:'Parroquias censales',zone:'Zonas censales',sector:'Sectores censales'};
const provinces = {'09':'Guayas','24':'Santa Elena'};
const query = new URLSearchParams(location.search);
const pageSize = 15;

function offsets(series){
  const cumulative=new Uint32Array(122);
  for(let age=0;age<=120;age++) cumulative[age+1]=cumulative[age]+(series[age]||0);
  return cumulative;
}

export function initDemographics({map,data,cantons,parishCatalog,index,state,colorize}){
  const cantonShapes=new Map(cantons.map(f=>[f.properties.code,f]));
  const parishShapes=new Map(parishCatalog.features.map(f=>[f.properties.code,f]));
  const all=new Map();
  for(const [code,ages] of Object.entries(data.agesByDpa)){
    const sums=offsets(ages),parent=code.slice(0,4);
    all.set(code,sums);
    if(!all.has(parent))all.set(parent,new Uint32Array(122));
    sums.forEach((n,i)=>{all.get(parent)[i]+=n;});
  }
  const pane=map.createPane('age-concentration');pane.style.zIndex=409;pane.style.pointerEvents='none';
  const renderer=L.canvas({pane:'age-concentration',padding:.1});
  const overlay=L.layerGroup(),zoneIndex=Object.entries(index?.zones||{});
  const ageTasks=new Map(), forms=[$('cohort-map-fields'),$('cohort-tool-fields')];
  const config={from:'25',to:'45',preset:'working',metric:'share',scope:'',minimum:'0'};
  let preferred='sector',lastProvince=state().province,applyingScope=false;
  let page=0,stats=null,statsKey='',error='',paintKey='',paintRevision=0,paintError='';
  function name(code){
    if(code.length===4)return cantonShapes.get(code)?.properties.name||code;
    const parish=parishShapes.get(code.slice(0,6))?.properties;
    if(code.length===6)return parish?.name||code;
    return (code.length===9?'Zona '+code.slice(6):'Sector '+code.slice(9)+' · Zona '+code.slice(6,9))+' · '+(parish?.name||code.slice(0,6));
  }
  const availableScopes=new Map([['','Ambas provincias'],...Object.entries(provinces)]);
  for(const f of [...cantons].sort((a,b)=>a.properties.name.localeCompare(b.properties.name,'es')))availableScopes.set(f.properties.code,f.properties.name);
  function level(){return state().theme==='ages'?state().territory?.level||preferred:preferred;}
  function agesValid(){
    const lo=Number(config.from),hi=config.to===''?120:Number(config.to);
    return config.from!==''&&Number.isInteger(lo)&&Number.isInteger(hi)&&lo>=0&&lo<=hi&&hi<=120;
  }
  function fieldsValid(){
    return agesValid()&&Number.isSafeInteger(Number(config.minimum))&&Number(config.minimum)>=0;
  }
  function band(){return config.from+'–'+(config.to||'120')+' años';}
  function sync(){
    for(const form of forms)for(const el of form.querySelectorAll('[data-field]')){
      const value=config[el.dataset.field];
      if(el.value!==value)el.value=value;
    }
    $('age-level').value=level();
  }
  function frameScope(zoom=true){
    applyingScope=true;
    try{
      const p=provinces[config.scope.slice(0,2)]||'';
      if($('province').value!==p){$('province').value=p;$('province').dispatchEvent(new Event('change'));}
      if(!zoom)return;
      const region=config.scope.length===4?[cantonShapes.get(config.scope)]:cantons.filter(f=>!p||f.properties.province===p);
      map.fitBounds(L.geoJSON(region).getBounds(),{padding:[18,18],maxZoom:13,animate:false});
    }finally{lastProvince=state().province;applyingScope=false;}
  }
  function activate(kind,frame=false){
    const t=state().territory;
    if(!t)return;
    if(!state().sectors&&(kind==='sector'||kind==='zone'))kind='parish';
    $('layer').value='ages';preferred=kind;
    if(t.level!==kind)t.browse(kind);
    if(frame)frameScope();
    colorize();
  }
  function setField(el){
    const key=el.dataset.field;config[key]=el.value;
    if(key==='preset'&&presets[el.value]){
      const [a,b]=presets[el.value];config.from=String(a);config.to=b===120?'':String(b);
    }else if(key==='from'||key==='to')config.preset='custom';
    if(key==='scope'&&state().theme==='ages')frameScope();
    refresh();
  }
  for(const form of forms){
    form.append($('cohort-form').content.cloneNode(true));
    const scope=form.querySelector('[data-field="scope"]');
    for(const [id,label] of availableScopes){
      const opt=new Option(id.length===4?'Cantón '+label:label,id);scope.add(opt);
    }
    for(const el of form.querySelectorAll('[data-field]')){
      el.addEventListener(el.tagName==='INPUT'?'input':'change',()=>setField(el));
    }
  }
  function loadAges(province){
    if(!ageTasks.has(province)){
      const task=readCompressedJSON('./data/sector-ages/'+province+'.json.gz')
        .then(raw=>Object.entries(raw).map(([code,series])=>[code,offsets(series)]))
        .catch(e=>{ageTasks.delete(province);throw e;});
      ageTasks.set(province,task);
    }
    return ageTasks.get(province);
  }
  async function calculate(kind,scope,lo,hi,metric,minimum){
    const areas=new Map();
    function add(code,sums){
      if(!code.startsWith(scope))return;
      const n=sums[hi+1]-sums[lo],total=sums[121];
      const id=kind==='zone'?code.slice(0,9):code;
      const row=areas.get(id)||{code:id,n:0,total:0};
      row.n+=n;row.total+=total;areas.set(id,row);
    }
    if(kind==='sector'||kind==='zone'){
      const rows=await Promise.all(Object.keys(provinces).filter(p=>!scope||scope.startsWith(p)).map(loadAges));
      for(const batch of rows)for(const [id,sums] of batch)add(id,sums);
    }else{
      for(const [id,sums] of all)if(id.length===(kind==='canton'?4:6))add(id,sums);
    }
    for(const row of areas.values()){
      row.share=row.total?row.n/row.total:null;
      row.value=row.n<minimum?null:(metric==='count'?row.n:row.share);
    }
    const sorted=[...areas.values()].filter(r=>r.value!==null).sort((a,b)=>b.value-a.value||b.n-a.n||a.code.localeCompare(b.code));
    const ascending=sorted.map(r=>r.value).reverse();
    const max=ascending.at(-1),cuts=[...new Set([1,2,3,4].map(i=>ascending[Math.ceil(ascending.length*i/5)-1]))].filter(v=>v<max);
    return {areas,sorted,cuts,max,kind,scope};
  }
  const bin=v=>stats.cuts.filter(edge=>v>edge).length;
  const color=i=>palette[stats.max===0?0:stats.cuts.length?Math.round(i*4/stats.cuts.length):2];
  function format(v){return config.metric==='count'?number.format(v):percent.format(v);}
  function detail(){
    const {theme,territory,code}=state(),kind=level();
    const id=territory?.current?.code||(kind==='canton'?code:'');
    $('cohort-profile').hidden=theme!=='ages'||!id;
    if(theme!=='ages'||!id)return;
    const r=stats?.areas.get(id);
    $('cohort-profile-title').textContent='Residentes de '+band();
    $('cohort-profile-value').textContent=r?number.format(r.n)+' de '+number.format(r.total)+' residentes · '+(r.share===null?'Sin porcentaje':percent.format(r.share))+(r.n<Number(config.minimum)?' · Por debajo del mínimo.':''):!fieldsValid()?'Revisa el rango de edad.':error||(!stats?'Cargando…':'Sin datos para esta área en la comparación.');
  }
  function table(){
    const list=$('age-ranking');list.replaceChildren();
    const leaders=$('cohort-leaders-list');leaders.replaceChildren();
    $('cohort-leaders').hidden=state().theme!=='ages'||!stats?.sorted.length;
    $('age-results').hidden=!stats;
    if(!stats)return;
    const pages=Math.ceil(stats.sorted.length/pageSize);
    page=Math.min(page,Math.max(0,pages-1));
    $('age-rank-title').textContent=levels[stats.kind]+' con mayor '+(config.metric==='count'?'número':'porcentaje')+' de residentes de '+band();
    $('age-rank-note').textContent=number.format(stats.sorted.length)+' áreas comparadas · '+availableScopes.get(stats.scope)+'. Selecciona un área para ubicarla en el mapa.';
    $('cohort-leaders-title').textContent=(config.metric==='count'?'Más residentes de ':'Mayor porcentaje de residentes de ')+band();
    for(const row of stats.sorted.slice(0,3)){
      const li=document.createElement('li'),btn=document.createElement('button'),info=document.createElement('small');
      btn.type='button';btn.className='linkbutton';btn.dataset.code=row.code;btn.textContent=name(row.code);
      info.textContent=number.format(row.n)+' de '+number.format(row.total)+' residentes · '+(row.share===null?'—':percent.format(row.share));
      li.append(btn,info);leaders.append(li);
    }
    for(const row of stats.sorted.slice(page*pageSize,(page+1)*pageSize)){
      const tr=list.insertRow(),cell=tr.insertCell(),button=document.createElement('button'),meta=document.createElement('small');
      button.type='button';button.className='linkbutton';button.dataset.code=row.code;button.textContent=name(row.code);
      meta.textContent=row.code+(row.code.length>4?' · '+name(row.code.slice(0,4)):'');
      cell.append(button,meta);
      for(const v of [number.format(row.n),number.format(row.total),row.share===null?'—':percent.format(row.share)])tr.insertCell().textContent=v;
    }
    $('age-prev').disabled=!page;$('age-next').disabled=page+1>=pages;
    $('age-page').textContent=pages?'Página '+(page+1)+' de '+number.format(pages):'Sin áreas con datos';
  }
  function legend(){
    if(state().theme!=='ages')return;
    $('legend-title').textContent=(config.metric==='count'?'Número':'Porcentaje')+' de residentes de '+band();
    const list=$('legend');list.replaceChildren();
    if(stats?.sorted.length){
      [ ...stats.cuts,stats.max ].forEach((edge,i)=>{
        const key=document.createElement('span'),sw=document.createElement('i');
        sw.className='sw';sw.style.background=color(i);key.className='key';
        const label=stats.cuts.length?(i?'> '+format(stats.cuts[i-1])+' a '+format(edge):'Hasta '+format(edge)):format(edge);
        key.append(sw,label);list.append(key);
      });
    }
    if(!stats?.sorted.length||paintError)list.append(paintError||message());
    else if(Number(config.minimum)>0||config.scope)list.append('Gris: fuera del filtro o sin dato.');
    const link=document.createElement('a');link.href='#demografia';link.textContent='Comparar áreas';list.append(link);
  }
  function message(){
    if(!agesValid())return 'Indica edades enteras entre 0 y 120. La edad final debe ser igual o mayor que la inicial.';
    if(!fieldsValid())return 'El mínimo de residentes debe ser un número entero mayor o igual a cero.';
    if(error)return error;
    if(!stats)return 'Cargando conteos censales…';
    if(!stats.sorted.length)return 'Ninguna área cumple los filtros elegidos.';
    return levels[stats.kind]+' · '+availableScopes.get(stats.scope)+' · '+number.format(stats.sorted.length)+' áreas. Color más oscuro = mayor '+(config.metric==='count'?'número':'porcentaje')+' del grupo.';
  }
  function updateInfo(){
    const msg=message();
    $('cohort-map-note').textContent=msg;
    $('age-warning').textContent=error||!fieldsValid()||!stats?msg:'';
    $('age-map').disabled=!fieldsValid();
    detail();legend();
  }
  async function paint(){
    const {theme,territory,sectors}=state(),view=map.getBounds();
    const key=[theme,statsKey,!!stats,view.toBBoxString(),map.getZoom()].join('|');
    if(key===paintKey)return;
    paintKey=key;
    const ticket=++paintRevision;
    overlay.clearLayers();
    if(theme!=='ages'||!stats){overlay.remove();return;}
    const snapshot=stats,{kind,scope}=snapshot;
    const grouped=Array.from({length:stats.cuts.length+1},()=>[]);
    function collect(id,parts){
      const v=snapshot.areas.get(id)?.value;
      if(v!=null)grouped[bin(v)].push(...parts);
    }
    try{
      if(kind==='zone'||kind==='sector'){
        const visible=zoneIndex.filter(([z,[,s,w,n,e]])=>z.startsWith(scope)&&view.intersects([[s,w],[n,e]]));
        if(kind==='zone'){
          const outlines=await territory.zoneOutlines();
          if(ticket!==paintRevision)return;
          for(const [z] of visible)collect(z,outlines[z]);
        }else{
          const batches=await Promise.all(visible.map(async ([z])=>[z,await sectors.readZone(z)]));
          if(ticket!==paintRevision)return;
          for(const [z,rows] of batches)for(const [suffix,,rings] of rows)collect(z+suffix,rings);
        }
      }else{
        for(const [id,f] of kind==='canton'?cantonShapes:parishShapes){
          if(!snapshot.areas.has(id))continue;
          const depth=f.geometry.type==='Polygon'?1:2,parts=L.GeoJSON.coordsToLatLngs(f.geometry.coordinates,depth);
          collect(id,depth===1?[parts]:parts);
        }
      }
      const stroke=kind==='parish'||kind==='zone'||(kind==='sector'&&map.getZoom()>=13);
      grouped.forEach((parts,i)=>{
        if(parts.length)L.polygon(parts,{pane:'age-concentration',renderer,interactive:false,stroke,weight:.55,color:'#536d69',opacity:.65,fillColor:color(i),fillOpacity:.85,smoothFactor:.6}).addTo(overlay);
      });
      overlay.addTo(map);paintError='';legend();
    }catch{
      if(ticket!==paintRevision)return;
      paintKey='';paintError='No se pudieron dibujar los límites. Mueve el mapa para reintentar. ';legend();
    }
  }
  function refresh(){
    const {theme,province}=state();
    if(province!==lastProvince){
      lastProvince=province;
      if(!applyingScope)config.scope=Object.keys(provinces).find(k=>provinces[k]===province)||'';
    }
    $('cohort-map-controls').hidden=theme!=='ages';
    $('cohort-leaders').hidden=theme!=='ages'||!stats?.sorted.length;
    if(theme!=='ages'&&$('demografia').hidden){
      statsKey='';stats=null;paint();$('cohort-profile').hidden=true;return;
    }
    const fineReady=!!state().sectors;
    for(const opt of $('age-level').options)if(opt.value==='sector'||opt.value==='zone')opt.disabled=!fineReady;
    if(!fineReady&&(preferred==='sector'||preferred==='zone'))preferred='parish';
    const kind=level();
    if(theme==='ages')preferred=kind;
    sync();
    const key=JSON.stringify([kind,config.scope,config.from,config.to,config.metric,config.minimum]);
    if(key===statsKey){detail();paint();return;}
    statsKey=key;stats=null;page=0;error=paintError='';table();updateInfo();paint();
    if(!fieldsValid())return;
    calculate(kind,config.scope,Number(config.from),config.to===''?120:Number(config.to),config.metric,Number(config.minimum))
      .then(result=>{
        if(key!==statsKey)return;
        stats=result;table();updateInfo();paint();
      }).catch(()=>{
        if(key!==statsKey)return;
        statsKey='';error='No se pudieron cargar los conteos. Vuelve a elegir el grupo o el territorio para reintentar.';updateInfo();
      });
  }
  $('age-level').onchange=()=>{
    preferred=$('age-level').value;
    if(state().theme==='ages')activate(preferred);
    else refresh();
  };
  $('age-prev').onclick=()=>{page--;table();};$('age-next').onclick=()=>{page++;table();};
  $('cohort-leaders-list').onclick=$('age-ranking').onclick=event=>{
    const code=event.target.closest('[data-code]')?.dataset.code;
    if(!code||!stats)return;
    const kind=stats.kind;activate(kind);frameScope(false);state().territory.open(kind,code,true);
    $('explorar').scrollIntoView({block:'start'});
  };
  $('age-start').onclick=()=>{activate(preferred,true);$('explorar').scrollIntoView({block:'start'});};
  $('age-map').onclick=$('age-start').onclick;
  map.on('moveend',paint);
  new MutationObserver(refresh).observe($('demografia'),{attributes:true,attributeFilter:['hidden']});
  if(query.get('capa')==='ages'){
    const lo=query.get('desde'),hi=query.get('hasta');
    if(lo!==null||hi!==null){
      config.from=lo??'0';config.to=hi??'';config.preset='custom';
      if(!fieldsValid()){config.from='25';config.to='45';config.preset='working';}
    }
    if(/^\d{1,9}$/.test(query.get('minimo')||''))config.minimum=query.get('minimo');
    if(query.get('medida')==='numero')config.metric='count';
    if(availableScopes.has(query.get('ambito')))config.scope=query.get('ambito');
  }
  $('age-start').disabled=false;
  return {refresh,legend,addFilters(url){
    if(state().theme!=='ages'||!fieldsValid())return;
    const p=url.searchParams;
    p.set('capa','ages');p.set('nivel',level());p.set('desde',config.from);p.set('hasta',config.to||'120');
    p.set('medida',config.metric==='count'?'numero':'porcentaje');
    if(config.scope)p.set('ambito',config.scope);
    if(Number(config.minimum))p.set('minimo',config.minimum);
  },startLink(){
    const parish=query.get('parroquia');
    if(parishShapes.has(parish)){activate('parish');state().territory.open('parish',parish);return;}
    const linkedArea=query.get('area');
    if(linkedArea)return;
    const kind=Object.hasOwn(levels,query.get('nivel'))?query.get('nivel'):'sector';
    activate(kind,true);
  }};
}
