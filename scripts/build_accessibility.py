#!/usr/bin/python3
"""Build a 3 km coastal accessibility grid and canton-level permutation Gi* measures.

Requires GDAL, pyproj, scipy and numpy. Source coordinates are WGS84 lon/lat.
Run python scripts/build_accessibility.py --help to supply an alternative source checkout and datasets.
"""
import argparse
import json
import hashlib
import math
from pathlib import Path
import unicodedata
from collections import Counter

import numpy as np
from osgeo import ogr, osr
from pyproj import Transformer
from scipy.spatial import cKDTree

FORWARD = Transformer.from_crs(4326, 32717, always_xy=True)
REVERSE = Transformer.from_crs(32717, 4326, always_xy=True)
STEP = 3000
PERMUTATIONS = 19999
SEED = 20261125
K_NEIGHBORS = 4
ALPHA = 0.05

def read(path):
    return json.loads(Path(path).read_text())
def dump(path, data):
    Path(path).write_text(json.dumps(data, ensure_ascii=False, allow_nan=False, separators=(',', ':')) + '\n')
def flat(text):
    return ''.join(x for x in unicodedata.normalize('NFKD', str(text or '').lower()) if not unicodedata.combining(x))

def projected_shape(feature):
    geom = ogr.CreateGeometryFromJson(json.dumps(feature['geometry']))
    sr = osr.SpatialReference()
    sr.ImportFromEPSG(4326)
    sr.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    target = osr.SpatialReference()
    target.ImportFromEPSG(32717)
    target.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    geom.Transform(osr.CoordinateTransformation(sr, target))
    return geom

class Polygons:
    def __init__(self, features):
        self.shapes = []
        for f in features:
            geom = projected_shape(f)
            self.shapes.append((f.get('properties',{}).get('code'),geom.GetEnvelope(),geom))

    def locate(self,x,y):
        point = None
        for code,(x0,x1,y0,y1),g in self.shapes:
            if x0<=x<=x1 and y0<=y<=y1:
                if point is None:
                    point = ogr.Geometry(ogr.wkbPoint)
                    point.AddPoint_2D(float(x),float(y))
                if g.Intersects(point):
                    return code if code is not None else True
        return None

def sites_xy(records):
    if not records:
        return np.empty((0,2))
    lons=[r['lon'] for r in records]
    lats=[r['lat'] for r in records]
    xs,ys=FORWARD.transform(lons,lats)
    coords=np.column_stack((xs,ys))
    if not np.isfinite(coords).all():
        raise ValueError('Non-finite facility coordinates.')
    return coords

def point_distances(grid, records):
    if not records:
        return [None]*len(grid)
    distances,_=cKDTree(sites_xy(records)).query(grid)
    return [round(float(d/1000),3) for d in distances]

def lines_in(geometry):
    if geometry['type']=='LineString':
        yield geometry['coordinates']
    elif geometry['type']=='MultiLineString':
        yield from geometry['coordinates']
    elif geometry['type']=='GeometryCollection':
        for child in geometry['geometries']:
            yield from lines_in(child)

def nearest_roads(grid,collection):
    # Midpoint tree is only the search index; every retained candidate is evaluated
    # against its continuous segment, so station spacing cannot inflate a distance.
    starts=[];ends=[]
    for f in collection['features']:
        for coords in lines_in(f['geometry']):
            if len(coords)<2:
                continue
            ll=np.asarray(coords)[:,:2]
            xy=np.column_stack(FORWARD.transform(ll[:,0],ll[:,1]))
            for a,b in zip(xy[:-1],xy[1:]):
                length=np.linalg.norm(b-a)
                if length==0:
                    continue
                n=math.ceil(length/2000)
                if n==1:
                    starts.append(a);ends.append(b)
                else:
                    pts=np.linspace(a,b,n+1)
                    starts.extend(pts[:-1]);ends.extend(pts[1:])
    if not starts:
        return [None]*len(grid)
    a,b=np.asarray(starts),np.asarray(ends)
    delta=b-a
    length_sq=(delta*delta).sum(axis=1)
    max_half=math.sqrt(float(length_sq.max()))/2
    tree=cKDTree((a+b)/2)
    nearest_mid,_=tree.query(grid)
    candidates=tree.query_ball_point(grid,nearest_mid+max_half+0.000001)
    result=[]
    for p,ids in zip(grid,candidates):
        ii=np.asarray(ids)
        ap=p-a[ii]
        projection=np.clip((ap*delta[ii]).sum(axis=1)/length_sq[ii],0,1)
        nearest=ap-projection[:,None]*delta[ii]
        result.append(round(math.sqrt(float((nearest*nearest).sum(axis=1).min()))/1000,3))
    return result

def grid_locations(cantons,land):
    bounds=[row[1] for row in cantons.shapes]
    x0=min(b[0] for b in bounds);x1=max(b[1] for b in bounds)
    y0=min(b[2] for b in bounds);y1=max(b[3] for b in bounds)
    points=[];rows=[]
    for y0_cell in range(math.floor(y0/STEP)*STEP,math.ceil(y1/STEP)*STEP,STEP):
        for x0_cell in range(math.floor(x0/STEP)*STEP,math.ceil(x1/STEP)*STEP,STEP):
            x=x0_cell+STEP/2;y=y0_cell+STEP/2
            code=cantons.locate(x,y)
            if not code or not land.locate(x,y):
                continue
            lon,lat=REVERSE.transform(x,y)
            rows.append([round(lon,6),round(lat,6),code])
            points.append((x,y))
    if not points:
        raise ValueError('The land/canton grid is empty.')
    return np.asarray(points),rows

def count_by_canton(records,cantons,known):
    counts=Counter(); assigned={'declared_dpa':0,'geometric':0,'external':0,'disagreements':0}
    for r,xy in zip(records,sites_xy(records)):
        # A run with authoritative administrative canton code takes precedence at
        # simplified or coastal borders. A buffer point outside is not a canton record.
        code=str(r.get('cantonCode') or r.get('canton_code') or r.get('code') or '').zfill(4)
        geometric=cantons.locate(*xy)
        if code in known:
            if geometric and geometric!=code:assigned['disagreements']+=1
            assigned['declared_dpa']+=1
        elif code!='0000' and len(code)==4 and code.isdigit():
            assigned['external']+=1
            continue
        elif geometric:
            assigned['geometric']+=1
            code=geometric
        else:
            assigned['external']+=1
            continue
        counts[code]+=1
    return counts,assigned

def by_qvalues(pvalues):
    """Benjamini–Yekutieli q-values for dependent tests."""
    p=np.asarray(pvalues,dtype=float)
    order=np.argsort(p)
    m=len(p)
    raw=p[order]*m*sum(1/j for j in range(1,m+1))/np.arange(1,m+1)
    monotone=np.minimum.accumulate(raw[::-1])[::-1]
    q=np.empty(m);q[order]=np.minimum(monotone,1)
    return q

def gistar(rates, neighbors):
    n=len(rates)
    k=neighbors.shape[1]
    mean=rates.mean()
    sd=rates.std()
    stat=rates[neighbors].sum(axis=1)
    expected=k*mean
    centered=stat-expected
    deviations=sd*math.sqrt(k*(n-k)/(n-1))
    if deviations < 1e-12:
        return [{'z':None,'p':None,'q':None,'cluster':'unknown'} for _ in rates]
    # Uniform random permutation of labels. Independent permutations are shared
    # across cantons for one map. The plus-one p includes the observed assignment.
    rng=np.random.default_rng(SEED)
    extremes=np.zeros(n,dtype=int)
    for batch_start in range(0,PERMUTATIONS,500):
        size=min(500,PERMUTATIONS-batch_start)
        perm=rng.permuted(np.broadcast_to(rates,(size,n)).copy(),axis=1)
        null=perm[:,neighbors].sum(axis=2)-expected
        extremes+=(abs(null)>=abs(centered)-1e-12).sum(axis=0)
    p=(extremes+1)/(PERMUTATIONS+1)
    q=by_qvalues(p)
    return [{'z':round(float(z),5),'p':round(float(pi),5),'q':round(float(qi),5),
             'cluster':'hot' if qi<=ALPHA and z>0 else ('cold' if qi<=ALPHA and z<0 else 'none')}
            for z,pi,qi in zip(centered/deviations,p,q)]

def compile_hotspots(features,cantons,school_records,hospital_records):
    codes=[f['properties']['code'] for f in features]
    population=np.array([f['properties']['population'] for f in features],dtype=float)
    coords=np.array([FORWARD.transform(*f['properties']['labelPoint']) for f in features])
    neighbors=np.argsort(((coords[:,None]-coords[None,:])**2).sum(axis=2),axis=1,kind='stable')[:,:K_NEIGHBORS+1]
    assert all(i in nbrs for i,nbrs in enumerate(neighbors))
    data={code:{} for code in codes};audit={}
    for key,records in [('school',school_records),('hospital',hospital_records)]:
        counts,report=count_by_canton(records,cantons,set(codes))
        audit[key]=report
        nn=np.array([counts[k] for k in codes]);rates=nn/population*10000
        scores=gistar(rates,neighbors)
        for i,code in enumerate(codes):
            data[code][key]={'count':int(nn[i]),'rate':round(float(rates[i]),4),**scores[i]}
    return data,audit

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    data_path=Path(__file__).resolve().parents[1]/'docs'/'data'
    parser.add_argument('--data',type=Path,default=data_path)
    parser.add_argument('--schools',type=Path,default=data_path/'infra'/'schools.json')
    parser.add_argument('--hospitals',type=Path,default=data_path/'infra'/'hospitals.json')
    parser.add_argument('--roads',type=Path,default=data_path/'infra'/'roads.geojson')
    parser.add_argument('--out',type=Path,default=data_path/'infra')
    args=parser.parse_args()
    args.out.mkdir(exist_ok=True,parents=True)
    features=read(args.data/'cantons.json')['features']
    cantons=Polygons(features)
    land=Polygons([f for f in read(args.data/'context.json')['features'] if f['properties']['kind']=='land'])
    xy,base=grid_locations(cantons,land)
    schools=read(args.schools);hospitals=read(args.hospitals);roads=read(args.roads)
    assert len({str(r['id']) for r in schools})==len(schools)
    assert len({str(r['id']) for r in hospitals})==len(hospitals)
    publics=[r for r in hospitals if flat(r.get('sector'))=='publico']
    privates=[r for r in hospitals if flat(r.get('sector'))=='privado']
    groups=[schools,hospitals,publics,privates]
    dists=[point_distances(xy,r) for r in groups]+[nearest_roads(xy,roads)]
    cells=[row+list(values) for row,values in zip(base,zip(*dists))]
    columns=['lon','lat','code','schoolKm','hospitalKm','publicHospitalKm','privateHospitalKm','roadKm']
    dump(args.out/'grid.json',{'spacingKm':STEP/1000,'columns':columns,'cells':cells})
    msp=[r for r in publics if r.get('source')=='MSP / IEDG']
    if not msp:
        raise ValueError('MSP public inventory is missing; do not downgrade absence to zero.')
    cant_data,audit=compile_hotspots(features,cantons,schools,msp)
    method={'unit':'establecimientos cartografiados por 10.000 habitantes (Censo 2022)',
      'schoolScope':'Sedes y extensiones educativas activas del registro ministerial, agosto de 2026. Cada registro cuenta una vez, incluso al compartir predio.',
      'hospitalScope':'Hospitales del Ministerio de Salud Pública (MSP / IEDG), julio de 2026. Se excluyen las redes privadas y otros operadores públicos para mantener la misma fuente en los 28 cantones.',
      'statistic':'Gi* de Getis-Ord; suma local estandarizada bajo aleatorización',
      'neighbors':4,'weights':'Cuatro puntos de referencia cantonales más cercanos y el propio cantón; pesos binarios.',
      'permutations':PERMUTATIONS,'seed':SEED,'pvalue':'Bilateral por permutación global de tasas entre cantones, con corrección +1.',
      'adjustment':'Benjamini–Yekutieli para las 28 pruebas de cada indicador, q ≤ 0,05.',
      'notes':'El vecindario se limita a las dos provincias. Las tasas usan registros, sin medir capacidad ni demanda de vivienda.'}
    dump(args.out/'hotspots.json',{'method':method,'cantons':cant_data})
    audit['inputsSha256']={name:hashlib.sha256(path.read_bytes()).hexdigest() for name,path in [
        ('cantons',args.data/'cantons.json'),('landContext',args.data/'context.json'),
        ('schools',args.schools),('hospitals',args.hospitals),('roads',args.roads)]}
    audit['gridSize']=len(cells)
    audit['cantonsWithCenters']=len({r[2] for r in cells})
    audit['facilityCount']={'school':len(schools),'hospital':len(hospitals),'publicHospital':len(publics),'privateHospital':len(privates)}
    audit['schoolClusterCounts']=dict(Counter(v['school']['cluster'] for v in cant_data.values()))
    audit['hospitalClusterCounts']=dict(Counter(v['hospital']['cluster'] for v in cant_data.values()))
    audit['distances']='EPSG:32717. Centros interiores cada 3 km con máscara terrestre Natural Earth. Distancia recta mínima a un punto o a segmentos viales disponibles; no mide tiempos ni acceso legal.'
    dump(args.out/'analysis-meta.json',audit)
    print(json.dumps(audit,indent=2,ensure_ascii=False))
if __name__=='__main__':
    main()
