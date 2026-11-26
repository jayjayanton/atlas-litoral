import {distanceKm} from './model.js';
import {ownership} from './access-model.js';

export const presets={
  balanced:[33,33,33], school:[60,20,20], hospital:[20,60,20], road:[20,20,60]
};
export const isValidWeights=weights=>Array.isArray(weights)&&weights.length===3&&
  weights.every(w=>Number.isFinite(w)&&w>=0&&w<=100)&&weights.some(w=>w>0);

export function countInRadius(lat,lon,sites,radius,scope='all'){
  if(!Array.isArray(sites))return null;
  let count=0;
  for(const site of sites){
    if(scope!=='all'&&ownership(site.sector)!==scope)continue;
    if(distanceKm(lat,lon,[site.lon,site.lat])<=radius)count++;
  }
  return count;
}

export function buildDensityGrid(grid,density){
  const pos=Object.fromEntries(grid.columns.map((v,i)=>[v,i]));
  const counts=new Map(density.cells.map(([lon,lat,counts])=>[lon+','+lat,counts]));
  const cells=grid.cells.map(row=>{
    const lon=row[pos.lon],lat=row[pos.lat];
    return {lon,lat,code:row[pos.code],roadKm:row[pos.roadKm],counts:counts.get(lon+','+lat)};
  });
  // The regional denominator stays fixed when a user narrows the comparison area.
  const maxima=density.radiiKm.map((_,ri)=>density.columns.map((_,ci)=>{
    let max=0;
    for(const cell of cells){
      const n=cell.counts?.[ri]?.[ci];
      if(!Number.isInteger(n)||n<0)throw Error('Incomplete density grid.');
      max=Math.max(max,n);
    }
    return max;
  }));
  return {cells,maxima};
}

export function suitabilityScore(schools,hospitals,roadKm,maxSchools,maxHospitals,roadLimit,weights){
  if(!isValidWeights(weights)||!Number.isFinite(roadLimit)||roadLimit<=0)return null;
  const density=(count,max)=>!Number.isFinite(count)||count<0||!Number.isFinite(max)||max<0?null:
    max>0?Math.min(1,count/max):(count===0?0:null);
  const parts=[density(schools,maxSchools),density(hospitals,maxHospitals),
    Number.isFinite(roadKm)&&roadKm>=0?Math.max(0,1-roadKm/roadLimit):null];
  let sum=0;
  for(let i=0;i<3;i++){
    if(!weights[i])continue;
    if(parts[i]===null)return null;
    sum+=weights[i]*parts[i];
  }
  return 100*sum/(weights[0]+weights[1]+weights[2]);
}
