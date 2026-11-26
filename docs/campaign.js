import {distanceKm} from './model.js';
import {nearestFacility} from './access-model.js';
import {readCompressedJSON} from './compressed-json.js';

const $ = id => document.getElementById(id);
const number = new Intl.NumberFormat('es-EC');
const percent = new Intl.NumberFormat('es-EC',{style:'percent',maximumFractionDigits:1});
const km = n => n.toLocaleString('es-EC',{minimumFractionDigits:1,maximumFractionDigits:1})+' km';
const ageLabel = ([lo,hi]) => hi===120?lo+' años o más':lo+'–'+hi+' años';
const bands = [[18,24],[25,34],[35,44],[45,54],[55,64],[65,120]];

function adsAgeNote(range) {
  const overlap=bands.filter(([lo,hi])=>lo<=range[1] && hi>=range[0]);
  const exact=overlap[0][0]===range[0] && overlap.at(-1)[1]===range[1];
  if (overlap.length===1 && exact) return 'Esta edad coincide con el intervalo '+ageLabel(range)+' de Google Ads.';
  const span=ageLabel([overlap[0][0],overlap.at(-1)[1]]);
  return 'Los intervalos de Google Ads que cubren este grupo son '+overlap.map(ageLabel).join(', ')+'. '+(exact?'Juntos cubren el rango elegido.':'Juntos abarcan '+span+'.');
}

function nearbySectors(rows,project,radius,age,matches,order) {
  const nearby=[];
  for(const [code,lat,lon,residents,ages] of rows) {
    const distance=distanceKm(project.lat,project.lon,[lon,lat]);
    if(distance<=radius) nearby.push({code,lat,lon,residents,count:ages[age],distance,queries:matches?.[code.slice(0,4)]??0});
  }
  nearby.sort((a,b)=>{
    if(order==='demand' && a.queries!==b.queries) return b.queries-a.queries;
    if(order==='cohort' && a.count!==b.count) return b.count-a.count;
    if(order==='population' && a.residents!==b.residents) return b.residents-a.residents;
    return a.distance-b.distance || a.code.localeCompare(b.code);
  });
  return nearby;
}

export function initCampaign({state,cantons,parishes,selectBuilding,pickOnMap,previewRadius,download}) {
  const building=$('campaign-building'), radius=$('campaign-radius'), cohort=$('campaign-age');
  const mode=$('campaign-mode'), rank=$('campaign-rank'), status=$('campaign-status');
  const codeInput=$('campaign-code'), adRadius=$('campaign-ad-radius');
  const names=new Map([...cantons,...(parishes||[])].map(f=>[f.properties.code,f.properties.name]));
  const codeLabel=code=>(names.get(code.slice(0,4))||code.slice(0,4))+' · Zona '+code.slice(6,9)+' · Sector '+code.slice(9);
  let data,byCode,loading=false,failed=false,optionsList,exportRows=[],lastView;
  let hospitals=null,facilitiesReady=false,selectedCode='';
  const initial=new URL(location.href).searchParams;
  if(initial.has('sectorCampana')) selectedCode=codeInput.value=initial.get('sectorCampana').trim();

  const catalogDetails=$('campaign-catalog'), places=$('campaign-google-place'), placeNote=$('campaign-place-note');
  const types={City:'Ciudad',District:'Distrito',Neighborhood:'Barrio',Province:'Provincia',Municipality:'Municipio','City Region':'Zona urbana','Postal Code':'Código postal',Canton:'Cantón'};
  let catalog,fetchingCatalog=false,catalogProvince='';
  function describePlace() {
    const [name,type,id]=catalog.provinces[catalogProvince].find(row=>row[2]===places.value)||[];
    placeNote.textContent=(id?name+' · '+(types[type]||type)+' · ID de Google Ads '+id+'. ':'')+'Catálogo de Google del '+catalog.date+'. Comprueba en Google Ads la cobertura del lugar elegido.';
  }
  async function showCatalog() {
    if(!catalogDetails.open || !byCode?.has(selectedCode)) return;
    if(!catalog) {
      if(fetchingCatalog) return;
      fetchingCatalog=true;$('campaign-catalog-retry').hidden=true;
      placeNote.textContent='Cargando ubicaciones publicadas…';
      try {
        const r=await fetch('./data/google-ads-locations.json');
        if(!r.ok) throw Error('Catálogo');
        catalog=await r.json();
      } catch {
        places.disabled=true;placeNote.textContent='No se pudo cargar el catálogo.';$('campaign-catalog-retry').hidden=false;return;
      } finally {fetchingCatalog=false;}
      if(!catalogDetails.open || !byCode.has(selectedCode)) return;
    }
    const province=selectedCode.slice(0,2);
    if(province!==catalogProvince) {
      catalogProvince=province;
      const options=catalog.provinces[province].map(([name,type,id])=>new Option(name+' · '+(types[type]||type),id));
      places.replaceChildren(new Option('Seleccionar ubicación de Google',''),...options);places.disabled=false;
    }
    describePlace();
  }
  catalogDetails.ontoggle=showCatalog;places.onchange=describePlace;$('campaign-catalog-retry').onclick=showCatalog;

  async function loadData() {
    loading=true;
    try {
      const json=await readCompressedJSON('./data/campaign-residents.json.gz');
      if(json.unit!=='residents') throw Error('Unidad censal desconocida');
      byCode=new Map(json.sectors.map(row=>[row[0],row]));
      cohort.replaceChildren(...json.cohorts.map((range,i)=>new Option(ageLabel(range),i)));
      const desired=initial.get('edad')||'45-54';
      const index=json.cohorts.findIndex(range=>range.join('-')===desired);
      cohort.value=String(index>=0?index:json.cohorts.findIndex(([lo,hi])=>lo===45&&hi===54));
      cohort.disabled=false;data=json;
    } catch {failed=true;}
    finally {loading=false;refresh();}
  }
  function useSector(code,scroll=true) {
    selectedCode=codeInput.value=code.trim();mode.value='sector';refresh();
    if(scroll) $('campana').scrollIntoView({block:'start'});
  }
  function exportRow(project,studyRadius,order,row,age,matches,hospital) {
    return [row.code,names.get(row.code.slice(0,4)),names.get(row.code.slice(0,6)),row.lat,row.lon,
      data.year,row.residents,ageLabel(data.cohorts[age]),row.count,row.count/row.residents,
      project?.name||'',studyRadius,order,row.distance==null?'':Number(row.distance.toFixed(2)),
      matches?row.queries:'',hospital?.item.name||'',hospital?Number(hospital.km.toFixed(2)):''];
  }
  function refresh() {
    const {project,buildings,matches}=state();
    if(optionsList!==buildings) {
      optionsList=buildings;
      const placeholder=new Option('Seleccionar edificio','');placeholder.disabled=true;
      building.replaceChildren(placeholder,...buildings.map(b=>new Option(b.name,b.id)));
      building.disabled=false;
    }
    building.value=project?.id||'';
    const single=mode.value==='sector';
    $('campaign-specific').hidden=!single;$('campaign-near').hidden=single;
    rank.querySelector('[value="demand"]').disabled=!matches;
    if(!matches && rank.value==='demand') rank.value='cohort';
    const key=[single,selectedCode,project,matches,rank.value,radius.value,cohort.value,data,failed,hospitals,facilitiesReady];
    if(lastView && key.every((v,i)=>v===lastView[i])) return;
    lastView=key;
    $('campaign-results').hidden=true;$('campaign-export').disabled=true;
    $('campaign-retry').hidden=!failed;exportRows=[];
    if(!data) {
      status.textContent=failed?'No se pudo cargar la base censal.':'Cargando los conteos de residentes…';
      if(!loading && !failed) loadData();
      return;
    }
    const age=Number(cohort.value), range=data.cohorts[age];
    $('campaign-single').hidden=!single;$('campaign-list').hidden=single;
    $('campaign-google-age').textContent=adsAgeNote(range);
    const header=['codigo_sector','canton','cabecera_o_parroquia','latitud_interior','longitud_interior','censo','residentes_totales','edad_residentes','residentes_del_grupo','proporcion_del_sector','proyecto','radio_comparacion_km','orden','km_recta_al_proyecto','consultas_canton_origen_90_dias','hospital_referencia','hospital_km_recta'];
    if(single) {
      if(!selectedCode){status.textContent='Elige un polígono en el mapa o ingresa su código censal.';return;}
      const row=byCode.get(selectedCode);
      if(!row){status.textContent='Ese código no tiene un sector censal con población en el atlas. Revisa los 12 dígitos o elige el sector en el mapa.';return;}
      const [code,lat,lon,residents,ages]=row, count=ages[age], share=count/residents;
      $('campaign-result-title').textContent=codeLabel(code);
      $('campaign-summary').textContent=(code.startsWith('09')?'Guayas':'Santa Elena')+' · '+(names.get(code.slice(0,6))||code.slice(0,6))+' · Código INEC '+code;
      $('campaign-pop').textContent=number.format(residents);
      $('campaign-count').textContent=number.format(count);$('campaign-age-label').textContent=ageLabel(range);
      $('campaign-share').textContent=percent.format(share)+' de la población del sector';
      $('campaign-location').textContent='Punto interior del sector: '+lat.toFixed(5)+', '+lon.toFixed(5)+'. Compara el límite del INEC con un radio alrededor de este punto y verifica la disponibilidad del área en Google Ads.';
      showCatalog();
      exportRows=[header,exportRow(null,'','Sector elegido',{code,lat,lon,residents,count},age,null,null)];
    } else {
      if(!project){status.textContent='Selecciona el edificio para comparar los sectores cercanos.';return;}
      if(!radius.validity.valid){status.textContent='Ingresa un radio entre 0,1 y 250 km.';return;}
      const nearby=nearbySectors(data.sectors,project,radius.valueAsNumber,age,matches,rank.value);
      if(!nearby.length){status.textContent='No hay sectores censados dentro de este radio. Amplía el radio o elige otro edificio.';return;}
      const total=nearby.reduce((n,row)=>n+row.residents,0), group=nearby.reduce((n,row)=>n+row.count,0);
      $('campaign-result-title').textContent='Primeros sectores para comparar';
      $('campaign-summary').textContent=project.name+' · '+km(radius.valueAsNumber)+'. '+number.format(nearby.length)+' sectores con '+number.format(total)+' residentes. En 2022, '+number.format(group)+' tenían '+ageLabel(range)+'.';
      const hospital=hospitals?.length?nearestFacility(project.lat,project.lon,hospitals):null;
      $('campaign-hospital').textContent=hospital?hospital.item.name+' figura a '+km(hospital.km)+' en línea recta desde '+(project.reference?'el acceso aproximado':'el punto registrado')+' de '+project.name+'. Verifica el trayecto antes de anunciar tiempos de viaje.':facilitiesReady?'Sin referencia hospitalaria disponible.':'Cargando hospitales…';
      const body=$('campaign-rows');body.replaceChildren();exportRows=[header];
      for(const row of nearby.slice(0,5)) {
        const tr=body.insertRow(), first=tr.insertCell(), button=document.createElement('button');
        button.type='button';button.className='linkbutton';button.textContent=codeLabel(row.code);
        button.onclick=()=>useSector(row.code);
        const small=document.createElement('small');small.textContent=(names.get(row.code.slice(0,6))||'')+' · '+row.code;
        first.append(button,small);
        for(const value of [km(row.distance),number.format(row.residents),number.format(row.count),percent.format(row.count/row.residents),matches?number.format(row.queries):'Sin muestra']) tr.insertCell().textContent=value;
        exportRows.push(exportRow(project,radius.valueAsNumber,rank.selectedOptions[0].textContent,row,age,matches,hospital));
      }
    }
    status.textContent='';$('campaign-results').hidden=false;$('campaign-export').disabled=false;
  }
  building.onchange=()=>selectBuilding(building.value);
  radius.oninput=mode.onchange=cohort.onchange=rank.onchange=refresh;
  $('campaign-code-form').onsubmit=e=>{e.preventDefault();useSector(codeInput.value,false);};
  $('campaign-pick').onclick=pickOnMap;
  $('campaign-preview').onclick=()=>{
    if(!adRadius.reportValidity()) return;
    const row=byCode?.get(selectedCode);
    if(row) previewRadius(row[0],row[1],row[2],adRadius.valueAsNumber);
  };
  $('campaign-retry').onclick=()=>{failed=false;lastView=null;refresh();};
  $('campaign-export').onclick=()=>{if(exportRows.length) download('atlas_sectores_por_edad.csv',exportRows);};
  refresh();
  return {refresh,useSector,setHospitals(items){facilitiesReady=true;hospitals=items;refresh();}};
}
