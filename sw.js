// Sparar appen, datan och kartbilder du har tittat på, så att kartan fungerar med dålig täckning.
const APP="app-v3",TILES="tiles-v1",MAXTILES=4000;
const SHELL=["./","index.html","app.js","app.css","manifest.webmanifest","icon.svg",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js","https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(APP).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==APP&&k!==TILES).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
async function trim(){const c=await caches.open(TILES),k=await c.keys();for(let i=0;i<k.length-MAXTILES;i++)await c.delete(k[i])}
self.addEventListener("fetch",e=>{const u=new URL(e.request.url);if(e.request.method!=="GET")return;
  // data: nätet först, sparad kopia om det inte går
  if(u.pathname.includes("/data/")){e.respondWith(fetch(e.request).then(r=>{const cp=r.clone();caches.open(APP).then(c=>c.put(e.request,cp));return r}).catch(()=>caches.match(e.request)));return}
  // kartbilder och mask: sparad kopia först
  if(u.hostname.includes("openstreetmap.org")||u.hostname.includes("openseamap.org")||u.pathname.includes("/mask/")){
    e.respondWith(caches.open(TILES).then(async c=>{const hit=await c.match(e.request);if(hit)return hit;
      try{const r=await fetch(e.request);if(r.ok||r.type==="opaque"){c.put(e.request,r.clone());trim()}return r}catch(_){return hit||Response.error()}}));return}
  // appen: sparad kopia, uppdateras i bakgrunden
  e.respondWith(caches.match(e.request).then(hit=>{const net=fetch(e.request).then(r=>{if(r.ok){const cp=r.clone();caches.open(APP).then(c=>c.put(e.request,cp))}return r}).catch(()=>hit);return hit||net}))});
