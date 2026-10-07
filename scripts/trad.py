#!/usr/bin/env python3
"""
trad.py

Trädhöjd från Skogsstyrelsens öppna trädhöjdsraster (laserskanning, 1 x 1 m), samplad i samma
rutnät som höjdmodellen i data/terrang.json (ca 20 m mellan punkterna). Används till läet för
vinden (vind_la.py) och till terrängskuggningen på land i appen.

Rastret hämtas från Skogsstyrelsens publika bildtjänst i bitar, i dubbel upplösning, och
medelvärdesbildas till rutnätet. Värdet i varje punkt är medelhöjden av trädkronorna i rutan.

Resultat: data/trad.png (gråskala, trädhöjd i kvartsmeter, 0 = ingen skog) och data/trad.json
med rutnätet och källan. Saknas tjänsten görs ingenting, och läet räknas då med skog från
OpenStreetMap som förut.
"""
import io
import json
import sys
import time
import urllib.parse
import urllib.request

import numpy as np

from common import DATA

SERVICE = "https://geodata.skogsstyrelsen.se/arcgis/rest/services/Publikt/Tradhojd_3_2/ImageServer/exportImage"
OUT_PNG, OUT_JSON = DATA / "trad.png", DATA / "trad.json"
VERSION = 1
PER_M = 4            # sparas som kvartsmeter, upp till 63,75 m
BLOCK = 1000         # punkter per bit och led i den hämtade upplösningen
SUB = 2              # hämtas i dubbel upplösning och medelvärdesbildas


def log(*a):
    print(*a, flush=True)


def fetch_block(w, s, e, n, W, H):
    """Trädhöjd i decimeter för en bit, som array med raderna från norr till söder."""
    from PIL import Image
    q = {"bbox": f"{w},{s},{e},{n}", "bboxSR": 4326, "imageSR": 4326, "size": f"{W},{H}",
         "format": "tiff", "pixelType": "S16", "noData": 0, "interpolation": "RSP_BilinearInterpolation", "f": "image"}
    url = SERVICE + "?" + urllib.parse.urlencode(q)
    req = urllib.request.Request(url, headers={"User-Agent": "skargardskartan/1.0"})
    last = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                data = r.read()
            if data[:1] == b"{":
                raise RuntimeError(data[:200].decode("utf-8", "replace"))
            try:
                a = np.array(Image.open(io.BytesIO(data))).astype(np.float32)
            except Exception:  # noqa: BLE001
                import rasterio
                from rasterio.io import MemoryFile
                with MemoryFile(data) as mf, mf.open() as ds:
                    a = ds.read(1).astype(np.float32)
            if a.shape != (H, W):
                raise RuntimeError(f"fick {a.shape}, väntade {(H, W)}")
            return np.where(a > 0, a, 0)
        except Exception as ex:  # noqa: BLE001
            last = ex
            time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"Skogsstyrelsen svarade inte: {last}")


def build(budget_s=8 * 60):
    from PIL import Image
    t_end = time.time() + budget_s
    tp = DATA / "terrang.json"
    if not tp.exists():
        log("Trädhöjd: höjdmodellen saknas ännu, väntar")
        return
    T = json.loads(tp.read_text())
    key = {"version": VERSION, "terrain": T.get("source"), "lat0": T["lat0"], "lon0": T["lon0"],
           "dlat": T["dlat"], "dlon": T["dlon"], "nx": T["nx"], "ny": T["ny"]}
    try:
        old = json.loads(OUT_JSON.read_text())
        if all(old.get(k) == v for k, v in key.items()) and OUT_PNG.exists():
            return
    except Exception:  # noqa: BLE001
        pass
    nx, ny = T["nx"], T["ny"]
    W, H = nx * SUB, ny * SUB
    dlon, dlat = T["dlon"] / SUB, T["dlat"] / SUB
    full = np.zeros((H, W), dtype=np.float32)
    nb = ((H + BLOCK - 1) // BLOCK) * ((W + BLOCK - 1) // BLOCK)
    log(f"Trädhöjd från Skogsstyrelsen: {nx} x {ny} punkter, {nb} bitar")
    k = 0
    for r0 in range(0, H, BLOCK):
        for c0 in range(0, W, BLOCK):
            if time.time() > t_end:
                log("  tiden slut, försöker igen nästa körning")
                return
            h, w_ = min(BLOCK, H - r0), min(BLOCK, W - c0)
            west = T["lon0"] + c0 * dlon
            north = T["lat0"] - r0 * dlat
            full[r0:r0 + h, c0:c0 + w_] = fetch_block(west, north - h * dlat, west + w_ * dlon, north, w_, h)
            k += 1
            log(f"  bit {k} av {nb}")
    # dm -> m, medel över SUB x SUB
    m = full.reshape(ny, SUB, nx, SUB).mean(axis=(1, 3)) / 10.0
    Image.fromarray(np.clip(np.round(m * PER_M), 0, 255).astype(np.uint8), "L").save(OUT_PNG, optimize=True)
    land = m > 2
    OUT_JSON.write_text(json.dumps(dict(key, source="Skogsstyrelsen, Trädhöjd från laserdata", per_m=PER_M,
                                        max_m=round(float(m.max()), 1)), separators=(",", ":")))
    log(f"Trädhöjd: klar, skog över 2 m på {land.mean() * 100:.0f} % av punkterna, högst {m.max():.0f} m")


if __name__ == "__main__":
    build(float(sys.argv[1]) * 60 if len(sys.argv) > 1 else 8 * 60)
