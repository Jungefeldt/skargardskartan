#!/usr/bin/env python3
"""
trad.py

Trädhöjd från Skogsstyrelsens öppna trädhöjdsraster (laserskanning, 1 x 1 m), samplad i samma
rutnät som höjdmodellen i data/terrang.json (ca 20 m mellan punkterna). Används till läet för
vinden (vind_la.py) och till terrängskuggningen på land i appen.

Skogsstyrelsens öppna bildtjänster letas upp i deras tjänstekatalog: först trädhöjdsraster
(Tradhojd), sedan Skogliga grunddata med medelhöjd. Tjänster som kräver inloggning hoppas över.
Rastret hämtas i bitar, i dubbel upplösning, och medelvärdesbildas till rutnätet. Finns ingen
öppen tjänst skrivs innehållet på Skogsstyrelsens FTP-server ut i loggen, som underlag.

Resultat: data/trad.png (gråskala, trädhöjd i kvartsmeter, 0 = ingen skog) och data/trad.json
med rutnätet och källan. Saknas tjänsten görs ingenting, och läet räknas då med skog från
OpenStreetMap som förut.
"""
import io
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

import numpy as np

from common import DATA

ROOT = "https://geodata.skogsstyrelsen.se/arcgis/rest/services"
FOLDERS = ("Publikt",)
FTP = ("ftp.skogsstyrelsen.se", "sgd", "rasterSKS")     # publicerat av Skogsstyrelsen
OUT_PNG, OUT_JSON = DATA / "trad.png", DATA / "trad.json"
VERSION = 2
PER_M = 4            # sparas som kvartsmeter, upp till 63,75 m
BLOCK = 1000         # punkter per bit och led i den hämtade upplösningen
SUB = 2              # hämtas i dubbel upplösning och medelvärdesbildas


def log(*a):
    print(*a, flush=True)


class NoAccess(Exception):
    pass


def get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "skargardskartan/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            js = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as ex:
        if ex.code in (401, 403, 499):
            raise NoAccess(f"HTTP {ex.code}")
        raise
    if isinstance(js, dict) and js.get("error"):
        code = js["error"].get("code")
        if code in (401, 403, 498, 499):
            raise NoAccess(f"kräver inloggning ({code})")
        raise RuntimeError(str(js["error"])[:200])
    return js


def find_sources():
    """Öppna bildtjänster med trädhöjd eller medelhöjd: [(url, band, namn)], bästa först."""
    import unicodedata
    plain = lambda s: unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    found = []
    for folder in FOLDERS:
        try:
            js = get_json(f"{ROOT}/{folder}?f=json")
        except Exception as ex:  # noqa: BLE001
            log(f"  tjänstekatalogen {folder}: {ex}")
            continue
        names = [s["name"] for s in js.get("services", []) if s.get("type") == "ImageServer"]
        log(f"  bildtjänster i {folder}: {', '.join(names) or 'inga'}")
        for nm in names:
            p = plain(nm)
            if "tradhojd" in p:
                found.append((0, nm))
            elif "grunddata" in p or "medelhojd" in p:
                found.append((1, nm))
    found.sort(key=lambda x: (x[0], [-int(d) if d.isdigit() else 0 for d in x[1].replace("_", " ").split()]))
    out = []
    for kind, nm in found:
        url = f"{ROOT}/{nm}/ImageServer"
        try:
            info = get_json(url + "?f=json")
        except NoAccess as ex:
            log(f"  {nm}: {ex}, hoppar över")
            continue
        except Exception as ex:  # noqa: BLE001
            log(f"  {nm}: {ex}")
            continue
        bands = [plain(b) for b in (info.get("bandNames") or [])]
        band = 0
        if kind == 1:
            hits = [i for i, b in enumerate(bands) if "medelh" in b or "hgv" in b or "height" in b]
            if not hits:
                log(f"  {nm}: ingen medelhöjd bland banden {bands}")
                continue
            band = hits[0]
        log(f"  {nm}: öppen, använder band {band}{' (' + bands[band] + ')' if bands else ''}")
        out.append((url, band, nm))
    return out


def list_ftp():
    """Skriver ut vad som finns på Skogsstyrelsens FTP-server (underlag om bildtjänsterna är stängda)."""
    import ftplib
    try:
        f = ftplib.FTP(FTP[0], timeout=60)
        f.login(FTP[1], FTP[2])
        top = f.nlst()
        log(f"  FTP {FTP[0]}: {', '.join(top[:40])}")
        for d in top:
            if "trad" in d.lower() or "hojd" in d.lower() or "höjd" in d.lower():
                try:
                    sub = f.nlst(d)
                    log(f"    {d}: {len(sub)} poster, t.ex. {', '.join(sub[:15])}")
                except Exception as ex:  # noqa: BLE001
                    log(f"    {d}: {ex}")
        f.quit()
    except Exception as ex:  # noqa: BLE001
        log(f"  FTP {FTP[0]}: {ex}")


def fetch_block(url, band, w, s, e, n, W, H):
    """Trädhöjd i decimeter för en bit, som array med raderna från norr till söder."""
    from PIL import Image
    q = {"bbox": f"{w},{s},{e},{n}", "bboxSR": 4326, "imageSR": 4326, "size": f"{W},{H}", "bandIds": band,
         "format": "tiff", "pixelType": "S16", "noData": 0, "interpolation": "RSP_BilinearInterpolation", "f": "image"}
    req = urllib.request.Request(url + "/exportImage?" + urllib.parse.urlencode(q), headers={"User-Agent": "skargardskartan/1.0"})
    last = None
    for attempt in range(3):
        try:
            try:
                with urllib.request.urlopen(req, timeout=120) as r:
                    data = r.read()
            except urllib.error.HTTPError as ex:
                if ex.code in (401, 403, 499):
                    raise NoAccess(f"HTTP {ex.code}")
                raise
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
        except NoAccess:
            raise
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
    nb = ((H + BLOCK - 1) // BLOCK) * ((W + BLOCK - 1) // BLOCK)
    log(f"Trädhöjd från Skogsstyrelsen: {nx} x {ny} punkter, {nb} bitar")
    sources = find_sources()
    if not sources:
        log("  ingen öppen bildtjänst med trädhöjd hittades; innehållet på FTP-servern som underlag:")
        list_ftp()
        return
    full, used = None, None
    for url, band, nm in sources:
        try:
            full = np.zeros((H, W), dtype=np.float32)
            k = 0
            for r0 in range(0, H, BLOCK):
                for c0 in range(0, W, BLOCK):
                    if time.time() > t_end:
                        log("  tiden slut, försöker igen nästa körning")
                        return
                    h, w_ = min(BLOCK, H - r0), min(BLOCK, W - c0)
                    west = T["lon0"] + c0 * dlon
                    north = T["lat0"] - r0 * dlat
                    full[r0:r0 + h, c0:c0 + w_] = fetch_block(url, band, west, north - h * dlat, west + w_ * dlon, north, w_, h)
                    k += 1
                    log(f"  {nm}: bit {k} av {nb}")
            used = nm
            break
        except NoAccess as ex:
            log(f"  {nm}: {ex}, provar nästa")
        except Exception as ex:  # noqa: BLE001
            log(f"  {nm}: {ex}, provar nästa")
    if used is None:
        log("  ingen tjänst gick att hämta från; innehållet på FTP-servern som underlag:")
        list_ftp()
        return
    pos = full[full > 0]
    if pos.size and np.percentile(pos, 99) < 60:                  # ser ut att vara meter, inte decimeter
        log("  värdena ser ut att vara i meter, räknar om")
        full = full * 10
    # dm -> m, medel över SUB x SUB
    m = full.reshape(ny, SUB, nx, SUB).mean(axis=(1, 3)) / 10.0
    Image.fromarray(np.clip(np.round(m * PER_M), 0, 255).astype(np.uint8), "L").save(OUT_PNG, optimize=True)
    land = m > 2
    OUT_JSON.write_text(json.dumps(dict(key, source=f"Skogsstyrelsen, {used}", per_m=PER_M,
                                        max_m=round(float(m.max()), 1)), separators=(",", ":")))
    log(f"Trädhöjd: klar, skog över 2 m på {land.mean() * 100:.0f} % av punkterna, högst {m.max():.0f} m")


if __name__ == "__main__":
    build(float(sys.argv[1]) * 60 if len(sys.argv) > 1 else 8 * 60)
