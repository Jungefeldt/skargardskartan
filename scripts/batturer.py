#!/usr/bin/env python3
"""
batturer.py

Båtturer enligt tidtabell, så att kartan kan visa vart Waxholmsbåtar och andra skärgårdsbåtar är
på väg och hur försenade de är. Tidtabellerna hämtas från Trafiklab (GTFS Regional, öppna data,
CC0): SL:s tidtabell (där Waxholmsbolagets och SL:s pendelbåtar ingår) och Strömmas.

Alla båtlinjer (GTFS route_type 4 och 1000-1099, eller 1200) med någon brygga i området tas med.
Resultat: data/batturer.json med bryggorna och turerna i dag och de två kommande dagarna, tider
i sekunder efter midnatt svensk tid (kan vara över 24 timmar för turer som går över midnatt).

Nyckel: miljövariabeln TRAFIKLAB_KEY (GTFS Regional Static). Den enklaste nivån tillåter 50 hämtningar
i månaden; skriptet hämtar en gång per dygn och feed.
"""
import csv
import datetime as dt
import io
import json
import os
import sys
import time
import urllib.request
import zipfile

from common import AREA, CACHE, DATA

FEEDS = ["sl", "stromma"]
URL = "https://opendata.samtrafiken.se/gtfs/{op}/{op}.zip?key={key}"
DAYS = 3
VERSION = 1


def log(*a):
    print(*a, flush=True)


def is_ferry(rt):
    try:
        rt = int(rt)
    except ValueError:
        return False
    return rt == 4 or 1000 <= rt < 1100 or rt == 1200


def local_today():
    # svensk tid: UTC+1, sommartid UTC+2 (sista söndagen i mars till sista söndagen i oktober)
    now = dt.datetime.now(dt.timezone.utc)
    y = now.year

    def last_sunday(m):
        d = dt.datetime(y, m, 31 if m in (3, 10) else 30, 1, tzinfo=dt.timezone.utc)
        return d - dt.timedelta(days=(d.weekday() + 1) % 7)
    dst = last_sunday(3) <= now < last_sunday(10)
    return (now + dt.timedelta(hours=2 if dst else 1)).date()


def download(op, key):
    CACHE.mkdir(exist_ok=True)
    p = CACHE / f"gtfs_{op}.zip"
    req = urllib.request.Request(URL.format(op=op, key=key), headers={"User-Agent": "skargardskartan/1.0", "Accept-Encoding": "gzip"})
    with urllib.request.urlopen(req, timeout=300) as r:
        data = r.read()
    if data[:2] == b"\x1f\x8b":
        import gzip
        data = gzip.decompress(data)
    p.write_bytes(data)
    return p


def rows(z, name):
    if name not in z.namelist():
        return
    with z.open(name) as f:
        yield from csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig"))


def hms(s):
    h, m, sec = (int(x) for x in s.split(":"))
    return h * 3600 + m * 60 + sec


def extract(path, dates, stops_out, stop_idx, routes_out, route_idx, trips_out):
    """Lägger till båtturerna i en GTFS-fil till de gemensamma listorna."""
    w, s, e, n = AREA
    with zipfile.ZipFile(path) as z:
        agency = {r["agency_id"]: r.get("agency_name", "") for r in rows(z, "agency.txt")}
        routes = {}
        for r in rows(z, "routes.txt"):
            if is_ferry(r.get("route_type", "")):
                routes[r["route_id"]] = (r.get("route_short_name", "") or "", r.get("route_long_name", "") or "",
                                         agency.get(r.get("agency_id", ""), ""))
        if not routes:
            return 0
        dset = {d.strftime("%Y%m%d"): i for i, d in enumerate(dates)}
        service_days = {}
        for r in rows(z, "calendar_dates.txt"):
            if r.get("date") in dset and r.get("exception_type", "1") == "1":
                service_days.setdefault(r["service_id"], []).append(dset[r["date"]])
        trips = {}
        for r in rows(z, "trips.txt"):
            if r["route_id"] in routes and r["service_id"] in service_days:
                trips[r["trip_id"]] = (r["route_id"], r.get("trip_headsign", "") or "", service_days[r["service_id"]])
        if not trips:
            return 0
        stops = {}
        for r in rows(z, "stops.txt"):
            try:
                stops[r["stop_id"]] = (r.get("stop_name", ""), float(r["stop_lat"]), float(r["stop_lon"]))
            except (KeyError, ValueError):
                continue
        st = {}
        for r in rows(z, "stop_times.txt"):
            t = r.get("trip_id")
            if t not in trips:
                continue
            tt = r.get("arrival_time") or r.get("departure_time")
            dep = r.get("departure_time") or tt
            if not tt:
                continue
            st.setdefault(t, []).append((int(r.get("stop_sequence", 0)), r["stop_id"], hms(tt), hms(dep)))
    count = 0
    for t, lst in st.items():
        lst.sort()
        pts = [(stops.get(sid), a, d) for _, sid, a, d in lst if stops.get(sid)]
        if len(pts) < 2 or not any(w <= p[0][2] <= e and s <= p[0][1] <= n for p in pts):
            continue
        rid, head, days = trips[t]
        if rid not in route_idx:
            route_idx[rid] = len(routes_out)
            routes_out.append(list(routes[rid]))
        seq = []
        for (name, la, lo), a, d in pts:
            k = (name, round(la, 4), round(lo, 4))
            if k not in stop_idx:
                stop_idx[k] = len(stops_out)
                stops_out.append([name, round(la, 5), round(lo, 5)])
            seq += [stop_idx[k], a, d]
        head = head or pts[-1][0][0]
        for di in days:
            trips_out.append([route_idx[rid], head, di, seq])
            count += 1
    return count


def build():
    key = os.environ.get("TRAFIKLAB_KEY", "").strip()
    if not key:
        log("Båtturer: TRAFIKLAB_KEY saknas, hoppar över")
        return
    out_p = DATA / "batturer.json"
    today = local_today()
    try:
        old = json.loads(out_p.read_text())
        if old.get("version") == VERSION and old.get("dates", [None])[0] == today.strftime("%Y%m%d"):
            return                                   # redan hämtat i dag
    except Exception:  # noqa: BLE001
        pass
    dates = [today + dt.timedelta(days=i) for i in range(DAYS)]
    stops, stop_idx, routes, route_idx, trips = [], {}, [], {}, []
    for op in FEEDS:
        try:
            t0 = time.time()
            p = download(op, key)
            n = extract(p, dates, stops, stop_idx, routes, route_idx, trips)
            log(f"Båtturer: {op}: {n} turer ({time.time() - t0:.0f} s)")
        except Exception as ex:  # noqa: BLE001
            log(f"Båtturer: {op} kunde inte hämtas ({str(ex)[:160]})")
    if not trips:
        log("Båtturer: inga turer hittades, behåller tidigare fil")
        return
    out = {"version": VERSION, "created": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
           "source": "Trafiklab GTFS Regional (SL, Strömma), CC0", "dates": [d.strftime("%Y%m%d") for d in dates],
           "stops": stops, "routes": routes, "trips": trips}
    DATA.mkdir(exist_ok=True)
    out_p.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    log(f"Båtturer: {len(trips)} turer, {len(stops)} bryggor, {len(routes)} linjer sparade")


if __name__ == "__main__":
    sys.exit(build())
