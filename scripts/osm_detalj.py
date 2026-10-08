#!/usr/bin/env python3
"""
osm_detalj.py

Detaljer för land från OpenStreetMap: hus (som ytor), bryggor och pirar, vägar och stigar, samt
marktyper (bebyggelse, skog, öppen mark, åker, berg i dagen, våtmark, strand). Används för att rita
en karta i Lantmäteriets stil ovanpå appens egen kustlinje och terräng.

Hämtas i små rutor från Overpass, så att servrarna inte överbelastas, och sparas kompakt i
data/osm/detalj.json: koordinater som heltal i hundratusendels grader relativt områdets sydvästra
hörn. Hämtas om en gång i veckan, eller när området ändras. Datan är © OpenStreetMaps bidragsgivare,
ODbL.
"""
import json
import time

from common import BOUNDS, DATA

OUT = DATA / "osm" / "detalj.json"
VERSION = 1
MAX_AGE_DAYS = 7
NX, NY = 4, 3                      # rutor över området
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
);
out geom qt;"""


def build(budget_s=6 * 60):
    import build_mask
    t_end = time.time() + budget_s
    w0, s0, e0, n0 = BOUNDS
    try:
        old = json.loads(OUT.read_text())
        fresh = time.time() - old.get("t", 0) < MAX_AGE_DAYS * 86400
        if old.get("version") == VERSION and old.get("bounds") == BOUNDS and fresh:
            return
    except Exception:  # noqa: BLE001
        pass
    enc = lambda g: [v for p in g for v in (round((p["lon"] - w0) * SCALE), round((p["lat"] - s0) * SCALE))]
    out = {"b": [], "p": [], "v": [], "l": []}
    seen = set()
    dx, dy = (e0 - w0) / NX, (n0 - s0) / NY
    log(f"Detaljer från OpenStreetMap: {NX * NY} rutor")
    for j in range(NY):
        for i in range(NX):
            if time.time() > t_end:
                log("  tiden slut, försöker igen nästa körning")
                return
            s, w = s0 + j * dy, w0 + i * dx
            try:
                els = build_mask.overpass(query(round(s, 5), round(w, 5), round(s + dy, 5), round(w + dx, 5)),
                                          timeout=150, attempts=2).get("elements", [])
            except Exception as ex:  # noqa: BLE001
                log(f"  ruta {i},{j}: {str(ex)[:100]}, försöker igen nästa körning")
                return
            n = 0
            for el in els:
                key = (el["type"], el["id"])
                if key in seen:
                    continue
                seen.add(key)
                t = el.get("tags", {})
                geoms = []
                if el["type"] == "way" and el.get("geometry"):
                    geoms = [el["geometry"]]
                elif el["type"] == "relation":
                    geoms = [m["geometry"] for m in el.get("members", []) if m.get("role") == "outer" and m.get("geometry")]
                for g in geoms:
                    if len(g) < 2:
                        continue
                    c = enc(g)
                    if "building" in t:
                        out["b"].append(c)
                    elif t.get("man_made") in ("pier", "quay", "breakwater", "groyne"):
                        out["p"].append(c)
                    elif t.get("highway") in ROADS:
                        out["v"].append([ROADS[t["highway"]], c])
                    else:
                        cls = next((v for (k, val), v in LAND.items() if t.get(k) == val), None)
                        if cls:
                            out["l"].append([cls, c])
                    n += 1
            log(f"  ruta {i},{j}: {n} objekt")
            time.sleep(1)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(dict(out, version=VERSION, bounds=BOUNDS, origin=[w0, s0], scale=SCALE, t=int(time.time()),
                                   source="© OpenStreetMaps bidragsgivare, ODbL"), separators=(",", ":")))
    log(f"Detaljer från OpenStreetMap: {len(out['b'])} hus, {len(out['p'])} bryggor och pirar, "
        f"{len(out['v'])} vägar och stigar, {len(out['l'])} markytor, {OUT.stat().st_size // 1024} kB")


if __name__ == "__main__":
    build()
