"""Collect census household counts by representative age from the atlas sector profiles."""
import gzip
import json
from pathlib import Path


def main():
    data = Path(__file__).resolve().parents[1] / 'docs/data'
    source = data / 'sectors'
    index = json.loads((source / 'index.json').read_text())
    households = {}
    for filename in sorted({item[0] for item in index['zones'].values()}):
        zones = json.loads(gzip.decompress((source / filename).read_bytes()))
        for zone, rows in zones.items():
            for row in rows:
                suffix, counts = row[:2]
                code = zone + suffix
                if code in households or len(counts) != 8:
                    raise ValueError(f'Invalid sector age counts for {code}')
                households[code] = counts[4:]
    census = json.loads(gzip.decompress((data / 'campaign-residents.json.gz').read_bytes()))
    if set(households) != {row[0] for row in census['sectors']}:
        raise ValueError('Campaign sectors and cartographic sectors differ')
    content = json.dumps(households, sort_keys=True, separators=(',', ':')).encode()
    (data / 'campaign-households.json.gz').write_bytes(gzip.compress(content, mtime=0))


if __name__ == '__main__':
    main()
