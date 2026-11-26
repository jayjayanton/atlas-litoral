"""Aggregate private households by census parish and household representative age.

Usage: python scripts/build_parish_income.py CPV_2022_Sector.zip
The first four values use the age groups from build_sector_profiles.py.
The fifth counts households whose representative age is unavailable. Sector
codes ending in 888 retain their six-digit parish and are included here.
"""
import argparse
from collections import defaultdict
from pathlib import Path

from build_sector_profiles import census_counts, compact, household_totals, missing_ages


def parish_households(counts, households):
    unknown = missing_ages(counts, households)
    by_parish = defaultdict(lambda: [0] * 5)
    for sector, values in counts.items():
        row = by_parish[sector[:6]]
        for i, heads in enumerate(values[4:]):
            row[i] += heads
        row[4] += unknown.get(sector, 0)
    if sum(map(sum, by_parish.values())) != sum(households.values()):
        raise ValueError('Parish counts do not reconcile with the household file')
    return dict(sorted(by_parish.items()))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('census_zip', type=Path)
    parser.add_argument('--out', type=Path, default=Path(__file__).resolve().parents[1]
                        / 'docs/data/parish-income-households.json')
    args = parser.parse_args()
    result = parish_households(census_counts(args.census_zip), household_totals(args.census_zip))
    args.out.write_bytes(compact(result) + b'\n')
