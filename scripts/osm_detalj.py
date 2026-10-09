#!/usr/bin/env python3
"""
osm_detalj.py

Detaljer för land från OpenStreetMap: hus (som ytor), bryggor och pirar, vägar och stigar, samt
marktyper (bebyggelse, skog, öppen mark, åker, berg i dagen, våtmark, strand) och vassbälten
(natural=wetland + wetland=reedbed, inritade från flygbilder), vägnamn och platser (färjeläge, hamn,
båtramp, bränsle, affär, restaurang, badplats, camping, boende, toalett, parkering). Används för att rita
en karta i Lantmäteriets stil ovanpå appens egen kustlinje och terräng.

Hämtas i små rutor från Overpass, så att servrarna inte överbelastas. Varje färdig ruta sparas för
sig, så att nästa körning fortsätter där den förra slutade. När alla är klara läggs de ihop kompakt i
data/osm/detalj.json: koordinater som heltal i hundratusendels grader relativt områdets sydvästra
hörn. Hämtas om en gång i veckan, eller när området ändras. Datan är © OpenStreetMaps bidragsgivare,
ODbL.
"""
import json
import time

from common import BOUNDS, DATA

OUT = DATA / "osm" / "detalj.json"
VERSION = 4
MAX_AGE_DAYS = 7
NX, NY = 6, 4                      # rutor över området
PARTS = DATA / "osm" / "delar"     # färdiga rutor sparas här, så att nästa körning fortsätter där den slutade
SCALE = 100000                     # hundratusendels grader (ca 1 m)

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


def build(budget_s=6 * 60):
    import build_mask
    t_end = time.time() + budget_s
    w0, s0, e0, n0 = BOUNDS
    stamp = json.dumps({"version": VERSION, "bounds": BOUNDS})
    try:
        old = json.loads(OUT.read_text())
        if old.get("version") == VERSION and old.get("bounds") == BOUNDS:
            if time.time() - old.get("t", 0) < MAX_AGE_DAYS * 86400:
                return
            for p in PARTS.glob("*.json"):              # en vecka gammal: hämta om alla rutor
                p.unlink()
    except Exception:  # noqa: BLE001
        pass
    enc = lambda g: [v for p in g for v in (round((p["lon"] - w0) * SCALE), round((p["lat"] - s0) * SCALE))]
    dx, dy = (e0 - w0) / NX, (n0 - s0) / NY
    PARTS.mkdir(parents=True, exist_ok=True)

    def done(i, j):
        p = PARTS / f"{i}_{j}.json"
        try:
            return json.loads(p.read_text()).get("stamp") == stamp
        except Exception:  # noqa: BLE001
            return False
    todo = [(i, j) for j in range(NY) for i in range(NX) if not done(i, j)]
    log(f"Detaljer från OpenStreetMap: {len(todo)} av {NX * NY} rutor kvar")
    for i, j in todo:
        if time.time() > t_end:
            log("  tiden slut, fortsätter nästa körning")
            return
        s, w = s0 + j * dy, w0 + i * dx
        try:
            els = build_mask.overpass(query(round(s, 5), round(w, 5), round(s + dy, 5), round(w + dx, 5)),
                                      timeout=150, attempts=2).get("elements", [])
        except Exception as ex:  # noqa: BLE001
            log(f"  ruta {i},{j}: {str(ex)[:100]}, försöker igen nästa körning")
            continue
        # varje objekt: [id, slag, klass, koordinater, namn]; id med ringnummer, så att flerdelade ytor behålls
        items = []
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
                    items.append([f"q{el['type'][0]}{el['id']}", "q", pt, enc([{"lon": lon, "lat": lat}]), t.get("name", "")])
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
            for gi, g in enumerate(geoms):
                if len(g) >= 2:
                    items.append([f"{el['type'][0]}{el['id']}.{gi}", kind, cls, enc(g), t.get("name", "") if kind == "v" else ""])
        (PARTS / f"{i}_{j}.json").write_text(json.dumps({"stamp": stamp, "items": items}, separators=(",", ":")))
        log(f"  ruta {i},{j}: {len(items)} objekt")
        time.sleep(1)
    if any(not done(i, j) for j in range(NY) for i in range(NX)):
        log("  alla rutor är inte klara än, fortsätter nästa körning")
        return
    # alla rutor klara: lägg ihop (objekt som korsar rutgränser finns i flera rutor och tas bara en gång)
    out = {"b": [], "p": [], "v": [], "l": [], "q": []}
    seen = set()
    for p in sorted(PARTS.glob("*.json")):
        for oid, kind, cls, c, name in json.loads(p.read_text())["items"]:
            if oid in seen:
                continue
            seen.add(oid)
            if kind in ("b", "p"):
                out[kind].append(c)
            elif kind == "v":
                out[kind].append([cls, c, name] if name else [cls, c])
            elif kind == "q":
                out[kind].append([cls, c[0], c[1], name])
            else:
                out[kind].append([cls, c])
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(dict(out, version=VERSION, bounds=BOUNDS, origin=[w0, s0], scale=SCALE, t=int(time.time()),
                                   source="© OpenStreetMaps bidragsgivare, ODbL"), separators=(",", ":")))
    log(f"Detaljer från OpenStreetMap: {len(out['b'])} hus, {len(out['p'])} bryggor och pirar, "
        f"{len(out['v'])} vägar och stigar, {len(out['l'])} markytor, {len(out['q'])} platser, {OUT.stat().st_size // 1024} kB")


if __name__ == "__main__":
    build()
