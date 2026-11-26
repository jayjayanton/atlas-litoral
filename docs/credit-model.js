import {normalize} from './model.js';

// SEPS publishes amount brackets with an open lower endpoint and a closed upper endpoint.
const edges=[0,1000,5000,10000,50000,100000,200000,Infinity];
export const bands=['Hasta $1 mil','Más de $1 a $5 mil','Más de $5 a $10 mil','Más de $10 a $50 mil','Más de $50 a $100 mil','Más de $100 a $200 mil','Más de $200 mil'];

export function summarize(groups,threshold){
  const t=Math.round(threshold*100),counts=bands.map(()=>0);
  let total=0,n=0,lower=0,upper=0,classified=0;
  for(const [k,sum,band] of groups){
    const lo=band>0?edges[band]*100+1:0,hi=band===undefined?Infinity:edges[band+1]*100;
    n+=k;total+=sum;
    if(band!==undefined){counts[band]+=k;classified+=k;}
    else if(k===1){counts[edges.findIndex(x=>x*100>=sum && x>0)-1]++;classified++;}
    if(t<lo){lower+=k;upper+=k;continue;}
    if(t>=hi)continue;
    if(sum>k*t)lower+=Number.isFinite(hi)?Math.ceil((sum-k*t)/(hi-t)):1;
    upper+=Math.min(k,Math.floor((sum-k*lo)/(t+1-lo)));
  }
  const most=Math.max(...counts);
  const modes=classified===n?bands.filter((_,i)=>counts[i]===most):[];
  return {n,total,lower,upper,mean:total/(100*n),aboveMean:total>t*n,mode:modes.join(' / ')};
}

const aliases={
  code:['codigo dpa','dpa'],name:['parroquia'],date:['fecha de corte','fecha corte'],
  state:['estado operacion','estado de la operacion'],person:['tipo persona','tipo de persona'],
  type:['tipo credito general','tipo de credito general'],range:['rango monto credito concedido'],
  n:['nro operaciones','numero de operaciones','nro de operaciones'],amount:['monto concedido usd','monto concedido']
};
function headerPositions(line){
  const columns=line.split('\t').map(normalize),out={};
  for(const [key,names] of Object.entries(aliases)){
    out[key]=columns.findIndex(x=>names.includes(x));
    if(out[key]===-1)throw Error('Falta la columna «'+names[0]+'». Usa el TXT mensual de volumen de crédito de SEPS.');
  }
  return out;
}
function month(raw){
  const s=raw.trim(),iso=s.match(/^(\d{4})[-/]?(\d{2})(?:[-/]?\d{2})?(?:T.*| .*)?$/);
  const local=iso?null:s.match(/^\d{1,2}[-/](\d{1,2})[-/](\d{4})(?: .*)?$/);
  const result=iso?[+iso[1],+iso[2]]:local?[+local[2],+local[1]]:null;
  if(!result || result[0]<2000 || result[1]<1 || result[1]>12)throw Error('Fecha de corte desconocida: '+s.slice(0,24));
  return result[0]+'-'+String(result[1]).padStart(2,'0');
}
const phrases=['hasta mil','mayor a 1 hasta 5 mil','mayor a 5 hasta 10 mil','mayor a 10 hasta 50 mil','mayor a 50 hasta 100 mil','mayor a 100 hasta 200 mil','mayor a 200 mil'];
function toCents(raw){
  let value=raw.trim();
  if(value.includes(',') && value.includes('.'))value=value.lastIndexOf(',')>value.lastIndexOf('.')?value.replaceAll('.','').replace(',','.'):value.replaceAll(',','');
  else value=value.replace(',','.');
  if(!/^\d+(?:\.\d{1,2}0*)?$/.test(value))throw Error('Monto no reconocido en el archivo.');
  return Math.round(Number(value)*100);
}
async function* lines(file){
  const sample=await file.slice(0,65536).arrayBuffer();
  let encoding='utf-8';
  try{new TextDecoder(encoding,{fatal:true}).decode(sample,{stream:true});}catch{encoding='windows-1252';}
  const decoder=new TextDecoder(encoding),reader=file.stream().getReader();
  let rest='';
  try{
    while(true){
      const {value,done}=await reader.read();
      const parts=(rest+decoder.decode(value,{stream:!done})).split('\n');
      rest=parts.pop();
      for(const part of parts)if(part.trim())yield part.replace(/\r$/,'');
      if(done){if(rest.trim())yield rest;break;}
      if(rest.length>1000000)throw Error('El archivo debe ser texto tabulado, ya descomprimido.');
    }
  }finally{reader.releaseLock();}
}
export async function readParishLoans(files){
  const months=new Set(),byMonth=new Map();
  for(const file of files){
    let h;const localMonths=new Set();
    for await(const line of lines(file)){
      if(!h){h=headerPositions(line);continue;}
      const v=line.split('\t').map(x=>x.trim().replace(/^"(.*)"$/,'$1'));
      const date=month(v[h.date]||'');localMonths.add(date);
      const code=(v[h.code]||'').padStart(6,'0');
      if(!/^(09|24)\d{4}$/.test(code))continue;
      if(normalize(v[h.state])!=='original' || !['natural','persona natural'].includes(normalize(v[h.person])))continue;
      if(!/^(inmobiliario|vivienda\b)/.test(normalize(v[h.type])))continue;
      const range=normalize(v[h.range]).replace(/ dolares?$/,'').replace(/^hasta 1 mil$/,'hasta mil');
      const band=phrases.indexOf(range),n=Number(v[h.n]),sum=toCents(v[h.amount]||'');
      if(!Number.isSafeInteger(n)||n<1 || !Number.isSafeInteger(sum)||band<0 ||
          sum<n*(band?edges[band]*100+1:0) || sum>n*edges[band+1]*100)
        throw Error('Revisa el rango, el monto y el número de operaciones de la fila '+code+' · '+date+'.');
      if(!byMonth.has(date))byMonth.set(date,new Map());
      const rows=byMonth.get(date);
      if(!rows.has(code))rows.set(code,{code,name:v[h.name],groups:new Map()});
      const row=rows.get(code),g=row.groups.get(band)||[0,0,band];
      g[0]+=n;g[1]+=sum;row.groups.set(band,g);
    }
    for(const d of localMonths){
      if(months.has(d))throw Error('Los archivos repiten el mes '+d+'. Usa una sola edición por período.');
      months.add(d);
    }
  }
  const dates=[...months].sort(),last=dates.at(-1);
  if(!last)throw Error('El archivo no contiene fechas de corte.');
  const cutoff=new Date(last+'-01T00:00:00Z');cutoff.setUTCMonth(cutoff.getUTCMonth()-11);
  const included=dates.filter(d=>d>=cutoff.toISOString().slice(0,7)),rows=new Map();
  for(const d of included)for(const row of byMonth.get(d)?.values()||[]){
    if(!rows.has(row.code))rows.set(row.code,{code:row.code,name:row.name,groups:[]});
    rows.get(row.code).groups.push(...row.groups.values());
  }
  if(!rows.size)throw Error('No se encontraron créditos originales de vivienda a personas naturales en Guayas o Santa Elena. Verifica la edición y sus categorías.');
  return {months:included,rows:[...rows.values()]};
}
