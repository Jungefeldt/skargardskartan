#!/usr/bin/env python3
"""
swan_run.py

Beräknar vågfältet i området med vågmodellen SWAN (TU Delft, https://swanmodel.sourceforge.io).
SWAN tar hänsyn till vindsträcka, lä bakom öar, refraktion mot grunt vatten, vågbrytning och
diffraktion. Beräkningen görs en gång för ett antal vindriktningar och vindstyrkor (stationära
körningar), och appen väljer sedan den beräkning som passar prognosens vind.

Resultat: data/swan/index.json och en fil per körning, data/swan/d{riktning}_s{styrka}.json,
med våghöjd (Hs), medelperiod (Tm01) och vågriktning (varifrån vågorna kommer) per rutpunkt.
Färdiga körningar sparas direkt, så att en körning som inte hinner klart fortsätter nästa gång.

Kräver gfortran och make (finns på GitHub:s Ubuntu-maskiner).
"""
import base64
import json
import math
import os
import shutil
import subprocess
import sys
import tarfile
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import numpy as np

from common import BOUNDS, CACHE, DATA, FULL_BOUNDS, MASK

TOP = DATA / "swan"
GRID = "g070"                                       # byts när rutnätet ändras, så att allt räknas om
OUT = TOP / GRID                                    # nya resultat samlas här tills alla är klara
DIRS = [round(i * 22.5, 1) for i in range(16)]      # 16 vindriktningar
SPEEDS = [5, 10, 15]
DX, DY = 0.00125, 0.000625                          # ca 70 x 70 m vid 59,5 grader
SRC_URLS = [
    "https://swanmodel.sourceforge.io/download/zip/swan4151.tar.gz",
    "https://downloads.sourceforge.net/project/swanmodel/swan/41.51/swan4151.tar.gz",
]
GIT_URL = "https://gitlab.tudelft.nl/citg/wavemodels/swan.git"


def log(*a):
    print(*a, flush=True)


# ------------------------------------------------------------------ hämta och bygg SWAN

def swan_exe():
    """Returnerar sökvägen till en kompilerad SWAN, bygger den vid behov."""
    exe = CACHE / "swan" / "swan.exe"
    if exe.exists():
        return exe
    CACHE.mkdir(exist_ok=True)
    work = CACHE / "swan_src"
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True)
    src = None
    for url in SRC_URLS:
        try:
            log(f"Hämtar SWAN från {url}")
            req = urllib.request.Request(url, headers={"User-Agent": "skargardskartan/1.0"})
            with urllib.request.urlopen(req, timeout=120) as r:
                data = r.read()
            tgz = work / "swan.tar.gz"
            tgz.write_bytes(data)
            with tarfile.open(tgz) as t:
                t.extractall(work)
            cands = [p.parent for p in work.rglob("INSTALL.README")] or [p.parent for p in work.rglob("Makefile")]
            if cands:
                src = cands[0]
                break
        except Exception as ex:  # noqa: BLE001
            log(f"  misslyckades: {ex}")
    if src is None:
        try:
            log(f"Klonar SWAN från {GIT_URL}")
            subprocess.run(["git", "clone", "--depth", "1", GIT_URL, str(work / "git")], check=True, timeout=300)
            src = work / "git"
        except Exception as ex:  # noqa: BLE001
            raise RuntimeError(f"kunde inte hämta SWAN: {ex}")
    log(f"Bygger SWAN i {src}")
    built = None
    try:
        subprocess.run(["make", "config"], cwd=src, check=True, timeout=300)
        subprocess.run(["make", "ser"], cwd=src, check=True, timeout=1800)
        built = next(iter(src.rglob("swan.exe")), None)
    except Exception as ex:  # noqa: BLE001
        log(f"  make misslyckades ({ex}), provar cmake")
    if built is None:
        b = src / "build"
        b.mkdir(exist_ok=True)
        subprocess.run(["cmake", ".."], cwd=b, check=True, timeout=300)
        subprocess.run(["make", "-j4"], cwd=b, check=True, timeout=1800)
        built = next(iter(b.rglob("swan.exe")), None) or next(iter(b.rglob("swan")), None)
    if built is None:
        raise RuntimeError("hittade ingen swan.exe efter bygget")
    exe.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(built, exe)
    exe.chmod(0o755)
    log(f"  SWAN byggd: {exe}")
    return exe


# ------------------------------------------------------------------ djup och land

def world_px(lon, lat, z):
    n = 256 * 2 ** z
    s = math.sin(math.radians(lat))
    return (lon + 180) / 360 * n, (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * n


def land_fraction(lons, lats):
    """Andel land per rutpunkt, från kustmasken i zoom 13 (ca 10 m per punkt)."""
    from PIL import Image
    z = 13
    cache = {}

    def tile(tx, ty):
        k = (tx, ty)
        if k not in cache:
            p = MASK / str(z) / str(tx) / f"{ty}.png"
            cache[k] = np.array(Image.open(p).convert("L")) > 127 if p.exists() else None
        return cache[k]

    frac = np.zeros((len(lats), len(lons)))
    for j, la in enumerate(lats):
        for i, lo in enumerate(lons):
            # 5 x 5 stickprov inom cellen
            land = 0
            tot = 0
            for a in (-0.4, -0.2, 0, 0.2, 0.4):
                for b in (-0.4, -0.2, 0, 0.2, 0.4):
                    x, y = world_px(lo + a * DX, la + b * DY, z)
                    t = tile(int(x // 256), int(y // 256))
                    tot += 1
                    if t is not None and not t[int(y % 256), int(x % 256)]:
                        land += 1
            frac[j, i] = land / tot
    return frac


def depth_grid(lons, lats):
    """Djup från EMODnet-filen (data/djup.json), i meter, positivt nedåt."""
    G = json.loads((DATA / "djup.json").read_text())
    D = np.frombuffer(base64.b64decode(G["d"]), dtype=np.uint8).reshape(G["ny"], G["nx"]).astype(float) / 2
    out = np.zeros((len(lats), len(lons)))
    for j, la in enumerate(lats):
        fy = min(max((la - G["lat0"]) / G["dlat"], 0), G["ny"] - 1.001)
        y0 = int(fy)
        ty = fy - y0
        for i, lo in enumerate(lons):
            fx = min(max((lo - G["lon0"]) / G["dlon"], 0), G["nx"] - 1.001)
            x0 = int(fx)
            tx = fx - x0
            out[j, i] = (D[y0, x0] * (1 - tx) + D[y0, x0 + 1] * tx) * (1 - ty) + (D[y0 + 1, x0] * (1 - tx) + D[y0 + 1, x0 + 1] * tx) * ty
    return out


def make_grid():
    w, s, e, n = BOUNDS
    nx = int(round((e - w) / DX)) + 1
    ny = int(round((n - s) / DY)) + 1
    lons = w + DX * np.arange(nx)
    lats = s + DY * np.arange(ny)
    log(f"SWAN-rutnät: {nx} x {ny} punkter")
    frac = land_fraction(lons, lats)
    dep = np.maximum(depth_grid(lons, lats), 1.0)
    dep[frac > 0.5] = -99.0               # land
    return lons, lats, dep


# ------------------------------------------------------------------ en körning

CMD = """PROJECT 'skk' '01'
SET NAUTICAL
MODE STATIONARY TWODIMENSIONAL
COORDINATES SPHERICAL CCM
CGRID REGULAR {x0} {y0} 0. {xl} {yl} {mx} {my} CIRCLE 36 0.15 1.2 24
INPGRID BOTTOM REGULAR {x0} {y0} 0. {mx} {my} {dx} {dy} EXCEPTION -99.
READINP BOTTOM 1. 'bottom.dat' 1 0 FREE
WIND {u} {d}
GEN3
BREAKING
FRICTION
TRIAD
DIFFRACTION
NUMERIC STOPC 0.01 0.02 0.02 97. STAT 40
BLOCK 'COMPGRID' NOHEADER 'dep.dat' LAY 1 DEPTH 1.
BLOCK 'COMPGRID' NOHEADER 'hs.dat' LAY 1 HSIGN 1.
BLOCK 'COMPGRID' NOHEADER 'tm.dat' LAY 1 TM01 1.
BLOCK 'COMPGRID' NOHEADER 'dir.dat' LAY 1 DIR 1.
COMPUTE
STOP
"""


def read_block(p, ny, nx):
    vals = np.array([float(v) for v in p.read_text().replace("D", "E").split()])
    if vals.size != ny * nx:
        raise RuntimeError(f"{p.name}: {vals.size} värden, väntade {ny * nx}")
    return vals.reshape(ny, nx)


def orient(block, dep_in):
    """SWAN:s utskrift kan börja uppifrån eller nedifrån; jämför djupet med indata och vänd rätt."""
    water = dep_in > 0
    best, flip = None, False
    for f in (False, True):
        b = block[::-1] if f else block
        err = np.abs(np.where(water, b - dep_in, 0)).mean()
        if best is None or err < best:
            best, flip = err, f
    return flip


def run_case(exe, lons, lats, dep, d, u):
    name = f"d{int(round(d * 10)):04d}_s{u:02d}"
    target = OUT / f"{name}.json"
    if target.exists():
        return name, "fanns redan"
    work = CACHE / "swan_runs" / name
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True)
    ny, nx = dep.shape
    # indata skrivs uppifrån (norr) och ned, rad för rad
    with open(work / "bottom.dat", "w") as f:
        for j in range(ny - 1, -1, -1):
            f.write(" ".join(f"{v:.1f}" for v in dep[j]) + "\n")
    (work / "INPUT").write_text(CMD.format(x0=lons[0], y0=lats[0], xl=lons[-1] - lons[0], yl=lats[-1] - lats[0],
                                           mx=nx - 1, my=ny - 1, dx=DX, dy=DY, u=u, d=d))
    t0 = time.time()
    r = subprocess.run([str(exe)], cwd=work, capture_output=True, text=True, timeout=1200)
    if not (work / "hs.dat").exists():
        tail = ((work / "PRINT").read_text()[-1500:] if (work / "PRINT").exists() else r.stdout[-1500:])
        raise RuntimeError(f"SWAN gav ingen utdata för {name}:\n{tail}")
    dep_out = read_block(work / "dep.dat", ny, nx)
    flip = orient(dep_out, dep)
    fix = (lambda a: a[::-1]) if flip else (lambda a: a)
    hs = fix(read_block(work / "hs.dat", ny, nx))
    tm = fix(read_block(work / "tm.dat", ny, nx))
    di = fix(read_block(work / "dir.dat", ny, nx))
    land = dep < 0
    hs_q = np.where(land | (hs < 0), 255, np.clip(np.round(hs * 100), 0, 254)).astype(np.uint8)    # cm, upp till 2,5 m
    tm_q = np.where(land | (tm < 0), 255, np.clip(np.round(tm * 25), 0, 254)).astype(np.uint8)    # 0,04 s
    di_q = np.where(land | (di < -900), 255, np.round((di % 360) / 360 * 254)).astype(np.uint8)
    out = {"dir": d, "speed": u, "flipped": bool(flip), "secs": round(time.time() - t0, 1),
           "hs": base64.b64encode(hs_q.tobytes()).decode("ascii"),
           "tm": base64.b64encode(tm_q.tobytes()).decode("ascii"),
           "di": base64.b64encode(di_q.tobytes()).decode("ascii")}
    target.write_text(json.dumps(out, separators=(",", ":")))
    shutil.rmtree(work, ignore_errors=True)
    return name, f"klar på {out['secs']} s, max Hs {float(np.nanmax(np.where(land, 0, hs))):.2f} m"


def write_index(lons, lats):
    """Skriver index för det nya rutnätet. Appen fortsätter använda det gamla tills alla
    beräkningar för det nya är klara; då pekas appen om och de gamla filerna tas bort."""
    done = sorted(p.stem for p in OUT.glob("d*_s*.json"))
    idx = {"bounds": BOUNDS, "lon0": float(lons[0]), "lat0": float(lats[0]), "dlon": DX, "dlat": DY,
           "nx": len(lons), "ny": len(lats), "dirs": DIRS, "speeds": SPEEDS, "done": done, "dir": GRID,
           "model": "SWAN 41.51, stationär, GEN3, brytning, bottenfriktion, triader, diffraktion"}
    (OUT / "index.json").write_text(json.dumps(idx, separators=(",", ":")))
    try:
        switched = json.loads((TOP / "index.json").read_text()).get("dir") == GRID
    except Exception:  # noqa: BLE001
        switched = False
    if len(done) >= len(DIRS) * len(SPEEDS) and not switched:
        (TOP / "index.json").write_text(json.dumps(idx, separators=(",", ":")))
        for old in TOP.glob("d*_s*.json"):           # resultat från tidigare rutnät
            old.unlink()
        for d in TOP.iterdir():
            if d.is_dir() and d.name != GRID:
                shutil.rmtree(d, ignore_errors=True)
        log(f"SWAN: appen använder nu rutnätet {GRID}")
    return len(done)


def build_swan(budget_s=25 * 60, workers=None):
    t_end = time.time() + budget_s
    if BOUNDS == FULL_BOUNDS:
        log("SWAN: körs bara i testområdet (hela skärgården blir för stor), hoppar över")
        return
    if not (DATA / "djup.json").exists():
        log("SWAN: djupdata saknas ännu, väntar till nästa körning")
        return
    OUT.mkdir(parents=True, exist_ok=True)
    total = len(DIRS) * len(SPEEDS)
    try:
        current = json.loads((TOP / "index.json").read_text()).get("dir") == GRID
    except Exception:  # noqa: BLE001
        current = False
    if current and len(list(OUT.glob("d*_s*.json"))) >= total:
        return
    exe = swan_exe()
    lons, lats, dep = make_grid()
    todo = [(d, u) for u in SPEEDS for d in DIRS if not (OUT / f"d{int(round(d * 10)):04d}_s{u:02d}.json").exists()]
    log(f"SWAN ({GRID}, {DX} x {DY} grader): {total - len(todo)} av {total} beräkningar klara sedan tidigare")
    workers = workers or max(1, min(4, os.cpu_count() or 1))
    with ThreadPoolExecutor(workers) as pool:
        futs = []
        for d, u in todo:
            futs.append(pool.submit(lambda dd=d, uu=u: run_case(exe, lons, lats, dep, dd, uu) if time.time() < t_end else (f"{dd}_{uu}", "hoppas över, tiden slut")))
        for f in futs:
            try:
                name, msg = f.result()
                log(f"  {name}: {msg}")
                write_index(lons, lats)   # efter varje körning, så att appen ser det som är klart
            except Exception as ex:  # noqa: BLE001
                log(f"  fel: {ex}")
    n = write_index(lons, lats)
    log(f"SWAN: {n} av {total} beräkningar sparade")


if __name__ == "__main__":
    build_swan(float(sys.argv[1]) * 60 if len(sys.argv) > 1 else 25 * 60)
