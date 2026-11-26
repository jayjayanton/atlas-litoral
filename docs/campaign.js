import {showAnalysis} from './explorer-ui.js';
import {rankSectors,sectorIncome} from './campaign-model.js';
import {incomeBandLabels} from './income-map.js';
import {initCampaignParishIncome} from './campaign-parish-income.js';
import {initCampaignOutcomes} from './campaign-outcomes.js';
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

const columns = [
  'codigo_sector','canton','cabecera_o_parroquia','latitud_interior','longitud_interior','censo',
  'residentes_totales','edad_residentes','residentes_del_grupo','proporcion_del_sector','proyecto',
  'radio_comparacion_km','orden','km_recta_al_proyecto','hospital_referencia','hospital_km_recta',
  'zona_de_prueba','posicion','latitud_proyecto','longitud_proyecto','ubicacion_del_proyecto',
  'sectores_en_seleccion','sectores_en_radio','residentes_en_seleccion','residentes_en_radio',
  'proporcion_grupo_en_seleccion','proporcion_grupo_en_radio','criterio_de_medicion',
  'localidad_del_punto_interior','consultas_compatibles_canton_origen_90d_una_fila_por_canton',
  'sector_piloto_asociado','diferencia_residentes_referencia_menos_piloto',
  'ingreso_mensual_del_hogar_usd','hogares_con_edad_del_representante','hogares_estimados_en_tramo','proporcion_estimada_de_hogares_en_tramo'
];

const metric = 'Gasto publicitario en USD dividido por visitas agendadas en el mismo período';
const locationType = project => project.reference ? 'Acceso aproximado de referencia' : project.temporary ? 'Punto marcado en el mapa' : 'Punto registrado';
const countLabel = (value, singular, plural) => number.format(value) + ' ' + (value === 1 ? singular : plural);

export function initCampaign({state,cantons,parishes,sectorIndex,selectBuilding,pickOnMap,previewRadius,updatePlanMap,matchesForProject,localityFor,showOrigins,download,shareQuery}) {
  const building=$('campaign-building'), radius=$('campaign-radius'), cohort=$('campaign-age');
  const mode=$('campaign-mode'), rank=$('campaign-rank'), status=$('campaign-status'), limit=$('campaign-limit');
  const codeInput=$('campaign-code'), adRadius=$('campaign-ad-radius');
  const outcomes = initCampaignOutcomes($('campaign-outcomes'));
  let appliedIncome=sectorIndex?{label:incomeBandLabels(sectorIndex.incomeCuts)[1],band:1,provinces:sectorIndex.provinces}:null;
  let households, householdRequest, householdError=false;
  let applied={mode:mode.value,radius:radius.value,age:cohort.value,rank:rank.value,limit:limit.value};
  let pendingBuilding;
  const names=new Map([...cantons,...(parishes||[])].map(f=>[f.properties.code,f.properties.name]));
  const areaName=code=>names.get(code.slice(0,6)) || names.get(code.slice(0,4)) || code.slice(0,4);
  const locality=row=>localityFor?.(row) || areaName(row.code);
  const codeLabel=row=>locality(row)+' · Zona '+row.code.slice(6,9)+' · Sector '+row.code.slice(9);
  let data,byCode,loading=false,failed=false,optionsList,lastView,exportPlan;
  let hospitals=null,facilitiesReady=false,selectedCode='',mapKey='';
  const initial=new URL(location.href).searchParams;
  if (matchMedia('(max-width:570px)').matches && !initial.has('sectorCampana')) $('campaign-settings-panel').open = false;
  if(initial.has('sectorCampana')) {
    selectedCode=codeInput.value=initial.get('sectorCampana').trim();
    applied.mode=mode.value='sector';
  }

  let parishIncome;
  parishIncome=initCampaignParishIncome({cantons,parishes,sectorIndex,shareQuery,onApplyIncome});
  function onApplyIncome(next) {
    // Custom ranges carry new provincial weights. The label identifies their actual bounds.
    if(next?.label===appliedIncome?.label && next?.band===appliedIncome?.band) return;
    appliedIncome=next;
    if(!next && applied.rank==='income') applied={...applied,rank:'population'};
    if(!next && rank.value==='income') rank.value='population';
    if(parishIncome)refresh();
  }

  function loadHouseholds() {
    if(householdRequest || households || !sectorIndex) return;
    householdError=false;
    householdRequest=readCompressedJSON('./data/campaign-households.json.gz')
      .then(value=>{households=value;}).catch(()=>{householdError=true;})
      .finally(()=>{householdRequest=null;refresh();});
  }

  function syncForm() {
    const single=mode.value==='sector';
    $('campaign-specific').hidden=!single;
    $('campaign-near').hidden=single;
    radius.disabled=single;
    codeInput.disabled=!single;
    codeInput.required=single;
    $('campaign-apply').textContent=single?'Consultar sector':'Calcular sectores';
    rank.querySelector('[value="cohort"]').disabled=cohort.value==='all';
    rank.querySelector('[value="income"]').disabled=!appliedIncome||!households;
    if(cohort.value==='all' && rank.value==='cohort') rank.value='population';
    const changed=mode.value!==applied.mode || cohort.value!==applied.age ||
      (single?codeInput.value.trim()!==selectedCode:
        pendingBuilding!==undefined || radius.value!==applied.radius || limit.value!==applied.limit || rank.value!==applied.rank);
    $('campaign-pending').hidden=!changed;
    $('campaign-income-band').textContent=appliedIncome?.label||'Todos los tramos';
    $('campaign-income-load-retry').hidden=!householdError;
  }

  function submitSettings(event) {
    event.preventDefault();
    const single=mode.value==='sector';
    applied={mode:mode.value,age:cohort.value,radius:single?applied.radius:radius.value,
      rank:single?applied.rank:rank.value,limit:single?applied.limit:limit.value};
    if(single)selectedCode=codeInput.value.trim();
    const newBuilding=pendingBuilding;
    pendingBuilding=undefined;
    if(!single && newBuilding)selectBuilding(newBuilding);
    refresh();
  }

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
      cohort.replaceChildren(new Option('Todas las edades','all'),...json.cohorts.map((range,i)=>new Option(ageLabel(range),String(i))));
      const index=json.cohorts.findIndex(range=>range.join('-')===initial.get('edad'));
      applied.age=cohort.value=index<0?'all':String(index);
      cohort.disabled=false;data=json;
    } catch {failed=true;}
    finally {loading=false;refresh();}
  }
  function useSector(code,scroll=true) {
    selectedCode=codeInput.value=code.trim();applied.mode=mode.value='sector';refresh();
    if(scroll)showAnalysis('campana',true);
  }
  function writeExport() {
    if(!exportPlan) return;
    const {project, radiusKm, order, age, plan, rows, hospital, matches}=exportPlan;
    const pilotSize=plan?.shortlist.length ?? 0;
    const paired=new Map(plan?.pairs.map(pair=>[pair.reference.code,pair.pilot]) ?? []);
    const seenCantons=new Set();
    const lines=rows.map((row,index)=>{
      const canton=row.code.slice(0,4);
      const queries=matches && !seenCantons.has(canton) ? (matches[canton]??0) : null;
      const partner=paired.get(row.code);
      seenCantons.add(canton);
      return [
        row.code,names.get(row.code.slice(0,4)),areaName(row.code),row.lat,row.lon,data.year,
        row.residents,age ?? 'Todas las edades',row.count,row.count/row.residents,project?.name,radiusKm,
        order,row.distance==null?null:Number(row.distance.toFixed(2)),hospital?.item.name,
        hospital?Number(hospital.km.toFixed(2)):null,plan?(index<pilotSize?'Selección':'Resto del radio'):'Sector consultado',
        plan?index+1:null,project?.lat,project?.lon,project?locationType(project):null,pilotSize||null,
        plan?.rows.length,plan?.pilot,plan?.total,plan?plan.pilotGroup/plan.pilot:null,
        plan?plan.group/plan.total:null,plan?metric:null,locality(row),queries,partner?.code,
        partner?row.residents-partner.residents:null,appliedIncome?.label,
        row.income?.eligible,row.income?Math.round(row.income.estimated):null,row.income?.share
      ];
    });
    download(plan?'atlas_litoral_plan_de_campana.csv':'atlas_litoral_sector.csv',[columns,...lines]);
  }

  function updateGeographies(project,radiusKm,plan) {
    const references=plan?.pairs.map(pair=>pair.reference) ?? [];
    const key=plan?JSON.stringify([project.id,project.lat,project.lon,project.name,radiusKm,plan.shortlist.map(row=>row.code),references.map(row=>row.code)]):'';
    if(key!==mapKey) {
      mapKey=key;
      updatePlanMap?.(plan?{project,radius:radiusKm,shortlist:plan.shortlist,references}:null);
    }
    outcomes.setPlan(references.length?JSON.stringify([key,applied.rank,applied.limit,applied.age,...(applied.rank==='income'?[appliedIncome?.label]:[]),project.price,project.rooms,project.sector]):null);
  }

  function unavailable(message) {
    status.textContent=message;
    $('campaign-results').hidden=true;
    $('campaign-export').disabled=true;
    exportPlan=null;
    updateGeographies(null,null,null);
  }

  function drawSingle(age,ageIndex) {
    if(!selectedCode) return unavailable('Elige un sector en el mapa o ingresa su código censal.');
    const row=byCode.get(selectedCode);
    if(!row) return unavailable('Ese código no tiene un sector censal con población en el atlas. Revisa los 12 dígitos o elige el sector en el mapa.');
    const [code,lat,lon,residents,ages]=row, count=ageIndex===null?residents:ages[ageIndex];
    $('campaign-result-title').textContent=codeLabel({code,lat,lon});
    $('campaign-summary').textContent=(code.startsWith('09')?'Guayas':'Santa Elena')+' · '+(names.get(code.slice(0,4))||code.slice(0,4))+' · Código INEC '+code;
    $('campaign-announcement').textContent='Sector '+code+' · '+countLabel(residents,'residente','residentes')+'.';
    $('campaign-pop').textContent=number.format(residents);
    $('campaign-single-age').hidden=ageIndex===null;
    $('campaign-count').textContent=number.format(count);
    $('campaign-age-label').textContent=age;
    $('campaign-share').textContent=percent.format(count/residents)+' de la población del sector';
    $('campaign-location').textContent='Punto interior del sector: '+lat.toFixed(5)+', '+lon.toFixed(5)+'. Compara el polígono con un radio de referencia y verifica qué ubicación admite Google Ads.';
    $('campaign-google-age').hidden=ageIndex===null;
    if(age) $('campaign-google-age').textContent=adsAgeNote(data.cohorts[ageIndex]);
    showCatalog();
    updateGeographies(null,null,null);
    const detail={code,lat,lon,residents,count,income:sectorIncome(code,households,appliedIncome)};
    showIncome([detail],true);
    exportPlan={age,order:'Sector elegido',rows:[detail]};
  }

  function showIncome(rows,single) {
    const card=$('campaign-income-result');
    card.hidden=!appliedIncome;
    if(!appliedIncome)return;
    $('campaign-income-heading').textContent='Ingreso mensual del hogar · '+appliedIncome.label+' · '+(single?'sector consultado':'sectores seleccionados');
    const available=rows.filter(row=>row.income);
    const eligible=available.reduce((sum,row)=>sum+row.income.eligible,0);
    const estimated=available.reduce((sum,row)=>sum+row.income.estimated,0);
    $('campaign-income-estimate').textContent=eligible?'≈ '+number.format(Math.round(estimated))+' hogares':'Sin estimación';
    $('campaign-income-base').textContent=eligible?percent.format(estimated/eligible)+' de '+number.format(eligible)+
      ' hogares con edad conocida de su representante. Censo 2022 y ENIGHUR 2024–2025.':
      !households?(householdError?'No se pudieron cargar los conteos de hogares.':'Cargando los conteos de hogares…'):
      'Sin hogares con edad conocida del representante.';
    if(eligible && applied.age!=='all')$('campaign-income-base').textContent+=' El filtro de edad describe residentes. El ingreso abarca los hogares con edad del representante conocida.';
  }

  function renderRows(rows, age) {
    const body=$('campaign-rows');
    body.replaceChildren();
    $('campaign-income-column').hidden=!appliedIncome;
    $('campaign-age-column').hidden=!age;
    if(age) $('campaign-age-column').textContent=age;
    for(const row of rows) {
      const tr=body.insertRow(), first=tr.insertCell(), button=document.createElement('button');
      button.type='button';button.className='linkbutton';button.textContent=codeLabel(row);
      button.onclick=()=>useSector(row.code);
      const small=document.createElement('small');small.textContent=row.code;
      first.append(button,small);
      tr.insertCell().textContent=km(row.distance);
      tr.insertCell().textContent=number.format(row.residents);
      if(age) tr.insertCell().textContent=number.format(row.count)+' ('+percent.format(row.count/row.residents)+')';
      if(appliedIncome)tr.insertCell().textContent=row.income?'≈ '+number.format(Math.round(row.income.estimated))+
        ' de '+number.format(row.income.eligible):'Sin estimación';
    }
  }

  function renderReferences(plan) {
    const {pairs,shortlist}=plan;
    $('campaign-references').hidden=!pairs.length;
    if(!pairs.length) return;
    const body=$('campaign-reference-rows');
    body.replaceChildren();
    let pilotTotal=0,referenceTotal=0;
    for(const {pilot,reference} of pairs) {
      const tr=body.insertRow();
      for(const row of [pilot,reference]) {
        const cell=tr.insertCell(),button=document.createElement('button');
        button.className='linkbutton';button.type='button';button.textContent=codeLabel(row);
        button.onclick=()=>useSector(row.code);
        const note=document.createElement('small');
        note.textContent=row.code+' · '+countLabel(row.residents,'residente','residentes');
        cell.append(button,note);
      }
      const delta=reference.residents-pilot.residents;
      tr.insertCell().textContent=(delta>0?'+':'')+number.format(delta);
      pilotTotal+=pilot.residents;
      referenceTotal+=reference.residents;
    }
    $('campaign-reference-summary').textContent='Sectores piloto con referencia: '+number.format(pairs.length)+' de '+number.format(shortlist.length)+'. En estos pares se censaron '+number.format(pilotTotal)+' residentes en el piloto y '+number.format(referenceTotal)+' en la referencia.';
  }

  function renderObserved(shortlist,matches) {
    const target=$('campaign-observed');
    $('campaign-all-origins').hidden=!matches;
    if(!matches) {
      target.textContent='Importa tus consultas para ver desde qué cantones preguntaron por una vivienda compatible con este proyecto.';
      return;
    }
    const ranked=Object.entries(matches).sort(([codeA,countA],[codeB,countB])=>countB-countA || codeA.localeCompare(codeB));
    if(!ranked.length) {
      target.textContent='Tu archivo no registra consultas compatibles con el sector, los dormitorios y el precio del proyecto en los últimos 90 días.';
      return;
    }
    const pilotCantons=new Set(shortlist.map(row=>row.code.slice(0,4)));
    const origins=ranked.slice(0,3).map(([code,count])=>(names.get(code)||code)+' ('+number.format(count)+')');
    const outside=ranked.filter(([code])=>!pilotCantons.has(code)).reduce((sum,[,count])=>sum+count,0);
    target.textContent='Principales cantones de origen en tu muestra de los últimos 90 días: '+origins.join(', ')+'. '+
      (outside?countLabel(outside,'consulta proviene','consultas provienen')+' de cantones distintos a los del piloto. ':'')+
      'Los conteos corresponden a cantones completos. Cada solicitud se cuenta una sola vez.';
  }

  function drawPlan(project,age,ageIndex,matches) {
    if(!project) return unavailable('Elige un proyecto o marca un punto en el mapa para comparar los sectores cercanos.');
    const radiusKm=Number(applied.radius);
    const plan=rankSectors(data.sectors,project,radiusKm,applied.rank,Number(applied.limit),ageIndex,households,appliedIncome);
    if(!plan.rows.length) return unavailable('No hay sectores censados dentro de este radio. Amplía el radio o elige otro proyecto.');

    const {rows,shortlist,total,pilot,group,pilotGroup}=plan;
    if(!shortlist.length) return unavailable('Ningún sector de este radio tiene hogares estimados en el tramo. Ajusta el radio o el tramo de ingreso.');
    const order=Array.from(rank.options).find(option=>option.value===applied.rank).textContent;
    const paired=plan.pairs.length;
    $('campaign-result-title').textContent='Sectores de prueba para '+project.name;
    $('campaign-summary').textContent=km(radiusKm)+' desde el '+locationType(project).toLowerCase()+' · '+order+'.';
    $('campaign-announcement').textContent=countLabel(shortlist.length,'sector seleccionado','sectores seleccionados')+' de '+number.format(rows.length)+'. '+countLabel(pilot,'residente en la selección','residentes en la selección')+'.';
    $('campaign-pilot-size').textContent=number.format(shortlist.length);
    $('campaign-area-size').textContent='de '+countLabel(rows.length,'sector en el radio','sectores en el radio');
    $('campaign-pilot-pop').textContent=number.format(pilot);
    $('campaign-pilot-coverage').textContent=percent.format(pilot/total)+' de la población del radio';
    $('campaign-area-pop').textContent=number.format(total);
    $('campaign-rest-pop').textContent=number.format(total-pilot)+' fuera de la selección';
    $('campaign-age-benchmark').hidden=!age;
    if(age) $('campaign-age-benchmark').textContent=age+' · '+number.format(pilotGroup)+' residentes en la selección ('+percent.format(pilotGroup/pilot)+') y '+number.format(group)+' en todo el radio ('+percent.format(group/total)+').';
    $('campaign-google-age').hidden=true;
    showIncome(shortlist,false);
    renderRows(shortlist,age);

    renderReferences(plan);
    $('campaign-measure').hidden=!paired;
    const test=$('campaign-test-area');
    test.textContent=paired?'Prueba el mismo anuncio y la misma oferta con presupuestos equivalentes en la zona piloto y en la de referencia. Revisa los pares sugeridos y verifica que ambas zonas de pauta estén disponibles y no se superpongan.':'La selección cubre todos los sectores disponibles. Amplía el radio o reduce la selección para obtener otra zona de comparación.';
    if(paired && paired<shortlist.length) test.textContent+=' Hay menos sectores de referencia que sectores piloto. Compara los pares disponibles o amplía el radio.';

    const hospital=hospitals?.length?nearestFacility(project.lat,project.lon,hospitals):null;
    $('campaign-hospital').hidden=!hospital;
    if(hospital) $('campaign-hospital').textContent='Un dato para el anuncio: '+hospital.item.name+' figura a '+km(hospital.km)+' en línea recta desde el proyecto. Verifica el trayecto antes de ofrecer tiempos de viaje.';
    renderObserved(shortlist,matches);
    updateGeographies(project,radiusKm,plan);
    exportPlan={project,radiusKm,order,age,plan,rows,hospital,matches};
  }

  function refresh() {
    const {project:active,buildings,matches,sample,localities,selectionStarted}=state();
    const project=active ?? (selectionStarted?null:buildings[0]);
    if(optionsList!==buildings) {
      optionsList=buildings;
      building.replaceChildren(...buildings.map(b=>new Option(b.name+(b.reference?' · referencia':''),b.id)));
      const placeholder=new Option(buildings.length?'Elegir un proyecto':'Sin proyectos registrados','');
      placeholder.disabled=true;building.add(placeholder,0);
      building.disabled=!buildings.length;
    }
    if(pendingBuilding!==undefined && (!buildings.some(b=>b.id===pendingBuilding) || pendingBuilding===project?.id))pendingBuilding=undefined;
    building.value=pendingBuilding??project?.id??'';
    const single=applied.mode==='sector';
    const sectorPoint=single && byCode?.get(selectedCode);
    parishIncome.setPoint(single
      ? (sectorPoint ? {lat:sectorPoint[1],lon:sectorPoint[2],name:'Sector '+selectedCode} : null)
      : project, single);
    syncForm();
    const ageIndex=applied.age==='all'?null:Number(applied.age);
    const key=[single,selectedCode,project,matches,sample,localities,applied.rank,applied.radius,applied.limit,applied.age,data,failed,hospitals,facilitiesReady,households,householdError,appliedIncome];
    if(lastView && key.every((v,i)=>v===lastView[i])) return;
    lastView=key;
    $('campaign-retry').hidden=!failed;
    if(!data) {
      unavailable(failed?'No se pudo cargar la base censal.':'Cargando los conteos de residentes…');
      if(!loading && !failed) loadData();
      return;
    }
    status.textContent='';
    exportPlan=null;
    $('campaign-single').hidden=!single;
    $('campaign-list').hidden=single;
    const age=ageIndex===null?null:ageLabel(data.cohorts[ageIndex]);
    if(single) drawSingle(age,ageIndex);
    else drawPlan(project,age,ageIndex,project && (matchesForProject?matchesForProject(project):matches));
    $('campaign-results').hidden=!exportPlan;
    $('campaign-export').disabled=!exportPlan;
  }
  building.onchange=()=>{
    const {project,buildings,selectionStarted}=state();
    const current=project??(selectionStarted?null:buildings[0]);
    pendingBuilding=building.value===current?.id?undefined:building.value;
    syncForm();
  };
  radius.oninput=mode.onchange=cohort.onchange=rank.onchange=limit.onchange=codeInput.oninput=syncForm;
  $('campaign-back').onclick=()=>{applied.mode=mode.value='near';refresh();mode.focus();};
  $('campaign-params').onsubmit=submitSettings;
  $('campaign-income-link').onclick=()=>{ $('ingresos-parroquiales').open=true; };
  $('campaign-income-load-retry').onclick=loadHouseholds;
  $('campaign-pick').onclick=pickOnMap;
  $('campaign-preview').onclick=()=>{
    if(!adRadius.reportValidity()) return;
    const row=byCode?.get(selectedCode);
    if(row) previewRadius(row[0],row[1],row[2],adRadius.valueAsNumber);
  };
  $('campaign-retry').onclick=()=>{failed=false;lastView=null;refresh();};
  $('campaign-export').onclick=writeExport;
  $('campaign-all-origins').onclick=()=>showOrigins(exportPlan.project);
  loadHouseholds();refresh();
  return {refresh,useSector,compareParish:parishIncome.compareParish,setScoreScenario:parishIncome.setScoreScenario,showParishIncomeBand:parishIncome.showBand,useProject(){pendingBuilding=undefined;applied.mode=mode.value='near';refresh();},setHospitals(items){facilitiesReady=true;hospitals=items;refresh();}};
}
