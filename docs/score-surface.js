// Draw scores in the same Web Mercator coordinates as the Leaflet map.
// Ground measurements and project scores retain their original resolution.
const palette = ['#edf3df', '#bdd9ad', '#77bd98', '#318e7e', '#07594f'];
const stops = palette.map(hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)));
const colors = Array.from({length: 256}, (_, i) => {
  const p = i / 255 * (stops.length - 1), k = Math.min(Math.floor(p), stops.length - 2);
  return stops[k].map((v, j) => Math.round(v + (p - k) * (stops[k + 1][j] - v)));
});

export function surfaceLegend(title, spacingKm) {
  document.getElementById('legend-title').textContent = title;
  document.getElementById('legend').innerHTML =
    '<span class="score-scale"><i style="background:linear-gradient(to right,' + palette.join(',') +
    ')"></i><span><b>0</b><b>50</b><b>100</b></span></span><small class="score-note">Superficie estimada · malla de ' + Math.round(spacingKm * 1000) + ' m</small>';
}

export function createScoreSurface(map, land, features, grid) {
  const crs = L.CRS.EPSG3857;
  const spacing = grid.spacingKm * 1000;
  const lonIndex = grid.columns.indexOf('lon'), latIndex = grid.columns.indexOf('lat');
  const points = grid.cells.map(row => crs.project(L.latLng(row[latIndex], row[lonIndex])));
  const extent = L.bounds(points);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', {willReadFrequently: true});
  let pixel = 0, x0 = 0, y0 = 0;
  function pathFor({geometry}) {
    const path = new Path2D();
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    for (const polygon of polygons) for (const ring of polygon) {
      ring.forEach(([lon, lat], i) => {
        const {x, y} = crs.project(L.latLng(lat, lon));
        if (i === 0) path.moveTo(x, y); else path.lineTo(x, y);
      });
      path.closePath();
    }
    return path;
  }
  const landPaths = land.map(pathFor);
  const regions = features.map(f => ({code: f.properties.code, path: pathFor(f)}));
  const mask = document.createElement('canvas');
  const maskCtx = mask.getContext('2d');
  function maskTo(paths) {
    maskCtx.resetTransform();
    maskCtx.clearRect(0, 0, mask.width, mask.height);
    maskCtx.setTransform(1 / pixel, 0, 0, -1 / pixel, -x0 / pixel, y0 / pixel);
    for (const path of paths) maskCtx.fill(path, 'evenodd');
    ctx.drawImage(mask, 0, 0);
  }
  const pane = map.createPane('score-surface');
  pane.style.zIndex = 355;
  pane.style.pointerEvents = 'none';
  let overlay, active, scores, codes, frame = 0;
  function clear(theme) {
    if (active !== theme) return;
    if (overlay) overlay.remove();
    if (frame) cancelAnimationFrame(frame);
    frame = 0; overlay = null; active = null; scores = null; codes = null;
  }
  function draw(theme, values, allowed) {
    active = theme; scores = values; codes = allowed;
    renderView();
  }
  // Match the visible area and device scale. Limit bitmap size on phones while
  // retaining smooth color transitions when a user zooms into one grid cell.
  function renderView() {
    if (!active) return;
    const view = map.getBounds().pad(.12);
    const sw = crs.project(view.getSouthWest()), ne = crs.project(view.getNorthEast());
    const west = Math.max(sw.x, extent.min.x - spacing), east = Math.min(ne.x, extent.max.x + spacing);
    const south = Math.max(sw.y, extent.min.y - spacing), north = Math.min(ne.y, extent.max.y + spacing);
    if (west >= east || south >= north) {
      if (overlay) overlay.remove();
      overlay = null; return;
    }
    const screenMeters = (ne.x - sw.x) / Math.max(1, map.getSize().x * 1.24);
    pixel = Math.max(spacing / 64, Math.min(spacing / 2, screenMeters / Math.min(2, window.devicePixelRatio || 1)), (east-west)/1200, (north-south)/1200);
    x0 = Math.floor(west/pixel)*pixel; y0 = Math.ceil(north/pixel)*pixel;
    const width = Math.ceil((east-x0)/pixel), height = Math.ceil((y0-south)/pixel);
    canvas.width = mask.width = width; canvas.height = mask.height = height;
    const bounds = L.latLngBounds(crs.unproject(L.point(x0, y0)), crs.unproject(L.point(x0 + width*pixel, y0 - height*pixel)));
    const sums = new Float32Array(width * height), weights = new Float32Array(sums.length);
    const supported = new Uint8Array(sums.length), image = ctx.createImageData(width, height);
    // Compact inverse-distance weights. No pixel is drawn farther than a
    // half-cell diagonal (rounded for projection) from a valid sample.
    const step = spacing / pixel, radius = 1.5 * step, support2 = (step * .72) ** 2;
    scores.forEach((score, i) => {
      if (!Number.isFinite(score)) return;
      const pt = points[i], cx = (pt.x-x0)/pixel, cy = (y0-pt.y)/pixel;
      if (cx < -radius || cy < -radius || cx > width+radius || cy > height+radius) return;
      for (let y = Math.max(0, Math.floor(cy - radius)); y < Math.min(height, cy + radius); y++) {
        for (let x = Math.max(0, Math.floor(cx - radius)); x < Math.min(width, cx + radius); x++) {
          const d2 = (x + .5 - cx) ** 2 + (y + .5 - cy) ** 2;
          if (d2 >= radius * radius) continue;
          const offset = y * width + x;
          if (d2 <= support2) supported[offset] = 1;
          const w = (1 - Math.sqrt(d2) / radius) ** 2 / Math.max(.0001, d2);
          sums[offset] += w * score; weights[offset] += w;
        }
      }
    });
    const rgba = image.data;
    for (let i = 0; i < sums.length; i++) {
      const j = i * 4;
      if (!supported[i]) { rgba[j + 3] = 0; continue; }
      const value = Math.max(0, Math.min(100, sums[i] / weights[i]));
      const rgb = colors[Math.round(value * 255 / 100)];
      rgba[j] = rgb[0]; rgba[j + 1] = rgb[1]; rgba[j + 2] = rgb[2]; rgba[j + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    ctx.globalCompositeOperation = 'destination-in';
    maskTo(landPaths);
    maskTo(regions.filter(r => codes.has(r.code)).map(r => r.path));
    ctx.globalCompositeOperation = 'source-over';
    const url = canvas.toDataURL('image/png');
    if (overlay) overlay.setBounds(bounds).setUrl(url);
    else overlay = L.imageOverlay(url, bounds, {pane: 'score-surface', opacity: .94, interactive: false, alt: '', className: 'atlas-score-surface'}).addTo(map);
  }
  function covers(latlng) {
    if (!overlay) return false;
    const p = crs.project(latlng);
    const x = Math.floor((p.x - x0) / pixel), y = Math.floor((y0 - p.y) / pixel);
    return x >= 0 && x < canvas.width && y >= 0 && y < canvas.height && ctx.getImageData(x, y, 1, 1).data[3] > 0;
  }
  map.on('moveend resize', () => {
    if (!active || frame) return;
    frame = requestAnimationFrame(() => {frame = 0; renderView();});
  });
  return {draw, clear, covers};
}
