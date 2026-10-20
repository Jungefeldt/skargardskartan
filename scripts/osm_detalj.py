#!/usr/bin/env python3
"""
osm_detalj.py

Detaljer för land från OpenStreetMap: hus (som ytor), bryggor och pirar, vägar och stigar, samt
marktyper (bebyggelse, skog, öppen mark, åker, berg i dagen, våtmark, strand) och vassbälten
(natural=wetland + wetland=reedbed, inritade från flygbilder), vägnamn och platser (färjeläge, hamn,
båtramp, bränsle, affär, restaurang, badplats, camping, boende, toalett, parkering). Används för att rita
en karta i Lantmäteriets stil ovanpå appens egen kustlinje.

Hela skärgården delas i rutor om 0,1 x 0,05 grader (ca 5,5 x 5,5 km). Rutorna hämtas från Overpass
i tur och ordning, närmast Furusundsleden (Stockholm, Vaxholm, Trälhavet, Furusund, Kapellskär) först,
och varje färdig ruta sparas direkt som data/osm/r/{x}_{y}.json, så att nästa körning fortsätter där
den förra slutade och appen kan använda det som är klart. data/osm/index.json listar färdiga rutor.
En ruta som Overpass inte orkar med i en fråga hämtas i fyra delar. När alla rutor finns hämtas den
äldsta om, så att kartan hålls aktuell (varje ruta ungefär en gång i månaden).
Koordinater sparas som heltal i hundratusendels grader relativt rutans sydvästra hörn.
Datan är © OpenStreetMaps bidragsgivare, ODbL.
"""
import json
import math
import time

from common import AREA, DATA

VERSION = 5
OUT_DIR = DATA / "osm" / "r"
INDEX = DATA / "osm" / "index.json"
LEGACY = [DATA / "osm" / "detalj.json", DATA / "osm" / "delar"]   # den gamla filen för testområdet
TLON, TLAT = 0.1, 0.05             # rutstorlek i grader
SCALE = 100000                     # hundratusendels grader (ca 1 m)
REFRESH_DAYS = 30
# Furusundsleden och Trälhavet: rutorna närmast den här linjen hämtas först
ROUTE = [(59.325, 18.08), (59.36, 18.20), (59.402, 18.352), (59.447, 18.392), (59.50, 18.55),
         (59.58, 18.75), (59.664, 18.918), (59.72, 19.07)]

# marktyper: OSM-taggar -> klass i kartan
LAND = {
    ("landuse", "residential"): "bebyggd", ("landuse", "commercial"): "bebyggd", ("landuse", "retail"): "bebyggd",
    ("landuse", "industrial"): "industri", ("landuse", "farmland"): "aker", ("landuse", "meadow"): "oppen",
    ("landuse", "grass"): "oppen", ("landuse", "forest"): "skog", ("natural", "wood"): "skog",
    ("natural", "scrub"): "oppen", ("natural", "heath"): "oppen", ("natural", "grassland"): "oppen",
    ("natural", "bare_rock"): "berg", ("natural", "wetland"): "vatmark", ("natural", "beach"): "strand",
    ("natural", "sand"): "strand", ("leisure", "park"): "oppen", ("leisure", "golf_course"): "oppen",
}
ROADS = {"motorway": 1, "trunk": 1, "primary": 1, "secondary": 1, "tertiary": 2, "unclassified": 2,
         "residential": 2, "service": 3, "living_street": 2, "track": 3,
         "footway": 4, "path": 4, "cycleway": 4, "bridleway": 4, "steps": 4}


def poi(t):
    """Platstyp för symbolerna i kartan, eller None."""
    a, le, sh, to = t.get("amenity"), t.get("leisure"), t.get("shop"), t.get("tourism")
    if a == "ferry_terminal":
        return "farja"
    if le == "marina":
        return "hamn"
    if le == "slipway":
        return "ramp"
    if a == "fuel" or t.get("waterway") == "fuel":
        return "bransle"
    if sh in ("supermarket", "convenience"):
        return "affar"
    if a in ("restaurant", "cafe"):
        return "mat"
    if le == "bathing_place":
        return "bad"
    if to == "camp_site":
        return "camping"
    if to in ("guest_house", "hotel", "hostel"):
        return "boende"
    if a == "toilets":
        return "wc"
    if a == "parking":
        return "parkering"
    return None


def log(*a):
    print(*a, flush=True)


def query(s, w, n, e):
    bb = f"({s},{w},{n},{e})"
    return f"""[out:json][timeout:120];
(
  way["building"]{bb};
  way["man_made"~"^(pier|quay|breakwater|groyne)$"]{bb};
  way["highway"~"^({'|'.join(ROADS)})$"]{bb};
  way["landuse"~"^(residential|commercial|retail|industrial|farmland|meadow|grass|forest)$"]{bb};
  way["natural"~"^(wood|scrub|heath|grassland|bare_rock|wetland|beach|sand)$"]{bb};
  way["leisure"~"^(park|golf_course)$"]{bb};
  relation["landuse"~"^(residential|forest|farmland|meadow)$"]{bb};
  relation["natural"~"^(wood|scrub|wetland|bare_rock)$"]{bb};
  relation["building"]{bb};
  nwr["leisure"~"^(marina|slipway|bathing_place)$"]{bb};
  nwr["amenity"~"^(ferry_terminal|fuel|restaurant|cafe|toilets|parking)$"]{bb};
  nwr["shop"~"^(supermarket|convenience)$"]{bb};
  nwr["tourism"~"^(camp_site|guest_house|hotel|hostel)$"]{bb};
  node["waterway"="fuel"]{bb};
);
out geom qt;"""


def grid():
    w, s, e, n = AREA
    return math.ceil((e - w) / TLON - 1e-9), math.ceil((n - s) / TLAT - 1e-9)


def _seg_km(p, a, b):
    """Avstånd i km från punkten p till sträckan a-b (lat, lon)."""
    k = math.cos(math.radians(p[0]))
    ax, ay, bx, by, px, py = a[1] * k, a[0], b[1] * k, b[0], p[1] * k, p[0]
    dx, dy = bx - ax, by - ay
    f = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy or 1)))
    return math.hypot(px - ax - f * dx, py - ay - f * dy) * 111.32


def order():
    """Alla rutor, närmast Furusundsleden först."""
    w, s, _, _ = AREA
    nx, ny = grid()
    out = []
    for x in range(nx):
        for y in range(ny):
            c = (s + (y + .5) * TLAT, w + (x + .5) * TLON)
            out.append((min(_seg_km(c, ROUTE[i], ROUTE[i + 1]) for i in range(len(ROUTE) - 1)), x, y))
    return [(x, y) for _, x, y in sorted(out)]


def fetch(s, w, n, e, depth=0):
    """Overpass-svaret för rutan; delas i fyra om servern inte orkar med hela."""
    import build_mask
    try:
        return build_mask.overpass(query(round(s, 5), round(w, 5), round(n, 5), round(e, 5)),
                                   timeout=150, attempts=1 if depth == 0 else 2).get("elements", [])
    except Exception:  # noqa: BLE001
        if depth >= 1:
            raise
    els, seen = [], set()
    ms, mw = (s + n) / 2, (w + e) / 2
    for a, b, c, d in ((s, w, ms, mw), (s, mw, ms, e), (ms, w, n, mw), (ms, mw, n, e)):
        for el in fetch(a, b, c, d, depth + 1):
            k = (el.get("type"), el.get("id"))
            if k not in seen:
                seen.add(k)
                els.append(el)
        time.sleep(1)
    return els


def tile_data(els, w0, s0):
    """Objekten i en ruta i appens kompakta format."""
    enc = lambda g: [v for p in g for v in (round((p["lon"] - w0) * SCALE), round((p["lat"] - s0) * SCALE))]
    out = {"b": [], "p": [], "v": [], "l": [], "q": []}
    for el in els:
        t = el.get("tags", {})
        pt = poi(t)
        if pt:                                       # plats: en punkt (mitten av ytan för vägar och ytor)
            if el["type"] == "node":
                lon, lat = el["lon"], el["lat"]
            else:
                g = el.get("geometry") or [p for m in el.get("members", []) for p in (m.get("geometry") or [])]
                lon = sum(p["lon"] for p in g) / len(g) if g else None
                lat = sum(p["lat"] for p in g) / len(g) if g else None
            if lon is not None:
                c = enc([{"lon": lon, "lat": lat}])
                out["q"].append([pt, c[0], c[1], t.get("name", "")])
            if el["type"] == "node":
                continue
        if el["type"] == "way" and el.get("geometry"):
            geoms = [el["geometry"]]
        elif el["type"] == "relation":
            geoms = [m["geometry"] for m in el.get("members", []) if m.get("role") == "outer" and m.get("geometry")]
        else:
            geoms = []
        if "building" in t:
            kind, cls = "b", 0
        elif t.get("man_made") in ("pier", "quay", "breakwater", "groyne"):
            kind, cls = "p", 0
        elif t.get("highway") in ROADS:
            kind, cls = "v", ROADS[t["highway"]]
        elif pt and not any(k in t for k in ("landuse", "natural")):
            continue
        elif t.get("natural") == "wetland" and t.get("wetland") == "reedbed":
            kind, cls = "l", "vass"
        else:
            cls = next((v for (k, val), v in LAND.items() if t.get(k) == val), None)
            kind = "l"
            if not cls:
                continue
        for g in geoms:
            if len(g) < 2:
                continue
            c = enc(g)
            if kind in ("b", "p"):
                out[kind].append(c)
            elif kind == "v":
                nm = t.get("name", "")
                out[kind].append([cls, c, nm] if nm else [cls, c])
            else:
                out[kind].append([cls, c])
    return out


def build(budget_s=6 * 60):
    t_end = time.time() + budget_s
    w, s, e, n = AREA
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    try:
        idx = json.loads(INDEX.read_text())
        if idx.get("version") != VERSION or idx.get("area") != AREA:
            idx = None
    except Exception:  # noqa: BLE001
        idx = None
    if idx is None:
        idx = {"version": VERSION, "area": AREA, "lon0": w, "lat0": s, "dlon": TLON, "dlat": TLAT, "done": {}}
    done = idx["done"]
    nx, ny = grid()
    now = time.time()
    # först rutor som saknas (närmast leden först), sedan de äldsta när allt finns
    todo = [(x, y) for x, y in order() if f"{x}_{y}" not in done]
    if not todo:
        old = sorted(done.items(), key=lambda kv: kv[1])
        todo = [tuple(int(v) for v in k.split("_")) for k, tt in old if now - tt > REFRESH_DAYS * 86400]
    if not todo:
        return
    log(f"Detaljer från OpenStreetMap: {nx * ny - len([k for k in done])} av {nx * ny} rutor kvar att hämta första gången")
    got = 0
    for x, y in todo:
        if time.time() > t_end:
            log("  tiden slut, fortsätter nästa körning")
            break
        s0, w0 = s + y * TLAT, w + x * TLON
        try:
            els = fetch(s0, w0, s0 + TLAT, w0 + TLON)
        except Exception as ex:  # noqa: BLE001
            log(f"  ruta {x}_{y}: {str(ex)[:100]}, försöker igen nästa körning")
            continue
        d = tile_data(els, w0, s0)
        (OUT_DIR / f"{x}_{y}.json").write_text(json.dumps(dict(d, o=[round(w0, 5), round(s0, 5)], scale=SCALE), separators=(",", ":")))
        done[f"{x}_{y}"] = int(time.time())
        INDEX.write_text(json.dumps(idx, separators=(",", ":")))   # efter varje ruta, så att appen ser det som är klart
        got += 1
        log(f"  ruta {x}_{y}: {len(d['b'])} hus, {len(d['v'])} vägar, {len(d['l'])} ytor, {len(d['q'])} platser")
        time.sleep(1)
    log(f"Detaljer från OpenStreetMap: {got} rutor hämtade, {len(done)} av {nx * ny} klara")
    # den gamla detaljfilen för testområdet behövs inte när rutorna runt Trälhavet finns
    if len(done) >= 40:
        import shutil
        for p in LEGACY:
            if p.is_dir():
                shutil.rmtree(p, ignore_errors=True)
            elif p.exists():
                p.unlink()


if __name__ == "__main__":
    build()
