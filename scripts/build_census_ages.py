"""Build anonymous parish age counts from INEC's 2022 sector-level census ZIP."""
import argparse
import json
from collections import defaultdict
from pathlib import Path
from zipfile import ZipFile

SOURCE = 'https://www.ecuadorencifras.gob.ec/documentos/web-inec/bd-censo/sector/BDD_CPV2022_SECT_CSV.zip'
GUIDE = 'https://www.ecuadorencifras.gob.ec/documentos/web-inec/bd-censo/5.GUIA_BASE_CPV_2022_v6.pdf'


def aggregate(archive):
    counts = defaultdict(lambda: [0] * 121)
    with ZipFile(archive) as files:
        member, = [name for name in files.namelist() if name.endswith('/CPV_2022_Poblacion_Sector.csv')]
        with files.open(member) as rows:
            fields = rows.readline().decode('utf-8-sig').strip().split(';')
            loc = [fields.index(k) for k in ('I01', 'I02', 'I03')]
            age_col = fields.index('P03')
            stop = max(*loc, age_col) + 1
            for row in rows:
                cells = row.split(b';', stop)
                if cells[loc[0]] not in (b'09', b'24'):
                    continue
                code = b''.join(cells[c] for c in loc).decode('ascii')
                years = int(cells[age_col])
                if len(code) != 6 or not code.isdigit() or not 0 <= years <= 120:
                    raise ValueError('Invalid census geography or age in ' + code)
                counts[code][years] += 1
    return dict(sorted(counts.items()))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    result = {'year': 2022, 'source': SOURCE, 'guide': GUIDE, 'agesByDpa': aggregate(args.archive)}
    args.output.write_text(json.dumps(result, separators=(',', ':')) + '\n', encoding='utf-8')
