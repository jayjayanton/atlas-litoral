"""Rebuild the local point catalog from the official IEDG geographic preview."""
import json
from pathlib import Path
from urllib.request import urlopen

SOURCE = 'https://visor-iedg.github.io/Atractivos-turisticos/'
OUTPUT = Path(__file__).resolve().parents[1] / 'docs/data/infra/attractions.json'


def extract(page):
    _, tag, payload = page.partition('const atractivosData=')
    if not tag:
        raise ValueError('No se encontró la capa de atractivos turísticos')
    collection, _ = json.JSONDecoder().raw_decode(payload.lstrip())
    rows = []
    for feature in collection['features']:
        geometry = feature['geometry']
        lon, lat = geometry['coordinates']
        name = feature['properties']['Nombre'].strip()
        if geometry['type'] != 'Point' or not name or not (-180 <= lon <= 180 and -90 <= lat <= 90):
            raise ValueError('Registro de atractivo inválido')
        rows.append(dict(name=name, lat=lat, lon=lon))
    if not rows:
        raise ValueError('Inventario vacío')
    return rows


if __name__ == '__main__':
    with urlopen(SOURCE, timeout=30) as response:
        records = extract(response.read().decode('utf-8-sig'))
    OUTPUT.write_text(json.dumps(records, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
