"""Build nearest-amenity distances for the Atlas Litoral 500 m suitability grid.

Run from any directory with NumPy and SciPy installed:
    python scripts/build_amenity_distances.py --verify
"""
import argparse
import gzip
import json
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

from build_density import RADIUS_KM, read, sphere_xyz

INFRA = Path(__file__).resolve().parents[1] / "docs" / "data" / "infra"
CRITERIA = ("shopping", "city", "tourism")


def coordinates(rows, name):
    points = np.asarray(rows, dtype=float)
    if (points.ndim != 2 or points.shape[1] != 2 or not np.isfinite(points).all()
            or np.any(np.abs(points[:, 0]) > 180) or np.any(np.abs(points[:, 1]) > 90)):
        raise ValueError(f"Missing or invalid coordinates in {name}.")
    return points


def nearest_metres(centres, facilities, verify):
    # On the unit sphere the shortest chord identifies the shortest great-circle arc.
    chord, _ = cKDTree(sphere_xyz(facilities)).query(sphere_xyz(centres))
    distances = 2 * RADIUS_KM * np.arcsin(np.clip(chord / 2, 0, 1))
    if verify:
        # Independent direct comparison with every feature in each inventory, in bounded batches.
        lon, lat = np.radians(facilities).T
        for start in range(0, len(centres), 256):
            target_lon, target_lat = np.radians(centres[start:start + 256]).T[:, :, None]
            h = (np.sin((target_lat - lat) / 2) ** 2
                 + np.cos(target_lat) * np.cos(lat) * np.sin((target_lon - lon) / 2) ** 2)
            km = 2 * RADIUS_KM * np.arcsin(np.sqrt(np.clip(h.min(axis=1), 0, 1)))
            if not np.allclose(km, distances[start:start + len(km)], rtol=0, atol=1e-8):
                raise ValueError("Nearest-distance verification failed.")
    return np.rint(distances * 1000).astype(int)


def build(directory, verify):
    grid = read(directory / "grid.json")
    lon = grid["columns"].index("lon")
    lat = grid["columns"].index("lat")
    centres = coordinates([(row[lon], row[lat]) for row in grid["cells"]], "grid")
    if len(set(map(tuple, centres))) != len(centres):
        raise ValueError("Repeated grid coordinates.")

    sites = {key: [] for key in CRITERIA}
    for kind, _name, _code, y, x in read(directory / "site-amenities.json"):
        if kind not in ("shopping", "city"):
            raise ValueError(f"Unknown site-amenity category {kind}.")
        sites[kind].append((x, y))
    sites["tourism"] = [(f["lon"], f["lat"]) for f in read(directory / "attractions.json")]
    columns = [nearest_metres(centres, coordinates(sites[key], key), verify) for key in CRITERIA]
    microdegrees = np.rint(centres * 1_000_000).astype(int)
    if not np.array_equal(microdegrees / 1_000_000, centres):
        raise ValueError("Grid coordinates exceed the microdegree precision of this format.")
    # The first row is absolute. Later rows store differences from the previous row.
    # Nearby centres have similar coordinates and distances, making the gzip asset smaller.
    deltas = np.column_stack([microdegrees, *columns])
    deltas[1:] = np.diff(deltas, axis=0)
    result = {"columns": ["lon_e6", "lat_e6", *(key + "_m" for key in CRITERIA)],
              "deltaRows": deltas.tolist()}
    payload = (json.dumps(result, separators=(",", ":"), allow_nan=False) + "\n").encode()
    return gzip.compress(payload, mtime=0)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=INFRA, help="Directory with the three input datasets")
    parser.add_argument("--output", type=Path, default=INFRA / "amenity-distances.json.gz")
    parser.add_argument("--verify", action="store_true", help="Check every nearest distance by brute force")
    args = parser.parse_args()
    content = build(args.input, args.verify)
    args.output.write_bytes(content)
    print(f"{args.output.name}: {len(content):,} bytes")
