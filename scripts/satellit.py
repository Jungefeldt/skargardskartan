#!/usr/bin/env python3
"""
satellit.py

Satellitbilder från Copernicus Sentinel-2 (nivå 2A, 10 m), hämtade fritt utan inloggning via
AWS öppna data och Element 84:s STAC-katalog (earth-search). Bara utsnittet över området läses ur
de molnoptimerade bildfilerna.

De senaste bilderna med lite moln (45 dagar bakåt) läggs ihop till en mosaik: varje punkt tas från
den senaste bilden där den är molnfri (enligt bildens egen klassning, SCL). Tre kartor räknas fram,
bara över vatten (appens kustmask):
  vass.png        NDVI, (nir - röd) / (nir + röd): vass och vattenväxter lyser starkt i nära infrarött
  grumlighet.png  reflektans i rött: grumligt vatten (slam, plankton) reflekterar mer rött ljus
  alger.png       NDCI, (rött kantband - röd) / (rött kantband + röd): klorofyll, alger
Efterbearbetning: närmast stranden blandar 10-metersrutorna land och vatten. Vass räknas därför bara
där ett grönt område är minst ca 30 m brett och når ut från stranden (då behålls hela bältet), och
grumlighet och alger jämnas ut över ca 30 m utan de närmaste rutorna, som sedan fylls i från
omgivningen. Utjämningen tar också bort sensorernas ränder.
Värdena sparas som gråskala 1-255 (0 = ingen data). scen.png anger vilken bild varje punkt kommer
från, och satellit.json rutnätet, skalorna och bildernas datum.
"""
import datetime as dt
import json
import math
import time
import urllib.request

from common import BOUNDS, DATA, MASK

STAC = "https://earth-search.aws.element84.com/v1/search"
UA = "skargardskartan/1.0 github.com/Jungefeldt/skargardskartan"
OUTD = DATA / "satellit"
VERSION = 3
RES_M = 10
DAYS = 45
MAX_SCENES = 6
CLEAR = (4, 5, 6, 7)                   # SCL: vegetation, mark, vatten, oklassat (inte moln, skugga, snö)
SCALES = {"vass": (-0.2, 0.8), "grumlighet": (0.0, 0.06), "alger": (-0.2, 0.4)}


def log(*a):
    print(*a, flush=True)


def search():
    w, s, e, n = BOUNDS
    end = dt.datetime.now(dt.timezone.utc)
    start = end - dt.timedelta(days=DAYS)
    body = {"collections": ["sentinel-2-l2a"], "bbox": [w, s, e, n], "limit": 50,
            "datetime": f"{start:%Y-%m-%dT00:00:00Z}/{end:%Y-%m-%dT23:59:59Z}",
            "query": {"eo:cloud_cover": {"lt": 70}}}
    req = urllib.request.Request(STAC, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json", "User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        feats = json.loads(r.read().decode("utf-8")).get("features", [])
    feats.sort(key=lambda f: f["properties"]["datetime"], reverse=True)
    return feats


def grid():
    w, s, e, n = BOUNDS
    dlat = RES_M / 111320
    dlon = RES_M / (111320 * math.cos(math.radians((s + n) / 2)))
    nx, ny = int(math.ceil((e - w) / dlon)), int(math.ceil((n - s) / dlat))
    return w, n, dlon, dlat, nx, ny


def water_mask(w, n, dlon, dlat, nx, ny):
    """Vatten enligt appens egen kustmask (zoom 13, ca 10 m)."""
    import numpy as np
    from PIL import Image
    z = 13
    N = 256 * 2 ** z
    lons = w + (np.arange(nx) + .5) * dlon
    lats = n - (np.arange(ny) + .5) * dlat
    px = ((lons + 180) / 360 * N).astype(np.int64)
    sl = np.sin(np.radians(lats))
    py = ((.5 - np.log((1 + sl) / (1 - sl)) / (4 * math.pi)) * N).astype(np.int64)
    wat = np.ones((ny, nx), dtype=bool)
    tiles = {}
    for ty in np.unique(py // 256):
        rows = np.where(py // 256 == ty)[0]
        for tx in np.unique(px // 256):
            cols = np.where(px // 256 == tx)[0]
            key = (int(tx), int(ty))
            if key not in tiles:
                p = MASK / str(z) / str(key[0]) / f"{key[1]}.png"
                tiles[key] = np.array(Image.open(p).convert("L")) > 127 if p.exists() else None
            t = tiles[key]
            if t is None:
                continue
            wat[np.ix_(rows, cols)] = t[np.ix_(py[rows] % 256, px[cols] % 256)]
    return wat


def read_band(asset, dst_t, shape, nearest=False):
    """Läser utsnittet ur en molnoptimerad bildfil och projicerar om till rutnätet."""
    import numpy as np
    import rasterio
    from rasterio.warp import reproject, transform_bounds, Resampling
    from rasterio.windows import Window, from_bounds
    w, s, e, n = BOUNDS
    with rasterio.open("/vsicurl/" + asset["href"]) as src:
        l, b, r, t = transform_bounds("EPSG:4326", src.crs, w, s, e, n, densify_pts=21)
        wf = from_bounds(l, b, r, t, src.transform)
        win = Window(int(math.floor(wf.col_off)) - 2, int(math.floor(wf.row_off)) - 2,
                     int(math.ceil(wf.width)) + 4, int(math.ceil(wf.height)) + 4)
        arr = src.read(1, window=win, boundless=True, fill_value=0).astype(np.float32)
        out = np.zeros(shape, dtype=np.float32)
        reproject(arr, out, src_transform=src.window_transform(win), src_crs=src.crs, src_nodata=0,
                  dst_transform=dst_t, dst_crs="EPSG:4326", dst_nodata=0,
                  resampling=Resampling.nearest if nearest else Resampling.bilinear)
    return out if nearest else np.where(out > 0, out, np.nan)            # råa pixelvärden


def need_scipy():
    try:
        import scipy  # noqa: F401
    except ImportError:
        import subprocess
        import sys
        subprocess.run([sys.executable, "-m", "pip", "install", "-q", "scipy"], check=True)


def clean(prod, wat):
    """Tar bort blandrutor vid stranden och jämnar ut (se beskrivningen överst)."""
    import numpy as np
    from scipy import ndimage
    dist = ndimage.distance_transform_edt(wat)               # rutor till närmaste land
    # vass: grönska smalare än ca 30 m (smala kanter längs stranden) tas bort med en morfologisk
    # öppning; de breda områdena får sedan tillbaka sin kant med ett steg
    v = prod["vass"]
    cand = (v > 0.22) & wat
    st = np.ones((3, 3), dtype=bool)
    core = ndimage.binary_opening(cand, structure=st, iterations=1)
    core &= ndimage.binary_dilation(dist >= 2.5, structure=st)   # måste nå ut från stranden
    keep = ndimage.binary_dilation(core, structure=st) & cand
    out = {"vass": np.where(keep, v, np.nan)}
    for k in ("grumlighet", "alger"):
        x = np.where(dist >= 2.5, prod[k], np.nan)
        ok = np.isfinite(x)
        num = ndimage.gaussian_filter(np.where(ok, x, 0.0), 3)
        den = ndimage.gaussian_filter(ok.astype(float), 3)
        sm = np.where(den > 0.05, num / np.maximum(den, 1e-6), np.nan)
        out[k] = np.where(wat & np.isfinite(prod[k]), sm, np.nan)
    return out


def build(budget_s=8 * 60):
    import lm_coast
    lm_coast.need_rasterio()
    need_scipy()
    import numpy as np
    from PIL import Image
    from rasterio.transform import from_origin
    t_end = time.time() + budget_s
    feats = search()
    log(f"Sentinel-2: {len(feats)} bilder de senaste {DAYS} dagarna")
    if not feats:
        return
    meta_p = OUTD / "satellit.json"
    try:
        old = json.loads(meta_p.read_text())
        if old.get("version") == VERSION and old.get("bounds") == BOUNDS and old.get("newest") == feats[0]["id"]:
            log("  ingen ny bild sedan förra gången")
            return
    except Exception:  # noqa: BLE001
        pass
    w, n, dlon, dlat, nx, ny = grid()
    dst_t = from_origin(w, n, dlon, dlat)
    wat = water_mask(w, n, dlon, dlat, nx, ny)
    filled = np.zeros((ny, nx), dtype=bool)
    scene = np.zeros((ny, nx), dtype=np.uint8)
    prod = {k: np.full((ny, nx), np.nan, dtype=np.float32) for k in SCALES}
    used = []
    for f in feats:
        if len(used) >= MAX_SCENES or filled[wat].mean() > .97 or time.time() > t_end:
            break
        a = f["assets"]
        try:
            scl = read_band(a["scl"], dst_t, (ny, nx), nearest=True).astype(np.uint8)
            clear = np.isin(scl, CLEAR) & wat & ~filled
            if clear.sum() < 0.03 * wat.sum():
                log(f"  {f['properties']['datetime'][:10]}: för mycket moln, hoppar över")
                continue
            red = read_band(a["red"], dst_t, (ny, nx))
            nir = read_band(a["nir"], dst_t, (ny, nx))
            re1 = read_band(a["rededge1"], dst_t, (ny, nx))
            # Från processversion 04.00 har pixelvärdena en förskjutning på 1000, som ibland redan är
            # borttagen av bildkällan. Vatten är mörkt (reflektans nära noll), så medianen över vattnet
            # avgör: kring 1000 eller mer finns förskjutningen kvar.
            raw = np.nanmedian(red[clear])
            off = -1000.0 if raw > 600 else 0.0
            red, nir, re1 = (red + off) * 1e-4, (nir + off) * 1e-4, (re1 + off) * 1e-4
            log(f"    rött över vattnet: pixelvärde {raw:.0f}, reflektans {np.nanmedian(red[clear]):.4f}")
        except Exception as ex:  # noqa: BLE001
            log(f"  {f['id']}: {str(ex)[:120]}")
            continue
        ok = clear & np.isfinite(red) & np.isfinite(nir) & np.isfinite(re1)
        prod["vass"][ok] = ((nir - red) / (nir + red + 1e-6))[ok]
        prod["grumlighet"][ok] = red[ok]
        prod["alger"][ok] = ((re1 - red) / (re1 + red + 1e-6))[ok]
        filled |= ok
        used.append({"id": f["id"], "datum": f["properties"]["datetime"][:10], "moln": round(f["properties"].get("eo:cloud_cover", 0))})
        scene[ok] = len(used)
        log(f"  {used[-1]['datum']}: {int(ok.sum())} nya punkter, {filled[wat].mean() * 100:.0f} % av vattnet klart")
    if not used:
        log("  ingen användbar bild, försöker igen nästa körning")
        return
    OUTD.mkdir(parents=True, exist_ok=True)
    prod = clean(prod, wat)
    for k, (lo, hi) in SCALES.items():
        v = prod[k]
        q = np.where(np.isfinite(v), np.clip(np.round((v - lo) / (hi - lo) * 254) + 1, 1, 255), 0).astype(np.uint8)
        Image.fromarray(q, "L").save(OUTD / f"{k}.png", optimize=True)
    Image.fromarray(scene, "L").save(OUTD / "scen.png", optimize=True)
    meta_p.write_text(json.dumps({"version": VERSION, "bounds": BOUNDS, "newest": feats[0]["id"], "lon0": w, "lat0": n,
                                  "dlon": dlon, "dlat": dlat, "nx": nx, "ny": ny, "skalor": SCALES, "bilder": used,
                                  "source": "Copernicus Sentinel-2 (ESA), via AWS öppna data"}, ensure_ascii=False))
    kb = sum((OUTD / f"{k}.png").stat().st_size for k in list(SCALES) + ["scen"]) // 1024
    log(f"Sentinel-2: klar, {len(used)} bilder ({used[0]['datum']} till {used[-1]['datum']}), "
        f"{filled[wat].mean() * 100:.0f} % av vattnet täckt, {kb} kB")


if __name__ == "__main__":
    build()
