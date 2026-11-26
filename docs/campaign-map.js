import {initBasemap, osmCredit} from './basemaps.js';
export function initCampaignMap({cantons, context, streets, readZone}) {
  const panel = document.getElementById('campaign-map-panel');
  const container = document.getElementById('campaign-plan-map');
  const note = document.getElementById('campaign-map-note');
  let map, overlay, plan, selectionBounds, studyCircle, revision = 0;

  function fit(bounds) {
    if (bounds?.isValid()) map.fitBounds(bounds, {paddingTopLeft:[20, 59], paddingBottomRight:[20, 32], maxZoom:16, animate:false});
  }

  function prepareMap() {
    if (map) {
      map.invalidateSize({pan:false});
      return;
    }
    map = L.map(container, {scrollWheelZoom:false, zoomControl:false, attributionControl:false});
    L.control.zoom({position:'topright', zoomInTitle:'Acercar', zoomOutTitle:'Alejar'}).addTo(map);
    L.control.attribution({prefix:false}).addTo(map)
      .addAttribution(osmCredit).addAttribution('Límites censales: INEC');
    const localPane = map.createPane('campaign-local');
    localPane.style.zIndex = '250';
    localPane.style.pointerEvents = 'none';
    const options = {pane:'campaign-local', interactive:false, smoothFactor:1};
    L.geoJSON(context, {...options, filter:f => f.properties.kind === 'land',
      style:{color:'#baa58f', weight:1, fillColor:'#f5ecdf', fillOpacity:1}}).addTo(map);
    L.geoJSON(cantons, {...options, pane:'overlayPane', style:{color:'#917f83', weight:1, fill:false}}).addTo(map);
    L.geoJSON(context, {...options, filter:f => f.properties.kind === 'river',
      style:{color:'#82a1b4', weight:1.4}}).addTo(map);
    L.geoJSON(streets, {...options, style:{color:'#ada092', weight:1}}).addTo(map);
    initBasemap(map, container);
    overlay = L.featureGroup().addTo(map);

    const views = L.control({position:'topleft'});
    views.onAdd = () => {
      const group = L.DomUtil.create('div', 'campaign-map-views');
      for (const [label, bounds] of [['Ver zonas', () => selectionBounds], ['Ver radio', () => studyCircle?.getBounds()]]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.onclick = () => fit(bounds());
        group.append(button);
      }
      L.DomEvent.disableClickPropagation(group);
      return group;
    };
    views.addTo(map);
    if (window.ResizeObserver) new ResizeObserver(() => map.invalidateSize({pan:false})).observe(container);
  }

  async function draw() {
    const ticket = ++revision;
    if (!panel.open || !plan) return;
    prepareMap();
    const {project, radius, shortlist, references = []} = plan;
    const points = [
      ...shortlist.map((row, i) => ({row, tag:String(i + 1), reference:false})),
      ...references.map((row, i) => ({row, tag:'R' + (i + 1), reference:true}))
    ];
    const point = [project.lat, project.lon];
    overlay.clearLayers();
    selectionBounds = L.latLngBounds([point, ...points.map(({row}) => [row.lat, row.lon])]);
    studyCircle = L.circle(point, {radius:radius * 1000, color:'#8d5c23', weight:2, dashArray:'6 5',
      fillColor:'#e7b765', fillOpacity:.07, interactive:false}).addTo(overlay);
    const projectLabel = document.createElement('span');
    projectLabel.textContent = project.name + (project.reference ? ' · ubicación aproximada' : '');
    const projectIcon = L.divIcon({className:'campaign-project-pin', html:'◆', iconSize:[22,22], iconAnchor:[11,11]});
    L.marker(point, {icon:projectIcon, title:projectLabel.textContent, alt:projectLabel.textContent, zIndexOffset:100})
      .bindPopup(projectLabel).addTo(overlay);
    const labels = points.map(({row, tag, reference}) => {
      const label = document.createElement('span');
      label.textContent = (reference ? 'Referencia ' : 'Piloto ') + tag + ' · Sector INEC ' + row.code;
      const icon = L.divIcon({className:reference ? 'campaign-reference-pin' : 'campaign-sector-pin', html:tag, iconSize:[23,23], iconAnchor:[11,11]});
      L.marker([row.lat,row.lon], {icon, title:label.textContent, alt:label.textContent}).bindPopup(label).addTo(overlay);
      return label;
    });
    fit(selectionBounds);
    note.textContent = 'Cargando los límites censales…';
    const geometry = await Promise.allSettled(points.map(async ({row}) => {
      const records = await readZone?.(row.code.slice(0,9));
      return records?.find(record => record[0] === row.code.slice(9))?.[2];
    }));
    if (ticket !== revision) return;
    let mapped = 0;
    geometry.forEach((result, index) => {
      if (result.status !== 'fulfilled' || !result.value?.length) return;
      const reference = points[index].reference;
      const polygon = L.polygon(result.value, {className:reference ? 'campaign-reference-shape' : 'campaign-sector-shape',
        color:reference ? '#344f76' : '#6d2f50', dashArray:reference ? '4 3' : null,
        weight:2.5, fillColor:reference ? '#7191b5' : '#cc6d77', fillOpacity:.43}).bindTooltip(labels[index].cloneNode(true)).addTo(overlay);
      selectionBounds.extend(polygon.getBounds());
      mapped++;
    });
    fit(selectionBounds);
    const referenceKey = references.length ? ' Las marcas R identifican las referencias de cada par.' : '';
    note.textContent = 'El rombo indica el proyecto y los números identifican los sectores piloto.' + referenceKey +
      ' El círculo punteado delimita el radio de estudio. ' +
      (mapped === points.length ? 'Los polígonos muestran los límites censales.' :
        'Faltan límites censales. Las marcas siguen indicando los puntos interiores de los sectores.');
  }

  panel.addEventListener('toggle', draw);
  return next => {
    plan = next;
    if (!next) {
      revision++;
      overlay?.clearLayers();
      return;
    }
    if (panel.open) draw();
  };
}
