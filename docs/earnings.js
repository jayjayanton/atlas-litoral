import {readCompressedJSON} from './compressed-json.js';

const $=id=>document.getElementById(id);
const provinces={'09':'Guayas','24':'Santa Elena'};
const number=new Intl.NumberFormat('es-EC');
const percent=new Intl.NumberFormat('es-EC',{style:'percent',maximumFractionDigits:1});

export function earningsShare(rows,lo,hi,minimum,maximum,includeNonworkers){
  let total=0,inRange=0,records=0;
  for(let age=lo;age<=hi;age++){
    const row=rows[age];
    if(!row)continue;
    const [nonworkerWeight,nonworkerRecords,employed]=row;
    if(includeNonworkers){total+=nonworkerWeight;records+=nonworkerRecords;}
    for(const [income,weight,n] of employed){
      total+=weight;records+=n;
      if(income>=minimum&&(maximum===null||income<=maximum))inRange+=weight;
    }
  }
  return {share:total>0?inRange/total:null,records};
}

export function initEarnings(location,residentCount){
  const card=$('earnings-card'),result=$('earn-result'),local=$('earn-local'),note=$('earn-note');
  const age=$('earn-age'),income=$('earn-income'),base=$('earn-base');
  let task,last='',revision=0;
  function refresh(){
    const area=location();
    card.hidden=!area;
    if(!area){last='';revision++;return;}
    const [lo,hi]=age.value.split('-').map(Number);
    const [minimum,upper]=income.value.split('-').map(Number);
    const maximum=Number.isFinite(upper)?upper:null;
    const key=JSON.stringify([area,lo,hi,minimum,maximum,base.value]);
    if(key===last)return;
    last=key;
    const ticket=++revision;
    result.textContent='';local.textContent='';note.textContent='';$('earn-retry').hidden=true;
    $('earn-domain').textContent='Referencia provincial · '+provinces[area.province]+' · ENEMDU 2025';
    if(area.code){
      local.textContent='Consultando el Censo 2022…';
      Promise.resolve(residentCount(area.code,lo,hi)).then(count=>{
        if(ticket!==revision)return;
        local.textContent=area.label+' · '+(count==null?'Sin desglose censal para estas edades.':number.format(count)+' residentes de '+lo+'–'+hi+' años · Censo 2022.');
      }).catch(()=>{if(ticket===revision)local.textContent='No se pudo cargar el conteo del Censo 2022.';});
    }else local.textContent=area.pending?'Buscando el sector del edificio…':'Sin sector censal identificado para el pin.';
    if(!task)task=readCompressedJSON('./data/earnings-2025.json.gz').catch(error=>{task=null;throw error;});
    note.textContent='Calculando el porcentaje provincial…';
    task.then(data=>{
      if(ticket!==revision)return;
      const all=base.value==='all';
      const {share,records}=earningsShare(data[area.province],lo,hi,minimum,maximum,all);
      if(share==null||records<30){
        result.textContent='Muestra insuficiente';
        note.textContent=number.format(records)+' registros con información. Amplía el rango de edad.';return;
      }
      result.textContent=percent.format(share);
      const group=all?'personas':'personas ocupadas';
      const band=maximum===null?'USD '+number.format(minimum)+' o más':'USD '+number.format(minimum)+'–'+number.format(maximum);
      note.textContent='Porcentaje de '+group+' de '+lo+'–'+hi+' años en '+provinces[area.province]+' con ingreso laboral mensual en el rango '+band+'. Base ponderada a partir de '+number.format(records)+' registros con información.'+(share===0?' Ningún registro de la muestra pertenece a este rango.':'');
    }).catch(()=>{
      if(ticket!==revision)return;
      note.textContent='No se pudo cargar la encuesta provincial.';$('earn-retry').hidden=false;
    });
  }
  age.addEventListener('change',refresh);
  income.addEventListener('change',refresh);
  base.addEventListener('change',refresh);
  $('earn-retry').onclick=()=>{last='';refresh();};
  return {refresh,setAges(lo,hi){
    const value=lo+'-'+hi;
    if([...age.options].some(option=>option.value===value))age.value=value;
    refresh();
  }};
}
