"""Build aggregate resident counts by age and census sector for the campaign planner."""
import argparse
import gzip
from collections import defaultdict
from pathlib import Path
from zipfile import ZipFile

from build_sector_profiles import compact

# Inclusive ranges, with standard adult age bands and additional census comparisons.
COHORTS = [(18, 24), (25, 34), (35, 44), (45, 54), (55, 64), (65, 120),
           (18, 120), (25, 45), (45, 60), (60, 120)]


def census_residents(archive):
    counts = defaultdict(lambda: [0] * 121)
    with ZipFile(archive) as z:
        name, = [n for n in z.namelist() if n.endswith('/CPV_2022_Poblacion_Sector.csv')]
        with z.open(name) as stream:
            fields = stream.readline().decode('utf-8-sig').strip().split(';')
            assert fields[:5] == ['I01', 'I02', 'I03', 'I04', 'I05']
            age_col = fields.index('P03')
            for row in stream:
                if row[:2] not in (b'09', b'24'):
                    continue
                fields = row.split(b';', age_col + 1)
                code = b''.join(fields[:5]).decode('ascii')
                age = int(fields[age_col])
                if not 0 <= age <= 120:
                    raise ValueError('Invalid census age in ' + code)
                counts[code][age] += 1
    return counts


def build(archive, gpkg, out):
    from osgeo import ogr, osr
    residents = census_residents(archive)
    ogr.UseExceptions()
    ds = ogr.Open(str(gpkg))
    layer = ds.GetLayer(0)
    layer.SetAttributeFilter("provincia IN ('09','24')")
    dest = osr.SpatialReference()
    dest.ImportFromEPSG(4326)
    dest.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    convert = osr.CoordinateTransformation(layer.GetSpatialRef(), dest)
    rows = []
    for feature in layer:
        code = feature['sec_anm']
        if code not in residents:
            continue
        point = feature.GetGeometryRef().PointOnSurface()
        point.Transform(convert)
        ages = residents[code]
        groups = [sum(ages[lo:hi+1]) for lo, hi in COHORTS]
        assert sum(groups[:6]) == groups[6]
        rows.append([code, round(point.GetY(), 5), round(point.GetX(), 5), sum(ages), groups])
    assert len({row[0] for row in rows}) == len(rows)
    payload = dict(year=2022, unit='residents', cohorts=COHORTS, sectors=sorted(rows))
    out.write_bytes(gzip.compress(compact(payload), compresslevel=9, mtime=0))
    print('Mapped sectors:', len(rows), 'residents:', sum(r[3] for r in rows))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for arg in ['archive', 'gpkg', 'out']:
        parser.add_argument(arg, type=Path)
    build(**vars(parser.parse_args()))
