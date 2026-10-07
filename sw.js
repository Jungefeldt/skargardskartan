// Sparar appen, datan och kartbilder du har tittat på, så att kartan fungerar med dålig täckning.
// Appen, datan och kustmasken hämtas alltid från nätet först, så att ändringar syns direkt;
// sparade kopior används bara när nätet saknas. Bakgrundskartorna sparas och återanvänds.
const APP="app-v5",TILES="tiles-v2",MAXTILES=4000;
const SHELL=["./","index.html","js/grund.js","js/rita.js","js/relief.js","js/lager.js","js/ui.js","app.css","manifest.webmanifest","icon.svg",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js","https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(APP).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==APP&&k!==TILES).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
async function trim(){const c=await caches.open(TILES),k=await c.keys();for(let i=0;i<k.length-MAXTILES;i++)await c.delete(k[i])}
// nätet först, sparad kopia om nätet inte svarar
const netFirst=(req,cache)=>fetch(req,{cache:"no-cache"}).then(r=>{if(r.ok){const cp=r.clone();caches.open(cache).then(c=>c.put(req,cp))}return r}).catch(()=>caches.match(req));
self.addEventListener("fetch",e=>{const u=new URL(e.request.url);if(e.request.method!=="GET")return;
  // bakgrundskartor och sjömärken: sparad kopia först
  if(u.hostname.includes("openstreetmap.org")||u.hostname.includes("openseamap.org")){
    e.respondWith(caches.open(TILES).then(async c=>{const hit=await c.match(e.request);if(hit)return hit;
      try{const r=await fetch(e.request);if(r.ok||r.type==="opaque"){c.put(e.request,r.clone());trim()}return r}catch(_){return hit||Response.error()}}));return}
  // kustmasken, datan och appen: alltid senaste versionen
  if(u.pathname.includes("/mask/")){e.respondWith(netFirst(e.request,TILES));return}
  e.respondWith(netFirst(e.request,APP))});
