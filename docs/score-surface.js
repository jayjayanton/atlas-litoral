// Draw scores in the same Web Mercator coordinates as the Leaflet map.
// Ground measurements and project scores retain their original resolution.
const palette = ['#edf3df', '#bdd9ad', '#77bd98', '#318e7e', '#07594f'];
const stops = palette.map(hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)));
const colors = Array.from({length: 256}, (_, i) => {
  const p = i / 255 * (stops.length - 1), k = Math.min(Math.floor(p), stops.length - 2);
  return stops[k].map((v, j) => Math.round(v + (p - k) * (stops[k + 1][j] - v)));
});

export function surfaceLegend(title) {
  document.getElementById('legend-title').textContent = title;
  document.getElementById('legend').innerHTML =
    '<span class="score-scale"><i style="background:linear-gradient(to right,' + palette.join(',') +
    ')"></i><span><b>0</b><b>50</b><b>100</b></span></span><small class="score-note">Superficie estimada · malla de 3 km</small>';
}

export function createScoreSurface(map, land, features, grid) {
  const crs = L.CRS.EPSG3857;
  const spacing = grid.spacingKm * 1000;
  const lonIndex = grid.columns.indexOf('lon'), latIndex = grid.columns.indexOf('lat');
  const points = grid.cells.map(row => crs.project(L.latLng(row[latIndex], row[lonIndex])));
  const extent = L.bounds(points);
  const pixel = spacing / 8;
  const x0 = extent.min.x - spacing, y0 = extent.max.y + spacing;
  const width = Math.ceil((extent.max.x - x0 + spacing) / pixel);
  const height = Math.ceil((y0 - extent.min.y + spacing) / pixel);
  const bounds = L.latLngBounds(crs.unproject(L.point(x0, y0)), crs.unproject(L.point(x0 + width * pixel, y0 - height * pixel)));
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(width, height);
  const sums = new Float32Array(width * height), weights = new Float32Array(sums.length);
  const supported = new Uint8Array(sums.length);
  const centers = points.map(p => [(p.x - x0) / pixel, (y0 - p.y) / pixel]);
  function pathFor({geometry}) {
    const path = new Path2D();
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    for (const polygon of polygons) for (const ring of polygon) {
      ring.forEach(([lon, lat], i) => {
        const p = crs.project(L.latLng(lat, lon)), x = (p.x - x0) / pixel, y = (y0 - p.y) / pixel;
        if (i === 0) path.moveTo(x, y); else path.lineTo(x, y);
      });
      path.closePath();
    }
    return path;
  }
  const landPaths = land.map(pathFor);
  const regions = features.map(f => ({code: f.properties.code, path: pathFor(f)}));
  const mask = document.createElement('canvas');
  mask.width = width; mask.height = height;
  const maskCtx = mask.getContext('2d');
  function maskTo(paths) {
    maskCtx.clearRect(0, 0, width, height);
    for (const path of paths) maskCtx.fill(path, 'evenodd');
    ctx.drawImage(mask, 0, 0);
  }
  const pane = map.createPane('score-surface');
  pane.style.zIndex = 355;
  pane.style.pointerEvents = 'none';
  let overlay, active;
  function clear(theme) {
    if (active !== theme) return;
    if (overlay) overlay.remove();
    overlay = null; active = null;
  }
  function draw(theme, scores, codes) {
    sums.fill(0); weights.fill(0); supported.fill(0);
    // Compact inverse-distance weights. No pixel is drawn farther than a
    // half-cell diagonal (rounded for projection) from a valid sample.
    const step = spacing / pixel, radius = 1.5 * step, support2 = (step * .72) ** 2;
    scores.forEach((score, i) => {
      if (!Number.isFinite(score)) return;
      const [cx, cy] = centers[i];
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
    if (overlay) overlay.setUrl(url);
    else overlay = L.imageOverlay(url, bounds, {pane: 'score-surface', opacity: .94, interactive: false, alt: '', className: 'atlas-score-surface'}).addTo(map);
    active = theme;
  }
  function covers(latlng) {
    if (!overlay) return false;
    const p = crs.project(latlng);
    const x = Math.floor((p.x - x0) / pixel), y = Math.floor((y0 - p.y) / pixel);
    return x >= 0 && x < width && y >= 0 && y < height && ctx.getImageData(x, y, 1, 1).data[3] > 0;
  }
  return {draw, clear, covers};
}
