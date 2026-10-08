#!/usr/bin/env python3
"""
update_data.py

Hämtar ny data till Skärgårdskartan:
  data/wind.json  vind och väder: met.no (nordiska modellen MEPS, 2,5 km) de första dygnen,
                  SMHI för resten och som reserv; senaste 5 dagarna sparas
  data/temp.json  vattentemperatur från Copernicus Marine: havsmodellen, rättad mot satellitmätt
                  yttemperatur (ca 2 km) där sådan finns, 5 dagar bakåt plus prognos

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
MET = "https://api.met.no/weatherapi/locationforecast/2.0/complete?lat={lat}&lon={lon}"
UA = "skargardskartan/1.0 github.com/Jungefeldt/skargardskartan"
LAT_STEP, LON_STEP = 0.10, 0.15  # punkternas täthet (ca 11 x 8 km)
SST_DATASET = "DMI-BALTIC-SST-L4-NRT-OBS_FULL_TIME_SERIE"   # satellitmätt yttemperatur, ca 2 km
WIND_BUDGET_S = 6 * 60   # längsta tid för vindhämtningen
TEMP_BUDGET_S = 8 * 60   # längsta tid för vattentemperaturen
FRESH_H = 6              # manuella körningar hoppar över hämtningen om datan är yngre än så


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
    with urllib.request.urlopen(req, timeout=20) as r:
        js = json.loads(r.read().decode("utf-8"))
    out = {}
    for step in js.get("timeSeries", []):
        t = step.get("time") or step.get("validTime")
        if t:
            out[t[:13] + ":00Z"] = parse_step(step)
    return out


def fetch_point_met(lat, lon):
    """Prognos från met.no (Locationforecast, bygger på den nordiska modellen MEPS med 2,5 km
    upplösning de första dygnen). Samma nycklar som SMHI; vädersymbolen tas från SMHI."""
    url = MET.format(lat=f"{lat:.4f}", lon=f"{lon:.4f}")
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        js = json.loads(r.read().decode("utf-8"))
    out = {}
    for step in js.get("properties", {}).get("timeseries", []):
        t = step.get("time")
        d = (step.get("data") or {}).get("instant", {}).get("details", {})
        if not t or d.get("wind_speed") is None:
            continue
        nh = (step.get("data") or {}).get("next_1_hours") or {}
        out[t[:13] + ":00Z"] = {"t": d.get("air_temperature"), "ws": d.get("wind_speed"), "wd": d.get("wind_from_direction"),
                                "gust": d.get("wind_speed_of_gust"), "pr": (nh.get("details") or {}).get("precipitation_amount")}
    return out


def update_wind():
    w, s, e, n = BOUNDS
    # i ett litet område tätare punkter (met.no räknar med 2,5 km rutor), så att vinden följer fjärdarna
    lat_step, lon_step = min(LAT_STEP, (n - s) / 6), min(LON_STEP, (e - w) / 6)
    pts = []
    lat = s + lat_step / 2
    while lat < n:
        lon = w + lon_step / 2
        while lon < e:
            pts.append((round(lat, 4), round(lon, 4)))
            lon += lon_step
        lat += lat_step
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
    ok = met_ok = 0
    t_end = time.time() + WIND_BUDGET_S
    for la, lo in pts:
        merged = {t: v for t, v in old.get((la, lo), {}).items() if t >= keep_from}
        if time.time() > t_end:
            # tiden är slut: behåll tidigare data för resten av punkterna
            series[(la, lo)] = merged
            continue
        try:
            merged.update(fetch_point(la, lo))
            ok += 1
        except Exception as ex:  # noqa: BLE001
            print(f"  SMHI {la},{lo}: {ex}")
        # met.no ovanpå SMHI där den finns; vädersymbolen behålls från SMHI
        try:
            for t, v in fetch_point_met(la, lo).items():
                cur = dict(merged.get(t) or {})
                cur.update({k: x for k, x in v.items() if x is not None})
                merged[t] = cur
            met_ok += 1
        except Exception as ex:  # noqa: BLE001
            print(f"  met.no {la},{lo}: {ex}")
        series[(la, lo)] = merged
        time.sleep(0.15)
    ok += met_ok
    print(f"  met.no svarade för {met_ok} av {len(pts)} punkter", flush=True)
    if not ok:
        print("SMHI svarade inte, behåller gammal vinddata")
        return
    times = sorted({t for v in series.values() for t in v if t >= keep_from})
    keys = ["ws", "wd", "gust", "t", "pr", "sym"]

    def row(v):
        return [None if v.get(k) is None else (round(v[k], 1) if isinstance(v[k], float) else v[k]) for k in keys]

    out = {
        "created": utcnow().strftime("%Y-%m-%dT%H:%MZ"),
        "bounds": BOUNDS,
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
    dates = [str(t)[:10] for t in da["time"].values]
    src = "Copernicus Marine, havsmodell"
    try:
        v, nsat = blend_satellite(cm, kw, v, lat, lon, dates, start, today)
        if nsat:
            src = f"Copernicus Marine, havsmodell rättad mot satellit ({nsat} dagar)"
    except Exception as ex:  # noqa: BLE001
        print(f"  satellittemperatur kunde inte hämtas ({str(ex).splitlines()[0][:160]}), använder bara modellen")

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
        "dates": dates,
        "source": src,
        "t": base64.b64encode(q.tobytes()).decode("ascii"),
    }
    (DATA / "temp.json").write_text(json.dumps(out, separators=(",", ":")))
    print(f"  vattentemperatur sparad: {len(out['dates'])} dagar", flush=True)


def blend_satellite(cm, kw, v, lat, lon, dates, start, today):
    """Rättar havsmodellens yttemperatur mot satellitmätt yttemperatur (Copernicus, DMI, ca 2 km).
    Dagar med satellitdata får satellitens värde där det finns; prognosdagarna efter får skillnaden
    mellan satellit och modell från sista satellitdagen, avtagande med 15 % per dag."""
    import numpy as np
    sat = cm.open_dataset(dataset_id=SST_DATASET, variables=["analysed_sst"],
                          minimum_longitude=float(lon.min()) - 0.05, maximum_longitude=float(lon.max()) + 0.05,
                          minimum_latitude=float(lat.min()) - 0.05, maximum_latitude=float(lat.max()) + 0.05,
                          start_datetime=f"{start}T00:00:00", end_datetime=f"{today}T23:59:59", **kw)
    if sat is None:
        return v, 0
    s = sat["analysed_sst"]
    sl = "latitude" if "latitude" in s.coords else "lat"
    so = "longitude" if "longitude" in s.coords else "lon"
    s = s.sortby(sl).sortby(so).load()
    slat, slon = s[sl].values.astype(float), s[so].values.astype(float)
    sv = s.transpose("time", sl, so).values.astype(float)
    if np.nanmean(sv) > 100:
        sv = sv - 273.15                                  # kelvin till grader
    iy = np.abs(slat[:, None] - lat[None, :]).argmin(axis=0)
    ix = np.abs(slon[:, None] - lon[None, :]).argmin(axis=0)
    sdates = [str(t)[:10] for t in s["time"].values]
    v = v.copy()
    last, diff, n = None, None, 0
    for k, d in enumerate(dates):
        if d in sdates:
            g = sv[sdates.index(d)][np.ix_(iy, ix)]
            ok = np.isfinite(g) & np.isfinite(v[k])
            if ok.sum() > 0:
                diff = np.where(ok, g - v[k], np.nan)
                v[k] = np.where(ok, g, v[k])
                last, n = k, n + 1
        elif last is not None and k > last and diff is not None:
            mean = np.nanmean(diff)
            dd = np.where(np.isfinite(diff), diff, mean)
            v[k] = v[k] + dd * 0.85 ** (k - last)
    print(f"  satellittemperatur: {n} dagar, medelskillnad mot modellen {np.nanmean(diff) if diff is not None else 0:+.1f} grader", flush=True)
    return v, n


def ensure_names():
    """Hämtar namnlagret om det saknas eller om urvalet av namn har ändrats."""
    from common import MASK
    p, v = MASK / "namn.json", MASK / "namn.ver"
    try:
        import build_mask
        current = v.exists() and v.read_text().strip() == str(build_mask.NAMES_VERSION)
    except Exception:  # noqa: BLE001
        current = False
    if p.exists() and current:
        return
    try:
        import build_mask
        with_time_limit(10 * 60, build_mask.build_names)
    except Exception as ex:  # noqa: BLE001
        print(f"Namn kunde inte hämtas ({ex}), försöker igen nästa körning")


def ensure_private():
    """Bygger zonerna runt hus och bryggor om de saknas, högst 10 minuter per körning.
    Färdiga delar sparas, så att nästa körning fortsätter där den här slutade."""
    from common import MASK
    if (MASK / "privat" / "info.json").exists():
        return
    try:
        import build_mask
        with_time_limit(14 * 60, lambda: build_mask.build_private(10 * 60))
    except Exception as ex:  # noqa: BLE001
        print(f"Hemfridszoner kunde inte byggas ({ex}), försöker igen nästa körning")


# ------------------------------------------------------------------- djup

EMOD = "https://erddap.emodnet.eu/erddap/griddap/bathymetry_dtm_2024.csv"


def ensure_depth():
    """Hämtar djupdata från EMODnet Bathymetry (DTM 2024) en gång och sparar som data/djup.json.
    Varannan punkt hämtas (ca 115 x 230 m), vilket ändå är tätare än det svenska underlaget."""
    p = DATA / "djup.json"
    if p.exists():
        try:
            if json.loads(p.read_text()).get("bounds") == BOUNDS:
                return
        except Exception:  # noqa: BLE001
            pass
    import csv
    import io
    import urllib.parse
    try:
        import numpy as np
    except ImportError:
        print("numpy saknas, hoppar över djupdata")
        return
    w, s, e, n = BOUNDS
    step = 1 if (e - w) * (n - s) < 0.2 else 2   # litet område: full upplösning
    sel = f"[({s}):{step}:({n})][({w}):{step}:({e})]"
    url = EMOD + "?" + urllib.parse.quote(f"elevation{sel},interpolation_flag{sel}", safe=":(),=.")
    print("Hämtar djupdata från EMODnet ...", flush=True)
    req = urllib.request.Request(url, headers={"User-Agent": "skargardskartan/1.0"})
    with urllib.request.urlopen(req, timeout=240) as r:
        text = r.read().decode("utf-8")
    rows = csv.reader(io.StringIO(text))
    head = next(rows)
    next(rows)  # enheter
    ia, io_, ie, iflag = head.index("latitude"), head.index("longitude"), head.index("elevation"), head.index("interpolation_flag")
    pts = []
    for row in rows:
        try:
            el = float(row[ie]) if row[ie] not in ("", "NaN") else float("nan")
            fl = int(row[iflag]) if row[iflag] not in ("", "NaN") else 1
            pts.append((float(row[ia]), float(row[io_]), el, fl))
        except (ValueError, IndexError):
            continue
    lats = np.array(sorted({q[0] for q in pts}))
    lons = np.array(sorted({q[1] for q in pts}))
    li = {v: k for k, v in enumerate(lats)}
    lo = {v: k for k, v in enumerate(lons)}
    depth = np.full((len(lats), len(lons)), np.nan)
    measured = np.zeros((len(lats), len(lons)), dtype=bool)
    for la, lon, el, fl in pts:
        y, x = li[la], lo[lon]
        if el == el and el < 0:
            depth[y, x] = -el
            measured[y, x] = fl == 0
    # fyll rutor utan djup (land och strandnära rutor) från grannarna, så att appen alltid
    # har ett värde under sin egen, noggrannare kustlinje
    filled = np.isfinite(depth)
    if not filled.any():
        print("  EMODnet gav inga djup, hoppar över")
        return
    v = np.where(filled, depth, 0.0)
    ny, nx = v.shape
    for _ in range(400):
        if filled.all():
            break
        fp = np.pad(filled, 1)
        vp = np.pad(v, 1)
        s_ = np.zeros_like(v)
        c = np.zeros_like(v)
        for dy, dx in [(1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)]:
            ys, xs = slice(1 + dy, 1 + dy + ny), slice(1 + dx, 1 + dx + nx)
            c += fp[ys, xs]
            s_ += vp[ys, xs] * fp[ys, xs]
        new = (~filled) & (c > 0)
        if not new.any():
            break
        v[new] = s_[new] / c[new]
        filled |= new
    q = np.clip(np.round(v * 2), 0, 254).astype("uint8")  # halvmeter, upp till 127 m
    out = {
        "created": utcnow().strftime("%Y-%m-%dT%H:%MZ"),
        "source": "EMODnet Bathymetry DTM 2024",
        "bounds": BOUNDS,
        "lat0": float(lats[0]), "lon0": float(lons[0]),
        "dlat": float(np.median(np.diff(lats))), "dlon": float(np.median(np.diff(lons))),
        "ny": int(ny), "nx": int(nx),
        "d": base64.b64encode(q.tobytes()).decode("ascii"),
        "m": base64.b64encode(np.packbits(measured.ravel()).tobytes()).decode("ascii"),
    }
    p.write_text(json.dumps(out, separators=(",", ":")))
    print(f"  djup sparat: {ny} x {nx} punkter, {int(measured.sum())} med lodningar", flush=True)


def data_age_h():
    """Hur många timmar sedan vinddatan hämtades senast (None om den saknas)."""
    try:
        c = json.loads((DATA / "wind.json").read_text())["created"]
        t = dt.datetime.strptime(c, "%Y-%m-%dT%H:%MZ").replace(tzinfo=dt.timezone.utc)
        return (utcnow() - t).total_seconds() / 3600
    except Exception:  # noqa: BLE001
        return None


def with_time_limit(seconds, fn):
    """Kör fn men avbryter efter angiven tid, så att körningen aldrig fastnar."""
    import signal

    def stop(*_):
        raise TimeoutError(f"tog längre än {seconds // 60} minuter")
    old = signal.signal(signal.SIGALRM, stop)
    signal.alarm(seconds)
    try:
        fn()
    except TimeoutError as ex:
        print(f"  avbröts: {ex}, behåller tidigare data")
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, old)


if __name__ == "__main__":
    DATA.mkdir(exist_ok=True)
    manual = os.environ.get("GITHUB_EVENT_NAME") == "workflow_dispatch"
    age = data_age_h()
    try:
        same_area = json.loads((DATA / "wind.json").read_text()).get("bounds") == BOUNDS
    except Exception:  # noqa: BLE001
        same_area = False
    if manual and same_area and age is not None and age < FRESH_H:
        print(f"Manuell körning och datan är {age:.1f} timmar gammal: hoppar över vind och vattentemperatur")
    else:
        update_wind()
        with_time_limit(TEMP_BUDGET_S, update_temp)
    ensure_names()
    try:
        import osm_detalj
        with_time_limit(8 * 60, lambda: osm_detalj.build(6 * 60))
    except Exception as ex:  # noqa: BLE001
        print(f"Detaljer från OpenStreetMap kunde inte hämtas ({ex}), försöker igen nästa körning")
    try:
        with_time_limit(5 * 60, ensure_depth)
    except Exception as ex:  # noqa: BLE001
        print(f"Djupdata kunde inte hämtas ({ex}), försöker igen nästa körning")
    try:
        import lm_coast
        with_time_limit(18 * 60, lambda: lm_coast.build(15 * 60))
    except Exception as ex:  # noqa: BLE001
        print(f"Lantmäteriets kustlinje kunde inte tas fram ({ex}), försöker igen nästa körning")
    try:
        import trad
        with_time_limit(10 * 60, lambda: trad.build(8 * 60))
    except Exception as ex:  # noqa: BLE001
        print(f"Trädhöjd kunde inte hämtas ({ex}), läet räknas med skog från OpenStreetMap")
    try:
        import vind_la
        with_time_limit(12 * 60, lambda: vind_la.build(10 * 60))
    except Exception as ex:  # noqa: BLE001
        print(f"Lä för vinden kunde inte räknas ({ex}), försöker igen nästa körning")
    try:
        import swan_run
        with_time_limit(28 * 60, lambda: swan_run.build_swan(25 * 60))
    except Exception as ex:  # noqa: BLE001
        print(f"SWAN kunde inte köras ({ex}), försöker igen nästa körning")
    try:
        import vag_fas
        with_time_limit(14 * 60, lambda: vag_fas.build(12 * 60))
    except Exception as ex:  # noqa: BLE001
        print(f"Vågfaserna kunde inte räknas ({ex}), försöker igen nästa körning")
    if manual:
        print("Manuell körning: hemfridszonerna byggs i de automatiska körningarna")
    else:
        ensure_private()
