"""Aggregate single-year census ages for the sectors included in the Atlas map."""
import argparse
import gzip
import json
from pathlib import Path

from build_campaign import census_residents
from build_sector_profiles import compact


def build(archive, sector_dir, destination):
    counts = census_residents(archive)
    index = json.loads((sector_dir / 'index.json').read_bytes())
    output = {}
    for filename in sorted({row[0] for row in index['zones'].values()}):
        zones = json.loads(gzip.decompress((sector_dir / filename).read_bytes()))
        for zone, rows in zones.items():
            for suffix, summary, *_ in rows:
                code = zone + suffix
                series = counts[code]
                if [sum(series[:25]), sum(series[25:46]), sum(series[46:60]), sum(series[60:])] != summary[:4]:
                    raise ValueError('Age totals differ for sector ' + code)
                # Omitted trailing ages have zero residents. Each remaining position is one year.
                end = max((i+1 for i, n in enumerate(series) if n), default=0)
                output.setdefault(code[:2], {})[code] = series[:end]
    destination.mkdir(exist_ok=True, parents=True)
    for province, rows in output.items():
        path = destination / (province + '.json.gz')
        path.write_bytes(gzip.compress(compact(dict(sorted(rows.items()))), compresslevel=9, mtime=0))
        print(province, len(rows), 'sectors;', path.stat().st_size, 'bytes', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    parser.add_argument('--sector-dir', type=Path, default=Path('docs/data/sectors'))
    parser.add_argument('--destination', type=Path, default=Path('docs/data/sector-ages'))
    build(**vars(parser.parse_args()))
