export const initialFinance={down:20,rate:8,years:20,share:30};
export const normalize = value => String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export function median(values){
 const v=[...values].sort((a,b)=>a-b),n=v.length;
 if(!n)return null;
 return n%2?v[(n-1)/2]:(v[n/2-1]+v[n/2])/2;
}
export function loanPrincipal(income, scenario){
 const monthly=scenario.rate/1200, n=scenario.years*12;
 const factor=monthly===0?n:-Math.expm1(-n*Math.log1p(monthly))/monthly;
 return income*(scenario.share/100)*factor;
}
export function maxPrice(income, scenario){
 return loanPrincipal(income,scenario)/(1-scenario.down/100);
}
function ringContains([x,y],ring){
 let inside=false;
 for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const [xi,yi]=ring[i],[xj,yj]=ring[j];
  if((yi>y)!==(yj>y) && x<(xj-xi)*(y-yi)/(yj-yi)+xi)inside=!inside;
 }
 return inside;
}
export function featureAt(features,lat,lon){
 return features.find(({geometry:g})=>(g.type==='Polygon'?[g.coordinates]:g.coordinates).some(p=>ringContains([lon,lat],p[0])&&!p.slice(1).some(r=>ringContains([lon,lat],r))));
}
export const demandFields=['id_solicitud','canton_origen','canton_destino','sector_destino','dormitorios','presupuesto_max_usd','fecha'];
export const loanFields=['id_operacion','canton_destino','monto_usd','fecha'];
export function readCSV(raw){
 const text=raw.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').trim();
 if(!text)throw Error('El archivo está vacío.');
 const delim=text.split('\n')[0].includes(';')?';':',';
 const lines=[];let row=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){const ch=text[i];
  if(ch==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
  else if(ch===delim&&!quoted){row.push(cell.trim());cell='';}
  else if(ch==='\n'&&!quoted){row.push(cell.trim());if(row.some(Boolean))lines.push(row);row=[];cell='';}
  else cell+=ch;
 }
 if(quoted)throw Error('Hay una comilla sin cerrar en el CSV.');
 row.push(cell.trim());if(row.some(Boolean))lines.push(row);
 return lines;
}
export function todayEC(d=new Date()){
 const p=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Guayaquil',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d);
 return ['year','month','day'].map(k=>p.find(e=>e.type===k).value).join('-');
}
function validDate(s){return /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s+'T00:00:00Z')) && new Date(s+'T00:00:00Z').toISOString().startsWith(s);}
export function parseSample(raw,type,features,asOf=todayEC()){
 const [headers,...rows]=readCSV(raw),fields=type==='demand'?demandFields:loanFields;
 if(fields.some(f=>!headers.includes(f))||headers.length!==fields.length)throw Error('Los encabezados deben coincidir con la plantilla. Carga únicamente sus columnas.');
 if(!rows.length)throw Error('La plantilla aún no contiene registros.');
 const valid=new Set(features.map(f=>f.properties.code));const seen=new Set();const out=[];
 for(const [index,row] of rows.entries()){
  const fail=msg=>{throw Error('Fila '+(index+2)+'. '+msg);};
  if(row.length!==headers.length)fail('Número de columnas incorrecto.');
  const r=Object.fromEntries(headers.map((h,i)=>[h,row[i]]));
  const id=r[fields[0]];if(!id||id.length>100||seen.has(id))fail('Se requiere un ID anónimo único por fila.');seen.add(id);
  for(const f of fields.filter(k=>k.startsWith('canton_'))){r[f]=r[f].padStart(4,'0');if(!valid.has(r[f]))fail('Utiliza un código cantonal DPA del atlas.');}
  if(!validDate(r.fecha)||r.fecha>asOf)fail('Utiliza una fecha válida hasta hoy (AAAA-MM-DD).');
  for(const k of fields.filter(k=>k==='dormitorios'||k.endsWith('_usd'))){r[k]=Number(r[k].replace(',','.'));if(!(r[k]>0&&Number.isFinite(r[k])))fail('El monto o los dormitorios deben ser positivos.');}
  if(type==='demand'&&(!r.sector_destino||!Number.isInteger(r.dormitorios)))fail('Indica un sector y una cantidad entera de dormitorios.');
  out.push(r);
 }
 return out;
}
export function recentMatches(rows,project,destCode,asOf=todayEC()){
 const end=Date.parse(asOf+'T00:00:00Z'),start=end-89*86400000, counts={};
 for(const r of rows){
  const time=Date.parse(r.fecha+'T00:00:00Z');
  if(time>=start&&time<=end&&r.canton_destino===destCode&&normalize(r.sector_destino)===normalize(project.sector)&&r.dormitorios===project.rooms&&r.presupuesto_max_usd>=project.price){
   counts[r.canton_origen]=(counts[r.canton_origen]??0)+1;
  }
 }
 return counts;
}
export function distanceKm(lat,lon,point){
 const rad=Math.PI/180;
 const deltaLat=(point[1]-lat)*rad,deltaLon=(point[0]-lon)*rad;
 const a=Math.sin(deltaLat/2)**2+Math.cos(lat*rad)*Math.cos(point[1]*rad)*Math.sin(deltaLon/2)**2;
 return 6371.0088*2*Math.asin(Math.min(1,Math.sqrt(a)));
}
