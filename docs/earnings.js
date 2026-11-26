import {readCompressedJSON} from './compressed-json.js';

const $=id=>document.getElementById(id);
const provinces={'09':'Guayas','24':'Santa Elena'};
const number=new Intl.NumberFormat('es-EC');
const percent=new Intl.NumberFormat('es-EC',{style:'percent',maximumFractionDigits:1});
const dollars=new Intl.NumberFormat('es-EC',{style:'currency',currency:'USD',maximumFractionDigits:2});

export function earningsShare(rows,lo,hi,threshold,includeNonworkers){
  let total=0,above=0,records=0;
  for(let age=lo;age<=hi;age++){
    const row=rows[age];
    if(!row)continue;
    const [nonworkerWeight,nonworkerRecords,employed]=row;
    if(includeNonworkers){total+=nonworkerWeight;records+=nonworkerRecords;}
    for(const [income,weight,n] of employed){
      total+=weight;records+=n;
      if(income>threshold)above+=weight;
    }
  }
  return {share:total>0?above/total:null,records};
}

export function initEarnings(location,residentCount){
  const card=$('earnings-card'),result=$('earn-result'),local=$('earn-local'),note=$('earn-note');
  const from=$('earn-from'),to=$('earn-to'),cut=$('earn-cut'),base=$('earn-base');
  let task,last='',revision=0;
  function refresh(){
    const area=location();
    card.hidden=!area;
    if(!area){last='';revision++;return;}
    const key=JSON.stringify([area,from.value,to.value,cut.value,base.value]);
    if(key===last)return;
    last=key;
    const ticket=++revision;
    const lo=from.valueAsNumber,hi=to.valueAsNumber,threshold=cut.valueAsNumber;
    result.textContent='';local.textContent='';note.textContent='';$('earn-retry').hidden=true;
    $('earn-domain').textContent='Referencia provincial · '+provinces[area.province]+' · ENEMDU 2025';
    if(!Number.isInteger(lo)||!Number.isInteger(hi)||lo<0||hi>120||lo>hi){
      note.textContent='Revisa las edades. La edad inicial debe ser menor o igual a la final.';return;
    }
    if(area.code){
      local.textContent='Consultando el Censo 2022…';
      Promise.resolve(residentCount(area.code,lo,hi)).then(count=>{
        if(ticket!==revision)return;
        local.textContent=area.label+' · '+(count==null?'Sin desglose censal para estas edades.':number.format(count)+' residentes de '+lo+'–'+hi+' años en el Censo 2022.');
      }).catch(()=>{if(ticket===revision)local.textContent='No se pudo cargar el conteo del Censo 2022.';});
    }else local.textContent=area.pending?'Buscando el sector del edificio…':'Sin sector censal identificado para el pin.';
    if(lo<15){note.textContent='El ingreso laboral se consulta desde los 15 años. Ajusta la edad inicial.';return;}
    if(!Number.isFinite(threshold)||threshold<0){note.textContent='Ingresa un monto mensual de cero o más dólares.';return;}
    if(!task)task=readCompressedJSON('./data/earnings-2025.json.gz').catch(error=>{task=null;throw error;});
    note.textContent='Calculando el porcentaje provincial…';
    task.then(data=>{
      if(ticket!==revision)return;
      const all=base.value==='all';
      const {share,records}=earningsShare(data[area.province],lo,hi,threshold,all);
      if(share==null||records<30){
        result.textContent='Muestra insuficiente';
        note.textContent=number.format(records)+' registros con información. Amplía el rango de edad.';return;
      }
      result.textContent=percent.format(share);
      const group=all?'personas':'personas ocupadas';
      note.textContent='Porcentaje de '+group+' de '+lo+'–'+hi+' años en '+provinces[area.province]+' que superó '+dollars.format(threshold)+' al mes en ingresos laborales. Base ponderada a partir de '+number.format(records)+' registros con información.'+(share===0?' Ningún registro de la muestra superó el monto.':'');
    }).catch(()=>{
      if(ticket!==revision)return;
      note.textContent='No se pudo cargar la encuesta provincial.';$('earn-retry').hidden=false;
    });
  }
  for(const field of [from,to,cut])field.addEventListener('input',refresh);
  base.addEventListener('change',refresh);
  $('earn-retry').onclick=()=>{last='';refresh();};
  return {refresh,setAges(lo,hi){from.value=lo;to.value=hi;refresh();}};
}
