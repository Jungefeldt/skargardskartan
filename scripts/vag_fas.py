#!/usr/bin/env python3
"""
vag_fas.py

Fasfält för de rörliga vågorna i appen. För varje vindriktning i SWAN räknas två fält:
P, som ökar med 1 för varje våglängd i vågornas gångriktning, och Q, som gör samma sak tvärs
över. Appen bygger sedan vågytan på grafikkortet som en summa av många vågor med olika
riktning och längd, uttryckta i P och Q, så att vågorna följer SWAN:s riktning och böjer sig
runt öarna. Våglängden på kartan är förstorad (60 till 230 m, längre där sjön är grövre),
annars syns vågorna inte i kartskala.

Fälten tas fram som minsta-kvadratlösningen till grad(P) = k och grad(Q) = k vriden 90
grader, där k är vågtalsvektorn från SWAN (10 m/s) dämpad med läet för vinden.

Resultat: data/fas/index.json och två bilder per riktning, data/fas/d{riktning}_p.png och
_q.png, där fältet är kodat i 16 bitar (röd = hög byte, grön = låg byte) mellan min och max
i index.json. Rader går från norr till söder.
"""
import base64
import json
import math
import sys
import time

import numpy as np

from common import BOUNDS, DATA

OUT = DATA / "fas"
VERSION = 1
DLAT, DLON = 0.00036, 0.00072      # ca 40 x 40 m
SPEED = 10


def log(*a):
    print(*a, flush=True)


def solve(kx, ky, dxm, dym):
    """phi med grad(phi) = (kx, ky) i minsta-kvadratmening; ky räknas nedåt i raderna."""
    import scipy.sparse as sp
    import scipy.sparse.linalg as sl
    ny, nx = kx.shape
    N = ny * nx
    idx = np.arange(N).reshape(ny, nx)
    a, b = idx[:, :-1].ravel(), idx[:, 1:].ravel()
    c, d = idx[:-1, :].ravel(), idx[1:, :].ravel()
    ex = ((kx[:, :-1] + kx[:, 1:]) / 2).ravel() * dxm
    ey = ((ky[:-1, :] + ky[1:, :]) / 2).ravel() * dym
    m1, m2 = len(a), len(c)
    rows = np.r_[np.arange(m1), np.arange(m1), m1 + np.arange(m2), m1 + np.arange(m2), m1 + m2]
    cols = np.r_[b, a, d, c, N // 2]
    vals = np.r_[np.ones(m1), -np.ones(m1), np.ones(m2), -np.ones(m2), 1.0]
    A = sp.csr_matrix((vals, (rows, cols)), shape=(m1 + m2 + 1, N))
    rhs = np.r_[ex, ey, 0.0]
    return sl.spsolve((A.T @ A).tocsc(), A.T @ rhs).reshape(ny, nx)


def encode(F, path):
    from PIL import Image
    lo, hi = float(F.min()), float(F.max())
    q = np.round((F - lo) / max(hi - lo, 1e-9) * 65535).astype(np.uint32)
    rgb = np.zeros(F.shape + (3,), dtype=np.uint8)
    rgb[..., 0] = q >> 8
    rgb[..., 1] = q & 255
    Image.fromarray(rgb, "RGB").save(path, optimize=True)
    return [lo, hi]


def build(budget_s=12 * 60):
    from PIL import Image
    from scipy import ndimage
    t_end = time.time() + budget_s
    try:
        SI = json.loads((DATA / "swan" / "index.json").read_text())
    except Exception:  # noqa: BLE001
        log("Vågfaser: SWAN saknas ännu, väntar")
        return
    sdir = (DATA / "swan" / SI["dir"]) if SI.get("dir") else (DATA / "swan")
    key = {"version": VERSION, "bounds": BOUNDS, "swan": SI.get("dir"), "speed": SPEED}
    try:
        idx = json.loads((OUT / "index.json").read_text())
        if all(idx.get(k) == v for k, v in key.items()) and len(idx.get("done", [])) == len(SI["dirs"]):
            return
        if not all(idx.get(k) == v for k, v in key.items()):
            idx = None
    except Exception:  # noqa: BLE001
        idx = None
    w, s, e, n = BOUNDS
    nx, ny = int(round((e - w) / DLON)), int(round((n - s) / DLAT))
    lats = n - (np.arange(ny) + 0.5) * DLAT
    lons = w + (np.arange(nx) + 0.5) * DLON
    dxm = DLON * 111320 * math.cos(math.radians((n + s) / 2))
    dym = DLAT * 111320
    # land från höjdmodellen (om den finns), annars från SWAN
    land = None
    try:
        T = json.loads((DATA / "terrang.json").read_text())
        h = np.frombuffer(base64.b64decode(T["h"]), dtype=np.uint8).reshape(T["ny"], T["nx"]).astype(np.float32)
        fy = (T["lat0"] - lats) / T["dlat"] - 0.5
        fx = (lons - T["lon0"]) / T["dlon"] - 0.5
        FY, FX = np.meshgrid(fy, fx, indexing="ij")
        land = ndimage.map_coordinates(h, [FY, FX], order=1, mode="nearest") > 0.5
    except Exception:  # noqa: BLE001
        pass
    fy = (lats - SI["lat0"]) / SI["dlat"]
    fx = (lons - SI["lon0"]) / SI["dlon"]
    FY, FX = np.meshgrid(fy, fx, indexing="ij")
    OUT.mkdir(parents=True, exist_ok=True)
    idx = idx or dict(key, lon0=w, lat0=n, dlon=DLON, dlat=DLAT, nx=nx, ny=ny, dirs=SI["dirs"], done=[], range={})
    log(f"Vågfaser: {nx} x {ny} punkter, {len(idx['done'])} av {len(SI['dirs'])} riktningar klara sedan tidigare")
    for d in SI["dirs"]:
        name = f"d{int(round(d * 10)):04d}"
        if name in idx["done"]:
            continue
        if time.time() > t_end:
            log("  tiden slut, fortsätter nästa körning")
            break
        f = sdir / f"{name}_s{SPEED:02d}.json"
        if not f.exists():
            continue
        t0 = time.time()
        S = json.loads(f.read_text())
        dec = lambda k: np.frombuffer(base64.b64decode(S[k]), dtype=np.uint8).reshape(SI["ny"], SI["nx"]).astype(np.float32)
        hs, di = dec("hs"), dec("di")
        sl_ = hs == 255
        near = ndimage.distance_transform_edt(sl_, return_distances=False, return_indices=True)
        a = np.radians(di / 254 * 360)
        fill = lambda A: np.where(sl_, A[tuple(near)], A)
        samp = lambda A: ndimage.map_coordinates(A, [FY, FX], order=1, mode="nearest")
        Hs = samp(fill(hs / 100))
        D = np.degrees(np.arctan2(samp(fill(np.sin(a))), samp(fill(np.cos(a)))))
        # läet för vinden dämpar sjön och gör vågorna kortare
        try:
            V = np.array(Image.open(DATA / "vind" / f"{name}.png")).astype(np.float32) / 200
            VI = json.loads((DATA / "vind" / "index.json").read_text())
            vy = (VI["lat0"] - lats) / VI["dlat"] - 0.5
            vx = (lons - VI["lon0"]) / VI["dlon"] - 0.5
            VY, VX = np.meshgrid(vy, vx, indexing="ij")
            Hs = Hs * ndimage.map_coordinates(V, [VY, VX], order=1, mode="nearest")
        except Exception:  # noqa: BLE001
            pass
        if land is not None:
            # på land: riktningen från närmaste vatten, så att fälten blir jämna ända in till stranden
            ni = ndimage.distance_transform_edt(land, return_distances=False, return_indices=True)
            Hs, D = Hs[tuple(ni)], D[tuple(ni)]
        lam = 60 + 170 * np.sqrt(np.clip(Hs, 0, 1.2) / 0.6)
        tr = np.radians(D + 180)
        kx, ky = np.sin(tr) / lam, -np.cos(tr) / lam      # ky nedåt i raderna (söderut)
        P = solve(kx, ky, dxm, dym)
        Q = solve(-ky, kx, dxm, dym)
        idx["range"][name] = encode(P, OUT / f"{name}_p.png") + encode(Q, OUT / f"{name}_q.png")
        idx["done"].append(name)
        (OUT / "index.json").write_text(json.dumps(idx, separators=(",", ":")))
        log(f"  {name}: klar på {time.time() - t0:.0f} s")
    log(f"Vågfaser: {len(idx['done'])} av {len(SI['dirs'])} riktningar klara")


if __name__ == "__main__":
    build(float(sys.argv[1]) * 60 if len(sys.argv) > 1 else 12 * 60)
