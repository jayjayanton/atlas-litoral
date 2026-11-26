"""Build shopping-centre and urban-centre reference points from local OSM catalogs."""
import argparse
import gzip
import json
import re
from pathlib import Path

DOCS = Path(__file__).resolve().parents[1] / 'docs'
SHOPPING_NAME = re.compile(r'^(?:Centro Comercial(?:\s+-)?|C\.C\.\s*Riocentro|Riocentro\b|Paseo Shopping\b)', re.I)


def build(building_file, city_file):
    rows=set()
    for name,canton,lat,lon in json.loads(gzip.decompress(Path(building_file).read_bytes())):
        if SHOPPING_NAME.search(name):
            rows.add(('shopping',name,canton,lat,lon))
    for kind,name,canton,lat,lon in json.loads(gzip.decompress(Path(city_file).read_bytes())):
        if kind=='city':
            rows.add(('city',name,canton,lat,lon))
    output=json.dumps(sorted(rows),ensure_ascii=False,separators=(',',':'))
    target=DOCS/'data/infra/site-amenities.json'
    target.write_text(output,encoding='utf-8')
    print(f'{len(rows)} mapped points, including named shopping centres and urban centres')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('building_catalog',help='named-buildings-osm-20261124.json.gz')
    parser.add_argument('city_catalog',help='OSM city reference points JSON')
    args=parser.parse_args()
    build(args.building_catalog,args.city_catalog)
