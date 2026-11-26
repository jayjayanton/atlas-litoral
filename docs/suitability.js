import {initSiteView} from './site-view.js';
import {surfaceLegend} from './score-surface.js';
import {
  buildDensityGrid, countInRadius, criterionKeys, presets,
  suitabilityFactors, weightedSuitability, weightShares
} from './suitability-model.js';
import {distanceKm} from './model.js';

const $ = id => document.getElementById(id);
const labels = [
  'Densidad de escuelas', 'Densidad de hospitales', 'Cercanía a vías principales',
  'Cercanía a centros comerciales', 'Cercanía a centros urbanos', 'Cercanía a atractivos turísticos'
];
const names = ['Escuelas', 'Hospitales', 'Vías principales', 'Centros comerciales', 'Centros urbanos', 'Atractivos turísticos'];
const storageKey = 'atlasLitoral.suitability.v2';
const number = new Intl.NumberFormat('es-EC', {maximumFractionDigits:2});
const scoreFormat = new Intl.NumberFormat('es-EC', {maximumFractionDigits:1});
const show = n => Number.isFinite(n) ? number.format(n) : 'Sin dato';
const showScore = n => Number.isFinite(n) ? scoreFormat.format(n) : '—';
const distanceLabel = n => Number.isFinite(n) ? show(n) + ' km' : 'Sin dato';
const densityDisplay = (n,area) => Number.isFinite(n) ? show(n / area) : 'Sin dato';
const escape = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const inRange = value => Number.isFinite(value) && value >= 0 && value <= 100;
const validArray = (values, length) => Array.isArray(values) && values.length === length && values.every(inRange);
const validRoadLimit = km => Number.isFinite(km) && km >= .1 && km <= 200;

function sameSettings(a, b) {
  return a && b && a.radius === b.radius && a.scope === b.scope && Object.is(a.limit,b.limit)
    && a.weights.every((value,i) => Object.is(value,b.weights[i]));
}

function readStore(key) {
  try { return JSON.parse(localStorage.getItem(key)) || {}; }
  catch { return {}; }
}

function readScenario() {
  const current = readStore(storageKey);
  if (validArray(current.weights, criterionKeys.length)) return current;
  const previous = readStore('atlasLitoral.density.v1');
  const optional = readStore('atlasLitoral.site.criteria.v1');
  const base = validArray(previous.weights, 3) ? previous.weights : presets.balanced.slice(0, 3);
  return {...previous, weights:[...base, optional.shopping ? 20 : 0, optional.city ? 20 : 0, 0]};
}

function scenarioFromQuery(params) {
  const model = params.get('modelo');
  let weights;
  if (Object.hasOwn(presets, model)) weights = presets[model];
  else if (model === 'custom') {
    const fields = (params.get('pesos') || '').split(',');
    if (fields.some(field => field.trim() === '')) return null;
    weights = fields.map(Number);
  }
  if (!validArray(weights, criterionKeys.length) || !weights.some(w => w > 0)) return null;
  const radius = Number(params.get('radio')), scope = params.get('red'), limit = Number(params.get('via'));
  return {weights,radius:[2,5,10].includes(radius)?radius:5,scope:['all','public','private'].includes(scope)?scope:'all',
    limit:Number.isFinite(limit) && limit >= .1 && limit <= 200 ? limit : 3};
}

export function initSuitability({map,state,changeTheme,selectCanton,scale,loadRegional,schools,hospitals,pinDistances,download,onScenarioChange}) {
  if (!scale) {
    $('suit-status').textContent = 'No se pudo cargar la escala regional de aptitud.';
    onScenarioChange?.(null);
    return null;
  }
  const {maxima} = scale, siteView = initSiteView(map);
  const regions = new Map(state().features.map(f => [f.properties.code, f]));
  const col = Object.fromEntries(scale.columns.map((key,i) => [key,i]));
  const scopeSelect = $('suit-scope'), radiusSelect = $('suit-radius'), limitInput = $('suit-road-limit');
  const zone = $('suit-area'), preset = $('suit-preset');
  const comparisonPreset = $('parish-suit-preset');
  const comparisonRadius = $('parish-suit-radius'), comparisonScope = $('parish-suit-scope');
  const comparisonLimit = $('parish-suit-road-limit');
  for (const [control,original] of [[comparisonPreset,preset],[comparisonRadius,radiusSelect],[comparisonScope,scopeSelect]]) {
    control.replaceChildren(...Array.from(original.options, option => option.cloneNode(true)));
  }
  comparisonPreset.disabled = false;
  const url = new URL(window.location.href);
  const linked = url.hash==='#ingresos-parroquiales' && ['puntaje','similares'].includes(url.searchParams.get('comparar'))
    ? scenarioFromQuery(url.searchParams) : null;
  const store = linked || readScenario();
  const weights = [...store.weights];
  const lastPositive = weights.map((weight,i) => {
    const saved = store.lastPositive?.[i];
    return weight > 0 ? weight : inRange(saved) && saved > 0 ? saved : (presets.balanced[i] || 20);
  });
  if (scale.radiiKm.includes(store.radius)) radiusSelect.value = String(store.radius);
  if (['all','public','private'].includes(store.scope)) scopeSelect.value = store.scope;
  if (Number.isFinite(store.limit) && store.limit >= .1 && store.limit <= 200) limitInput.value = store.limit;

  let grid, surface, cells, regionalTask, regionalError = false, hasAmenityGrid = false;
  let areaProvince = null, seriesKey = null, mapKey = null, projectKey = null, ranking = [], pendingFrame = 0;
  let radius, scope, roadLimit, ri, hcol, shares, valid, area;
  const countsAtPin = new Map();

  function makeWeightControls(prefix) {
    $(prefix+'-weights').innerHTML = labels.map((label,i) => {
      const key = criterionKeys[i], base = prefix+'-';
      const siteAttribute = prefix==='site' ? ' data-site-criterion="'+key+'"' : '';
      return '<div class="suit-weight"><label class="suit-weight-name" for="'+base+'toggle-'+i+'">'+
        '<input type="checkbox" id="'+base+'toggle-'+i+'" data-weight-key="'+key+'"'+siteAttribute+'>'+label+'</label>'+
        '<input type="range" min="0" max="100" step="any" id="'+base+'slide-'+i+'" aria-label="Deslizador de '+label+'">'+
        '<input type="number" min="0" max="100" step="any" id="'+base+'w-'+i+'" aria-label="Peso de '+label+'">'+
        '<output for="'+base+'w-'+i+' '+base+'slide-'+i+'" id="'+base+'share-'+i+'" aria-live="off" aria-label="Peso normalizado de '+label+'"></output></div>';
    }).join('');
    return criterionKeys.map((_,i) => ({
      toggle:$(prefix+'-toggle-'+i), slider:$(prefix+'-slide-'+i),
      field:$(prefix+'-w-'+i), share:$(prefix+'-share-'+i)
    }));
  }
  const weightControls = ['suit','site'].map(makeWeightControls);
  const comparisonControls = makeWeightControls('parish-suit');
  const comparisonLastPositive = [...lastPositive];
  let currentScenario, comparisonEdited = false;

  function synchronizeArea(province) {
    if (areaProvince === province) return;
    const previous = zone.value;
    areaProvince = province;
    const fs = state().features.filter(f => !province || f.properties.province === province)
      .sort((a,b) => a.properties.name.localeCompare(b.properties.name,'es'));
    zone.replaceChildren(new Option(province ? 'Toda la provincia · '+province : 'Guayas y Santa Elena',''),
      ...fs.map(f => new Option(f.properties.name, f.properties.code)));
    if (fs.some(f => f.properties.code === previous)) zone.value = previous;
  }

  function setWeightInput({field,slider,toggle}, value, source) {
    if (source !== field) field.value = Number.isFinite(value) ? value : '';
    if (inRange(value)) slider.value = value;
    toggle.checked = inRange(value) && value > 0;
  }

  function changeWeight(i, value, source) {
    weights[i] = value;
    if (inRange(value) && value > 0) lastPositive[i] = value;
    for (const controls of weightControls) setWeightInput(controls[i],value,source);
  }

  function scenarioFor(values, radius, scope, limit) {
    let message = '';
    if (!values.every(inRange)) message = 'Ingresa un peso entre 0 y 100 para cada criterio.';
    else if (!values.some(w => w > 0)) message = 'Activa al menos un criterio o aumenta uno de los pesos para calcular la aptitud.';
    else if (values[2] && !validRoadLimit(limit)) message = 'Ajusta el límite vial entre 0,1 y 200 km.';
    const valid = scale.radiiKm.includes(radius) && ['all','public','private'].includes(scope) && !message;
    const preset = Object.keys(presets).find(key => presets[key].every((v,i) => values[i] === v)) || 'custom';
    return {weights:[...values],radius,scope,limit,preset,valid,message};
  }

  function showShares(controls, scenario, portions) {
    controls.forEach(({share,field,slider},i) => {
      const weight = scenario.weights[i];
      share.textContent = portions ? show(100 * portions[i])+' %' : '—';
      slider.setAttribute('aria-valuetext',portions ? show(weight)+' de 100 · '+share.textContent+' del puntaje' : scenario.message);
      field.setAttribute('aria-invalid', String(!inRange(weight)));
    });
  }

  function readDraft() {
    return scenarioFor(comparisonControls.map(({field}) => field.valueAsNumber),
      Number(comparisonRadius.value),comparisonScope.value,comparisonLimit.valueAsNumber);
  }

  function previewDraft() {
    const draft = readDraft();
    comparisonEdited = !sameSettings(draft,currentScenario);
    comparisonPreset.value = draft.preset;
    showShares(comparisonControls,draft,weightShares(draft.weights));
    comparisonLimit.setAttribute('aria-invalid',String(!!draft.weights[2] && !validRoadLimit(draft.limit)));
  }

  function syncDraft() {
    weights.forEach((weight,i) => {
      setWeightInput(comparisonControls[i],weight);
      comparisonLastPositive[i] = lastPositive[i];
    });
    comparisonScope.value = scopeSelect.value;
    comparisonRadius.value = radiusSelect.value;
    comparisonLimit.value = limitInput.value;
    previewDraft();
  }

  function applyDraft() {
    const draft = readDraft();
    if (!draft.valid) return draft;
    comparisonEdited = false;
    if (!sameSettings(draft,currentScenario)) {
      draft.weights.forEach((weight,i) => {
        changeWeight(i,weight);
        lastPositive[i] = comparisonLastPositive[i];
      });
      radiusSelect.value = comparisonRadius.value;
      scopeSelect.value = comparisonScope.value;
      limitInput.value = comparisonLimit.value;
      update();
    }
    return draft;
  }
  const comparisonEditor = {readDraft,applyDraft};

  function readControls(savePreferences) {
    radius = Number(radiusSelect.value);
    scope = scopeSelect.value;
    roadLimit = limitInput.valueAsNumber;
    ri = scale.radiiKm.indexOf(radius);
    hcol = col[scope];
    area = Math.PI * radius * radius;
    shares = weightShares(weights);
    currentScenario = scenarioFor(weights,radius,scope,roadLimit);
    valid = currentScenario.valid;
    for (const controls of weightControls) showShares(controls,currentScenario,shares);
    preset.value = currentScenario.preset;
    if (!comparisonEdited || sameSettings(readDraft(),currentScenario)) syncDraft();
    onScenarioChange?.(currentScenario,comparisonEditor);
    $('suit-message').textContent = $('site-weight-message').textContent = currentScenario.message;
    if (savePreferences && weights.every(inRange) && validRoadLimit(roadLimit)) {
      try { localStorage.setItem(storageKey, JSON.stringify({weights, lastPositive, scope, radius, limit:roadLimit})); }
      catch {}
    }
  }

  function factors(s,h,roadKm,amenities) {
    return suitabilityFactors(s,h,roadKm,maxima[ri][col.school],maxima[ri][hcol],roadLimit,amenities,radius);
  }

  function buildRanking(province) {
    const result = [];
    for (const [index,c] of cells.entries()) {
      if (zone.value && c.code !== zone.value) continue;
      if (province && regions.get(c.code).properties.province !== province) continue;
      const s = c.counts[ri][col.school], h = c.counts[ri][hcol];
      const value = weightedSuitability(factors(s,h,c.roadKm,c.amenityKm), weights);
      if (value !== null) result.push({cell:c,index,s,h,value});
    }
    return result.sort((a,b) => b.value-a.value || a.cell.code.localeCompare(b.cell.code) || a.cell.lat-b.cell.lat || a.cell.lon-b.cell.lon);
  }

  function projectSummary(site,canton) {
    $('suit-pin').hidden = !site;
    if (!site) { siteView.render(null); return; }
    $('suit-pin-name').textContent = site.name;
    let value = null, near = {}, counts = '', parts = [];
    const active = criterionKeys.filter((key,i) => inRange(weights[i]) && weights[i] > 0);
    if (canton) {
      near = pinDistances(site,scope);
      const key = [site.lat,site.lon,radius,scope].join('|');
      if (!countsAtPin.has(key)) {
        if (countsAtPin.size >= 36) countsAtPin.clear();
        countsAtPin.set(key,[countInRadius(site.lat,site.lon,schools,radius), countInRadius(site.lat,site.lon,hospitals,radius,scope)]);
      }
      const [s,h] = countsAtPin.get(key);
      if (valid) {
        const terms = factors(s,h,near.road?.km,[near.shopping?.km,near.city?.km,near.tourism?.km]);
        value = weightedSuitability(terms, weights);
        parts = names.flatMap((label,i) => {
          if (!weights[i]) return [];
          return [label+' · '+show(100*shares[i])+' % del peso · '+
            (Number.isFinite(terms[i]) ? showScore(100*shares[i]*terms[i])+' puntos' : 'sin dato')];
        });
      }
      const schoolCount = s===null ? 'escuelas sin dato' : show(s)+(s===1 ? ' escuela' : ' escuelas');
      const hospitalCount = h===null ? 'hospitales sin dato' : show(h)+(h===1 ? ' hospital' : ' hospitales');
      const network = scope==='public' ? (h===1?' público':' públicos') : scope==='private' ? (h===1?' privado':' privados') : '';
      counts = 'Radio de conteo '+radius+' km · '+schoolCount+' · '+hospitalCount+network+'.';
      if (value === null) counts += ' '+(valid ? 'Faltan datos para un criterio con peso positivo.' : $('suit-message').textContent);
    }
    $('suit-score').textContent = showScore(value);
    $('suit-pin-facts').textContent = canton ? counts : 'Punto fuera de la cobertura de Guayas y Santa Elena.';
    siteView.render({site,canton,counts,near,parts,score:showScore(value),radius,criteria:active});
  }

  function requestRegional(retry=false) {
    if (regionalTask || (!retry && (cells || regionalError))) return;
    regionalError = false;
    $('suit-count').textContent = 'Cargando la malla regional…';
    regionalTask = loadRegional().then(result => {
      grid = result.grid;
      surface = result.surface;
      hasAmenityGrid = false;
      if (result.amenities) {
        try {
          cells = buildDensityGrid(grid,result.density,result.amenities).cells;
          hasAmenityGrid = true;
        } catch {
          // Older or incomplete distance files still allow the three original criteria.
          cells = buildDensityGrid(grid,result.density).cells;
        }
      } else cells = buildDensityGrid(grid,result.density).cells;
    }).catch(() => { regionalError = !cells; }).finally(() => {
      regionalTask = null;
      seriesKey = mapKey = null;
      refresh();
    });
  }

  function regionalMessage(loading,failed,missing) {
    const status = $('suit-count');
    status.replaceChildren();
    if (loading) { status.textContent = 'Cargando la malla regional…'; return; }
    if (failed || missing) {
      status.textContent = failed ? 'No se pudo cargar la malla regional. ' :
        'Faltan las distancias regionales para los lugares seleccionados. ';
      const retry = document.createElement('button');
      retry.type = 'button'; retry.className = 'linkbutton'; retry.textContent = 'Reintentar';
      retry.onclick = () => requestRegional(true);
      status.append(retry);
      return;
    }
    status.textContent = valid ? 'Se muestran '+Math.min(5,ranking.length)+' de '+number.format(ranking.length)+' puntos de la malla. Cada punto abre su ubicación en el mapa.' : '';
  }

  function rankTable() {
    $('suit-top').innerHTML = ranking.slice(0,5).map(({cell:c,s,h,value},i) => {
      const name = regions.get(c.code).properties.name;
      const distances = [c.roadKm, ...(c.amenityKm || [null,null,null])];
      return '<tr><td><button data-ranking="'+i+'" class="linkbutton">Ver punto '+(i+1)+' · '+escape(name)+'</button><span class="suit-coord">'+
        c.lat.toFixed(4)+', '+c.lon.toFixed(4)+'</span></td><td><strong>'+showScore(value)+'</strong></td><td>'+s+'</td><td>'+h+'</td>'+
        distances.map(d => '<td>'+distanceLabel(d)+'</td>').join('')+'</tr>';
    }).join('') || '<tr><td colspan="8">Sin resultados para la selección.</td></tr>';
  }

  function draw() {
    if (!ranking.length || state().theme !== 'suitability') { surface?.clear('suitability'); return; }
    const scores = new Array(cells.length), codes = new Set();
    for (const r of ranking) { scores[r.index] = r.value; codes.add(r.cell.code); }
    surface.draw('suitability',scores,codes);
  }

  function refresh() {
    const {province,theme,site,siteCanton} = state();
    synchronizeArea(province);
    const parameters = [radius,scope,roadLimit,weights.join(',')].join('|');
    const scenario = [parameters,zone.value,province].join('|');
    const pinKey = [parameters,site?.lat,site?.lon,site?.name,site?.temporary,siteCanton?.code].join('|');
    if (projectKey !== pinKey) { projectKey = pinKey; projectSummary(site,siteCanton); }
    siteView.display(theme==='site');
    if (theme==='site') siteView.legend();
    const missing = !!cells && !hasAmenityGrid && weights.slice(3).some(w => w > 0);
    $('suit-map').disabled = !valid || missing || regionalError;
    if (theme==='suitability' || $('suit-regional').open) {
      if (!cells && !regionalError) requestRegional();
      if (seriesKey !== scenario) {
        seriesKey = scenario;
        ranking = valid && cells && !regionalError && !missing ? buildRanking(province) : [];
        rankTable();
        regionalMessage(!!regionalTask,regionalError,missing);
      }
    }
    $('suit-export').disabled = !ranking.length || !valid || missing || regionalError;
    const target = theme==='suitability' ? scenario : 'hidden';
    if (mapKey !== target) { mapKey = target; draw(); }
    if (theme==='suitability') legend();
  }

  function showPoint(r) {
    const c = r.cell, others = c.amenityKm || [];
    const details = ['Vía principal: '+distanceLabel(c.roadKm),'Centro comercial: '+distanceLabel(others[0]),
      'Centro urbano: '+distanceLabel(others[1]),'Atractivo turístico: '+distanceLabel(others[2])];
    L.popup().setLatLng([c.lat,c.lon]).setContent('<b>'+escape(regions.get(c.code).properties.name)+' · muestra de la malla · '+
      showScore(r.value)+'/100</b><br>Radio de '+radius+' km<br>Escuelas: '+r.s+' ('+densityDisplay(r.s,area)+'/km²)<br>Hospitales: '+
      r.h+' ('+densityDisplay(r.h,area)+'/km²)<br>'+details.join('<br>')).openOn(map);
  }

  function inspect(ll) {
    if (!valid || !grid) return;
    let near = null, nearest = grid.spacingKm * .72;
    for (const r of ranking) {
      if (Math.abs(r.cell.lat-ll.lat)>.03 || Math.abs(r.cell.lon-ll.lng)>.03) continue;
      const d = distanceKm(ll.lat,ll.lng,[r.cell.lon,r.cell.lat]);
      if (d <= nearest) { nearest = d; near = r; }
    }
    if (near) showPoint(near);
  }

  function legend() {
    if (grid && ranking.length && valid) { surfaceLegend('Aptitud ponderada · 0–100',grid.spacingKm); return; }
    $('legend-title').textContent = 'Aptitud regional';
    $('legend').textContent = !valid ? $('suit-message').textContent : regionalTask ? 'Cargando la malla regional…' :
      regionalError || (cells && !hasAmenityGrid && weights.slice(3).some(w=>w>0)) ? 'Faltan datos de la malla. Reintenta en Aptitud del sitio.' :
      cells ? 'Sin resultados para la selección.' : 'Cargando la malla regional…';
  }

  function update(savePreferences=true) {
    if (pendingFrame) { cancelAnimationFrame(pendingFrame); pendingFrame = 0; }
    readControls(savePreferences); map.closePopup(); refresh();
  }
  function updateOnFrame() {
    if (!pendingFrame) pendingFrame = requestAnimationFrame(() => { pendingFrame = 0; update(); });
  }
  weightControls.forEach(controls => controls.forEach(({field,slider,toggle},i) => {
    changeWeight(i, weights[i]);
    slider.oninput = () => { changeWeight(i,Math.round(Number(slider.value))); updateOnFrame(); };
    field.oninput = () => { changeWeight(i,field.valueAsNumber,field); update(); };
    toggle.onchange = () => { changeWeight(i,toggle.checked ? lastPositive[i] : 0); update(); };
  }));
  preset.onchange = () => {
    const values = presets[preset.value];
    if (!values) return;
    values.forEach((value,i) => changeWeight(i,value));
    update();
  };
  function changeDraftWeight(i,value,source) {
    if (inRange(value) && value > 0) comparisonLastPositive[i] = value;
    setWeightInput(comparisonControls[i],value,source);
  }
  comparisonControls.forEach(({field,slider,toggle},i) => {
    slider.oninput = () => { changeDraftWeight(i,Math.round(Number(slider.value))); previewDraft(); };
    field.oninput = () => { changeDraftWeight(i,field.valueAsNumber,field); previewDraft(); };
    toggle.onchange = () => { changeDraftWeight(i,toggle.checked ? comparisonLastPositive[i] : 0); previewDraft(); };
  });
  comparisonPreset.onchange = () => {
    const values = presets[comparisonPreset.value];
    if (values) {
      values.forEach((value,i) => changeDraftWeight(i,value));
      previewDraft();
    } else {
      $('parish-suit-adjust').open = true;
      $('parish-suit-slide-0').focus();
    }
  };
  comparisonRadius.onchange = comparisonScope.onchange = comparisonLimit.oninput = previewDraft;
  scopeSelect.onchange = radiusSelect.onchange = update;
  zone.onchange = () => update(false);
  limitInput.oninput = update;
  $('suit-map').onclick = () => {
    changeTheme('suitability');
    const group = state().features.filter(f => (!zone.value || f.properties.code===zone.value) && (!state().province || f.properties.province===state().province));
    map.fitBounds(L.geoJSON(group).getBounds(),{padding:[12,12],maxZoom:11});
    $('explorar').scrollIntoView({block:'start'});
  };
  $('suit-top').onclick = event => {
    const button = event.target.closest('button[data-ranking]');
    if (!button) return;
    const r = ranking[Number(button.dataset.ranking)];
    if (!r) return;
    changeTheme('suitability'); selectCanton(r.cell.code);
    map.setView([r.cell.lat,r.cell.lon],11); showPoint(r);
  };
  $('suit-export').onclick = () => {
    if (!valid || !ranking.length || seriesKey === null) return;
    const heads = ['rango','dpa','canton','latitud','longitud','aptitud_0_100','escuelas_en_radio','hospitales_en_radio','escuelas_por_km2','hospitales_por_km2','distancia_via_km','radio_km','red_hospitalaria','limite_vial_km','peso_escuelas_pct','peso_hospitales_pct','peso_vias_pct','max_escuelas_regional_en_radio','max_hospitales_regional_en_radio','distancia_centro_comercial_km','distancia_centro_urbano_km','distancia_atractivo_turistico_km','peso_comercios_pct','peso_centros_urbanos_pct','peso_turismo_pct'];
    const percentages = shares.map(f => Number((100*f).toFixed(4)));
    download('atlas_litoral_aptitud_ponderada.csv', [heads,...ranking.map(({cell:c,s,h,value},i) => [
      i+1,c.code,regions.get(c.code).properties.name,c.lat,c.lon,Number(value.toFixed(4)),s,h,
      Number((s/area).toFixed(5)),Number((h/area).toFixed(5)),c.roadKm,radius,scopeSelect.selectedOptions[0].textContent,
      Number.isFinite(roadLimit) ? roadLimit : '',...percentages.slice(0,3),maxima[ri][col.school],maxima[ri][hcol],
      ...(c.amenityKm || ['','','']),...percentages.slice(3)
    ])]);
  };
  $('suit-regional').ontoggle = refresh;
  $('suit-start').disabled = $('site-start').disabled = $('site-opt').disabled = false;
  $('suit-opt').disabled = false;
  $('suit-body').hidden = false;
  $('suit-status').textContent = '';
  readControls(!linked); refresh();
  return {refresh,legend,inspect,siteLegend:siteView.legend};
}
