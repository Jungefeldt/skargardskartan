#!/usr/bin/env python3
"""
lm_coast.py

Skarpare kustlinje ur Lantmäteriets laserskannade höjdmodell (Markhöjdmodell, 1 m rutnät,
öppna data). Havsytan ligger nära noll meter, så allt som ligger högre än LAND_M räknas som
land. Resultatet skrivs in i kustmasken (mask/{z}/{x}/{y}.png) för zoom 12 till 15.

Sjöar ligger ovanför havet och skulle annars bli land, så de tas från OpenStreetMap-masken:
vatten i masken som inte hänger ihop med havet behålls som vatten. Där höjddata saknas
behålls masken som den är.

Samtidigt sparas en höjdmodell för hela området (data/terrang.json, ca 20 m mellan punkterna),
som lämodellen för vinden (vind_la.py) använder.

Inloggning: miljövariablerna LM_USERNAME och LM_PASSWORD (samma som på Geotorget).
Höjdrutorna hämtas via Lantmäteriets STAC-tjänst; sökningen är öppen, nedladdningen kräver
inloggning. Lantmäteriet byter från rutor på 2,5 x 2,5 km till filer på 10 x 10 km (COG); de
små laddas ner, de stora läses direkt över nätet och bara den del som behövs.
Körs en gång; mask/info.json får fältet "lm" när det är klart, och om masken
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
VERSION = 2             # höjs om metoden ändras, så att allt görs om
T_DLAT, T_DLON = 0.00018, 0.00036   # höjdmodellen för vinden: ca 20 x 20 m
BLOCK = 2500            # läser höjddatan i bitar om 2500 x 2500 m


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
    """Höjdfilerna som täcker området, som (id, nedladdningslänk, stor). De små rutorna
    (2,5 x 2,5 km, samling mhm-*) används om de finns, annars de nya stora filerna."""
    w, s, e, n = BOUNDS
    url = f"{STAC}/search?" + urllib.parse.urlencode({"bbox": f"{w},{s},{e},{n}", "limit": 200})
    small, big, seen = [], [], set()
    for _ in range(80):
        page = json.loads(get(url))
        for it in page.get("features", []):
            if it["id"] in seen:
                continue
            hrefs = [a["href"] for a in it.get("assets", {}).values()
                     if str(a.get("href", "")).lower().split("?")[0].endswith((".tif", ".tiff"))]
            if not hrefs:
                continue
            seen.add(it["id"])
            (small if str(it.get("collection", "")).startswith("mhm") else big).append((it["id"], hrefs[0]))
        nxt = [l["href"] for l in page.get("links", []) if l.get("rel") == "next"]
        if not nxt:
            break
        url = nxt[0]
    if small:
        return [(i, h, False) for i, h in small]
    return [(i, h, True) for i, h in big]


def download(tiles, auth, t_end):
    """Laddar ner de små filerna; de stora läses direkt över nätet (/vsicurl/)."""
    d = CACHE / "lm_hojd"
    d.mkdir(parents=True, exist_ok=True)
    paths = []
    for i, (tid, href, big) in enumerate(tiles):
        if big:
            paths.append("/vsicurl/" + href)
            continue
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
        paths.append(str(p))
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


def zoom_grid(z):
    tx0, ty0, tx1, ty1 = tile_range(z)
    W, H = (tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256
    res = 2 * R / (256 * 2 ** z)
    return {"z": z, "rng": (tx0, ty0, tx1, ty1), "W": W, "H": H, "res": res,
            "X0": tx0 * 256 * res - R, "Y0": R - ty0 * 256 * res,
            "frac": np.full((H, W), np.nan, dtype=np.float32)}


def terrain_grid():
    w, s, e, n = BOUNDS
    nx, ny = int(round((e - w) / T_DLON)), int(round((n - s) / T_DLAT))
    return {"lon0": w, "lat0": n, "nx": nx, "ny": ny,
            "sum": np.zeros((ny, nx), dtype=np.float64), "cnt": np.zeros((ny, nx), dtype=np.float64)}


def read_all(paths, grids, terr):
    """Läser höjddatan bit för bit och fyller andelen land i varje zoomnivå samt
    medelhöjden i höjdmodellen. Bara den del av varje fil som ligger i området läses."""
    import rasterio
    from rasterio.transform import Affine
    from rasterio.warp import Resampling, reproject, transform_bounds
    from rasterio.windows import Window, from_bounds
    w, s, e, n = BOUNDS
    for k, p in enumerate(paths):
        with rasterio.open(p) as src:
            # områdets gränser i filens koordinatsystem
            ab = transform_bounds("EPSG:4326", src.crs, w, s, e, n, densify_pts=21)
            try:
                win = from_bounds(*ab, transform=src.transform).round_offsets().round_lengths()
                win = win.intersection(Window(0, 0, src.width, src.height))
            except Exception:  # noqa: BLE001  (filen ligger utanför området)
                continue
            if win.width <= 0 or win.height <= 0:
                continue
            nod = src.nodata
            for r0 in range(int(win.row_off), int(win.row_off + win.height), BLOCK):
                for c0 in range(int(win.col_off), int(win.col_off + win.width), BLOCK):
                    bw = Window(c0, r0, min(BLOCK, int(win.col_off + win.width) - c0), min(BLOCK, int(win.row_off + win.height) - r0))
                    h = src.read(1, window=bw).astype(np.float32)
                    bad = ~np.isfinite(h) | ((h == nod) if nod is not None else False) | (h < -50)
                    if bad.all():
                        continue
                    h[bad] = np.nan
                    tr = src.window_transform(bw)
                    land = np.where(bad, np.nan, (h > LAND_M).astype(np.float32))
                    bb = transform_bounds(src.crs, "EPSG:3857", *rasterio.windows.bounds(bw, src.transform))
                    for g in grids:
                        res, X0, Y0 = g["res"], g["X0"], g["Y0"]
                        cc0 = max(0, int((bb[0] - X0) / res) - 2)
                        cc1 = min(g["W"], int(math.ceil((bb[2] - X0) / res)) + 2)
                        rr0 = max(0, int((Y0 - bb[3]) / res) - 2)
                        rr1 = min(g["H"], int(math.ceil((Y0 - bb[1]) / res)) + 2)
                        if cc1 <= cc0 or rr1 <= rr0:
                            continue
                        dst = np.full((rr1 - rr0, cc1 - cc0), np.nan, dtype=np.float32)
                        reproject(land, dst, src_transform=tr, src_crs=src.crs, src_nodata=np.nan,
                                  dst_transform=Affine(res, 0, X0 + cc0 * res, 0, -res, Y0 - rr0 * res),
                                  dst_crs="EPSG:3857", dst_nodata=np.nan, resampling=Resampling.average)
                        wv = g["frac"][rr0:rr1, cc0:cc1]
                        ok = np.isfinite(dst)
                        wv[ok] = np.where(np.isfinite(wv[ok]), np.maximum(wv[ok], dst[ok]), dst[ok])
                    # medelhöjd i höjdmodellen för vinden (grader, norr uppåt)
                    gb = transform_bounds(src.crs, "EPSG:4326", *rasterio.windows.bounds(bw, src.transform))
                    tc0 = max(0, int((gb[0] - terr["lon0"]) / T_DLON) - 1)
                    tc1 = min(terr["nx"], int(math.ceil((gb[2] - terr["lon0"]) / T_DLON)) + 1)
                    tr0 = max(0, int((terr["lat0"] - gb[3]) / T_DLAT) - 1)
                    tr1 = min(terr["ny"], int(math.ceil((terr["lat0"] - gb[1]) / T_DLAT)) + 1)
                    if tc1 > tc0 and tr1 > tr0:
                        dst = np.full((tr1 - tr0, tc1 - tc0), np.nan, dtype=np.float32)
                        reproject(np.where(bad, np.nan, h), dst, src_transform=tr, src_crs=src.crs, src_nodata=np.nan,
                                  dst_transform=Affine(T_DLON, 0, terr["lon0"] + tc0 * T_DLON, 0, -T_DLAT, terr["lat0"] - tr0 * T_DLAT),
                                  dst_crs="EPSG:4326", dst_nodata=np.nan, resampling=Resampling.average)
                        ok = np.isfinite(dst)
                        terr["sum"][tr0:tr1, tc0:tc1][ok] += dst[ok]
                        terr["cnt"][tr0:tr1, tc0:tc1][ok] += 1
        log(f"  {k + 1} av {len(paths)} höjdfiler lästa")
    # bara inom området; utanför räknas fortfarande som öppet vatten, som i resten av masken
    for g in grids:
        tx0, ty0 = g["rng"][0], g["rng"][1]
        ax0, ay0 = world_px(w, n, g["z"])
        ax1, ay1 = world_px(e, s, g["z"])
        inside = np.zeros((g["H"], g["W"]), dtype=bool)
        inside[max(0, int(ay0) - ty0 * 256):int(math.ceil(ay1)) - ty0 * 256, max(0, int(ax0) - tx0 * 256):int(math.ceil(ax1)) - tx0 * 256] = True
        g["frac"][~inside] = np.nan


def save_terrain(terr):
    """Höjdmodellen för vinden: meter över havet (0 på vatten), 0 till 254 m i heltal."""
    h = np.where(terr["cnt"] > 0, terr["sum"] / np.maximum(terr["cnt"], 1), 0.0)
    q = np.clip(np.round(np.maximum(h, 0)), 0, 254).astype(np.uint8)
    out = {"bounds": BOUNDS, "lon0": terr["lon0"], "lat0": terr["lat0"], "dlon": T_DLON, "dlat": T_DLAT,
           "nx": terr["nx"], "ny": terr["ny"], "rows": "norr till söder", "source": "Lantmäteriet Markhöjdmodell",
           "h": base64.b64encode(q.tobytes()).decode("ascii")}
    from common import DATA
    DATA.mkdir(exist_ok=True)
    (DATA / "terrang.json").write_text(json.dumps(out, separators=(",", ":")))
    log(f"  höjdmodell sparad: {terr['nx']} x {terr['ny']} punkter, högst {int(q.max())} m")


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
    if tiles[0][2]:
        log("  Lantmäteriets nya stora filer: läser bara området direkt över nätet")
    paths = download(tiles, auth, t_end)
    if paths is None:
        return
    import rasterio
    grids = [zoom_grid(z) for z in ZOOMS]
    terr = terrain_grid()
    u, p = os.environ.get("LM_USERNAME", ""), os.environ.get("LM_PASSWORD", "")
    with rasterio.Env(GDAL_HTTP_AUTH="BASIC", GDAL_HTTP_USERPWD=f"{u}:{p}", GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
                      CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif,.tiff", GDAL_HTTP_MAX_RETRY="4", GDAL_HTTP_RETRY_DELAY="3"):
        read_all(paths, grids, terr)
    for g in grids:
        osm = read_mask(g["z"], g["rng"])
        water = combine(g["frac"], osm)
        changed = int((water != osm).sum())
        write_mask(g["z"], g["rng"], water)
        log(f"  zoom {g['z']}: {changed} pixlar ändrade mot OpenStreetMap ({100 * np.isfinite(g['frac']).mean():.0f} % täckt av höjddata)")
    save_terrain(terr)
    info["lm"] = VERSION
    info_p.write_text(json.dumps(info))
    log("Lantmäteriets kustlinje: klar")


if __name__ == "__main__":
    build(float(sys.argv[1]) * 60 if len(sys.argv) > 1 else 15 * 60)
