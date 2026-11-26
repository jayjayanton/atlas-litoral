import {distanceKm} from './model.js';
import {ownership} from './access-model.js';

export const criterionKeys = ['school', 'hospital', 'road', 'shopping', 'city', 'tourism'];
export const presets = {
  balanced: [33, 33, 33, 0, 0, 0],
  school: [60, 20, 20, 0, 0, 0],
  hospital: [20, 60, 20, 0, 0, 0],
  road: [20, 20, 60, 0, 0, 0],
  shopping: [0, 0, 0, 100, 0, 0],
  city: [0, 0, 0, 0, 100, 0],
  tourism: [0, 0, 0, 0, 0, 100]
};

export const isValidWeights = weights => Array.isArray(weights)
  && (weights.length === 3 || weights.length === criterionKeys.length)
  && weights.every(w => Number.isFinite(w) && w >= 0 && w <= 100)
  && weights.some(w => w > 0);

export function weightShares(weights) {
  if (!isValidWeights(weights)) return null;
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map(weight => weight / total);
}

export function countInRadius(lat,lon,sites,radius,scope='all'){
  if(!Array.isArray(sites))return null;
  let count=0;
  for(const site of sites){
    if(scope!=='all'&&ownership(site.sector)!==scope)continue;
    if(distanceKm(lat,lon,[site.lon,site.lat])<=radius)count++;
  }
  return count;
}

function regionalAmenityDistances(amenities, cellCount) {
  if (!amenities) return null;
  const columns = ['lon_e6', 'lat_e6', ...criterionKeys.slice(3).map(key => key + '_m')];
  if (amenities.columns?.join(',') !== columns.join(',') || amenities.deltaRows?.length !== cellCount) {
    throw Error('Unexpected amenity-distance grid.');
  }
  const distances = new Map();
  let values = [0, 0, 0, 0, 0];
  for (const deltas of amenities.deltaRows) {
    if (deltas.length !== columns.length || !deltas.every(Number.isSafeInteger)) throw Error('Invalid distance row.');
    values = values.map((value, i) => value + deltas[i]);
    const [lon, lat, ...metres] = values;
    if (Math.abs(lon) > 180e6 || Math.abs(lat) > 90e6 || metres.some(m => m < 0)) {
      throw Error('Invalid coordinate or amenity distance.');
    }
    distances.set((lon / 1e6) + ',' + (lat / 1e6), metres.map(m => m / 1000));
  }
  if (distances.size !== cellCount) throw Error('Duplicate coordinates in the amenity-distance grid.');
  return distances;
}

export function buildDensityGrid(grid,density,amenities){
  const distances = regionalAmenityDistances(amenities, grid.cells.length);
  const pos=Object.fromEntries(grid.columns.map((v,i)=>[v,i]));
  const counts=new Map(density.cells.map(([lon,lat,counts])=>[lon+','+lat,counts]));
  const cells=grid.cells.map(row=>{
    const lon=row[pos.lon],lat=row[pos.lat];
    const key=lon+','+lat, amenityKm=distances?.get(key) ?? [null,null,null];
    // Consuming each match rejects repeated base-grid coordinates as well as missing cells.
    if (distances && !distances.delete(key)) throw Error('Grid coordinates differ between datasets.');
    return {lon,lat,code:row[pos.code],roadKm:row[pos.roadKm],counts:counts.get(key),amenityKm};
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

export function densityFactor(count, maximum) {
  if (!Number.isFinite(count) || count < 0 || !Number.isFinite(maximum) || maximum < 0) return null;
  if (maximum === 0) return count === 0 ? 0 : null;
  return Math.min(1, count / maximum);
}

export function proximity(distance, limit) {
  if (!Number.isFinite(distance) || distance < 0 || !Number.isFinite(limit) || limit <= 0) return null;
  return Math.max(0, 1 - distance / limit);
}

export function suitabilityFactors(schools, hospitals, roadKm, maxSchools, maxHospitals, roadLimit, amenityKm, radius) {
  return [
    densityFactor(schools, maxSchools),
    densityFactor(hospitals, maxHospitals),
    proximity(roadKm, roadLimit),
    proximity(amenityKm?.[0], radius),
    proximity(amenityKm?.[1], radius),
    proximity(amenityKm?.[2], radius)
  ];
}

export function weightedSuitability(factors, weights) {
  if (!isValidWeights(weights) || !Array.isArray(factors) || factors.length < weights.length) return null;
  let points = 0, totalWeight = 0;
  for (let i = 0; i < weights.length; i++) {
    if (weights[i] === 0) continue;
    const factor = factors[i];
    if (!Number.isFinite(factor) || factor < 0 || factor > 1) return null;
    points += weights[i] * factor;
    totalWeight += weights[i];
  }
  return 100 * points / totalWeight;
}

// Original three-criterion model entry point, retained for existing callers.
export function suitabilityScore(schools,hospitals,roadKm,maxSchools,maxHospitals,roadLimit,weights) {
  if (!Number.isFinite(roadLimit) || roadLimit <= 0) return null;
  return weightedSuitability(suitabilityFactors(schools,hospitals,roadKm,maxSchools,maxHospitals,roadLimit),weights);
}
