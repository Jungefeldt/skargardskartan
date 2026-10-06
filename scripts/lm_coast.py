#!/usr/bin/env python3
"""
lm_coast.py

Skarpare kustlinje ur Lantmäteriets laserskannade höjdmodell (Markhöjdmodell, 1 m rutnät,
öppna data). Havsytan ligger nära noll meter, så allt som ligger högre än LAND_M räknas som
land. Resultatet skrivs in i kustmasken (mask/{z}/{x}/{y}.png) för zoom 12 till 15.

Sjöar ligger ovanför havet och skulle annars bli land, så de tas från OpenStreetMap-masken:
vatten i masken som inte hänger ihop med havet behålls som vatten. Där höjddata saknas
behålls masken som den är.

Inloggning: miljövariablerna LM_USERNAME och LM_PASSWORD (samma som på Geotorget).
Höjdrutorna hämtas via Lantmäteriets STAC-tjänst; sökningen är öppen, nedladdningen kräver
inloggning. Körs en gång; mask/info.json får fältet "lm" när det är klart, och om masken
byggs om från OpenStreetMap görs det om automatiskt.
"""
import base64
import json
import math
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

import numpy as np

from common import BOUNDS, CACHE, FULL_BOUNDS, MASK

STAC = "https://api.lantmateriet.se/stac-hojd/v1"
LAND_M = 0.5            # höjd över havet (RH 2000) som räknas som land
ZOOMS = [15, 14, 13, 12]
VERSION = 1             # höjs om metoden ändras, så att allt görs om


def log(*a):
    print(*a, flush=True)


def need_rasterio():
    try:
        import rasterio  # noqa: F401
    except ImportError:
        log("Installerar rasterio ...")
        subprocess.run([sys.executable, "-m", "pip", "install", "-q", "rasterio", "scipy"], check=True)


def auth_header():
    u, p = os.environ.get("LM_USERNAME", ""), os.environ.get("LM_PASSWORD", "")
    if not u or not p:
        return None
    return "Basic " + base64.b64encode(f"{u}:{p}".encode()).decode()


def get(url, auth=None, timeout=120):
    req = urllib.request.Request(url, headers={"User-Agent": "skargardskartan/1.0", "Accept": "*/*"})
    if auth:
        req.add_header("Authorization", auth)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


# ------------------------------------------------------------------ hitta och hämta höjdrutor

def find_tiles():
    """Alla höjdrutor (2,5 x 2,5 km, mhm-*) som täcker området, som (id, nedladdningslänk)."""
    w, s, e, n = BOUNDS
    url = f"{STAC}/search?" + urllib.parse.urlencode({"bbox": f"{w},{s},{e},{n}", "limit": 200})
    out, seen = [], set()
    for _ in range(50):
        page = json.loads(get(url))
        for it in page.get("features", []):
            if not str(it.get("collection", "")).startswith("mhm") or it["id"] in seen:
                continue
            hrefs = [a["href"] for a in it.get("assets", {}).values()
                     if str(a.get("href", "")).lower().split("?")[0].endswith((".tif", ".tiff"))]
            if hrefs:
                seen.add(it["id"])
                out.append((it["id"], hrefs[0]))
        nxt = [l["href"] for l in page.get("links", []) if l.get("rel") == "next"]
        if not nxt:
            break
        url = nxt[0]
    return out


def download(tiles, auth, t_end):
    d = CACHE / "lm_hojd"
    d.mkdir(parents=True, exist_ok=True)
    paths = []
    for i, (tid, href) in enumerate(tiles):
        p = d / f"{tid}.tif"
        if not p.exists():
            if time.time() > t_end:
                log("  tiden slut, fortsätter nästa körning")
                return None
            for attempt in range(3):
                try:
                    p.write_bytes(get(href, auth, timeout=300))
                    break
                except urllib.error.HTTPError as ex:
                    if ex.code in (401, 403):
                        raise RuntimeError(f"Lantmäteriet nekade nedladdningen ({ex.code}). Kontrollera att "
                                           "Markhöjdmodell Nedladdning är beställd och godkänd på Geotorget, "
                                           "och att LM_USERNAME och LM_PASSWORD stämmer.")
                    if attempt == 2:
                        raise
                    time.sleep(5)
        paths.append(p)
        if (i + 1) % 10 == 0:
            log(f"  {i + 1} av {len(tiles)} höjdrutor hämtade")
    return paths


# ------------------------------------------------------------------ rutnät i kartprojektionen

R = 20037508.342789244


def world_px(lon, lat, z):
    n = 256 * 2 ** z
    s = math.sin(math.radians(lat))
    return (lon + 180) / 360 * n, (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * n


def tile_range(z):
    w, s, e, n = BOUNDS
    x0, y0 = world_px(w, n, z)
    x1, y1 = world_px(e, s, z)
    return int(x0 // 256), int(y0 // 256), int(x1 // 256), int(y1 // 256)


def land_fraction(paths, z):
    """Andel land per pixel i zoom z (NaN där höjddata saknas), i samma rutor som masken."""
    import rasterio
    from rasterio.transform import Affine
    from rasterio.warp import Resampling, reproject, transform_bounds
    tx0, ty0, tx1, ty1 = tile_range(z)
    W, H = (tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256
    res = 2 * R / (256 * 2 ** z)
    X0, Y0 = tx0 * 256 * res - R, R - ty0 * 256 * res
    frac = np.full((H, W), np.nan, dtype=np.float32)
    # bara inom området; utanför räknas fortfarande som öppet vatten, som i resten av masken
    w, s, e, n = BOUNDS
    ax0, ay0 = world_px(w, n, z)
    ax1, ay1 = world_px(e, s, z)
    inside = np.zeros((H, W), dtype=bool)
    inside[max(0, int(ay0) - ty0 * 256):int(math.ceil(ay1)) - ty0 * 256, max(0, int(ax0) - tx0 * 256):int(math.ceil(ax1)) - tx0 * 256] = True
    for p in paths:
        with rasterio.open(p) as src:
            h = src.read(1).astype(np.float32)
            nod = src.nodata
            bad = ~np.isfinite(h) | ((h == nod) if nod is not None else False) | (h < -50)
            land = np.where(bad, np.nan, (h > LAND_M).astype(np.float32))
            b = transform_bounds(src.crs, "EPSG:3857", *src.bounds)
            c0 = max(0, int((b[0] - X0) / res) - 2)
            c1 = min(W, int(math.ceil((b[2] - X0) / res)) + 2)
            r0 = max(0, int((Y0 - b[3]) / res) - 2)
            r1 = min(H, int(math.ceil((Y0 - b[1]) / res)) + 2)
            if c1 <= c0 or r1 <= r0:
                continue
            dst = np.full((r1 - r0, c1 - c0), np.nan, dtype=np.float32)
            reproject(land, dst, src_transform=src.transform, src_crs=src.crs, src_nodata=np.nan,
                      dst_transform=Affine(res, 0, X0 + c0 * res, 0, -res, Y0 - r0 * res),
                      dst_crs="EPSG:3857", dst_nodata=np.nan, resampling=Resampling.average)
            win = frac[r0:r1, c0:c1]
            ok = np.isfinite(dst)
            win[ok] = np.where(np.isfinite(win[ok]), np.maximum(win[ok], dst[ok]), dst[ok])
    frac[~inside] = np.nan
    return frac, (tx0, ty0, tx1, ty1)


def read_mask(z, rng):
    from PIL import Image
    tx0, ty0, tx1, ty1 = rng
    W, H = (tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256
    water = np.ones((H, W), dtype=bool)
    for tx in range(tx0, tx1 + 1):
        for ty in range(ty0, ty1 + 1):
            p = MASK / str(z) / str(tx) / f"{ty}.png"
            if p.exists():
                water[(ty - ty0) * 256:(ty - ty0 + 1) * 256, (tx - tx0) * 256:(tx - tx0 + 1) * 256] = \
                    np.array(Image.open(p).convert("L")) > 127
    return water


def write_mask(z, rng, water):
    from PIL import Image
    tx0, ty0, tx1, ty1 = rng
    for tx in range(tx0, tx1 + 1):
        for ty in range(ty0, ty1 + 1):
            a = water[(ty - ty0) * 256:(ty - ty0 + 1) * 256, (tx - tx0) * 256:(tx - tx0 + 1) * 256]
            out = MASK / str(z) / str(tx)
            out.mkdir(parents=True, exist_ok=True)
            Image.fromarray((a * 255).astype(np.uint8)).convert("1").save(out / f"{ty}.png", optimize=True)


def combine(frac, osm_water):
    """Ny vattenyta: höjddatan där den finns, sjöar och okänt från OpenStreetMap."""
    from scipy import ndimage
    H, W = osm_water.shape
    lab, n = ndimage.label(osm_water)
    edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    sea = np.isin(lab, edge[edge > 0])
    lakes = osm_water & ~sea                             # vatten som inte hänger ihop med havet
    known = np.isfinite(frac)
    water = np.where(known, (np.nan_to_num(frac, nan=1) < 0.5) | lakes, osm_water)
    # låga gropar på land som inte når havet eller en sjö blir land igen
    lab2, _ = ndimage.label(water)
    keep = np.unique(np.concatenate([lab2[0], lab2[-1], lab2[:, 0], lab2[:, -1], lab2[osm_water]]))
    return np.isin(lab2, keep[keep > 0])


def build(budget_s=15 * 60):
    t_end = time.time() + budget_s
    if BOUNDS == FULL_BOUNDS:
        log("Lantmäteriets kustlinje: görs bara i testområdet än så länge, hoppar över")
        return
    info_p = MASK / "info.json"
    if not info_p.exists():
        log("Lantmäteriets kustlinje: masken saknas, väntar till nästa körning")
        return
    info = json.loads(info_p.read_text())
    if info.get("lm") == VERSION and info.get("bounds") == BOUNDS:
        return
    auth = auth_header()
    if not auth:
        log("Lantmäteriets kustlinje: LM_USERNAME och LM_PASSWORD saknas, hoppar över")
        return
    need_rasterio()
    log("Lantmäteriets kustlinje: söker höjdrutor ...")
    tiles = find_tiles()
    log(f"  {len(tiles)} höjdrutor täcker området")
    if not tiles:
        return
    paths = download(tiles, auth, t_end)
    if paths is None:
        return
    for z in ZOOMS:
        frac, rng = land_fraction(paths, z)
        osm = read_mask(z, rng)
        water = combine(frac, osm)
        changed = int((water != osm).sum())
        write_mask(z, rng, water)
        log(f"  zoom {z}: {changed} pixlar ändrade mot OpenStreetMap ({100 * np.isfinite(frac).mean():.0f} % täckt av höjddata)")
    info["lm"] = VERSION
    info_p.write_text(json.dumps(info))
    log("Lantmäteriets kustlinje: klar")


if __name__ == "__main__":
    build(float(sys.argv[1]) * 60 if len(sys.argv) > 1 else 15 * 60)
