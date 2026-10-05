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

PRIV = MASK / "privat"   # ligger i mask-mappen så att den sparas av flödet
PRIV_ZOOMS = range(11, 14)
PRIV_M = 25          # avstånd från brygga eller hus som räknas som hemfridszon
HOUSE_HALF_M = 6     # ungefärlig halv husbredd (hus hämtas som mittpunkt)


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


def private_features():
    """Hus och bryggor nära stranden från OpenStreetMap. Hus hämtas som mittpunkter
    (litet svar), bryggor, kajer och vågbrytare med hela sin form."""
    CACHE.mkdir(exist_ok=True)
    p = CACHE / "private.json"
    if p.exists():
        return json.loads(p.read_text())
    w, s, e, n = BOUNDS
    houses, piers, seen = [], [], set()
    rows, cols = 6, 4
    print("Hämtar hus och bryggor nära stranden ...", flush=True)
    for i in range(rows):
        for j in range(cols):
            s1, n1 = s + (n - s) * i / rows, s + (n - s) * (i + 1) / rows
            w1, e1 = w + (e - w) * j / cols, w + (e - w) * (j + 1) / cols
            bb = f"({s1},{w1},{n1},{e1})"
            q = f"""[out:json][timeout:300];
way["natural"="coastline"]{bb}->.c;
(
  way(around.c:60)["building"];
  relation(around.c:60)["building"];
  node(around.c:60)["leisure"="slipway"];
)->.h;
.h out center qt;
(
  way(around.c:60)["man_made"~"^(pier|quay|breakwater|groyne)$"];
  way(around.c:60)["leisure"="marina"];
)->.p;
.p out geom qt;"""
            for el in overpass(q).get("elements", []):
                key = (el.get("type"), el.get("id"))
                if key in seen:
                    continue
                seen.add(key)
                if el.get("geometry"):
                    piers.append([[round(g["lon"], 6), round(g["lat"], 6)] for g in el["geometry"]])
                elif "center" in el:
                    houses.append([round(el["center"]["lon"], 6), round(el["center"]["lat"], 6)])
                elif "lat" in el:
                    houses.append([round(el["lon"], 6), round(el["lat"], 6)])
            print(f"  del {i * cols + j + 1}/{rows * cols}: {len(houses)} hus, {len(piers)} bryggor", flush=True)
            time.sleep(3)
    data = {"houses": houses, "piers": piers}
    p.write_text(json.dumps(data))
    return data


def render_private(feat, z):
    """Ritar zonen runt hus och bryggor. Bara rutor med innehåll sparas."""
    w, s, e, n = BOUNDS
    x0, y0 = world_px(w, n, z)
    x1, y1 = world_px(e, s, z)
    tx0, ty0, tx1, ty1 = int(x0 // 256), int(y0 // 256), int(x1 // 256), int(y1 // 256)
    ox, oy = tx0 * 256, ty0 * 256
    W, H = (tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256
    lat_mid = (s + n) / 2
    mpp = 156543.034 * math.cos(math.radians(lat_mid)) / 2 ** z
    img = Image.new("1", (W, H), 0)
    d = ImageDraw.Draw(img)
    rh = (PRIV_M + HOUSE_HALF_M) / mpp
    for lo, la in feat["houses"]:
        px, py = world_px(lo, la, z)
        px, py = px - ox, py - oy
        d.ellipse([px - rh, py - rh, px + rh, py + rh], fill=1)
    rp = PRIV_M / mpp
    for line in feat["piers"]:
        pts = [(px - ox, py - oy) for px, py in (world_px(lo, la, z) for lo, la in line)]
        if len(pts) > 1:
            d.line(pts, fill=1, width=max(1, int(round(2 * rp))))
        for px, py in pts:
            d.ellipse([px - rp, py - rp, px + rp, py + rp], fill=1)
    count = 0
    for tx in range(tx0, tx1 + 1):
        for ty in range(ty0, ty1 + 1):
            tile = img.crop(((tx - tx0) * 256, (ty - ty0) * 256, (tx - tx0 + 1) * 256, (ty - ty0 + 1) * 256))
            if not tile.getbbox():
                continue
            out = PRIV / str(z) / str(tx)
            out.mkdir(parents=True, exist_ok=True)
            tile.save(out / f"{ty}.png", optimize=True)
            count += 1
    return count


def build_private():
    try:
        feat = private_features()
    except Exception as ex:  # noqa: BLE001
        print(f"Hus och bryggor kunde inte hämtas ({ex}), hoppar över hemfridszoner den här gången")
        return
    PRIV.mkdir(parents=True, exist_ok=True)
    for z in PRIV_ZOOMS:
        print(f"  hemfridszon zoom {z}: {render_private(feat, z)} rutor", flush=True)
    (PRIV / "info.json").write_text(json.dumps({"bounds": BOUNDS, "zooms": list(PRIV_ZOOMS), "meter": PRIV_M,
                                                 "hus": len(feat["houses"]), "bryggor": len(feat["piers"])}))


def _size_km(el):
    b = el.get("bounds")
    if not b:
        return 0.0
    dy = (b["maxlat"] - b["minlat"]) * 111.0
    dx = (b["maxlon"] - b["minlon"]) * 111.0 * math.cos(math.radians(b["minlat"]))
    return max(dx, dy)


def _min_zoom(kind, typ, km):
    """Från vilken zoomnivå ett namn visas, ungefär som på ett sjökort."""
    if kind == "ort":
        return {"town": 9, "village": 11, "hamlet": 12}.get(typ, 13)
    if kind == "vatten":
        return 10 if km > 8 else 11 if km > 3 else 12 if km > 1 else 13
    return 9 if km > 15 else 10 if km > 5 else 11 if km > 2 else 12 if km > 0.7 else 13 if km > 0.25 else 14


def build_names():
    """Namn på orter, öar, fjärdar, sund och uddar till appens eget namnlager."""
    w, s, e, n = BOUNDS
    out, seen = [], set()
    rows, cols = 3, 2
    print("Hämtar ortnamn, öar och fjärdar ...", flush=True)
    for i in range(rows):
        for j in range(cols):
            s1, n1 = s + (n - s) * i / rows, s + (n - s) * (i + 1) / rows
            w1, e1 = w + (e - w) * j / cols, w + (e - w) * (j + 1) / cols
            bb = f"({s1},{w1},{n1},{e1})"
            q = f"""[out:json][timeout:300];
(
  node["place"~"^(town|village|hamlet|locality|island|islet)$"]["name"]{bb};
  way["place"~"^(island|islet)$"]["name"]{bb};
  relation["place"~"^(island|islet)$"]["name"]{bb};
  node["natural"~"^(bay|strait|cape|peninsula)$"]["name"]{bb};
  way["natural"~"^(bay|strait|peninsula)$"]["name"]{bb};
  relation["natural"~"^(bay|strait)$"]["name"]{bb};
  node["place"="sea"]["name"]{bb};
);
out tags bb qt;"""
            for el in overpass(q).get("elements", []):
                tg = el.get("tags", {})
                nm = tg.get("name")
                if not nm:
                    continue
                if "lat" in el:
                    lat, lon = el["lat"], el["lon"]
                elif "bounds" in el:
                    b = el["bounds"]
                    lat, lon = (b["minlat"] + b["maxlat"]) / 2, (b["minlon"] + b["maxlon"]) / 2
                else:
                    continue
                if not (s <= lat <= n and w <= lon <= e):
                    continue
                typ = tg.get("place") or tg.get("natural")
                kind = "ort" if typ in ("town", "village", "hamlet", "locality") else "vatten" if typ in ("bay", "strait", "sea") else "land"
                key = (nm, round(lat, 2), round(lon, 2))
                if key in seen:
                    continue
                seen.add(key)
                km = _size_km(el)
                out.append([nm, round(lat, 5), round(lon, 5), kind, _min_zoom(kind, typ, km), round(km, 2)])
            time.sleep(3)
    MASK.mkdir(parents=True, exist_ok=True)
    (MASK / "namn.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"  {len(out)} namn sparade", flush=True)


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "privat":
        build_private()
        return
    if len(sys.argv) > 1 and sys.argv[1] == "namn":
        build_names()
        return
    polys = water_polygons(coastlines())
    for z in MASK_ZOOMS:
        n = render(polys, z)
        print(f"  zoom {z}: {n} rutor", flush=True)
    (MASK / "info.json").write_text(json.dumps({"bounds": BOUNDS, "zooms": list(MASK_ZOOMS)}))
    build_private()
    try:
        build_names()
    except Exception as ex:  # noqa: BLE001
        print(f"Namn kunde inte hämtas ({ex}), försöker igen nästa körning")
    print("Klart.")


if __name__ == "__main__":
    sys.exit(main())
