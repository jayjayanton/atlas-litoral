// The local cartography remains below these tiles when a provider is slow or offline.
const esriMaps = {
  streets: '55ebf90799fa4a3fa57562700a68c405',
  satellite: '28f49811a6974659988fd279de5ce39f'
};
export const osmCredit = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>';
const esa = '<a href="https://esa-worldcover.org/en/data-access" target="_blank" rel="noopener">© ESA WorldCover project 2021</a> / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium';
const esri = 'Powered by <a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a>';
const openLayers = {
  streets: {
    source: 'OpenStreetMap',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: {attribution: osmCredit, maxNativeZoom: 19}
  },
  satellite: {
    source: 'Sentinel-2 · 2021 · 10 m por píxel',
    url: 'https://mapproxy.terrascope.be/mapproxy/wmts/esa-worldcover-s2rgbnir-10m-2021-v2_tcc/webmercator/{z}/{x}/{y}.png',
    options: {attribution: esa, maxNativeZoom: 14}
  }
};

function esriLayer(kind, key) {
  const token = encodeURIComponent(key);
  if (kind === 'satellite') return {
    source: 'Esri World Imagery',
    url: 'https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=' + token,
    options: {attribution: esri + ' · Esri, Vantor, Earthstar Geographics and the GIS User Community', maxNativeZoom: 19}
  };
  return {
    source: 'Esri Streets',
    url: 'https://static-map-tiles-api.arcgis.com/arcgis/rest/services/static-basemap-tiles-service/v1/arcgis/streets/static/tile/{z}/{y}/{x}?token=' + token,
    options: {attribution: esri + ' · Esri, TomTom, Garmin, FAO, NOAA, USGS, ' + osmCredit + ', and the GIS User Community',
      tileSize: 512, zoomOffset: -1, minZoom: 1, maxNativeZoom: 19}
  };
}

export function initBasemap(map, before) {
  const key = document.querySelector('meta[name="atlas-esri-public-key"]')?.content.trim();
  const pane = map.createPane('atlas-basemap');
  pane.style.zIndex = '380';
  pane.style.pointerEvents = 'none';

  const bar = document.createElement('div');
  bar.className = 'basemap-bar';
  bar.innerHTML = '<div role="group" aria-label="Fondo del mapa" class="basemap-choices">' +
    '<span>Fondo</span><button type="button" data-base="streets">Calles</button>' +
    '<button type="button" data-base="satellite">Satélite</button></div>' +
    '<span class="basemap-source"></span><a class="basemap-esri" target="_blank" rel="noopener"></a>' +
    '<div class="basemap-notice" role="status" hidden><span></span> <button type="button">Reintentar</button></div>';
  before.before(bar);
  const buttons = [...bar.querySelectorAll('[data-base]')];
  const source = bar.querySelector('.basemap-source');
  const viewer = bar.querySelector('.basemap-esri');
  const notice = bar.querySelector('.basemap-notice');
  let kind = 'streets', active;

  function updateLink() {
    const point = map.getCenter();
    const url = new URL('https://www.arcgis.com/apps/mapviewer/index.html');
    url.search = new URLSearchParams({webmap: esriMaps[kind],
      center: point.lng.toFixed(6) + ',' + point.lat.toFixed(6), level: String(Math.round(map.getZoom()))});
    viewer.href = url.href;
  }

  function apply(next, useEsri = Boolean(key)) {
    if (active) active.remove();
    kind = next;
    const layer = useEsri ? esriLayer(kind, key) : openLayers[kind];
    pane.dataset.base = kind;
    const labels = map.getPane('labels');
    if (labels) labels.style.zIndex = kind === 'satellite' ? '411' : '375';
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.base === kind));
    source.textContent = layer.source;
    viewer.textContent = kind === 'streets' ? 'Ver calles en Esri' : 'Ver imagen en Esri';
    map.whenReady(updateLink);
    notice.hidden = true;

    const tiles = L.tileLayer(layer.url, {pane:'atlas-basemap', maxZoom: 20, keepBuffer: 1, ...layer.options});
    active = tiles;
    const outcomes = new Map();
    tiles.on('tileload tileerror', event => {
      outcomes.set(event.tile, {coords: event.coords, loaded: event.type === 'tileload'});
    });
    tiles.on('tileunload', event => outcomes.delete(event.tile));
    tiles.on('load', () => {
      if (tiles !== active) return;
      const zoom = Math.min(Math.round(map.getZoom()), layer.options.maxNativeZoom);
      const view = map.getBounds();
      const viewport = L.bounds(map.project(view.getNorthWest(), zoom), map.project(view.getSouthEast(), zoom));
      const size = tiles.getTileSize();
      let loaded = 0, errors = 0;
      for (const result of outcomes.values()) {
        if (result.coords.z !== zoom) continue;
        const corner = result.coords.scaleBy(size);
        if (!viewport.overlaps(L.bounds(corner, corner.add(size)))) continue;
        if (result.loaded) loaded++; else errors++;
      }
      if (errors && !loaded && useEsri) {
        // Leaflet finishes its tile bookkeeping after firing the load event.
        queueMicrotask(() => { if (tiles === active) apply(kind, false); });
        return;
      }
      notice.hidden = !errors;
      if (errors) notice.firstElementChild.textContent = loaded
        ? 'Algunas partes del fondo no cargaron.'
        : 'Se muestra el mapa local. No se pudo cargar el fondo de ' + layer.source.split(' · ')[0] + '.';
    });
    tiles.addTo(map);
  }

  for (const button of buttons) button.onclick = () => apply(button.dataset.base);
  notice.querySelector('button').onclick = () => apply(kind);
  map.on('moveend', updateLink);
  apply(kind);
}
