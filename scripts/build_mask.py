#!/usr/bin/env python3
"""
build_mask.py

Hämtar kustlinjen från OpenStreetMap och ritar en land/vatten-mask som
kartbilder (mask/{z}/{x}/{y}.png). Appen använder masken för att räkna ut
lä och för att bara färga vatten. Körs en gång, eller när området ändras.

Kräver: pip install shapely pillow
"""
import json
import math
import sys
import time
import urllib.parse
import urllib.request

from PIL import Image, ImageDraw
from shapely.geometry import LineString, box
from shapely.ops import polygonize, unary_union
from shapely.strtree import STRtree

from common import BOUNDS, CACHE, MASK, MASK_ZOOMS


SERVERS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]


def overpass(query):
    """Provar flera Overpass-servrar och försöker igen om de är överbelastade."""
    last = None
    for attempt in range(4):
        for url in SERVERS:
            try:
                req = urllib.request.Request(
                    url,
                    data=urllib.parse.urlencode({"data": query}).encode(),
                    headers={"User-Agent": "skargardskartan/1.0"},
                )
                with urllib.request.urlopen(req, timeout=300) as r:
                    return json.loads(r.read().decode("utf-8"))
            except Exception as ex:  # noqa: BLE001
                last = ex
                print(f"    {url.split('/')[2]}: {ex}", flush=True)
        time.sleep(30 * (attempt + 1))
    raise RuntimeError(f"Ingen Overpass-server svarade: {last}")


def coastlines():
    CACHE.mkdir(exist_ok=True)
    p = CACHE / "coast.json"
    if p.exists():
        data = json.loads(p.read_text())
    else:
        w, s, e, n = BOUNDS
        print("Hämtar kustlinje från OpenStreetMap i delar ...", flush=True)
        els, seen = [], set()
        rows, cols = 3, 2   # mindre frågor klarar överbelastade servrar bättre
        for i in range(rows):
            for j in range(cols):
                s1, n1 = s + (n - s) * i / rows, s + (n - s) * (i + 1) / rows
                w1, e1 = w + (e - w) * j / cols, w + (e - w) * (j + 1) / cols
                part = overpass(f'[out:json][timeout:300];way["natural"="coastline"]({s1},{w1},{n1},{e1});out geom;')
                for el in part.get("elements", []):
                    if el.get("id") not in seen:
                        seen.add(el.get("id"))
                        els.append(el)
                print(f"  del {i * cols + j + 1}/{rows * cols}: {len(els)} kustlinjer hittills", flush=True)
                time.sleep(5)
        data = {"elements": els}
        p.write_text(json.dumps(data))
    lines = [
        LineString([(q["lon"], q["lat"]) for q in el["geometry"]])
        for el in data.get("elements", [])
        if el.get("geometry") and len(el["geometry"]) > 1
    ]
    print(f"  {len(lines)} kustlinjer")
    return lines


def water_polygons(lines):
    """I OpenStreetMap ligger land till vänster om kustlinjen."""
    bb = box(*BOUNDS)
    if not lines:
        return [bb]
    noded = unary_union(lines + [bb.boundary])
    tree = STRtree(lines)
    water = []
    for face in polygonize(noded):
        pt = face.representative_point()
        if not bb.contains(pt):
            continue
        hit = tree.nearest(pt)
        near = hit if hasattr(hit, "coords") else lines[int(hit)]
        d = near.project(pt)
        a = near.interpolate(max(d - 1e-6, 0))
        b = near.interpolate(min(d + 1e-6, near.length))
        if (b.x - a.x) * (pt.y - a.y) - (b.y - a.y) * (pt.x - a.x) < 0:
            water.append(face)
    g = unary_union(water)
    return [g] if g.geom_type == "Polygon" else list(g.geoms)


def world_px(lon, lat, z):
    n = 256 * 2 ** z
    x = (lon + 180) / 360 * n
    s = math.sin(math.radians(lat))
    y = (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * n
    return x, y


def render(polys, z):
    w, s, e, n = BOUNDS
    x0, y0 = world_px(w, n, z)
    x1, y1 = world_px(e, s, z)
    tx0, ty0, tx1, ty1 = int(x0 // 256), int(y0 // 256), int(x1 // 256), int(y1 // 256)
    ox, oy = tx0 * 256, ty0 * 256
    W, H = (tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256
    img = Image.new("1", (W, H), 1)  # 1 = vatten (utanför området räknas som öppet vatten)
    d = ImageDraw.Draw(img)
    # allt inom området är land tills vattenytorna ritas in
    d.rectangle([x0 - ox, y0 - oy, x1 - ox, y1 - oy], fill=0)
    for pg in polys:
        ext = [(px - ox, py - oy) for px, py in (world_px(lo, la, z) for lo, la in pg.exterior.coords)]
        d.polygon(ext, fill=1)
        for ring in pg.interiors:
            d.polygon([(px - ox, py - oy) for px, py in (world_px(lo, la, z) for lo, la in ring.coords)], fill=0)
    count = 0
    for tx in range(tx0, tx1 + 1):
        for ty in range(ty0, ty1 + 1):
            tile = img.crop(((tx - tx0) * 256, (ty - ty0) * 256, (tx - tx0 + 1) * 256, (ty - ty0 + 1) * 256))
            out = MASK / str(z) / str(tx)
            out.mkdir(parents=True, exist_ok=True)
            tile.save(out / f"{ty}.png", optimize=True)
            count += 1
    return count


def main():
    polys = water_polygons(coastlines())
    for z in MASK_ZOOMS:
        n = render(polys, z)
        print(f"  zoom {z}: {n} rutor", flush=True)
    (MASK / "info.json").write_text(json.dumps({"bounds": BOUNDS, "zooms": list(MASK_ZOOMS)}))
    print("Klart.")


if __name__ == "__main__":
    sys.exit(main())
