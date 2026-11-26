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
  const plotted=new Map();
  function choose(code,fromList=false) {
    for(const [id,polygon] of plotted) {
      polygon.setStyle(id===code ? {weight:3,color:'#682b4b',fillColor:'#a76187',fillOpacity:.74}
        : {weight:1.7,color:'#82536e',fillColor:'#d7b7c9',fillOpacity:.76});
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
    matches.clearLayers();plotted.clear();buttons=rowButtons;
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
      plotted.set(row.code,layer);
      extent.extend(layer.getCenter());
    });
    // Include a shape's extent when all mapped result centres happen to coincide.
    if(extent.getSouthWest().equals(extent.getNorthEast()))extent.extend(plotted.values().next().value.getBounds());
    choose('');
  };
}

export function initCampaignParishIncome({cantons,parishes,sectorIndex,shareQuery}) {
  const panel=$('ingresos-parroquiales'), band=$('parish-income-band'), group=$('parish-income-group');
  const minimum=$('parish-income-min'), status=$('parish-income-status'), output=$('parish-income-results');
  const retry=$('parish-income-retry'), list=$('parish-income-list'), urbanNote=$('parish-income-urban-note');
  const share=$('parish-share-query'), useCampaignPoint=$('parish-use-campaign-point');
  const names=new Map(cantons.map(f=>[f.properties.code,f.properties.name]));
  const urbanSeat=parishes?.find(f=>f.properties.code==='090150');
  const drawMap=initParishMap(), files=new Map();
  let point, campaignPoint, linkedPoint, shareUrl, sectorMode=false, anchorKey, choiceMade=false, revision=0;
  if(sectorIndex) {
    band.replaceChildren(...incomeBandLabels(sectorIndex.incomeCuts).map((name,i)=>new Option(name,String(i))));
    band.value='1';band.disabled=false;
  }
  function load(file) {
    if(!files.has(file))files.set(file,(file.endsWith('.gz')?readCompressedJSON('./data/'+file):fetch('./data/'+file).then(response=>{
      if(!response.ok)throw new Error(file);
      return response.json();
    })).catch(error=>{files.delete(file);throw error;}));
    return files.get(file);
  }
  const method=$('parish-query-mode'), minScore=$('parish-score-min'), source=$('parish-score-source');
  const lower=$('parish-income-lower'), upper=$('parish-income-upper'), refCard=$('parish-score-reference');
  const allIncomes=new Option('Todos los tramos',''), customIncome=new Option('Rango personalizado','range');
  let priorMethod='nearby',nearBand=band.value||'1',scoreBand='',chosenBand=false;
  let scenario, scores, scoreKey, sourceGroup, pendingSource;

  function updateInputs() {
    const scored=method.value!=='nearby';
    point=scored && linkedPoint!==undefined ? linkedPoint : campaignPoint;
    useCampaignPoint.hidden=!scored || linkedPoint===undefined || !campaignPoint ||
      (point?.lat===campaignPoint.lat && point?.lon===campaignPoint.lon);
    if(scored && priorMethod==='nearby') {
      nearBand=band.value;
      if(!band.contains(allIncomes))band.insertBefore(allIncomes,band.firstChild);
      if(!band.contains(customIncome))band.append(customIncome);
      band.value=chosenBand?nearBand:scoreBand;
      chosenBand=false;
    } else if(!scored && priorMethod!=='nearby') {
      scoreBand=band.value;
      allIncomes.remove();customIncome.remove();band.value=nearBand;
    }
    priorMethod=method.value;
    if(!point && !choiceMade)group.value=scored?'urban':'census';
    const custom=scored && band.value==='range';
    $('parish-score-settings').hidden=!scored;
    $('parish-score-source-field').hidden=method.value!=='similar';
    $('parish-score-min-field').hidden=method.value!=='minimum';
    $('parish-income-min-field').hidden=band.value==='';
    $('parish-income-lower-field').hidden=$('parish-income-upper-field').hidden=$('parish-custom-hint').hidden=!custom;
  }

  function referenceOptions(areas,urban) {
    if(sourceGroup!==urban) {
      const previous=source.value;
      const sorted=[...areas].sort((a,b)=>a.properties.name.localeCompare(b.properties.name,'es'));
      source.replaceChildren(new Option('',''),...sorted.map(f=>new Option(
        titleCase(f.properties.name)+' · '+f.properties.kind+' · '+(names.get(f.properties.canton)||f.properties.canton),
        f.properties.code)));
      source.value=areas.some(f=>f.properties.code===previous)?previous:'';
      sourceGroup=urban;
    }
    source.options[0].text=point?'Usar la parroquia del punto':'Elegir una parroquia';
    if(pendingSource) {
      if(areas.some(f=>f.properties.code===pendingSource))source.value=pendingSource;
      pendingSource=undefined;
    }
  }

  function showRows(result,areas,urban,scored) {
    const {rows,reference}=result, buttons=new Map();
    list.setAttribute('aria-label',scored?'Parroquias que cumplen la búsqueda por puntaje':'Parroquias por distancia al punto de campaña');
    list.replaceChildren(...rows.map((row,i)=>{
      const item=document.createElement('li'), button=document.createElement('button');
      button.type='button';button.setAttribute('aria-controls','parish-income-map');
      const value=element('b',scored?scoreText(row.score):percent.format(row.share));
      if(scored)value.className='parish-result-score';
      button.append(element('strong',(i+1)+'. '+titleCase(row.name)),value,
        element('small',row.kind+' · '+titleCase(names.get(row.canton)||row.canton)));
      if(reference) {
        const gap=Math.abs(row.difference);
        const label=gap===0?'Mismo puntaje que la referencia':(gap<.01?'Menos de 0,01':points.format(gap))+' puntos '+(row.difference>0?'por encima':'por debajo')+' de la referencia';
        const detail=element('small',label);detail.className='parish-score-difference';button.append(detail);
      }
      if(scored)button.append(element('small','Aptitud media de '+cellsText(row)));
      if(row.distanceKm!=null)button.append(element('small',distanceLabel(row.distanceKm)));
      if(row.share!=null)button.append(element('small',(scored?percent.format(row.share)+' en el tramo · ':'')+
        '≈ '+integer.format(Math.round(row.estimatedHouseholds))+' de '+integer.format(row.eligibleHouseholds)+' hogares con edad publicada'));
      buttons.set(row.code,button);item.append(button);return item;
    }));
    output.hidden=false;
    drawMap({point,rows,areas,urban,reference,rowButtons:buttons,method:method.value});
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

  function queryUrl(reference) {
    const url=new URL(location.href);
    url.search='';url.hash=panel.id;
    const params=url.searchParams;
    params.set('comparar',reference?'similares':'puntaje');
    if(reference)params.set('referencia',reference.code);
    else params.set('minPuntaje',String(minScore.valueAsNumber));
    params.set('division',group.value);
    params.set('origen',point?point.lat+','+point.lon:'');
    params.set('modelo',scenario.preset);
    if(scenario.preset==='custom')params.set('pesos',scenario.weights.join(','));
    params.set('radio',String(scenario.radius));
    params.set('red',scenario.scope);
    if(Number.isFinite(scenario.limit) && scenario.limit>=.1 && scenario.limit<=200)params.set('via',String(scenario.limit));
    if(band.value==='range') {
      params.set('desde',String(lower.valueAsNumber));
      params.set('hasta',String(upper.valueAsNumber));
    } else if(band.value!=='')params.set('tramo',band.value);
    if(band.value!=='' && minimum.value!=='')params.set('porcentaje',String(minimum.valueAsNumber));
    return url;
  }

  async function refresh() {
    const ticket=++revision;
    if(!panel.open)return;
    updateInputs();
    const query=method.value,scored=query!=='nearby',useIncome=band.value!=='',custom=band.value==='range';
    output.hidden=true;retry.hidden=true;refCard.hidden=true;
    shareUrl=undefined;share.disabled=true;share.hidden=!scored||!shareQuery;
    const urban=group.value==='urban';
    urbanNote.hidden=!urban||!useIncome;
    const location=sectorMode?'punto interior del sector censal':point?.reference?'ubicación aproximada del proyecto':point?.temporary?'punto marcado en el mapa':'ubicación del proyecto';
    $('parish-income-origin').textContent=point?.linked?'Punto de la consulta · '+point.lat+', '+point.lon:point?'Desde '+point.name+' · '+location:scored?'Guayas y Santa Elena':sectorMode?
      'Introduce un código censal válido para usar el punto interior del sector.':'Elige un proyecto o marca un punto en el mapa para comparar sus parroquias cercanas.';
    if(!point && !scored){status.textContent='';return;}
    const invalid=checkInputs(custom);
    if(invalid){status.textContent=invalid;return;}
    if(scored && !scenario?.valid) {
      status.textContent=scenario===undefined?'Cargando el escenario de aptitud…':scenario?.message||'El escenario de aptitud no está disponible. Revisa sus criterios.';
      return;
    }
    if(!parishes?.length || (useIncome && !sectorIndex)) {
      status.textContent='No se pudieron cargar los límites censales o los datos de ingresos. Recarga la página para reintentar.';
      return;
    }
    status.textContent='Consultando las parroquias…';
    try {
      const [households,boundaries,counts,grid,distribution]=await Promise.all([
        useIncome?load('parish-income-households.json'):null,
        urban?load('guayaquil-urban.json'):null,
        urban && useIncome?load('guayaquil-urban-households.json'):null,
        scored?load('infra/parish-suitability.json.gz'):null,
        custom?load('parish-income-ranges.json'):null
      ]);
      if(ticket!==revision || !panel.open)return;
      const urbanParishes=urban?groupMunicipalParishes(boundaries.features):undefined;
      if(urban && !choiceMade && point && !featureAt(urbanParishes,point.lat,point.lon)) {
        group.value='census';refresh();return;
      }
      const areas=urban?[...parishes.filter(f=>f.properties.code!=='090150'),...urbanParishes]:parishes;
      if(query==='similar')referenceOptions(areas,urban);
      if(scored) {
        const key=JSON.stringify([scenario.weights,scenario.radius,scenario.scope,scenario.limit]);
        if(scoreKey!==key){scores=scoreParishes(grid,scenario);scoreKey=key;}
      }
      const result=queryCampaignParishes({point,method:query,referenceCode:source.value,band:useIncome?(custom?0:Number(band.value)):null,
        minShare:useIncome && minimum.value!==''?minimum.valueAsNumber/100:0,minScore:minScore.valueAsNumber,
        parishes,households,provinces:custom?incomeRangeProvinces(distribution,lower.valueAsNumber,upper.valueAsNumber):sectorIndex?.provinces,
        urbanParishes,urbanHouseholds:counts?.households,scores});
      if(urban && useIncome) {
        const coverage=counts.coverage;
        urbanNote.textContent='En Guayaquil se asigna cada sector censal completo según su punto interior en los límites municipales. La división urbana incluye '+
          integer.format(coverage.assignedHouseholds)+' de '+integer.format(coverage.mappedHouseholds)+' hogares de los sectores cartografiados de la cabecera. Los hogares sin ubicación sectorial asignable quedan fuera del cálculo urbano.';
      }
      if(query==='similar') {
        if(!result.reference){status.textContent='Elige una parroquia de referencia por nombre o selecciona un punto dentro de su límite.';return;}
        showReference(result.reference);
        if(result.reference.score==null){status.textContent='Elige una parroquia de referencia con un puntaje disponible.';return;}
      }
      if(scored && shareQuery){shareUrl=queryUrl(result.reference);share.disabled=false;}
      const found=result.rows.length;
      if(!found) {
        status.textContent=query==='minimum' && result.maxScore!=null?
          'Ninguna parroquia alcanza ese puntaje mínimo. El mayor puntaje disponible con los demás filtros es '+scoreText(result.maxScore)+'.':
          'Ninguna parroquia con datos de Guayas y Santa Elena cumple estos filtros. Prueba otro tramo o reduce el mínimo.';
        return;
      }
      const order=query==='similar'?'menor diferencia con la referencia':query==='minimum'?'mayor puntaje':'menor distancia al punto';
      status.textContent=(found===1?'1 parroquia':found+' parroquias')+(result.matchedCount>found?' de '+integer.format(result.matchedCount)+' coincidencias':'')+
        ' en Guayas y Santa Elena, en orden de '+order+'. Toca una fila para ubicarla.';
      showRows(result,areas,urban,scored);
    } catch {
      if(ticket!==revision || !panel.open)return;
      shareUrl=undefined;share.disabled=true;
      output.hidden=true;status.textContent='No se pudo cargar la comparación parroquial.';retry.hidden=false;
    }
  }
  group.onchange=()=>{choiceMade=true;pendingSource=undefined;refresh();};
  share.onclick=()=>{if(shareUrl)shareQuery(shareUrl);};
  useCampaignPoint.onclick=()=>{linkedPoint=undefined;refresh();};
  source.onchange=()=>{pendingSource=undefined;refresh();};
  band.onchange=()=>{chosenBand=method.value==='nearby';refresh();};
  method.onchange=minimum.oninput=minScore.oninput=lower.oninput=upper.oninput=retry.onclick=refresh;
  panel.addEventListener('toggle',refresh);
  function openFromLink(){if(location.hash==='#'+panel.id)panel.open=true;}
  const queryParams=new URLSearchParams(location.search);
  if(location.hash==='#'+panel.id && ['puntaje','similares'].includes(queryParams.get('comparar'))) {
    method.value=queryParams.get('comparar')==='puntaje'?'minimum':'similar';
    if(['urban','census'].includes(queryParams.get('division'))) {
      group.value=queryParams.get('division');choiceMade=true;
    }
    if(method.value==='similar')pendingSource=queryParams.get('referencia');
    if(queryParams.has('origen')) {
      const coords=parseCoordinates(queryParams.get('origen'));
      if(coords)linkedPoint={...coords,name:'Punto de la consulta',linked:true};
      else if(queryParams.get('origen')==='')linkedPoint=null;
    }
    updateInputs();
    if(queryParams.has('minPuntaje')) minScore.value=queryParams.get('minPuntaje');
    if(queryParams.has('desde') || queryParams.has('hasta')) {
      band.value='range';
      lower.value=queryParams.get('desde')??'';
      upper.value=queryParams.get('hasta')??'';
    } else if (/^[0-4]$/.test(queryParams.get('tramo'))) band.value=queryParams.get('tramo');
    if(queryParams.has('porcentaje')) minimum.value=queryParams.get('porcentaje');
    updateInputs();
  }
  window.addEventListener('hashchange',openFromLink);openFromLink();
  function showBand(value) {
    linkedPoint=undefined;method.value='nearby';updateInputs();
    band.value=value;chosenBand=true;panel.open=true;refresh();
  }
  function compareParish(code) {
    if(!code)return;
    if(code.startsWith('gye-'))group.value='urban';
    else if(code==='090150')group.value='census';
    linkedPoint=undefined;choiceMade=true;pendingSource=code;
    method.value='similar';updateInputs();
    band.value='';minimum.value='';
    panel.open=true;refresh();
    panel.scrollIntoView({block:'start'});
  }
  function setScoreScenario(next) {
    scenario=next;
    if(method.value!=='nearby')refresh();
  }
  return {showBand,compareParish,setScoreScenario,setPoint(next,single) {
    const key=JSON.stringify([next?.lat,next?.lon,next?.name,next?.reference,next?.temporary,single]);
    if(key===anchorKey)return;
    anchorKey=key;campaignPoint=next;sectorMode=single;
    const anchor=method.value!=='nearby' && linkedPoint!==undefined ? linkedPoint : next;
    if(!choiceMade)group.value=anchor&&urbanSeat&&featureAt([urbanSeat],anchor.lat,anchor.lon)?'urban':'census';
    refresh();
  }};
}
