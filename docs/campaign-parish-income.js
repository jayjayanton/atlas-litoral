import {featureAt} from './model.js';
import {parseCoordinates} from './buildings.js';
import {queryCampaignParishes} from './parish-income.js';
import {readCompressedJSON} from './compressed-json.js';
import {scoreParishes} from './parish-suitability.js';
import {incomeRangeProvinces} from './income-range.js';
import {incomeBandLabels} from './income-map.js';
import {groupMunicipalParishes} from './parishes.js';

const $ = id => document.getElementById(id);
const integer = new Intl.NumberFormat('es-EC');
const percent = new Intl.NumberFormat('es-EC',{style:'percent',maximumFractionDigits:1});
const distance = new Intl.NumberFormat('es-EC',{maximumFractionDigits:1});
const points = new Intl.NumberFormat('es-EC',{maximumFractionDigits:2});
const filterNumber = new Intl.NumberFormat('es-EC',{maximumFractionDigits:12});
const scoreText = score => points.format(score)+' / 100';
const cellsText = row => (row.validCells===row.cells ? integer.format(row.validCells) : integer.format(row.validCells)+' de '+integer.format(row.cells))+(row.cells===1?' celda de 500 m':' celdas de 500 m');
const titleCase = text => text.toLocaleLowerCase('es')
  .replace(/(^|[\s(])\p{L}/gu, initial => initial.toLocaleUpperCase('es'))
  .replace(/\b(De|Del|Y)\b/g, word=>word.toLowerCase());
const distanceLabel = km => km===0 ? 'Contiene el punto · 0 km' : (km<.1 ? 'A menos de 0,1' : 'A '+distance.format(km))+' km del límite';

function element(tag,text) {
  const node=document.createElement(tag);
  node.textContent=text;
  return node;
}

function initParishMap() {
  const container=$('parish-income-map'), reset=$('parish-income-reset');
  let map, background, matches, origin, extent, buttons, grouping, nearby;
  const plotted=new Map(), fills=new Map();
  const colors=['#f3e8ed','#e3c4d1','#cc9eb1','#af748f','#86445f'];
  const cuts=[.05,.1,.2,.35];
  const incomeKey=$('parish-map-income-key');
  const labels=['Menos del 5 %','5–<10 %','10–<20 %','20–<35 %','35 % o más'];
  for(const [i,label] of labels.entries()) {
    const item=element('span',label),swatch=document.createElement('i');
    swatch.style.backgroundColor=colors[i];item.prepend(swatch);incomeKey.append(item);
  }
  function choose(code,fromList=false) {
    for(const [id,polygon] of plotted) {
      const selected=id===code;
      polygon.setStyle({weight:selected?3.4:1.7,color:selected?'#49223b':'#82536e',
        fillColor:fills.get(id) || (selected?'#a76187':'#d7b7c9'),fillOpacity:.85});
      buttons.get(id).setAttribute('aria-pressed',String(id===code));
    }
    reset.hidden=!code;
    const chosen=plotted.get(code);
    if(chosen)chosen.bringToFront();
    origin?.bringToFront();
    const bounds=chosen?chosen.getBounds():extent;
    if(origin && nearby)bounds.extend(origin.getLatLng());
    map.fitBounds(bounds,{padding:[18,18],maxZoom:13,animate:false});
    if(fromList && matchMedia('(max-width:600px)').matches)container.scrollIntoView({block:'nearest'});
  }
  reset.onclick=()=>choose('');
  return function render({point,rows,areas,urban,reference,rowButtons,method}) {
    nearby=method==='nearby';
    if(!map) {
      map=L.map(container,{scrollWheelZoom:false,attributionControl:false,zoomSnap:.25,minZoom:3,maxZoom:17}).setView(point?[point.lat,point.lon]:[-2,-80],8);
      L.control.attribution({prefix:false}).addTo(map).addAttribution('CONALI · Municipio de Guayaquil');
      L.control.scale({imperial:false,position:'bottomleft'}).addTo(map);
      matches=L.layerGroup().addTo(map);
      if(window.ResizeObserver)new ResizeObserver(()=>map.invalidateSize({pan:false})).observe(container);
    }
    map.invalidateSize({pan:false});
    if(grouping!==urban) {
      background?.remove();
      background=L.geoJSON(areas,{interactive:false,style:{color:'#b8b1a5',weight:.8,fillColor:'#f4f2eb',fillOpacity:1}}).addTo(map);
      background.bringToBack();
      grouping=urban;
    }
    matches.clearLayers();plotted.clear();fills.clear();buttons=rowButtons;
    const mappedIncome=rows.some(row=>row.share!=null);
    incomeKey.hidden=!mappedIncome;
    $('parish-result-legend').hidden=mappedIncome;
    extent=L.latLngBounds([]);origin=null;
    $('parish-origin-legend').hidden=!point;
    $('parish-ref-legend').hidden=!reference;
    if(point) {
      const anchor=[point.lat,point.lon];
      origin=L.circleMarker(anchor,{radius:5,color:'white',weight:2,fillColor:'#442437',fillOpacity:1})
        .bindTooltip(element('span',point.name)).addTo(matches);
      extent.extend(anchor);
    }
    if(reference) {
      const feature=areas.find(f=>f.properties.code===reference.code);
      const layer=L.geoJSON(feature,{interactive:false,style:{weight:3,color:'#234f53',fillColor:'#c8ddda',fillOpacity:.55,dashArray:'6 4'}}).addTo(matches);
      extent.extend(layer.getBounds().getCenter());
    }
    rows.forEach((row,i)=>{
      const feature=areas.find(f=>f.properties.code===row.code);
      const layer=L.geoJSON(feature).getLayers()[0].addTo(matches);
      layer.bindTooltip(element('span',String(i+1)),{permanent:true,direction:'center',className:'parish-income-number'});
      layer.on('click',()=>choose(row.code));
      buttons.get(row.code).onclick=()=>choose(row.code,true);
      if(row.share!=null)fills.set(row.code,colors[cuts.filter(cut=>row.share>=cut).length]);
      plotted.set(row.code,layer);
      extent.extend(layer.getCenter());
    });
    // Include a shape's extent when all mapped result centres happen to coincide.
    if(extent.getSouthWest().equals(extent.getNorthEast()))extent.extend(plotted.values().next().value.getBounds());
    choose('');
  };
}

export function initCampaignParishIncome({cantons,parishes,sectorIndex,shareQuery,onApplyIncome}) {
  const panel=$('ingresos-parroquiales'), band=$('parish-income-band'), group=$('parish-income-group');
  const minimum=$('parish-income-min'), status=$('parish-income-status'), output=$('parish-income-results');
  const retry=$('parish-income-retry'), list=$('parish-income-list'), urbanNote=$('parish-income-urban-note');
  const share=$('parish-share-query'), useCampaignPoint=$('parish-use-campaign-point');
  const names=new Map(cantons.map(f=>[f.properties.code,f.properties.name]));
  const urbanSeat=parishes?.find(f=>f.properties.code==='090150');
  const drawMap=initParishMap(), files=new Map();
  const form=$('parish-query-form'), pending=$('parish-pending'), appliedBox=$('parish-applied');
  const method=$('parish-query-mode'), minScore=$('parish-score-min'), source=$('parish-score-source');
  const lower=$('parish-income-lower'), upper=$('parish-income-upper'), refCard=$('parish-score-reference');
  const allIncomes=new Option('Todos los tramos',''), customIncome=new Option('Rango personalizado','range');
  let campaignPoint, linkedPoint, sectorMode=false, anchorKey, choiceMade=false;
  let scenario, scoreControls, scores, scoreKey, shareUrl, lastIncomeKey;
  let applied, dirty=false, needsRender=false, committing=false, revision=0;
  let sourceGroup, preferredSource='', optionsRevision=0, lastNearbyBand='1';
  if(sectorIndex) {
    band.replaceChildren(...incomeBandLabels(sectorIndex.incomeCuts).map((name,i)=>new Option(name,String(i))));
    band.value=lastNearbyBand;band.disabled=false;
  }
  function load(file) {
    if(!files.has(file))files.set(file,(file.endsWith('.gz')?readCompressedJSON('./data/'+file):fetch('./data/'+file).then(response=>{
      if(!response.ok)throw new Error(file);
      return response.json();
    })).catch(error=>{files.delete(file);throw error;}));
    return files.get(file);
  }
  function pointFor(query, shared) {
    return query!=='nearby' && shared!==undefined ? shared : campaignPoint;
  }

  function updateInputs() {
    const scored=method.value!=='nearby';
    const point=pointFor(method.value,linkedPoint);
    if(scored) {
      if(!band.contains(allIncomes))band.insertBefore(allIncomes,band.firstChild);
    } else {
      if(band.value==='')band.value=lastNearbyBand;
      allIncomes.remove();
    }
    // A chosen income range also works when switching back to distance order.
    if(sectorIndex && !band.contains(customIncome))band.append(customIncome);
    const custom=band.value==='range';
    $('parish-score-settings').hidden=!scored;
    $('parish-score-source-field').hidden=method.value!=='similar';
    $('parish-score-min-field').hidden=method.value!=='minimum';
    $('parish-income-min-field').hidden=band.value==='';
    $('parish-income-lower-field').hidden=$('parish-income-upper-field').hidden=$('parish-custom-hint').hidden=!custom;
    useCampaignPoint.hidden=!scored || linkedPoint===undefined || !campaignPoint ||
      (point?.lat===campaignPoint.lat && point?.lon===campaignPoint.lon);
    if(!choiceMade)group.value=point ?
      (urbanSeat && featureAt([urbanSeat],point.lat,point.lon)?'urban':'census') : (scored?'urban':'census');
    const place=sectorMode?'punto interior del sector censal':point?.reference?'ubicación aproximada del proyecto':point?.temporary?'punto marcado en el mapa':'ubicación del proyecto';
    $('parish-income-origin').textContent=point?.linked?'Punto de la consulta · '+point.lat+', '+point.lon:point?
      'Desde '+point.name+' · '+place:scored?'Guayas y Santa Elena':'Elige un proyecto o marca un punto en el mapa para comparar sus parroquias cercanas.';
    if(method.value==='similar')prepareReferences();
  }

  async function prepareReferences() {
    const ticket=++optionsRevision, urban=group.value==='urban';
    const first=pointFor(method.value,linkedPoint)?'Usar la parroquia del punto':'Elegir una parroquia';
    if(sourceGroup===urban){source.options[0].text=first;source.disabled=false;return;}
    source.disabled=true;
    try {
      const urbanParishes=urban?groupMunicipalParishes((await load('guayaquil-urban.json')).features):null;
      if(ticket!==optionsRevision)return;
      const areas=urban?[...(parishes||[]).filter(f=>f.properties.code!=='090150'),...urbanParishes]:[...(parishes||[])];
      areas.sort((a,b)=>a.properties.name.localeCompare(b.properties.name,'es'));
      source.replaceChildren(new Option(first,''),...areas.map(f=>new Option(
        titleCase(f.properties.name)+' · '+f.properties.kind+' · '+(names.get(f.properties.canton)||f.properties.canton),f.properties.code)));
      preferredSource=areas.some(f=>f.properties.code===preferredSource)?preferredSource:'';
      source.value=preferredSource;sourceGroup=urban;
    } catch {
      if(ticket===optionsRevision)source.replaceChildren(new Option('No se pudieron cargar los nombres',''));
    } finally {if(ticket===optionsRevision)source.disabled=false;}
  }

  function showRows(result,areas,urban,query,point) {
    const {rows,reference}=result, buttons=new Map(),scored=query.method!=='nearby';
    list.setAttribute('aria-label',scored?'Parroquias que cumplen la búsqueda por puntaje':'Parroquias por distancia al punto de campaña');
    list.replaceChildren(...rows.map((row,i)=>{
      const item=document.createElement('li'), button=document.createElement('button');
      button.type='button';button.setAttribute('aria-controls','parish-income-map');
      const value=element('b',scored?scoreText(row.score):percent.format(row.share));
      if(scored)value.className='parish-result-score';
      button.append(element('strong',(i+1)+'. '+titleCase(row.name)),value,
        element('small',row.kind+' · '+titleCase(names.get(row.canton)||row.canton)));
      if(row.share!=null) {
        const income=element('small',(scored?percent.format(row.share)+' · ':'')+
          '≈ '+integer.format(Math.round(row.estimatedHouseholds))+' de '+integer.format(row.eligibleHouseholds)+' hogares en la base de estimación');
        income.className='parish-row-income';button.append(income);
      }
      if(reference) {
        const gap=Math.abs(row.difference);
        const label=gap===0?'Mismo puntaje que la referencia':(gap<.01?'Menos de 0,01':points.format(gap))+' puntos '+(row.difference>0?'por encima':'por debajo')+' de la referencia';
        const detail=element('small',label);detail.className='parish-score-difference';button.append(detail);
      }
      if(scored)button.append(element('small','Aptitud media de '+cellsText(row)));
      if(row.distanceKm!=null)button.append(element('small',distanceLabel(row.distanceKm)));
      buttons.set(row.code,button);item.append(button);return item;
    }));
    output.hidden=false;
    drawMap({point,rows,areas,urban,reference,rowButtons:buttons,method:query.method});
  }

  function checkInputs(custom) {
    const requireScore=method.value==='minimum', useIncome=band.value!=='';
    const badScore=requireScore && !minScore.validity.valid;
    const badMin=useIncome && !minimum.validity.valid;
    const lo=lower.valueAsNumber,hi=upper.valueAsNumber;
    const badLo=custom && (!Number.isFinite(lo)||!lower.validity.valid);
    const badHi=custom && (!Number.isFinite(hi)||!upper.validity.valid||hi<=lo);
    [[minScore,badScore],[minimum,badMin],[lower,badLo],[upper,badHi]].forEach(([el,bad])=>el.setAttribute('aria-invalid',String(bad)));
    if(badScore)return 'El puntaje de aptitud va de 0 a 100. Ingresa un mínimo dentro de esa escala.';
    if(badLo||badHi)return 'Ingresa dos límites de ingreso entre $0 y $100.000 en pasos de $100. El límite superior debe ser mayor.';
    if(badMin)return 'Ingresa un porcentaje mínimo entre 0 y 100, o deja el campo vacío.';
    return '';
  }

  function showReference(reference) {
    refCard.hidden=false;
    const name=element('strong',titleCase(reference.name));
    const value=element('b',reference.score==null?'Sin puntaje':scoreText(reference.score));
    const coverage=reference.score==null?'Sin celdas con datos suficientes para estos criterios.':cellsText(reference)+' con datos de aptitud.';
    refCard.replaceChildren(element('small','Parroquia de referencia'),name,value,element('span',coverage));
  }

  function readDraft() {
    const value=band.value, custom=value==='range';
    return {method:method.value, band:value, lower:lower.valueAsNumber, upper:upper.valueAsNumber,
      label:custom?'$'+integer.format(lower.valueAsNumber)+' a menos de $'+integer.format(upper.valueAsNumber):
        value===''?'Todos los tramos':band.selectedOptions[0]?.textContent,
      minShare:value!=='' && minimum.value!==''?minimum.valueAsNumber/100:0, minScore:minScore.valueAsNumber,
      reference:preferredSource, division:group.value, autoDivision:!choiceMade, sharedPoint:linkedPoint,
      scenario:scoreControls?.readDraft()??scenario};
  }

  function queryUrl(query,reference,point,urban) {
    const url=new URL(location.href);
    url.search='';url.hash=panel.id;
    const params=url.searchParams,config=query.scenario;
    params.set('comparar',reference?'similares':'puntaje');
    if(reference)params.set('referencia',reference.code);
    else params.set('minPuntaje',String(query.minScore));
    params.set('division',urban?'urban':'census');
    params.set('origen',point?point.lat+','+point.lon:'');
    params.set('modelo',config.preset);
    if(config.preset==='custom')params.set('pesos',config.weights.join(','));
    params.set('radio',String(config.radius));params.set('red',config.scope);
    if(Number.isFinite(config.limit) && config.limit>=.1 && config.limit<=200)params.set('via',String(config.limit));
    if(query.band==='range') {
      params.set('desde',String(query.lower));params.set('hasta',String(query.upper));
    } else if(query.band!=='')params.set('tramo',query.band);
    if(query.minShare>0)params.set('porcentaje',String(Number((query.minShare*100).toFixed(12))));
    return url;
  }

  function showApplied(query,result,point) {
    const order=query.method==='similar'?'Diferencia de aptitud con '+titleCase(result.reference?.name||'la referencia'):
      query.method==='minimum'?'Aptitud de '+filterNumber.format(query.minScore)+' o más':'Cercanía a '+(point?.name||'la ubicación');
    $('parish-applied-filters').textContent=order+' · '+(query.band===''?'Todos los ingresos':query.label+' al mes')+
      (query.minShare?' · Mínimo de hogares en ese tramo: '+filterNumber.format(query.minShare*100)+' %':'');
    const total=$('parish-household-total');
    total.hidden=query.band==='' || !result.rows.length;
    if(!total.hidden) {
      const homes=result.rows.reduce((sum,row)=>sum+row.eligibleHouseholds,0);
      const estimated=result.rows.reduce((sum,row)=>sum+row.estimatedHouseholds,0);
      total.textContent='≈ '+integer.format(Math.round(estimated))+' hogares en el tramo · '+percent.format(estimated/homes)+
        ' de '+integer.format(homes)+' hogares con edad conocida en '+(result.rows.length===1?'la parroquia mostrada':'las '+result.rows.length+' parroquias mostradas')+'.';
    }
    $('parish-pilot-link').hidden=query.band==='' || $('campaign-results').hidden;
    appliedBox.hidden=false;
  }

  function pendingChanges(message) {
    dirty=true;share.disabled=true;
    pending.textContent=message||'Cambios sin aplicar. Pulsa Calcular comparación.';
  }
  function clearPending() {dirty=false;pending.textContent='';}
  function clearResult() {
    output.hidden=true;refCard.hidden=true;appliedBox.hidden=true;
    shareUrl=undefined;share.disabled=true;
  }
  function applyIncome(query,provinces,bandIndex) {
    const key=JSON.stringify([query.band,query.band==='range'?query.lower:null,query.band==='range'?query.upper:null]);
    if(key===lastIncomeKey)return;
    lastIncomeKey=key;
    onApplyIncome?.(query.band===''?null:{label:query.label,band:bandIndex,provinces});
  }

  async function calculate(query) {
    const ticket=++revision;
    needsRender=false;
    const point=pointFor(query.method,query.sharedPoint), scored=query.method!=='nearby';
    const useIncome=query.band!=='', custom=query.band==='range', config=query.scenario;
    let urban=query.division==='urban';
    if(query.autoDivision)urban=point?!!(urbanSeat && featureAt([urbanSeat],point.lat,point.lon)):scored;
    retry.hidden=true;share.disabled=true;
    if(!point && !scored){clearResult();status.textContent='Elige un proyecto o un sector para calcular la cercanía.';return;}
    if(scored && !config?.valid) {
      clearResult();status.textContent=config===undefined?'Cargando el escenario de aptitud…':
        config?.message||'El escenario de aptitud no está disponible.';
      return;
    }
    if(!parishes?.length || (useIncome && !sectorIndex)){clearResult();status.textContent='No se pudieron cargar los datos de la consulta. Recarga la página para reintentar.';return;}
    status.textContent='Calculando la comparación…';
    try {
      const [households,boundaries,counts,grid,distribution]=await Promise.all([
        useIncome?load('parish-income-households.json'):null,urban?load('guayaquil-urban.json'):null,
        urban && useIncome?load('guayaquil-urban-households.json'):null,scored?load('infra/parish-suitability.json.gz'):null,
        custom?load('parish-income-ranges.json'):null
      ]);
      if(ticket!==revision)return;
      let urbanParishes=urban?groupMunicipalParishes(boundaries.features):undefined;
      if(urban && query.autoDivision && point && !featureAt(urbanParishes,point.lat,point.lon)) {
        urban=false;urbanParishes=undefined;
        if(!dirty && query===applied){group.value='census';if(method.value==='similar')prepareReferences();}
      }
      const areas=urban?[...parishes.filter(f=>f.properties.code!=='090150'),...urbanParishes]:parishes;
      if(scored) {
        const key=JSON.stringify([config.weights,config.radius,config.scope,config.limit]);
        if(scoreKey!==key){scores=scoreParishes(grid,config);scoreKey=key;}
      }
      const provinces=custom?incomeRangeProvinces(distribution,query.lower,query.upper):sectorIndex?.provinces;
      const bandIndex=useIncome?(custom?0:Number(query.band)):null;
      const result=queryCampaignParishes({point,method:query.method,referenceCode:query.reference,band:bandIndex,
        minShare:query.minShare,minScore:query.minScore,parishes,households,provinces,
        urbanParishes,urbanHouseholds:urban?counts?.households:undefined,scores});
      clearResult();
      urbanNote.hidden=!urban||!useIncome;
      if(urban && useIncome) {
        const coverage=counts.coverage;
        urbanNote.textContent='La división municipal de Guayaquil incluye '+integer.format(coverage.assignedHouseholds)+
          ' de '+integer.format(coverage.mappedHouseholds)+' hogares en los sectores cartografiados de la cabecera. Cada sector se asigna por su punto interior.';
      }
      if(query.method==='similar') {
        if(!result.reference){status.textContent='Elige una parroquia de referencia o selecciona un punto dentro de su límite.';return;}
        showReference(result.reference);
        if(result.reference.score==null){status.textContent='Elige una parroquia de referencia con un puntaje disponible.';return;}
      }
      applyIncome(query,provinces,bandIndex);
      showApplied(query,result,point);
      share.hidden=!scored||!shareQuery;
      if(scored && shareQuery){shareUrl=queryUrl(query,result.reference,point,urban);share.disabled=dirty;}
      const found=result.rows.length;
      if(!found) {
        status.textContent=query.method==='minimum' && result.maxScore!=null?
          'Ninguna parroquia alcanza ese puntaje mínimo. El mayor puntaje con los demás filtros es '+scoreText(result.maxScore)+'.':
          'Ninguna parroquia con datos cumple estos filtros. Prueba otro tramo o reduce el mínimo.';
        return;
      }
      const order=query.method==='similar'?'menor diferencia con la referencia':scored?'mayor puntaje':'menor distancia al punto';
      status.textContent=(found===1?'1 parroquia':found+' parroquias')+(result.matchedCount>found?' de '+integer.format(result.matchedCount)+' coincidencias':'')+
        ', en orden de '+order+'. Toca una fila para ubicarla.';
      showRows(result,areas,urban,query,point);
    } catch {
      if(ticket!==revision)return;
      share.disabled=true;status.textContent='No se pudo completar la comparación.';retry.hidden=false;
    }
  }

  function applyDraft(commitScore=false) {
    updateInputs();
    const query=readDraft(),scored=query.method!=='nearby';
    let message=checkInputs(query.band==='range');
    if(scored && query.scenario!==undefined && !query.scenario?.valid)message=query.scenario?.message||'No se pudo cargar la aptitud.';
    if(message) {
      pendingChanges(message);
      form.querySelector('[aria-invalid="true"]')?.focus();
      return;
    }
    if(scored && commitScore && scoreControls && query.scenario?.valid) {
      committing=true;
      try {query.scenario=scoreControls.applyDraft();}
      finally {committing=false;}
    }
    clearPending();applied=query;calculate(query);
  }

  form.addEventListener('submit',event=>{event.preventDefault();applyDraft(true);});
  function edited(event) {
    const target=event.target;
    if(target===group){choiceMade=true;preferredSource='';source.value='';}
    if(target===source)preferredSource=source.value;
    if(target===band && band.value!=='')lastNearbyBand=band.value;
    updateInputs();pendingChanges();
  }
  form.addEventListener('input',edited);
  form.addEventListener('change',edited);
  share.onclick=()=>{if(!dirty && shareUrl)shareQuery(shareUrl);};
  retry.onclick=()=>{if(applied)calculate(applied);};
  useCampaignPoint.onclick=()=>{linkedPoint=undefined;updateInputs();pendingChanges();};
  panel.addEventListener('toggle',()=>{
    if(!panel.open)return;
    updateInputs();
    if(!applied && !dirty) {
      if(method.value==='nearby' && !$('sector-income-card').hidden && /^[0-4]$/.test($('sector-profile-band').value))
        band.value=lastNearbyBand=$('sector-profile-band').value;
      applyDraft();
    }
    else if(needsRender && applied)calculate(applied);
  });

  const queryParams=new URLSearchParams(location.search);
  if(location.hash==='#'+panel.id && ['puntaje','similares'].includes(queryParams.get('comparar'))) {
    method.value=queryParams.get('comparar')==='puntaje'?'minimum':'similar';
    if(['urban','census'].includes(queryParams.get('division'))){group.value=queryParams.get('division');choiceMade=true;}
    if(method.value==='similar')preferredSource=queryParams.get('referencia')||'';
    if(queryParams.has('origen')) {
      const coords=parseCoordinates(queryParams.get('origen'));
      if(coords)linkedPoint={...coords,name:'Punto de la consulta',linked:true};
      else if(queryParams.get('origen')==='')linkedPoint=null;
    }
    updateInputs();
    band.value='';
    if(queryParams.has('minPuntaje'))minScore.value=queryParams.get('minPuntaje');
    if(queryParams.has('desde') || queryParams.has('hasta')) {
      band.value='range';lower.value=queryParams.get('desde')??'';upper.value=queryParams.get('hasta')??'';
    } else if(/^[0-4]$/.test(queryParams.get('tramo')))band.value=queryParams.get('tramo');
    if(queryParams.has('porcentaje'))minimum.value=queryParams.get('porcentaje');
  }
  function openFromLink(){if(location.hash==='#'+panel.id)panel.open=true;}
  window.addEventListener('hashchange',openFromLink);openFromLink();

  // A sector-map income choice follows the user when they scroll to the plan.
  // Existing results continue to describe the previously submitted band.
  $('income-band').addEventListener('change',event=>{
    if(!/^[0-4]$/.test(event.target.value) || band.value===event.target.value)return;
    lastNearbyBand=band.value=event.target.value;updateInputs();pendingChanges();
  });

  function showBand(value) {
    linkedPoint=undefined;method.value='nearby';updateInputs();
    lastNearbyBand=band.value=value;panel.open=true;applyDraft();
  }
  function compareParish(code) {
    if(!code)return;
    if(code.startsWith('gye-'))group.value='urban';
    else if(code==='090150')group.value='census';
    linkedPoint=undefined;choiceMade=true;preferredSource=code;method.value='similar';
    if(sourceGroup===(group.value==='urban'))source.value=code;
    panel.open=true;applyDraft();panel.scrollIntoView({block:'start'});
  }
  function setScoreScenario(next,controls) {
    if(controls)scoreControls=controls;
    const previous=scenario;scenario=next;
    if(committing || method.value==='nearby')return;
    if(applied && applied.method!=='nearby' && applied.scenario===undefined) {
      applied={...applied,scenario:next};calculate(applied);
    } else if(previous!==undefined && JSON.stringify(previous)!==JSON.stringify(next))pendingChanges();
  }
  return {showBand,compareParish,setScoreScenario,setPoint(next,single) {
    const key=JSON.stringify([next?.lat,next?.lon,next?.name,next?.reference,next?.temporary,single]);
    if(key===anchorKey)return;
    anchorKey=key;campaignPoint=next;sectorMode=single;
    if(!panel.open){needsRender=true;return;}
    updateInputs();
    if(applied)calculate(applied);
    else if(!dirty)applyDraft();
  }};
}
