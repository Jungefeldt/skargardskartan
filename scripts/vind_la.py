#!/usr/bin/env python3
"""
vind_la.py

Hur mycket vinden dämpas i lä bakom öar, uddar och skog. Bygger på hur vinden återhämtar
sig bakom vindskydd (läbälten och skogsridåer): dämpningen är störst några hinderhöjder bakom
hindret och vinden är nästan tillbaka efter 20 till 30 hinderhöjder.

För varje punkt och vindriktning letas hindren i lovart upp (inom MAX_D meter). Ett hinder med
höjden h på avståndet d ger dämpningen shelter(d / h); det hinder som skyddar mest avgör.
Hindrets höjd är markhöjden från Lantmäteriets höjdmodell (data/terrang.json) plus trädhöjden
från Skogsstyrelsens laserskanning (data/trad.png, från trad.py). Saknas den räknas TREE_H meter
där OpenStreetMap har skog. Varje riktning räknas som ett medel över tre riktningar
(±SPREAD grader), eftersom vinden aldrig är helt jämn i riktning.

Resultat: data/vind/index.json och en bild per riktning, data/vind/d{riktning}.png, där
varje pixel är vindfaktorn gånger SCALE (1,0 = ingen dämpning). Appen multiplicerar
prognosens vind med faktorn. Uppskruvad vind runt uddar och i sund ingår inte.
"""
import base64
import json
import math
import sys
import time

import numpy as np

from common import BOUNDS, DATA

OUT = DATA / "vind"
VERSION = 2
DIRS = [round(i * 22.5, 1) for i in range(16)]
TREE_H = 15.0       # antagen trädhöjd där det är skog (m)
MAX_D = 2000.0      # längsta avstånd till ett hinder som räknas (m)
STEP = 20.0         # steg längs vindriktningen (m)
SPREAD = (-10.0, 0.0, 10.0)
MIN_H = 1.0         # lägre än så räknas inte som hinder (m)
SCALE = 200         # faktorn sparas som heltal: faktor * SCALE


def log(*a):
    print(*a, flush=True)


def shelter(s):
    """Vindfaktor på avståndet s hinderhöjder bakom ett hinder: 0,45 närmast hindret,
    0,8 vid 10 höjder, 0,95 vid 20 höjder och nästan 1 vid 30 höjder."""
    return np.where(s < 3, 0.45, 1 - 0.55 * np.exp(-(s - 3) / 7))


def forest_grid(T):
    """Skog från OpenStreetMap (natural=wood, landuse=forest) i höjdmodellens rutnät."""
    from PIL import Image, ImageDraw
    import build_mask
    w, s, e, n = BOUNDS
    q = (f'[out:json][timeout:180];(way["natural"="wood"]({s},{w},{n},{e});way["landuse"="forest"]({s},{w},{n},{e});'
         f'relation["natural"="wood"]({s},{w},{n},{e});relation["landuse"="forest"]({s},{w},{n},{e}););out geom;')
    js = build_mask.overpass(q, timeout=240)
    img = Image.new("L", (T["nx"], T["ny"]), 0)
    d = ImageDraw.Draw(img)

    def xy(g):
        return [((p["lon"] - T["lon0"]) / T["dlon"], (T["lat0"] - p["lat"]) / T["dlat"]) for p in g]
    outer, inner = [], []
    for el in js.get("elements", []):
        if el["type"] == "way" and el.get("geometry") and len(el["geometry"]) >= 3:
            outer.append(xy(el["geometry"]))
        elif el["type"] == "relation":
            for m in el.get("members", []):
                if m.get("type") == "way" and m.get("geometry") and len(m["geometry"]) >= 3:
                    (inner if m.get("role") == "inner" else outer).append(xy(m["geometry"]))
    for pg in outer:
        d.polygon(pg, fill=1)
    for pg in inner:
        d.polygon(pg, fill=0)
    log(f"  skog: {len(outer)} ytor från OpenStreetMap")
    return np.array(img) > 0


def shift(a, dy, dx):
    """b[r, c] = a[r + dy, c + dx], noll utanför."""
    b = np.zeros_like(a)
    H, W = a.shape
    ys, yd = (slice(dy, H), slice(0, H - dy)) if dy >= 0 else (slice(0, H + dy), slice(-dy, H))
    xs, xd = (slice(dx, W), slice(0, W - dx)) if dx >= 0 else (slice(0, W + dx), slice(-dx, W))
    b[yd, xd] = a[ys, xs]
    return b


def factor(Hgt, wd, dxm, dym):
    acc = np.zeros_like(Hgt)
    for off in SPREAD:
        th = math.radians(wd + off)
        F = np.ones_like(Hgt)
        seen = set()
        for k in range(1, int(MAX_D / STEP) + 1):
            dist = k * STEP
            dx = int(round(dist * math.sin(th) / dxm))     # lovart: åt det håll vinden kommer ifrån
            dy = int(round(-dist * math.cos(th) / dym))    # raderna går från norr till söder
            if (dx, dy) in seen:
                continue
            seen.add((dx, dy))
            Hs = shift(Hgt, dy, dx)
            f = np.where(Hs > MIN_H, shelter(dist / np.maximum(Hs, 1e-3)), 1.0)
            np.minimum(F, f, out=F)
        acc += F
    return acc / len(SPREAD)


def tree_grid(T):
    """Trädhöjd i meter från Skogsstyrelsen i höjdmodellens rutnät, eller None om den saknas."""
    from PIL import Image
    try:
        meta = json.loads((DATA / "trad.json").read_text())
        if (meta["nx"], meta["ny"], meta["lat0"], meta["lon0"]) != (T["nx"], T["ny"], T["lat0"], T["lon0"]):
            return None
        return np.array(Image.open(DATA / "trad.png")).astype(np.float32) / meta.get("per_m", 4)
    except Exception:  # noqa: BLE001
        return None


def build(budget_s=10 * 60):
    from PIL import Image
    t_end = time.time() + budget_s
    tp = DATA / "terrang.json"
    if not tp.exists():
        log("Lä för vinden: höjdmodellen saknas ännu (kommer från Lantmäteriet), väntar")
        return
    T = json.loads(tp.read_text())
    trees = tree_grid(T)
    tsrc = "Skogsstyrelsen" if trees is not None else "OpenStreetMap"
    done = []
    try:
        idx = json.loads((OUT / "index.json").read_text())
        if idx.get("version") == VERSION and idx.get("bounds") == BOUNDS and idx.get("terrain") == T.get("source") \
                and idx.get("trees") == tsrc:
            if len(idx.get("done", [])) == len(DIRS):
                return
            done = list(idx.get("done", []))           # fortsätt där förra körningen slutade
    except Exception:  # noqa: BLE001
        pass
    log(f"Lä för vinden: räknar med skog från {tsrc}, {len(done)} riktningar klara sedan tidigare ...")
    h = np.frombuffer(base64.b64decode(T["h"]), dtype=np.uint8).reshape(T["ny"], T["nx"]).astype(np.float32)
    land = h > 0.5
    if trees is not None:
        Hgt = np.where(land, h + trees, h).astype(np.float32)
    else:
        forest = forest_grid(T)
        Hgt = np.where(land & forest, h + TREE_H, h).astype(np.float32)
    lat_mid = T["lat0"] - T["ny"] * T["dlat"] / 2
    dxm = T["dlon"] * 111320 * math.cos(math.radians(lat_mid))
    dym = T["dlat"] * 111320
    OUT.mkdir(parents=True, exist_ok=True)
    for wd in DIRS:
        if f"d{int(round(wd * 10)):04d}" in done:
            continue
        if time.time() > t_end:
            log("  tiden slut, fortsätter nästa körning")
            break
        F = factor(Hgt, wd, dxm, dym)
        name = f"d{int(round(wd * 10)):04d}"
        Image.fromarray(np.clip(np.round(F * SCALE), 0, 255).astype(np.uint8), "L").save(OUT / f"{name}.png", optimize=True)
        done.append(name)
        log(f"  {name}: medelfaktor på vattnet {F[~land].mean():.2f}, lägst {F[~land].min():.2f}")
    idx = {"version": VERSION, "bounds": BOUNDS, "terrain": T.get("source"), "lon0": T["lon0"], "lat0": T["lat0"],
           "dlon": T["dlon"], "dlat": T["dlat"], "nx": T["nx"], "ny": T["ny"], "dirs": DIRS, "scale": SCALE,
           "done": done, "trees": tsrc, "tree_h": TREE_H,
           "model": "lä bakom hinder: faktor 0,45 inom 3 hinderhöjder, sedan 1 - 0,55 exp(-(s-3)/7)"}
    (OUT / "index.json").write_text(json.dumps(idx, separators=(",", ":")))
    log(f"Lä för vinden: {len(done)} av {len(DIRS)} riktningar klara")


if __name__ == "__main__":
    build(float(sys.argv[1]) * 60 if len(sys.argv) > 1 else 10 * 60)
