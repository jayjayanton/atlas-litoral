const $ = id => document.getElementById(id);
const usd = new Intl.NumberFormat('es-EC', {style:'currency', currency:'USD', maximumFractionDigits:2});
const num = new Intl.NumberFormat('es-EC');
export const isSectorTheme = theme => theme === 'sectors' || theme === 'sector-income';

// Each bracket uses fixed percentage-point intervals in both provinces and at every zoom.
const breaksByBand = [[36,39,40,43], [32,34,36,39], [9,12,13,14], [3,5,6,7], [3,5,6.5,7]];
const palette = ['#f0edf7','#d4c6e5','#b09acb','#8465a4','#583876'];
const missingColor = '#b8bcbf';

export function estimatedShare(homes, refs, band) {
  const total = homes.reduce((a,b)=>a+b, 0);
  if (!total) return null;
  return homes.reduce((sum,count,i)=>sum+count*refs[i].shares[band], 0) / total;
}

export function shareColor(share, band) {
  if (share === null) return missingColor;
  return palette[breaksByBand[band].filter(cut=>share*100 >= cut).length];
}

function key(color, label) {
  const item=document.createElement('span'), swatch=document.createElement('i');
  item.className='key'; swatch.className='sw'; swatch.style.backgroundColor=color;
  item.append(swatch, label);
  return item;
}

export function bandKeys(band) {
  const cuts=breaksByBand[band].map(v=>num.format(v));
  const labels=['<'+cuts[0]+' %', ...cuts.slice(0,-1).map((v,i)=>v+'–<'+cuts[i+1]+' %'), cuts.at(-1)+' % o más'];
  return [...labels.map((label,i)=>key(palette[i],label)),key(missingColor,'Sin estimación')];
}

export function initProvinceIncome(map, provinces, incomes) {
  const pane=map.createPane('province-income');
  pane.style.zIndex=406; pane.style.pointerEvents='none';
  const order=provinces.features.map(f=>f.properties.name).sort((a,b)=>incomes[a].median-incomes[b].median);
  const colors=new Map(order.map((name,i)=>[name,i===0?'#c5b7d9':'#74508f']));
  const layer=L.geoJSON(provinces,{pane:'province-income',interactive:false});
  function refresh(active, filter) {
    if (!active) {layer.remove();return;}
    layer.setStyle(({properties:{name}})=>({stroke:false,fillColor:colors.get(name),fillOpacity:filter && filter!==name?0:.8}));
    if (!map.hasLayer(layer)) layer.addTo(map);
    $('legend-title').textContent='Ingreso mensual mediano del hogar';
    const source=document.createElement('small'); source.className='sector-legend-area';
    source.textContent='Medianas provinciales ponderadas · ENIGHUR 2024–2025';
    const keys=order.filter(name=>!filter || name===filter).map(name=>{
      const {median,n}=incomes[name];
      return key(colors.get(name),name+' · '+usd.format(median)+' · '+num.format(n)+' hogares encuestados');
    });
    $('legend').replaceChildren(source,...keys);
  }
  return {refresh};
}
