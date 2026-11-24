"""Build the Yiliang sample locally from four Mapzen Terrarium PNG tiles.

Requires Pillow. For x=3221..3222 and y=1754..1755 download the public PNG
from SOURCE_URL to yiliang-12-{x}-{y}.png in one directory; pass that
directory as the only command-line argument. The generated grid is sampled at
geographic nodes inclusive of its bounds, west to east, north to south.
"""

import argparse
import hashlib
import json
import math
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
RUN_ID = "9223370282794817000"
BOUNDS = (103.121, 24.886, 103.185, 24.943)
ZOOM = 12
NODES = 97
SOURCE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"


def build(tile_dir):
    tiles = {}
    provenance = []
    for x in (3221, 3222):
        for y in (1754, 1755):
            path = tile_dir / f"yiliang-{ZOOM}-{x}-{y}.png"
            with Image.open(path) as image:
                if image.format != "PNG" or image.size != (256, 256):
                    raise ValueError(f"Expected a 256 px Terrarium PNG at {path}")
                if image.mode == "RGBA" and image.getchannel("A").getextrema()[0] != 255:
                    raise ValueError(f"Unexpected transparent elevations in {path}")
                tiles[x, y] = image.convert("RGB")
            provenance.append({
                "xyz": [ZOOM, x, y],
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            })

    def pixel_height(x, y):
        tile_x, local_x = divmod(x, 256)
        tile_y, local_y = divmod(y, 256)
        red, green, blue = tiles[tile_x, tile_y].getpixel((local_x, local_y))
        return red * 256 + green + blue / 256 - 32768

    def sample(lon, lat):
        # Web Mercator pixels have their centres at half-integer offsets.
        world = 256 * 2**ZOOM
        x = (lon + 180) / 360 * world - 0.5
        y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * world - 0.5
        left, top = math.floor(x), math.floor(y)
        fx, fy = x - left, y - top
        upper = (1 - fx) * pixel_height(left, top) + fx * pixel_height(left + 1, top)
        lower = (1 - fx) * pixel_height(left, top + 1) + fx * pixel_height(left + 1, top + 1)
        return round(upper * (1 - fy) + lower * fy)

    west, south, east, north = BOUNDS
    profile = json.loads((ROOT / f"public/route-elevation/{RUN_ID}.json").read_text())
    if not all(west < p[2] < east and south < p[1] < north for p in profile["samples"]):
        raise ValueError("Published run profile exceeds the sample boundary")
    elevations = [
        sample(west + (east - west) * col / (NODES - 1), north - (north - south) * row / (NODES - 1))
        for row in range(NODES)
        for col in range(NODES)
    ]
    if not 0 < min(elevations) < max(elevations) < 6000:
        raise ValueError("Unexpected height range for Yiliang")
    return {
        "runId": RUN_ID,
        "bounds": BOUNDS,
        "cols": NODES,
        "rows": NODES,
        "elevations": elevations,
        "source": {
            "name": "Mapzen Terrain Tiles",
            "url": "https://registry.opendata.aws/terrain-tiles/",
            "tileTemplate": SOURCE_URL,
            "encoding": "Terrarium",
            "unit": "m",
            "attribution": "Mapzen; global SRTM and GMTED2010 terrain data courtesy of the U.S. Geological Survey.",
            "attributionUrl": "https://github.com/tilezen/joerd/blob/master/docs/attribution.md",
            "tiles": provenance,
        },
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("tile_dir", type=Path)
    grid = build(parser.parse_args().tile_dir)
    output = ROOT / "public/terrain-sample/terrain.json"
    output.parent.mkdir(exist_ok=True)
    output.write_bytes(json.dumps(grid, separators=(",", ":")).encode() + b"\n")
    print(f"{output.name}: {grid['cols']}×{grid['rows']}, {min(grid['elevations'])}–{max(grid['elevations'])} m")
