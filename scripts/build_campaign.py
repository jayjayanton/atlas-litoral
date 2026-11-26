"""Build anonymous census and survey aggregates for project-area market research."""
import argparse
import csv
import gzip
from bisect import bisect_right
from collections import defaultdict
from pathlib import Path
from zipfile import ZipFile

from osgeo import ogr, osr
from build_sector_profiles import PROVINCES, compact, household_totals

# Inclusive ranges; overlaps allow both an exact research cohort and standard age bands.
COHORTS = [(18, 120), (18, 24), (25, 34), (35, 44), (25, 45), (45, 60), (45, 54), (55, 64), (60, 120), (65, 120)]
CUTS = list(range(250, 15001, 250))


def census_heads(archive):
    counts = defaultdict(lambda: [0] * len(COHORTS))
    buckets = [[i for i, (lo, hi) in enumerate(COHORTS) if lo <= age <= hi] for age in range(121)]
    with ZipFile(archive) as z:
        name, = [n for n in z.namelist() if n.endswith('/CPV_2022_Poblacion_Sector.csv')]
        with z.open(name) as f:
            fields = f.readline().decode('utf-8-sig').strip().split(';')
            assert fields[:5] == ['I01', 'I02', 'I03', 'I04', 'I05']
            age, rel = (fields.index(k) for k in ('P03', 'P01'))
            for row in f:
                if row[:2] not in (b'09', b'24'):
                    continue
                cells = row.split(b';', max(age, rel) + 1)
                key = b''.join(cells[:5]).decode('ascii')
                group = counts[key]
                if int(cells[rel]) == 1:
                    for i in buckets[int(cells[age])]:
                        group[i] += 1
    return counts


def income_reference(households, persons):
    ages = {}
    with persons.open(encoding='utf-8-sig', newline='') as f:
        for r in csv.DictReader(f):
            if r['PROVINCIA'].strip().zfill(2) in PROVINCES and int(r['P05']) == 1:
                k = r['Identif_hog'].strip()
                assert k not in ages
                ages[k] = int(r['P04'])
    hist = {p: [[[0, 0.] for _ in range(len(CUTS)+1)] for _ in COHORTS] for p in PROVINCES}
    with households.open(encoding='utf-8-sig', newline='') as f:
        for r in csv.DictReader(f, delimiter=';'):
            prov = r['PROVINCIA'].strip().zfill(2)
            if prov not in hist or not r['ing_mon_cor'].strip():
                continue
            income = float(r['ing_mon_cor'].replace(',', '.'))
            weight = float(r['Fexp'].replace(',', '.'))
            assert income >= 0 and weight > 0
            bucket = bisect_right(CUTS, income)
            age = ages[r['Identif_hog'].strip()]
            for i, (lo, hi) in enumerate(COHORTS):
                if lo <= age <= hi:
                    cell = hist[prov][i][bucket]
                    cell[0] += 1
                    cell[1] += weight
    refs = {}
    for prov, groups in hist.items():
        refs[prov] = []
        for group in groups:
            sample, weight = map(sum, zip(*group))
            # Index j reports income >= CUTS[j]. Publish only cohort summaries.
            tail, wtail, above = 0, 0., []
            for n, w in reversed(group[1:]):
                tail += n
                wtail += w
                above.append([tail, round(wtail/weight, 7)])
            refs[prov].append(dict(n=sample, above=above[::-1]))
    return refs


def build(archive, gpkg, hh, persons, out):
    heads = census_heads(archive)
    households = household_totals(archive)
    ogr.UseExceptions()
    ds = ogr.Open(str(gpkg))
    layer = ds.GetLayer(0)
    layer.SetAttributeFilter("provincia IN ('09','24')")
    dest = osr.SpatialReference()
    dest.ImportFromEPSG(4326)
    dest.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    convert = osr.CoordinateTransformation(layer.GetSpatialRef(), dest)
    rows = []
    for f in layer:
        code = f['sec_anm']
        if code not in heads:
            continue
        point = f.GetGeometryRef().PointOnSurface()
        point.Transform(convert)
        total = households.get(code, 0)
        assert max(heads[code]) <= total
        rows.append([code, round(point.GetY(), 5), round(point.GetX(), 5), total, heads[code]])
    assert len({r[0] for r in rows}) == len(rows)
    payload = dict(cohorts=COHORTS, cuts=CUTS, refs=income_reference(hh, persons), sectors=sorted(rows))
    out.write_bytes(gzip.compress(compact(payload), compresslevel=9, mtime=0))
    print('Mapped sectors:', len(rows), 'households:', sum(r[3] for r in rows), 'bytes:', out.stat().st_size)


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    for arg in ['archive', 'gpkg', 'hh', 'persons', 'out']:
        p.add_argument(arg, type=Path)
    build(**vars(p.parse_args()))
