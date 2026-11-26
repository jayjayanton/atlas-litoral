import {distanceKm} from './model.js';

export const defaults = [
  {key:'school', name:'Escuelas', weight:40, limit:3},
  {key:'hospital', name:'Hospitales', weight:40, limit:10},
  {key:'road', name:'Vías principales', weight:20, limit:3}
];

export function accessibility(distances, criteria) {
  let total=0, weights=0;
  for (const {key,weight,limit} of criteria) {
    if (!Number.isFinite(weight)||weight<0||!Number.isFinite(limit)||limit<=0) return null;
    if (!weight) continue;
    const d=distances[key];
    if(!Number.isFinite(d)||d<0) return null;
    total+=weight*Math.max(0,1-d/limit);
    weights+=weight;
  }
  return weights ? 100*total/weights : null;
}

export function ownership(value) {
  const s=(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  if(s.startsWith('public'))return 'public';
  if(s.startsWith('privad'))return 'private';
  return 'unknown';
}

export function nearestFacility(lat,lon,items,filter=null) {
  let result=null;
  for(const point of items) {
    if(filter&&ownership(point.sector)!==filter)continue;
    const km=distanceKm(lat,lon,[point.lon,point.lat]);
    if(result===null||km<result.km)result={item:point,km};
  }
  return result;
}

export function roadLines(geo) {
  const lines=[];
  for(const feature of geo.features){
    const g=feature.geometry;
    const paths=g.type==='MultiLineString'?g.coordinates:(g.type==='LineString'?[g.coordinates]:[]);
    for(const coords of paths)if(coords.length>1)lines.push({item:feature.properties,coords});
  }
  return lines;
}

// Closest point along each mapped segment in a tangent plane centered on the pin.
export function nearestRoad(lat,lon,lines) {
  const k=6371.0088*Math.PI/180, kx=k*Math.cos(lat*Math.PI/180);
  let shortest=Infinity,item,nearestLat,nearestLon;
  for(const line of lines){
    let ax=(line.coords[0][0]-lon)*kx,ay=(line.coords[0][1]-lat)*k;
    for(let i=1;i<line.coords.length;i++){
      const b=line.coords[i],bx=(b[0]-lon)*kx,by=(b[1]-lat)*k;
      const dx=bx-ax,dy=by-ay,denom=dx*dx+dy*dy;
      const t=denom?Math.max(0,Math.min(1,-(ax*dx+ay*dy)/denom)):0;
      const squared=(ax+t*dx)**2+(ay+t*dy)**2;
      if(squared<shortest){
        shortest=squared;item=line.item;
        nearestLon=line.coords[i-1][0]+t*(b[0]-line.coords[i-1][0]);
        nearestLat=line.coords[i-1][1]+t*(b[1]-line.coords[i-1][1]);
      }
      ax=bx;ay=by;
    }
  }
  return item?{item,km:Math.sqrt(shortest),lat:nearestLat,lon:nearestLon}:null;
}
