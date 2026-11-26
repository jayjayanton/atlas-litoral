"""Build aggregate census sector profiles, survey references and display boundaries.

Use Python with the GDAL bindings for geometry. The inputs are the INEC sector
population ZIP, extracted official sector GeoPackage, and the two ENIGHUR CSVs.
Only counts, regional survey summaries and public boundaries are written.
"""
import argparse
import bisect
import csv
import gzip
import json
from collections import Counter, defaultdict
from pathlib import Path
from zipfile import ZipFile

AGES = [25, 46, 60]  # 0–24, 25–45, 46–59, 60+
DOLLARS = [500, 1000, 1500, 2000]
PROVINCES = ('09', '24')


def census_counts(archive):
    result = defaultdict(lambda: [0] * 8)
    with ZipFile(archive) as z:
        name, = [m for m in z.namelist() if m.endswith('/CPV_2022_Poblacion_Sector.csv')]
        with z.open(name) as f:
            fields = f.readline().decode('utf-8-sig').strip().split(';')
            assert fields[:5] == ['I01', 'I02', 'I03', 'I04', 'I05']
            age, relation = (fields.index(v) for v in ('P03', 'P01'))
            for row in f:
                if row[:2] not in (b'09', b'24'):
                    continue
                cells = row.split(b';', max(age, relation) + 1)
                code = b''.join(cells[:5]).decode('ascii')
                years = int(cells[age])
                if len(code) != 12 or not code.isdigit() or not 0 <= years <= 120:
                    raise ValueError('Invalid sector or age')
                group = bisect.bisect_right(AGES, years)
                counts = result[code]
                counts[group] += 1
                if int(cells[relation]) == 1:
                    counts[group + 4] += 1
    return result


def household_totals(archive):
    with ZipFile(archive) as z:
        name, = [m for m in z.namelist() if m.endswith('/CPV_2022_Hogar_Sector.csv')]
        with z.open(name) as f:
            fields = f.readline().decode('utf-8-sig').strip().split(';')
            assert fields[:5] == ['I01', 'I02', 'I03', 'I04', 'I05']
            return Counter(b''.join(row.split(b';', 5)[:5]).decode('ascii')
                           for row in f if row[:2] in (b'09', b'24'))


def missing_ages(counts, households):
    if set(households) - set(counts):
        raise ValueError('Household sector without population')
    differences = {k: households.get(k, 0) - sum(v[4:]) for k, v in counts.items()}
    if min(differences.values()) < 0:
        raise ValueError('More representatives than private households')
    return {k: v for k, v in differences.items() if v}


def survey_groups(households, people):
    # Keep the same provincial income reference throughout each province.
    with open(people, encoding='utf-8-sig', newline='') as f:
        heads = {}
        for r in csv.DictReader(f):
            if r['PROVINCIA'].strip().zfill(2) in PROVINCES and int(r['P05']) == 1:
                key = r['Identif_hog'].strip()
                if key in heads:
                    raise ValueError('Duplicate survey household representative')
                heads[key] = int(r['P04'])
    samples = {p: [[] for _ in range(4)] for p in PROVINCES}
    with open(households, encoding='utf-8-sig', newline='') as f:
        for r in csv.DictReader(f, delimiter=';'):
            p = r['PROVINCIA'].strip().zfill(2)
            if p not in samples or not r['ing_mon_cor'].strip():
                continue
            a = heads[r['Identif_hog'].strip()]
            y = float(r['ing_mon_cor'].replace(',', '.'))
            w = float(r['Fexp'].replace(',', '.'))
            if w <= 0 or y < 0 or not 0 <= a <= 120:
                raise ValueError('Invalid survey record')
            samples[p][bisect.bisect_right(AGES, a)].append((y, w))
    result = {}
    for p, groups in samples.items():
        result[p] = []
        for group in groups:
            total = sum(w for y, w in group)
            weights = [0.] * (len(DOLLARS) + 1)
            amounts = sorted(group)
            cumulative = []
            running = 0.
            for y, w in amounts:
                running += w
                cumulative.append(running)
                weights[bisect.bisect_right(DOLLARS, y)] += w
            quartiles = [amounts[bisect.bisect_left(cumulative, q * total)][0] for q in (.25, .5, .75)]
            result[p].append(dict(n=len(group), quartiles=quartiles, shares=[round(w / total, 9) for w in weights]))
    return result


def compact(obj):
    return json.dumps(obj, separators=(',', ':'), ensure_ascii=False).encode('utf-8')


def boundaries(gpkg, counts, households, output):
    from osgeo import ogr, osr
    ogr.UseExceptions()
    ds = ogr.Open(str(gpkg))
    layer = ds.GetLayer(0)
    layer.SetAttributeFilter("provincia IN ('09','24')")
    src = layer.GetSpatialRef().Clone()
    dst = osr.SpatialReference()
    dst.ImportFromEPSG(4326)
    dst.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    transform = osr.CoordinateTransformation(src, dst)
    zones = defaultdict(list)
    cartographic = defaultdict(int)
    shapes = 0
    for f in layer:
        code = f['sec_anm']
        shapes += 1
        cartographic[code[:6]] += int(f['pob_t'] or 0)
        if code not in counts:
            continue
        totals = counts[code]
        g = f.GetGeometryRef().SimplifyPreserveTopology(5)
        if g.Transform(transform):
            raise ValueError('Coordinate transform failed')
        # Closed rings include all polygon parts and holes. Round only for display.
        polygons = [g] if g.GetGeometryName() == 'POLYGON' else list(g)
        rings = [[[[round(pt[1], 5), round(pt[0], 5)] for pt in ring.GetPoints()] for ring in poly] for poly in polygons]
        row = [code[-3:], totals, rings]
        if f['pob_t'] is not None and sum(totals[:4]) != int(f['pob_t']):
            row.append(int(f['pob_t']))
        zones[code[:9]].append(row)
    placed = {z + row[0] for z, rows in zones.items() for row in rows}
    pooled = set(counts) - placed
    if any(not k.endswith('888') for k in pooled):
        raise ValueError('Unexpected location code without geometry')
    totals = defaultdict(int)
    for code, v in counts.items():
        totals[code[:6]] += sum(v[:4])
    if totals != cartographic:
        raise ValueError('Parish populations fail to reconcile between census files')
    coverage = dict(mapped=len(placed), shapes=shapes, pooledResidents=sum(sum(counts[k][:4]) for k in pooled),
                    pooledHouseholds=sum(households.get(k, 0) for k in pooled))
    lookup = {}
    block, prefix, num, size = {}, '', 0, 0

    def flush():
        if block:
            filename = f'{prefix}-{num}.json.gz'
            (output / filename).write_bytes(gzip.compress(compact(block), compresslevel=9, mtime=0))
            for z in block:
                points = (point for row in block[z] for poly in row[2] for ring in poly for point in ring)
                south, west = 90., 180.
                north, east = -90., -180.
                for lat, lon in points:
                    south, west = min(south, lat), min(west, lon)
                    north, east = max(north, lat), max(east, lon)
                lookup[z] = [filename, south, west, north, east]

    for zone, rows in sorted(zones.items()):
        if zone[:4] != prefix or size + len(rows) > 300:
            flush()
            block, size = {}, 0
            num = num + 1 if zone[:4] == prefix else 0
            prefix = zone[:4]
        block[zone] = sorted(rows)
        size += len(rows)
    flush()
    return lookup, coverage


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ['census_zip', 'gpkg', 'households_csv', 'persons_csv', 'output_dir']:
        p.add_argument(name, type=Path)
    args = p.parse_args()
    out = args.output_dir
    out.mkdir(parents=True, exist_ok=True)
    refs = survey_groups(args.households_csv, args.persons_csv)
    counts = census_counts(args.census_zip)
    households = household_totals(args.census_zip)
    missing = missing_ages(counts, households)
    index, coverage = boundaries(args.gpkg, counts, households, out)
    data = dict(ageCuts=AGES, incomeCuts=DOLLARS, provinces=refs, zones=index, coverage=coverage,
                withoutAgeBySector={k: v for k, v in sorted(missing.items()) if not k.endswith('888')})
    (out / 'index.json').write_bytes(compact(data) + b'\n')
    print('Sectors, residents, private households:', len(counts), sum(sum(v[:4]) for v in counts.values()), sum(households.values()))


if __name__ == '__main__':
    main()
