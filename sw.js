// Sparar appen, kustmasken och datan i telefonen, så att kartan startar snabbt och fungerar med
// dålig täckning.
//  - Appen (sidan och skripten): från nätet om det svarar inom 2,5 s, annars den sparade kopian.
//  - Vind och vattentemperatur: den sparade kopian direkt om den är yngre än 30 minuter, annars
//    från nätet om det svarar inom 3 s, annars den sparade kopian.
//  - Kustmasken och övrig data (djup, lä, SWAN, höjdkurvor, detaljkarta, namn): den sparade kopian
//    direkt, och en ny hämtas i bakgrunden om kopian är äldre än 6 timmar. Att en kartruta saknas
//    (till exempel zoner där det inte finns några hus) sparas också, så att den inte efterfrågas igen.
//  - Kartbilder från OpenStreetMap och kartbiblioteket: sparad kopia först.
// Eget djup (GitHub) och fartyg (AIS) går alltid direkt till nätet.
const APP="app-v6",DATA="data-v1",MASKC="mask-v1",TILES="tiles-v2";
const KEEP=[APP,DATA,MASKC,TILES],MAX={[TILES]:4000,[MASKC]:30000};
const STALE_MS=6*3600*1000,FRESH_MS=30*60*1000;
const SHELL=["./","index.html","js/grund.js","js/rita.js","js/relief.js","js/lager.js","js/ui.js","app.css","manifest.webmanifest","icon.svg",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js","https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(APP).then(c=>c.addAll(SHELL)).catch(()=>{}).then(()=>self.skipWaiting()))});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>!KEEP.includes(k)).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
let trimming=false;
async function trim(name){if(trimming||!MAX[name])return;trimming=true;
  try{const c=await caches.open(name),k=await c.keys();for(let i=0;i<k.length-MAX[name];i++)await c.delete(k[i])}finally{trimming=false}}
// sparar svaret med tidpunkten, så att det går att se hur gammal kopian är
async function store(name,req,res){if(!res||!(res.ok||res.type==="opaque"||(name===MASKC&&res.status===404)))return;
  try{const c=await caches.open(name);
    if(res.type==="opaque"){await c.put(req,res);return}
    const h=new Headers(res.headers);h.set("sw-saved",String(Date.now()));
    await c.put(req,new Response(await res.blob(),{status:res.status,statusText:res.statusText,headers:h}));trim(name)}catch(_){}}
const key=req=>new Request(req.url.split("#")[0]);
// nätet först, men aldrig längre än ms: då sparad kopia (nätets svar sparas ändå när det kommer)
function netFirst(e,name,ms){const req=e.request,k=key(req);
  const net=fetch(req,{cache:"no-cache"}).then(r=>{e.waitUntil(store(name,k,r.clone()));return r});
  return new Promise(res=>{let done=false;const fin=r=>{if(!done&&r){done=true;res(r)}};
    const t=setTimeout(()=>caches.match(k).then(fin),ms);
    net.then(r=>{clearTimeout(t);fin(r)}).catch(()=>{clearTimeout(t);caches.match(k).then(h=>fin(h||Response.error()))})})}
// sparad kopia direkt; uppdateras i bakgrunden om den är för gammal
async function cacheFirst(e,name,staleMs){const req=e.request,k=key(req),c=await caches.open(name),hit=await c.match(k);
  const refresh=()=>fetch(req,{cache:"no-cache"}).then(r=>store(name,k,r.clone()).then(()=>r));
  if(hit){const saved=+hit.headers.get("sw-saved")||0;if(staleMs&&Date.now()-saved>staleMs)e.waitUntil(refresh().catch(()=>{}));return hit}
  try{return await refresh()}catch(_){return Response.error()}}
self.addEventListener("fetch",e=>{const req=e.request;if(req.method!=="GET")return;const u=new URL(req.url);
  // eget djup och fartyg: alltid direkt
  if(u.hostname==="api.github.com"||u.hostname.endsWith("workers.dev"))return;
  if(u.origin!==self.location.origin){
    if(u.hostname.includes("openstreetmap.org")||u.hostname==="cdnjs.cloudflare.com")e.respondWith(cacheFirst(e,TILES,0));
    return}
  const p=u.pathname;
  if(p.includes("/mask/")){e.respondWith(cacheFirst(e,MASKC,STALE_MS));return}
  if(/\/data\/(wind|temp)\.json$/.test(p)){e.respondWith(caches.match(key(req)).then(h=>{const saved=h&&+h.headers.get("sw-saved")||0;
      if(h&&Date.now()-saved<FRESH_MS){e.waitUntil(fetch(req,{cache:"no-cache"}).then(r=>store(DATA,key(req),r)).catch(()=>{}));return h}
      return netFirst(e,DATA,3000)}));return}
  if(p.includes("/data/")){e.respondWith(cacheFirst(e,DATA,STALE_MS));return}
  e.respondWith(netFirst(e,APP,2500))});
