"""Build the provincial age/earnings lookup from INEC's annual 2025 person CSV."""
import argparse
import csv
import gzip
import io
import json
from collections import defaultdict
from pathlib import Path
from zipfile import ZipFile

SOURCE = "https://www.ecuadorencifras.gob.ec/documentos/web-inec/EMPLEO/2025/anual/2_BDD_DATOS_ABIERTOS_ENEMDU_2025_CSV.zip"
OUTPUT = Path(__file__).resolve().parents[1] / "docs/data/earnings-2025.json.gz"


def build(archive):
    # Within an age/province: earnings -> [annual expansion weight, survey records].
    earnings = defaultdict(lambda: defaultdict(lambda: [0.0, 0]))
    nonworkers = defaultdict(lambda: [0.0, 0])
    for row in csv.DictReader(archive, delimiter=";"):
        province = row["prov"].zfill(2)
        age = int(row["p03"])
        if province not in ("09", "24") or not 15 <= age <= 120:
            continue
        key = province, age
        status = int(row["condact"])
        weight = float(row["fexp"].replace(",", "."))
        if weight <= 0:
            raise ValueError("Expected a positive annual expansion factor")
        if status in (7, 8, 9):  # Unemployed or economically inactive.
            bucket = nonworkers[key]
        elif 1 <= status <= 6:
            value = row["ingrl"].strip()
            if status == 5:  # Empleo no remunerado.
                amount = 0
            elif not value or value == "999999":
                continue
            else:
                amount = int(value)
                if amount < -1:
                    raise ValueError("Unexpected income code")
                # The loss code (-1) falls below all supported nonnegative thresholds.
                amount = max(amount, 0)
            bucket = earnings[key][amount]
        else:
            continue
        bucket[0] += weight
        bucket[1] += 1

    result = {"09": {}, "24": {}}
    for province, age in sorted(earnings.keys() | nonworkers.keys()):
        key = province, age
        other_weight, other_n = nonworkers[key]
        cells = [[amount, round(weight, 6), n] for amount, (weight, n) in sorted(earnings[key].items())]
        result[province][age] = [round(other_weight, 6), other_n, cells]
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("zip", help=SOURCE)
    args = parser.parse_args()
    with ZipFile(args.zip) as source:
        with source.open("BDDenemdu_personas_2025_anual.csv") as binary:
            result = build(io.TextIOWrapper(binary, encoding="utf-8-sig"))
    OUTPUT.write_bytes(gzip.compress(json.dumps(result, separators=(",", ":")).encode(), mtime=0))
