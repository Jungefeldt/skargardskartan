#!/usr/bin/env python3
"""
update_data.py

Hämtar ny data till Skärgårdskartan:
  data/wind.json  vind och väder från SMHI (prognos), senaste 5 dagarna sparas
  data/temp.json  vattentemperatur från Copernicus Marine, 5 dagar bakåt plus prognos

Copernicus-inloggning läses från miljövariablerna
COPERNICUSMARINE_SERVICE_USERNAME och COPERNICUSMARINE_SERVICE_PASSWORD.
Saknas de hoppas vattentemperaturen över och vind/väder uppdateras ändå.
"""
import base64
import datetime as dt
import json
import os
import time
import urllib.request

from common import BOUNDS, DATA, DAYS_BACK

SMHI = "https://opendata-download-metfcst.smhi.se/api/category/snow1g/version/1/geotype/point/lon/{lon}/lat/{lat}/data.json"
LAT_STEP, LON_STEP = 0.10, 0.15  # punkternas täthet (ca 11 x 8 km)


def utcnow():
    return dt.datetime.now(dt.timezone.utc)


# --------------------------------------------------------------------- SMHI

def pick(data, *names, contains=None):
    for n in names:
        if n in data and data[n] is not None:
            return data[n]
    if contains:
        for k, v in data.items():
            if contains in k and v is not None:
                return v
    return None


def parse_step(step):
    """Klarar både snow1g (data som ordbok) och äldre format (parameters-lista)."""
    d = step.get("data")
    if d is None and "parameters" in step:
        d = {p["name"]: (p.get("values") or [None])[0] for p in step["parameters"]}
    d = d or {}
    return {
        "t": pick(d, "air_temperature", "t"),
        "ws": pick(d, "wind_speed", "ws"),
        "wd": pick(d, "wind_from_direction", "wd"),
        "gust": pick(d, "wind_speed_of_gust", "gust", contains="gust"),
        "pr": pick(d, "precipitation_amount_mean", "pmean", contains="precipitation_amount"),
        "sym": pick(d, "symbol_code", "Wsymb2", contains="symbol"),
    }


def fetch_point(lat, lon):
    url = SMHI.format(lat=f"{lat:.4f}", lon=f"{lon:.4f}")
    req = urllib.request.Request(url, headers={"User-Agent": "skargardskartan/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        js = json.loads(r.read().decode("utf-8"))
    out = {}
    for step in js.get("timeSeries", []):
        t = step.get("time") or step.get("validTime")
        if t:
            out[t[:13] + ":00Z"] = parse_step(step)
    return out


def update_wind():
    w, s, e, n = BOUNDS
    pts = []
    lat = s + LAT_STEP / 2
    while lat < n:
        lon = w + LON_STEP / 2
        while lon < e:
            pts.append((round(lat, 4), round(lon, 4)))
            lon += LON_STEP
        lat += LAT_STEP
    print(f"SMHI: {len(pts)} punkter", flush=True)

    old = {}
    p = DATA / "wind.json"
    if p.exists():
        try:
            o = json.loads(p.read_text())
            for i, (la, lo) in enumerate(o["points"]):
                old[(la, lo)] = {t: dict(zip(o["keys"], o["series"][i][j])) for j, t in enumerate(o["times"]) if o["series"][i][j]}
        except Exception:  # noqa: BLE001
            old = {}

    keep_from = (utcnow() - dt.timedelta(days=DAYS_BACK)).strftime("%Y-%m-%dT%H:00Z")
    series = {}
    ok = 0
    for la, lo in pts:
        merged = {t: v for t, v in old.get((la, lo), {}).items() if t >= keep_from}
        try:
            merged.update(fetch_point(la, lo))
            ok += 1
        except Exception as ex:  # noqa: BLE001
            print(f"  {la},{lo}: {ex}")
        series[(la, lo)] = merged
        time.sleep(0.15)
    if not ok:
        print("SMHI svarade inte, behåller gammal vinddata")
        return
    times = sorted({t for v in series.values() for t in v if t >= keep_from})
    keys = ["ws", "wd", "gust", "t", "pr", "sym"]

    def row(v):
        return [None if v.get(k) is None else (round(v[k], 1) if isinstance(v[k], float) else v[k]) for k in keys]

    out = {
        "created": utcnow().strftime("%Y-%m-%dT%H:%MZ"),
        "keys": keys,
        "times": times,
        "points": [list(pt) for pt in pts],
        "series": [[row(series[pt][t]) if t in series[pt] else None for t in times] for pt in pts],
    }
    DATA.mkdir(exist_ok=True)
    p.write_text(json.dumps(out, separators=(",", ":")))
    print(f"  vind sparad: {len(times)} tidssteg", flush=True)


# --------------------------------------------------------------- Copernicus

def update_temp():
    user = os.environ.get("COPERNICUSMARINE_SERVICE_USERNAME")
    pwd = os.environ.get("COPERNICUSMARINE_SERVICE_PASSWORD")
    try:
        import numpy as np
        import copernicusmarine as cm
    except ImportError:
        print("copernicusmarine saknas, hoppar över vattentemperatur")
        return
    if not (user and pwd):
        print("Copernicus-inloggning saknas (hemligheterna COPERNICUS_USER och COPERNICUS_PASSWORD), hoppar över vattentemperatur")
        return
    today = utcnow().date()
    start = today - dt.timedelta(days=DAYS_BACK)
    end = today + dt.timedelta(days=10)
    kw = {"username": user, "password": pwd}
    print(f"Copernicus: {start} till {end}", flush=True)
    try:
        ds = cm.open_dataset(
            dataset_id="cmems_mod_bal_phy_anfc_P1D-m", variables=["thetao"],
            minimum_longitude=BOUNDS[0] - 0.05, maximum_longitude=BOUNDS[2] + 0.05,
            minimum_latitude=BOUNDS[1] - 0.05, maximum_latitude=BOUNDS[3] + 0.05,
            start_datetime=f"{start}T00:00:00", end_datetime=f"{end}T23:59:59", **kw)
    except Exception as ex:  # noqa: BLE001
        print(f"  Copernicus misslyckades: {str(ex).splitlines()[0][:200]}")
        return
    if ds is None:
        print("  Copernicus gav ingen data (kontrollera användarnamn och lösenord), hoppar över")
        return
    da = ds["thetao"]
    if "depth" in da.dims:
        da = da.isel(depth=0)
    latn = "latitude" if "latitude" in da.coords else "lat"
    lonn = "longitude" if "longitude" in da.coords else "lon"
    da = da.sortby(latn).sortby(lonn).load()
    lat = da[latn].values.astype(float)
    lon = da[lonn].values.astype(float)
    v = da.transpose("time", latn, lonn).values.astype(float)

    # fyll rutor utan värde (land, trånga vikar) från grannarna
    wet = np.isfinite(v).all(axis=0)
    v[:, ~wet] = np.nan
    filled = wet.copy()
    ny, nx = wet.shape
    while wet.any() and not filled.all():
        fp = np.pad(filled, 1)
        vp = np.pad(np.where(filled, v, 0.0), ((0, 0), (1, 1), (1, 1)))
        s_ = np.zeros_like(v)
        c = np.zeros((ny, nx))
        for dy, dx in [(1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)]:
            ys, xs = slice(1 + dy, 1 + dy + ny), slice(1 + dx, 1 + dx + nx)
            c += fp[ys, xs]
            s_ += vp[:, ys, xs]
        new = (~filled) & (c > 0)
        if not new.any():
            break
        v[:, new] = s_[:, new] / c[new]
        filled |= new
    q = np.clip(np.round((np.nan_to_num(v, nan=0.0) + 2) * 10), 0, 255).astype("uint8")
    out = {
        "created": utcnow().strftime("%Y-%m-%dT%H:%MZ"),
        "lat0": float(lat[0]), "lon0": float(lon[0]),
        "dlat": float(np.median(np.diff(lat))), "dlon": float(np.median(np.diff(lon))),
        "ny": int(len(lat)), "nx": int(len(lon)),
        "dates": [str(t)[:10] for t in da["time"].values],
        "t": base64.b64encode(q.tobytes()).decode("ascii"),
    }
    (DATA / "temp.json").write_text(json.dumps(out, separators=(",", ":")))
    print(f"  vattentemperatur sparad: {len(out['dates'])} dagar", flush=True)


if __name__ == "__main__":
    DATA.mkdir(exist_ok=True)
    update_wind()
    update_temp()
