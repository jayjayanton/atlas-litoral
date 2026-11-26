import {featureAt} from './model.js';
import {nearbyParishIncome} from './parish-income.js';
import {incomeBandLabels} from './income-map.js';
import {groupMunicipalParishes} from './parishes.js';

const $ = id => document.getElementById(id);
const integer = new Intl.NumberFormat('es-EC');
const percent = new Intl.NumberFormat('es-EC',{style:'percent',maximumFractionDigits:1});
const distance = new Intl.NumberFormat('es-EC',{maximumFractionDigits:1});
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
  let map, background, matches, origin, extent, buttons, grouping;
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
    origin.bringToFront();
    const bounds=chosen?chosen.getBounds().extend(origin.getLatLng()):extent;
    map.fitBounds(bounds,{padding:[18,18],maxZoom:13,animate:false});
    if(fromList && matchMedia('(max-width:600px)').matches)container.scrollIntoView({block:'nearest'});
  }
  reset.onclick=()=>choose('');
  return function render({point,rows,areas,urban,rowButtons}) {
    if(!map) {
      map=L.map(container,{scrollWheelZoom:false,attributionControl:false,zoomSnap:.25,minZoom:3,maxZoom:17}).setView([point.lat,point.lon],10);
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
    const anchor=[point.lat,point.lon];
    origin=L.circleMarker(anchor,{radius:5,color:'white',weight:2,fillColor:'#442437',fillOpacity:1})
      .bindTooltip(element('span',point.name)).addTo(matches);
    extent=L.latLngBounds([anchor]);
    rows.forEach((row,i)=>{
      const feature=areas.find(f=>f.properties.code===row.code);
      const layer=L.geoJSON(feature).getLayers()[0].addTo(matches);
      layer.bindTooltip(element('span',String(i+1)),{permanent:true,direction:'center',className:'parish-income-number'});
      layer.on('click',()=>choose(row.code));
      buttons.get(row.code).onclick=()=>choose(row.code,true);
      plotted.set(row.code,layer);
      extent.extend(layer.getCenter());
    });
    choose('');
  };
}

export function initCampaignParishIncome({cantons,parishes,sectorIndex}) {
  const panel=$('ingresos-parroquiales'), band=$('parish-income-band'), group=$('parish-income-group');
  const minimum=$('parish-income-min'), status=$('parish-income-status'), output=$('parish-income-results');
  const retry=$('parish-income-retry'), list=$('parish-income-list'), urbanNote=$('parish-income-urban-note');
  const names=new Map(cantons.map(f=>[f.properties.code,f.properties.name]));
  const urbanSeat=parishes?.find(f=>f.properties.code==='090150');
  const drawMap=initParishMap(), files=new Map();
  let point, sectorMode=false, anchorKey, choiceMade=false, revision=0;
  if(sectorIndex) {
    band.replaceChildren(...incomeBandLabels(sectorIndex.incomeCuts).map((name,i)=>new Option(name,String(i))));
    band.value='1';band.disabled=false;
  }
  function load(file) {
    if(!files.has(file))files.set(file,fetch('./data/'+file).then(response=>{
      if(!response.ok)throw new Error(file);
      return response.json();
    }).catch(error=>{files.delete(file);throw error;}));
    return files.get(file);
  }
  function showRows(rows,areas,urban) {
    const buttons=new Map();
    list.replaceChildren(...rows.map((row,i)=>{
      const item=document.createElement('li'), button=document.createElement('button');
      button.type='button';button.setAttribute('aria-controls','parish-income-map');
      button.append(element('strong',(i+1)+'. '+titleCase(row.name)),element('b',percent.format(row.share)),
        element('small',row.kind+' · '+titleCase(names.get(row.canton)||row.canton)),
        element('small',distanceLabel(row.distanceKm)),
        element('small','≈ '+integer.format(Math.round(row.estimatedHouseholds))+' de '+integer.format(row.eligibleHouseholds)+' hogares con edad publicada'));
      buttons.set(row.code,button);item.append(button);return item;
    }));
    output.hidden=false;
    drawMap({point,rows,areas,urban,rowButtons:buttons});
  }
  async function refresh() {
    const ticket=++revision;
    if(!panel.open)return;
    output.hidden=true;retry.hidden=true;urbanNote.hidden=group.value!=='urban';
    const location=sectorMode?'punto interior del sector censal':point?.reference?'ubicación aproximada del proyecto':point?.temporary?'punto marcado en el mapa':'ubicación del proyecto';
    $('parish-income-origin').textContent=point
      ? 'Desde '+point.name+' · '+location
      : sectorMode?'Introduce un código censal válido para usar el punto interior del sector.':'Elige un proyecto o marca un punto en el mapa para comparar sus parroquias cercanas.';
    if(!point){status.textContent='';return;}
    minimum.setAttribute('aria-invalid',String(!minimum.validity.valid));
    if(!minimum.validity.valid){status.textContent='Ingresa un mínimo entre 0 y 100, o deja el campo vacío.';return;}
    if(!parishes?.length || !sectorIndex) {
      status.textContent='Los límites censales o los datos provinciales no están disponibles. Recarga la página para reintentar.';
      return;
    }
    const urban=group.value==='urban', minShare=minimum.value===''?0:minimum.valueAsNumber/100;
    status.textContent='Cargando los hogares y los límites parroquiales…';
    try {
      const [households,boundaries,counts]=await Promise.all([load('parish-income-households.json'),
        urban?load('guayaquil-urban.json'):null,urban?load('guayaquil-urban-households.json'):null]);
      if(ticket!==revision || !panel.open)return;
      const urbanParishes=urban?groupMunicipalParishes(boundaries.features):undefined;
      if(urban && !choiceMade && !featureAt(urbanParishes,point.lat,point.lon)) {
        group.value='census';refresh();return;
      }
      const rows=nearbyParishIncome({point,band:Number(band.value),minShare,parishes,households,
        provinces:sectorIndex.provinces,urbanParishes,urbanHouseholds:counts?.households});
      if(urban) {
        const coverage=counts.coverage;
        urbanNote.textContent='En Guayaquil se asigna cada sector censal completo según su punto interior en los límites municipales. La división urbana incluye '+
          integer.format(coverage.assignedHouseholds)+' de '+integer.format(coverage.mappedHouseholds)+' hogares de los sectores cartografiados de la cabecera. Los hogares sin ubicación sectorial asignable quedan fuera del cálculo urbano.';
      }
      if(!rows.length){status.textContent='Ninguna parroquia con datos de Guayas y Santa Elena cumple estos filtros. Prueba otro tramo o reduce el mínimo.';return;}
      const areas=urban?[...parishes.filter(f=>f.properties.code!=='090150'),...urbanParishes]:parishes;
      status.textContent=(rows.length===1?'1 área cercana':rows.length+' áreas cercanas')+' en Guayas y Santa Elena, en orden de distancia. El porcentaje estima los hogares del tramo. Toca una fila para ubicarla.';
      showRows(rows,areas,urban);
    } catch {
      if(ticket!==revision || !panel.open)return;
      output.hidden=true;status.textContent='No se pudo cargar la comparación parroquial.';retry.hidden=false;
    }
  }
  group.onchange=()=>{choiceMade=true;refresh();};
  band.onchange=minimum.oninput=retry.onclick=refresh;
  panel.addEventListener('toggle',refresh);
  function openFromLink(){if(location.hash==='#'+panel.id)panel.open=true;}
  window.addEventListener('hashchange',openFromLink);openFromLink();
  function showBand(value) {
    band.value=value;
    panel.open=true;
    refresh();
  }
  return {showBand,setPoint(next,single) {
    const key=JSON.stringify([next?.lat,next?.lon,next?.name,next?.reference,next?.temporary,single]);
    if(key===anchorKey)return;
    anchorKey=key;point=next;sectorMode=single;
    if(!choiceMade)group.value=point&&urbanSeat&&featureAt([urbanSeat],point.lat,point.lon)?'urban':'census';
    refresh();
  }};
}
