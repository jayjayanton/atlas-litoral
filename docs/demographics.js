const $=id=>document.getElementById(id);
const num=new Intl.NumberFormat('es-EC');
const pct=new Intl.NumberFormat('es-EC',{style:'percent',maximumFractionDigits:1});
const colors=['#edf3f3','#c2dfdc','#85bcb7','#438e89','#125956'];
const presets={working:[25,45],older:[60,120],sixty:[60,60],all:[0,120]};
const sum=values=>values.reduce((a,b)=>a+b,0);
const span=(a,b)=>a===b?String(a):b===120?a+'+':a+'–'+b;

export function initDemographics({map,data,cantons,parishCatalog,parishes,state,selectCanton,colorize,isPicking}){
  const geo=$('age-geo'),preset=$('age-preset'),from=$('age-from'),to=$('age-to');
  const provinceFor=new Map(cantons.map(f=>[f.properties.code,f.properties.province]));
  const shapes=new Map(parishCatalog.features.map(f=>[f.properties.code,f]));
  const all=new Map(),names=new Map(),groups=new Map();
  for(const f of cantons){
    const {code,name}=f.properties;
    names.set(code,'Cantón '+name);groups.set(code,[]);all.set(code,Array(121).fill(0));
  }
  for(const [code,ages] of Object.entries(data.agesByDpa)){
    const canton=code.slice(0,4),parent=all.get(canton),f=shapes.get(code);
    if(!parent)continue;
    all.set(code,ages);
    ages.forEach((n,i)=>parent[i]+=n);
    names.set(code,f?f.properties.name+' · '+f.properties.kind:'DPA '+code);
    groups.get(canton).push(code);
  }
  for(const f of [...cantons].sort((a,b)=>a.properties.name.localeCompare(b.properties.name,'es'))){
    const {code,name,province}=f.properties,group=document.createElement('optgroup');
    group.label=name+' · '+province;
    group.append(new Option('Todo el cantón '+name,code));
    for(const id of groups.get(code).sort((a,b)=>names.get(a).localeCompare(names.get(b),'es')))group.append(new Option(names.get(id),id));
    geo.append(group);
  }
  const pane=map.createPane('age-parishes');pane.style.zIndex=407;
  const layers=new Map(),overlay=L.geoJSON(parishCatalog,{pane:'age-parishes',onEachFeature:(f,l)=>{
    const code=f.properties.code;layers.set(code,l);
    l.bindTooltip(()=>{const el=document.createElement('span'),s=shares.get(code);
      el.textContent=f.properties.name+(s===undefined?' · Sin dato':' · '+pct.format(s)+' ('+num.format(selectedCounts.get(code))+')');return el;
    },{sticky:true});
  }});
  const totals=new Map([...all].map(([key,values])=>[key,sum(values)]));
  let shares=new Map(),selectedCounts=new Map(),cuts=[],valid=false,band='',areaKey='',paintKey='',revision=0;
  function recalculate(){
    shares.clear();selectedCounts.clear();
    const a=from.valueAsNumber,b=to.value===''?120:to.valueAsNumber;
    valid=from.value!==''&&Number.isInteger(a)&&Number.isInteger(b)&&a>=0&&a<=b&&b<=120&&!to.validity.badInput;
    band=valid?span(a,b):'';
    if(valid)for(const [code,ages] of all){
      const n=sum(ages.slice(a,b+1));selectedCounts.set(code,n);
      if(totals.get(code)>0)shares.set(code,n/totals.get(code));
    }
    // Interior quintiles distinguish even single ages. Identical cuts share one color.
    const values=[...shapes.keys()].filter(k=>shares.has(k)).map(k=>shares.get(k)).sort((x,y)=>x-y);
    cuts=[...new Set([1,2,3,4].map(i=>values[Math.ceil(values.length*i/5)-1]))]
      .filter(v=>Number.isFinite(v)&&v<values.at(-1));
    revision++;
  }
  function color(value){
    if(value===undefined || !valid)return '#e5e9e8';
    const i=cuts.filter(c=>value>c).length;
    return colors[cuts.length?Math.round(i*4/cuts.length):2];
  }
  function paint(){
    const {theme,province}=state(),key=[theme,province,revision].join('|');
    if(key===paintKey)return;paintKey=key;
    if(theme!=='ages'||!valid){if(map.hasLayer(overlay))overlay.remove();return;}
    overlay.setStyle(f=>{const outside=province&&provinceFor.get(f.properties.canton)!==province;
      return {color:'#567977',weight:.75,fillColor:color(shares.get(f.properties.code)),opacity:outside?.25:.8,fillOpacity:outside?.13:.77};
    });
    if(!map.hasLayer(overlay))overlay.addTo(map);
  }
  function choose(code,move){
    const parish=shapes.get(code),canton=code.slice(0,4);
    selectCanton(canton,move&&!parish);parishes.highlight(parish);
    if(move&&parish)map.fitBounds(layers.get(code).getBounds(),{padding:[22,22],maxZoom:15,animate:false});
    refresh();
  }
  function topBands(ages){
    const bands=[];
    for(let start=0;start<ages.length;start+=5){
      const n=sum(ages.slice(start,start+5));
      if(n)bands.push({label:start===120?'120 años':start+'–'+(start+4)+' años',n});
    }
    return bands.sort((a,b)=>b.n-a.n);
  }
  function refresh(){
    paint();
    const code=$('parish-select').value||state().code;
    const key=code+'|'+revision;
    if(key===areaKey)return;areaKey=key;
    const unknown=geo.querySelector('[data-unavailable]');if(unknown)unknown.remove();
    const ages=all.get(code);
    if(!ages){
      const opt=new Option($('parish-select').selectedOptions[0]?.textContent||code,code);
      opt.dataset.unavailable='';geo.append(opt);
    }
    geo.value=code;
    $('age-warning').textContent=!ages?'El Censo 2022 agrupa esta parroquia urbana en la cabecera cantonal. Selecciona la cabecera para ver su población.':!valid?'Usa edades enteras entre 0 y 120. La edad final debe ser igual o mayor que la inicial.':'';
    $('age-results').hidden=!ages;
    $('age-map').disabled=!ages||!valid;
    if(!ages)return;
    const n=totals.get(code),bands=topBands(ages),max=bands[0]?.n;
    $('age-pop').textContent=num.format(n);
    $('age-band-title').textContent=valid?band+' años':'Rango elegido';
    $('age-n').textContent=valid?num.format(selectedCounts.get(code)):'—';
    $('age-share').textContent=valid?pct.format(shares.get(code))+' del área':'—';
    $('age-mode').textContent=bands.filter(v=>v.n===max).map(v=>v.label).join(' / ');
    $('age-bars').replaceChildren();
    for(const v of bands.slice(0,5)){
      const li=document.createElement('li'),track=document.createElement('span'),bar=document.createElement('i'),value=document.createElement('span');
      track.className='age-track';bar.style.width=(100*v.n/max)+'%';track.append(bar);
      value.textContent=num.format(v.n)+' · '+pct.format(v.n/n);
      li.append(document.createTextNode(v.label),track,value);$('age-bars').append(li);
    }
  }
  function legend(){
    $('legend-title').textContent=valid?'Población de '+band+' años · % parroquial':'Revisa el rango de edad';
    const root=$('legend');root.replaceChildren();
    if(valid){
      const values=[...shapes.keys()].map(k=>shares.get(k)).filter(Number.isFinite);
      const percent=n=>new Intl.NumberFormat('es-EC',{maximumFractionDigits:2}).format(n*100)+' %';
      const edges=[...cuts,Math.max(...values)];
      for(const [i,edge] of edges.entries()){
        const el=document.createElement('span'),sw=document.createElement('i');el.className='key';sw.className='sw';
        sw.style.background=color(edge);
        const range=edges.length===1?percent(edge):(i?'> '+percent(edges[i-1])+' a '+percent(edge):'Hasta '+percent(edge));
        el.append(sw,document.createTextNode(range));root.append(el);
      }
    }
    const link=document.createElement('a');link.href='#demografia';link.textContent='Cambiar edades';root.append(link);
  }
  geo.onchange=()=>choose(geo.value,true);
  const update=()=>{recalculate();colorize();refresh();};
  preset.onchange=()=>{const combo=presets[preset.value];if(!combo){from.focus();return;}from.value=combo[0];to.value=combo[1]===120?'':combo[1];update();};
  from.oninput=to.oninput=()=>{preset.value='custom';update();};
  $('age-map').onclick=()=>{const code=geo.value;$('layer').value='ages';choose(code,true);colorize();$('map').scrollIntoView({block:'center'});};
  recalculate();refresh();
  return {refresh,legend,openParish(code){
    if(shapes.has(code)&&all.has(code))choose(code,true);
  }};
}
