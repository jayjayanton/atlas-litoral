#!/usr/bin/env python3
"""Rebuild the Atlas Litoral facility-count sidecar. Requires NumPy and SciPy.

Usage: python scripts/build_density.py --input docs/data/infra --output docs/data/infra/density.json --verify
"""
import argparse
import json
from pathlib import Path
import unicodedata

import numpy as np
from scipy.spatial import cKDTree

RADIUS_KM = 6371.0088  # docs/model.js distanceKm
RADII = (2, 5, 10)
COLUMNS = ('school', 'all', 'public', 'private')


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def sector(record):
    text = unicodedata.normalize('NFD', record.get('sector', '').casefold())
    value = ''.join(c for c in text if not unicodedata.combining(c))
    if value.startswith('public'):
        return 'public'
    if value.startswith('privad'):
        return 'private'
    return 'unknown'


def sphere_xyz(lonlat):
    lon, lat = np.radians(lonlat).T
    return np.column_stack((np.cos(lat)*np.cos(lon), np.cos(lat)*np.sin(lon), np.sin(lat)))


def facility_counts(centers, records, verify=False):
    if len(records) != len({r['id'] for r in records}):
        raise ValueError('The layer must have unique facility record IDs.')
    if not records:
        return np.zeros((len(centers),len(RADII)), dtype=int)
    points = np.asarray([(r['lon'],r['lat']) for r in records], dtype=float)
    if not np.isfinite(points).all():
        raise ValueError('A facility has invalid coordinates.')
    # Great-circle distance <= r equals Euclidean chord distance <= 2 sin(r/2R).
    tree = cKDTree(sphere_xyz(points))
    center_xyz = sphere_xyz(centers)
    counts = np.column_stack([tree.query_ball_point(
        center_xyz, 2*np.sin(r/(2*RADIUS_KM)), return_length=True) for r in RADII])
    if verify:
        lon, lat = np.radians(points).T
        for index,(center_lon,center_lat) in enumerate(np.radians(centers)):
            h = np.sin((lat-center_lat)/2)**2 + np.cos(lat)*np.cos(center_lat)*np.sin((lon-center_lon)/2)**2
            km = 2*RADIUS_KM*np.arcsin(np.sqrt(np.clip(h,0,1)))
            expected = [int(np.count_nonzero(km <= r)) for r in RADII]
            if list(counts[index]) != expected:
                raise ValueError(f'Count mismatch at {centers[index]}: {counts[index]} vs {expected}')
    return counts


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--verify',action='store_true')
    args=parser.parse_args()
    grid=read(args.input/'grid.json')
    row_lon=grid['columns'].index('lon'); row_lat=grid['columns'].index('lat')
    centers=np.asarray([(r[row_lon],r[row_lat]) for r in grid['cells']],dtype=float)
    if len(set(map(tuple,centers)))!=len(centers):
        raise ValueError('Repeated grid coordinates.')
    schools=read(args.input/'schools.json')
    hospitals=read(args.input/'hospitals.json')
    layers=(schools,hospitals,[h for h in hospitals if sector(h)=='public'],
            [h for h in hospitals if sector(h)=='private'])
    counts=np.stack([facility_counts(centers,sites,args.verify) for sites in layers],axis=-1)
    if np.any(counts[:,1:,:]<counts[:,:-1,:]):
        raise ValueError('Radius monotonicity failed.')
    if np.any(counts[:,:,1]<counts[:,:,2]+counts[:,:,3]):
        raise ValueError('Hospital ownership totals exceed all hospitals.')
    cells=[[float(lon),float(lat),value.tolist()] for (lon,lat),value in zip(centers,counts)]
    output={'radiiKm':RADII,'columns':COLUMNS,'cells':cells}
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(output,separators=(',',':'),allow_nan=False)+'\n',encoding='utf-8')
    scale={'radiiKm':RADII,'columns':COLUMNS,'maxima':counts.max(axis=0).tolist()}
    args.output.with_name('density-scale.json').write_text(json.dumps(scale,separators=(',',':'))+'\n',encoding='utf-8')
    print(f'{len(centers)} centers. Radius maxima [schools, all hospitals, public, private]: {counts.max(axis=0).tolist()}')

if __name__=='__main__':
    main()
