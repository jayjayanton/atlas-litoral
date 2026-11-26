"""Aggregate ENIGHUR 2024–2025 household expansion weights in USD 100 intervals.

Run with ENIGHUR25_HOGARES_AGREGADOS.csv and ENIGHUR_F1_PERSONAS.csv.
Bin i contains incomes in [100*i, 100*(i+1)); trailing empty bins are omitted.
"""

import argparse
import math
from collections import defaultdict
from pathlib import Path

from build_sector_profiles import AGES, compact, survey_samples

STEP = 100


def weighted_bins(group):
    by_bin = defaultdict(list)
    for income, weight in group:
        if not math.isfinite(income) or not math.isfinite(weight):
            raise ValueError('Survey income and weight must be finite')
        by_bin[int(income) // STEP].append(weight)
    if not by_bin:
        raise ValueError('No surveyed households in a province and age group')
    return dict(n=len(group), weights=[math.fsum(by_bin.get(i, ())) for i in range(max(by_bin) + 1)])


def income_ranges(households, people):
    samples = survey_samples(households, people)
    provinces = {p: [weighted_bins(group) for group in groups] for p, groups in samples.items()}
    return dict(source='INEC ENIGHUR 2024–2025', variable='ing_mon_cor', weight='Fexp',
                stepUSD=STEP, ageCuts=AGES, provinces=provinces)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('households_csv', type=Path)
    parser.add_argument('persons_csv', type=Path)
    parser.add_argument('--out', type=Path, default=Path(__file__).resolve().parents[1]
                        / 'docs/data/parish-income-ranges.json')
    args = parser.parse_args()
    args.out.write_bytes(compact(income_ranges(args.households_csv, args.persons_csv)) + b'\n')
