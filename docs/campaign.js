import {distanceKm, maxPrice} from './model.js';
import {nearestFacility} from './access-model.js';
import {readCompressedJSON} from './compressed-json.js';

const $ = id => document.getElementById(id);
const number = new Intl.NumberFormat('es-EC');
const money = new Intl.NumberFormat('es-EC',{style:'currency',currency:'USD',maximumFractionDigits:0});
const percent = new Intl.NumberFormat('es-EC',{style:'percent',maximumFractionDigits:1});
const km = n => n.toLocaleString('es-EC',{minimumFractionDigits:1,maximumFractionDigits:1})+' km';
const provinces = {'09':'Guayas','24':'Santa Elena'};

function nearbySectors(data,project,radius,age,matches,order) {
  const nearby=[], byProvince=new Map();
  for (const [code,lat,lon,homes,ages] of data.sectors) {
    if (!homes) continue;
    const distance=distanceKm(project.lat,project.lon,[lon,lat]);
    if (distance>radius) continue;
    const province=code.slice(0,2);
    byProvince.set(province,(byProvince.get(province)||0)+ages[age]);
    nearby.push({code,distance,homes,cohort:ages[age],queries:matches?.[code.slice(0,4)]??0});
  }
  nearby.sort((a,b)=>{
    if(order==='demand' && a.queries!==b.queries) return b.queries-a.queries;
    if(order!=='near' && a.homes!==b.homes) return b.homes-a.homes;
    return a.distance-b.distance || a.code.localeCompare(b.code);
  });
  return {nearby,byProvince};
}

export function initCampaign({state,cantons,parishes,selectBuilding,selectSector,editFinance,download}) {
  const projectInput=$('campaign-building'), radius=$('campaign-radius'), cohort=$('campaign-age');
  const floor=$('campaign-floor'),rank=$('campaign-rank'),status=$('campaign-status');
  const names=new Map([...cantons,...(parishes||[])].map(f=>[f.properties.code,f.properties.name]));
  let data,loading=false,failed=false,optionsList,exportRows=[],lastView;
  let hospitalData=null,facilitiesReady=false;
  const ageLabel = ([lo,hi]) => hi===120?lo+' años o más':lo+'–'+hi+' años';

  async function loadData() {
    loading=true;
    try {
      data=await readCompressedJSON('./data/campaign.json.gz');
      cohort.replaceChildren();
      data.cohorts.forEach((range,i)=>cohort.add(new Option(ageLabel(range),i)));
      cohort.value=String(data.cohorts.findIndex(([lo,hi])=>lo===45 && hi===60));
      cohort.disabled=false;
    } catch {data=null;failed=true;}
    finally {loading=false;refresh();}
  }
  function refresh() {
    const {project,buildings,finance,matches}=state();
    if(optionsList!==buildings) {
      optionsList=buildings;
      const placeholder=new Option('Seleccionar edificio','');placeholder.disabled=true;
      projectInput.replaceChildren(placeholder,...buildings.map(b=>new Option(b.name,b.id)));
      projectInput.disabled=false;
    }
    projectInput.value=project?.id||'';
    rank.querySelector('[value="demand"]').disabled=!matches;
    if(!matches && rank.value==='demand') rank.value='homes';
    const key=[project,finance,matches,rank.value,radius.value,floor.value,cohort.value,data,failed,hospitalData,facilitiesReady];
    if(lastView && key.every((v,i)=>v===lastView[i])) return;
    lastView=key;
    $('campaign-results').hidden=true;$('campaign-export').disabled=true;
    $('campaign-retry').hidden=!failed || !project; exportRows=[];
    if(!project){status.textContent='Selecciona el edificio que quieres promocionar.';return;}
    if(!data) {
      status.textContent=failed?'No se pudo cargar la base para la comparación.':'Cargando sectores y referencias de ingreso…';
      if(!loading && !failed) loadData();
      return;
    }
    if(!radius.validity.valid){status.textContent='Ingresa un radio entre 0,1 y 250 km.';return;}
    const age=Number(cohort.value);
    const {nearby,byProvince}=nearbySectors(data,project,radius.valueAsNumber,age,matches,rank.value);
    if(!nearby.length){status.textContent='No hay sectores con hogares y punto interior dentro del radio. Amplía el radio o selecciona otro edificio.';return;}
    const top=nearby.slice(0,5);
    const ageGroup=ageLabel(data.cohorts[age]);
    const households=nearby.reduce((n,r)=>n+r.homes,0), group=nearby.reduce((n,r)=>n+r.cohort,0);
    status.textContent='';
    $('campaign-results').hidden=false;
    $('campaign-summary').textContent=project.name+' · '+km(radius.valueAsNumber)+'. '+number.format(nearby.length)+' sectores con '+number.format(households)+' hogares. En '+number.format(group)+' hogares el representante tenía '+ageGroup+' en 2022.';
    const body=$('campaign-rows');body.replaceChildren();
    const requiredIncome=project.price>0 ? project.price/maxPrice(1,finance) : null;
    const requested=floor.value==='price'?requiredIncome:Number(floor.value);
    const cut=requested===null?-1:data.cuts.findIndex(v=>v>=requested);
    const threshold=data.cuts[cut];
    const refRoot=$('campaign-reference');refRoot.replaceChildren();
    $('campaign-finance').textContent=floor.value==='price'
      ? (requiredIncome===null?'Agrega el precio del edificio o elige un ingreso mensual.':
        'Para un precio de '+money.format(project.price)+', el escenario requiere aproximadamente '+money.format(requiredIncome)+' al mes, con '+finance.down+' % de entrada, '+finance.years+' años, '+finance.rate+' % anual y cuota de '+finance.share+' % del ingreso.')
      : 'Umbral elegido de ingreso corriente monetario mensual por hogar: '+money.format(requested)+'.';
    const refs=new Map();
    for(const [province,localCount] of byProvince) {
      const ref=data.refs[province][age], item=document.createElement('li');
      const pair=ref.above[cut];
      const reportable=pair && ref.n>=30 && pair[0]>=10 && ref.n-pair[0]>=10;
      const label=provinces[province]+' · '+number.format(localCount)+' hogares del grupo en el radio. ';
      if(!pair) item.textContent=label+(requested===null?'Falta el umbral de ingreso.':'El ingreso requerido supera el máximo tabulado de '+money.format(data.cuts.at(-1))+'.');
      else if(!reportable) item.textContent=label+'En la muestra provincial, '+number.format(pair[0])+' de '+number.format(ref.n)+' hogares del grupo alcanzaron '+money.format(threshold)+' al mes. La muestra es insuficiente para estimar cuántos hogares locales superan ese umbral.';
      else item.textContent=label+'En la encuesta provincial, '+percent.format(pair[1])+' alcanzó al menos '+money.format(threshold)+' al mes (muestra del grupo: '+number.format(ref.n)+'). Al aplicar esa proporción al radio se estiman unos '+number.format(Math.round(localCount*pair[1]))+' hogares.'+(pair[0]<30 || ref.n-pair[0]<30?' La muestra en uno de los tramos es pequeña.':'');
      refs.set(province,reportable?pair[1]:null);refRoot.append(item);
    }
    if(requested!=null && threshold>requested) $('campaign-finance').textContent+=' La encuesta se consulta en el siguiente corte de '+money.format(threshold)+' (intervalos de $250).';
    const hospital=hospitalData?.length?nearestFacility(project.lat,project.lon,hospitalData):null;
    $('campaign-hospital').textContent=hospital
      ? hospital.item.name+' figura a '+km(hospital.km)+' en línea recta desde '+(project.reference?'el acceso aproximado':'el punto registrado')+' de '+project.name+'. Verifica el trayecto antes de anunciar tiempos de viaje.'
      : facilitiesReady?'Sin referencia hospitalaria disponible para este proyecto.':'Cargando el inventario de hospitales…';
    exportRows=[['proyecto','radio_km','orden','codigo_sector','canton','cabecera_o_parroquia','distancia_recta_km','hogares_2022','edad_representante','hogares_del_grupo_2022','consultas_canton_origen_90_dias','umbral_mensual_usd','proporcion_provincial_estimada_ENIGHUR','hospital_referencia','hospital_km_recta']];
    for(const row of top) {
      const tr=body.insertRow(), first=tr.insertCell(), button=document.createElement('button');
      const canton=names.get(row.code.slice(0,4))||row.code.slice(0,4), parish=names.get(row.code.slice(0,6))||row.code.slice(0,6);
      button.type='button';button.className='linkbutton';button.textContent=canton+' · Zona '+row.code.slice(6,9)+' · Sector '+row.code.slice(9);
      button.onclick=()=>selectSector(row.code);
      const small=document.createElement('small');small.textContent=parish+' · '+row.code;
      first.append(button,small);
      for(const value of [km(row.distance),number.format(row.homes),number.format(row.cohort),matches?number.format(row.queries):'Sin muestra']) tr.insertCell().textContent=value;
      exportRows.push([project.name,radius.valueAsNumber,rank.selectedOptions[0].textContent,row.code,canton,parish,Number(row.distance.toFixed(2)),row.homes,ageGroup,row.cohort,matches?row.queries:'',threshold??'',refs.get(row.code.slice(0,2))??'',hospital?.item.name||'',hospital?Number(hospital.km.toFixed(2)):'']);
    }
    $('campaign-export').disabled=false;
  }
  projectInput.onchange=()=>selectBuilding(projectInput.value);
  radius.oninput=cohort.onchange=floor.onchange=rank.onchange=refresh;
  $('campaign-retry').onclick=()=>{failed=false;lastView=null;refresh();};
  $('campaign-export').onclick=()=>{if(exportRows.length) download('atlas_prueba_geografica.csv',exportRows);};
  $('campaign-edit').onclick=editFinance;
  refresh();
  return {refresh,setHospitals(items){facilitiesReady=true;hospitalData=items;refresh();}};
}
