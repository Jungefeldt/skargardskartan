// Skärgårdskartan: mellanstation för AIS (Cloudflare Worker)
//
// aisstream.io tillåter inte anslutning direkt från en webbläsare, så den här lilla tjänsten ansluter
// i stället, lyssnar några sekunder och lämnar över fartygen som JSON till kartan. Fartyg som ligger
// still rapporterar sällan, så de senaste positionerna sparas i minnet (och i KV om det är kopplat)
// i upp till 15 minuter.
//
// Inställningar i Cloudflare (Workers & Pages > din worker > Settings > Variables and Secrets):
//   AISSTREAM_KEY  (Secret)  din nyckel från aisstream.io
//   AIS            (valfri KV-koppling under Bindings) gör att fartyg som ligger still finns kvar
//                  även när Cloudflare startar om tjänsten

const AREA = [[59.15, 18.0], [60.5, 19.4]];      // Stockholms skärgård (lat, lon), samma som kartans område
const LISTEN_MS = 7000;                           // hur länge varje anrop lyssnar
const REFRESH_MS = 12000;                         // lyssna inte oftare än så, svara med det sparade emellan
const KEEP_MS = 15 * 60 * 1000;                   // glöm fartyg som inte hörts av på 15 minuter
const ORIGINS = ["https://jungefeldt.github.io"]; // sidor som får använda tjänsten

let SHIPS = null, LAST = 0, KV_SAVED = 0;

function cors(req) {
  const o = req.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": ORIGINS.includes(o) || o.startsWith("http://localhost") ? o : ORIGINS[0],
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Vary": "Origin",
  };
}

function handle(raw) {
  let m;
  try { m = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw)); } catch (_) { return; }
  const md = m.MetaData || {}, id = md.MMSI;
  if (!id) return;
  const s = SHIPS[id] || (SHIPS[id] = { id });
  if (md.ShipName && md.ShipName.trim()) s.n = md.ShipName.trim();
  const msg = m.Message || {};
  const p = msg.PositionReport || msg.StandardClassBPositionReport || msg.ExtendedClassBPositionReport;
  if (p && md.latitude != null && md.longitude != null && Math.abs(md.latitude) <= 90) {
    s.lat = +md.latitude.toFixed(5); s.lon = +md.longitude.toFixed(5);
    s.sog = p.Sog != null && p.Sog < 102.3 ? p.Sog : null;
    s.cog = p.Cog != null && p.Cog < 360 ? p.Cog : null;
    s.hdg = p.TrueHeading != null && p.TrueHeading < 360 ? p.TrueHeading : null;
    if (p.NavigationalStatus != null) s.nav = p.NavigationalStatus;
    s.b = !msg.PositionReport;                    // klass B (mindre fartyg och båtar)
    s.t = Date.now();
  }
  const st = msg.ShipStaticData || (msg.StaticDataReport && msg.StaticDataReport.ReportB);
  if (st) {
    if (st.Type != null) s.type = st.Type;
    if (st.ShipType != null) s.type = st.ShipType;
    const d = st.Dimension; if (d && d.A != null) s.len = d.A + d.B;
    if (st.Destination && st.Destination.trim()) s.dest = st.Destination.trim();
    if (st.Name && st.Name.trim()) s.n = st.Name.trim();
  }
}

async function listen(env) {
  const r = await fetch("https://stream.aisstream.io/v0/stream", { headers: { Upgrade: "websocket" } });
  const ws = r.webSocket;
  if (!ws) throw new Error("aisstream svarade inte med en WebSocket (" + r.status + ")");
  ws.accept();
  ws.send(JSON.stringify({ APIKey: env.AISSTREAM_KEY, BoundingBoxes: [AREA],
    FilterMessageTypes: ["PositionReport", "StandardClassBPositionReport", "ExtendedClassBPositionReport", "ShipStaticData", "StaticDataReport"] }));
  await new Promise(res => {
    const t = setTimeout(res, LISTEN_MS);
    ws.addEventListener("message", ev => handle(ev.data));
    ws.addEventListener("close", () => { clearTimeout(t); res(); });
    ws.addEventListener("error", () => { clearTimeout(t); res(); });
  });
  try { ws.close(1000, "klar"); } catch (_) {}
}

export default {
  async fetch(req, env, ctx) {
    const h = cors(req);
    if (req.method === "OPTIONS") return new Response(null, { headers: h });
    if (!env.AISSTREAM_KEY) return new Response(JSON.stringify({ error: "AISSTREAM_KEY saknas" }), { status: 500, headers: { ...h, "Content-Type": "application/json" } });
    if (!SHIPS) { SHIPS = {}; if (env.AIS) { try { SHIPS = (await env.AIS.get("ships", "json")) || {}; } catch (_) {} } }
    const now = Date.now();
    let err = null;
    if (now - LAST > REFRESH_MS) { LAST = now; try { await listen(env); } catch (e) { err = String(e.message || e); } }
    for (const k in SHIPS) if (!SHIPS[k].t || now - SHIPS[k].t > KEEP_MS) delete SHIPS[k];
    // spara till KV högst en gång i minuten (gratisnivån tillåter 1 000 skrivningar per dygn)
    if (env.AIS && now - KV_SAVED > 60000) { KV_SAVED = now; ctx.waitUntil(env.AIS.put("ships", JSON.stringify(SHIPS), { expirationTtl: 3600 })); }
    const ships = Object.values(SHIPS).filter(s => s.lat != null);
    return new Response(JSON.stringify({ t: now, err, ships }), { headers: { ...h, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  },
};
