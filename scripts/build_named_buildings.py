"""Build a local named-building gazetteer using GDAL and a Geofabrik Ecuador PBF."""
import argparse
import gzip
import json
import re
import subprocess
import tempfile
from pathlib import Path

from osgeo import ogr

# Include named multi-unit and public/commercial buildings. Generic footprints
# need a building or venue name that identifies a collective place.
CLASSES = {"apartments", "commercial", "office", "retail", "hospital", "school",
           "university", "college", "hotel", "civic", "public", "government",
           "church", "cathedral", "chapel", "stadium", "train_station", "terminal"}
COLLECTIVE = re.compile(r"\b(edificios?|torres?|towers?|condominios?|conjunto|bloque|centro comercial|hospital|cl[ií]nica|hotel|plaza|mercado|terminal|universidad|colegio|escuela|municipio|iglesia)\b", re.I)
DOCS = Path(__file__).resolve().parents[1] / 'docs'


def build(pbf):
    ogr.UseExceptions()
    cantons = json.loads((DOCS / 'data/cantons.json').read_text())['features']
    areas = [(f['properties']['code'], ogr.CreateGeometryFromJson(json.dumps(f['geometry']))) for f in cantons]
    rows = set()
    with tempfile.TemporaryDirectory() as directory:
        polygons = Path(directory) / 'buildings.gpkg'
        subprocess.run(['ogr2ogr', '-f', 'GPKG', '-select', 'name,building,amenity,shop,office,tourism', '-where',
                        "name IS NOT NULL AND building IS NOT NULL AND building <> 'no'",
                        '-nln', 'buildings', str(polygons), pbf, 'multipolygons'], check=True)
        ds = ogr.Open(str(polygons))
        for f in ds.GetLayer(0):
            name = ' '.join(f['name'].split())
            if not 2 <= len(name) <= 80:
                continue
            kind = f['building']
            if kind not in CLASSES:
                if kind not in ('yes', 'residential', 'mixed_use') or not (
                    COLLECTIVE.search(name) or any(f[k] for k in ('amenity', 'shop', 'office', 'tourism'))
                ):
                    continue
            point = f.GetGeometryRef().PointOnSurface()
            for code, area in areas:
                if area.Contains(point):
                    rows.add((name, code, round(point.GetY(), 6), round(point.GetX(), 6)))
                    break
    payload = json.dumps(sorted(rows), ensure_ascii=False, separators=(',', ':')).encode()
    (DOCS / 'data/named-buildings-osm-20261124.json.gz').write_bytes(gzip.compress(payload, mtime=0))
    print(f'{len(rows)} named building locations')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pbf', help='Ecuador extract from Geofabrik, 2026-11-24')
    build(parser.parse_args().pbf)
