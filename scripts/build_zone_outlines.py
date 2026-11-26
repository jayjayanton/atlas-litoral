"""Build display outlines for the census zones from the official INEC sector GeoPackage."""
import argparse
import gzip
import json
from collections import defaultdict
from pathlib import Path

from osgeo import ogr, osr


def build(source, destination, index):
    ogr.UseExceptions()
    zones = json.loads(index.read_text())["zones"]
    db = ogr.Open(str(source))
    layer = db.GetLayer(0)
    layer.SetAttributeFilter("provincia IN ('09','24')")
    groups = defaultdict(lambda: ogr.Geometry(ogr.wkbMultiPolygon))
    for row in layer:
        code = row["sec_anm"][:9]
        if code not in zones:
            continue
        geometry = row.GetGeometryRef()
        polygons = [geometry] if geometry.GetGeometryName() == "POLYGON" else geometry
        for polygon in polygons:
            groups[code].AddGeometry(polygon)
    target = osr.SpatialReference()
    target.ImportFromEPSG(4326)
    target.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    transform = osr.CoordinateTransformation(layer.GetSpatialRef(), target)
    result = {}
    for code, group in sorted(groups.items()):
        geometry = group.UnionCascaded().SimplifyPreserveTopology(12)
        geometry.Transform(transform)
        polygons = [geometry] if geometry.GetGeometryName() == "POLYGON" else geometry
        result[code] = [[[[round(y, 5), round(x, 5)] for x, y, *_ in ring.GetPoints()]
                         for ring in polygon] for polygon in polygons]
    if result.keys() != zones.keys():
        raise ValueError("Missing census zones")
    data = json.dumps(result, separators=(",", ":")).encode()
    destination.write_bytes(gzip.compress(data, compresslevel=9, mtime=0))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("gpkg", type=Path)
    parser.add_argument("--index", type=Path, default=Path("docs/data/sectors/index.json"))
    parser.add_argument("--output", type=Path, default=Path("docs/data/zone-outlines.json.gz"))
    args = parser.parse_args()
    build(args.gpkg, args.output, args.index)
