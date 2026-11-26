import {readCompressedJSON} from './compressed-json.js';
import {normalize} from './model.js';

let catalog;
function readBuildings(){
  if(!catalog)catalog=readCompressedJSON('./data/named-buildings-osm-20261124.json.gz')
    .then(rows=>rows.map(([name,canton,lat,lon])=>({name,canton,lat,lon,key:normalize(name),source:'osm'})))
    .catch(error=>{catalog=null;throw error;});
  return catalog;
}

export function buildingSearch(saved,cantonName){
  const input=document.getElementById('f-name'),coords=document.getElementById('f-coordinates');
  const list=document.getElementById('building-matches');
  const local=saved.map(b=>({...b,key:normalize(b.name)}));
  let rows=[],failed=false,chosen=null;
  const ready=readBuildings().then(data=>{rows=data;}).catch(()=>{failed=true;});
  function find(key,exact=false){
    const hits=[],seen=new Set();
    for(const item of [...local,...rows]){
      if(exact?item.key!==key:!item.key.includes(key))continue;
      const id=item.key+'|'+item.lat+'|'+item.lon;
      if(seen.has(id))continue;
      seen.add(id);hits.push(item);
    }
    return hits;
  }
  function suggest(){
    if(!list.isConnected)return;
    list.replaceChildren();
    const key=normalize(input.value);
    if(key.length<2||coords.value.trim())return;
    const hits=find(key).sort((a,b)=>Number(b.key===key)-Number(a.key===key));
    for(const item of hits.slice(0,6)){
      const button=document.createElement('button');button.type='button';
      const place=item.canton?cantonName(item.canton):'Guardado o de referencia';
      button.textContent=item.name+' · '+place+' ('+item.lat.toFixed(4)+', '+item.lon.toFixed(4)+')';
      button.onclick=()=>{
        chosen=item;input.value=item.name;coords.value=item.lat+', '+item.lon;
        coords.dispatchEvent(new Event('input'));list.replaceChildren();
      };
      list.append(button);
    }
  }
  input.addEventListener('input',()=>{chosen=null;suggest();});
  coords.addEventListener('input',suggest);
  ready.then(suggest);suggest();
  return {get chosen(){return chosen;},get failed(){return failed;},async exact(name){
    await ready;return find(normalize(name),true);
  }};
}
