/* Skärgårdskartan, ui.js: Vindpilar, förklaring, tid, knappar, tryck på kartan, position och start.
   Filerna i js/ laddas i ordning från index.html och delar variabler med varandra. */
"use strict";
// ------------------------------------------------------------------ vindpilar
// Pilarna ligger kvar mellan omritningarna (en per prognospunkt). När tiden byts vrider de sig mjukt
// den kortaste vägen till den nya riktningen, färgen glider över och siffrorna räknas fram.
const arrowLayer=L.layerGroup().addTo(map),ARW=new Map();
function drawArrows(ui,shared){const boxes=shared?ui:(ui||[]).slice(),used=new Set();
  const add=(key,ll,wd,ws,gust,big)=>{const s=big?44:36,p=map.latLngToContainerPoint(ll),bx=[p.x-34,p.y-s/2,p.x+34,p.y+s/2+34];
    const sz=map.getSize();if(bx[0]<2||bx[1]<2||bx[2]>sz.x-2||bx[3]>sz.y-2)return;
    if(boxes.some(o=>bx[0]<o[2]&&bx[2]>o[0]&&bx[1]<o[3]&&bx[3]>o[1]))return false;arrowAt(key,ll,wd,ws,gust,big);used.add(key);boxes.push(bx);return true};
  const W=S.wind;
  if(!S.layers.arrows){}
  else if(S.src==="egen")add("egen",map.getCenter(),S.own.dir,S.own.sp,null,true);
  else if(W){const ki=k=>W.keys.indexOf(k),b=map.getBounds().pad(.05),z=map.getZoom(),every=z<=9?3:z<=10?2:1;
    let placed=0;
    W.points.forEach((p,i)=>{const r=W.series[i][S.ti];if(!r||r[ki("ws")]==null)return;const row=Math.round((p[0]-W.points[0][0])/0.1),col=Math.round((p[1]-W.points[0][1])/0.15);
      if(row%every||col%every)return;if(!b.contains(p))return;if(add("p"+i,L.latLng(p[0],p[1]),r[ki("wd")],r[ki("ws")],r[ki("gust")]))placed++});
    // inzoomat kan alla prognospunkter hamna utanför bilden: rita då en pil med vinden för platsen,
    // på en ledig plats så nära mitten som möjligt (helst över vatten)
    if(!placed){const sz=map.getSize(),cands=[];
      for(let gy=1;gy<8;gy++)for(let gx=1;gx<8;gx++){const pt=L.point(sz.x*gx/8,sz.y*gy/8),ll=map.containerPointToLatLng(pt);
        cands.push({ll,d:Math.hypot(pt.x-sz.x/2,pt.y-sz.y/2)+(onWater(ll)?0:1e4)})}
      cands.sort((a,c)=>a.d-c.d);
      for(const c of cands){const lw=windAt(c.ll.lat,c.ll.lng,S.ti);if(!lw||lw.ws==null)continue;if(add("mitt",c.ll,lw.wd,lw.ws,lw.gust))break}}}
  for(const [k,o] of ARW)if(!used.has(k)){cancelAnimationFrame(o.raf);arrowLayer.removeLayer(o.m);ARW.delete(k)}
  return boxes}
const arrowNum=(ws,gust)=>f0(ws)+(gust!=null?" ("+f0(gust)+")":"");
function arrowAt(key,ll,wd,ws,gust,big){const s=big?44:36,c=windCol(ws),o=ARW.get(key);
  if(!o||o.big!==big){if(o){cancelAnimationFrame(o.raf);arrowLayer.removeLayer(o.m)}
    const html=`<svg width="${s}" height="${s}" viewBox="-16 -16 32 32" style="transform:rotate(${wd+180}deg)"><path d="M0 -14 L9 4 L2.5 1.5 L2.5 13 L-2.5 13 L-2.5 1.5 L-9 4 Z" style="fill:${c}" stroke="#fff" stroke-width="2.4" stroke-linejoin="round" paint-order="stroke"/></svg><span style="border-color:${c}"><b>${arrowNum(ws,gust)}</b><em>${windTerm(ws).replace(" vind","").toLowerCase()}</em></span>`;
    const m=L.marker(ll,{pane:"lbl",interactive:false,keyboard:false,icon:L.divIcon({className:"arrow",html,iconSize:[76,s+34],iconAnchor:[38,s/2]})}).addTo(arrowLayer);
    ARW.set(key,{m,big,ang:wd+180,ws,gust,cw:ws,cg:gust,raf:0});return}
  if(!o.m.getLatLng().equals(ll))o.m.setLatLng(ll);
  const el=o.m.getElement();if(!el)return;
  const playing=typeof playT!=="undefined"&&!!playT,ms=playing?1150:700,tf=`${ms}ms ${playing?"linear":"ease-in-out"}`;
  const sv=el.querySelector("svg"),pa=el.querySelector("path"),sp=el.querySelector("span"),bb=el.querySelector("b"),em=el.querySelector("em");
  const ang=o.ang+((wd+180-o.ang)%360+540)%360-180;                 // kortaste vägen runt
  sv.style.transition=`transform ${tf}`;pa.style.transition=`fill ${tf}`;sp.style.transition=`border-color ${tf}`;
  sv.style.transform=`rotate(${ang}deg)`;pa.style.fill=c;sp.style.borderColor=c;
  em.textContent=windTerm(ws).replace(" vind","").toLowerCase();
  cancelAnimationFrame(o.raf);const w0=o.cw,g0=o.cg,t0=performance.now();
  // samma klocka hela vägen och andelen alltid mellan 0 och 1 (bildklockan kan ligga före t0)
  const step=()=>{let f=Math.max(0,Math.min(1,(performance.now()-t0)/ms));if(!playing)f=f*f*(3-2*f);
    o.cw=w0+(ws-w0)*f;o.cg=g0!=null&&gust!=null?g0+(gust-g0)*f:gust;bb.textContent=arrowNum(o.cw,o.cg);
    o.raf=f<1?requestAnimationFrame(step):0};
  o.raf=requestAnimationFrame(step);o.ang=ang;o.ws=ws;o.gust=gust}

// ------------------------------------------------------------------ förklaring
function legend(){const L_=$("legend"),w=laWind||domainWind(S.ti);let h="";
  if(S.find.on)h+=`<span><i style="background:rgba(214,24,138,.67)"></i>Uppfyller villkoren</span><span><i style="background:rgba(70,80,88,.37)"></i>Övrigt vatten</span>`;
  else if(S.layers.la&&(S.wstyle==="monster"||S.wstyle==="rorlig"))h+=LA_CLASSES.map((c,k)=>`<span>${wavePatternSVG(k)}${c[1]}</span>`).join("");
  else if(S.layers.la)h+=LA_CLASSES.map(c=>`<span><i style="background:${c[2]}"></i>${c[1]}</span>`).join("");
  else if(S.layers.temp&&tRange)h+=`<div class="grad" style="background:linear-gradient(90deg,${TSTOPS.map(s=>s[1]+" "+(s[0]/24*100)+"%").join(",")})"></div><div class="gl"><span>0</span><span>6</span><span>12</span><span>18</span><span>24 °C</span></div>`;
  if((S.layers.la||S.find.on)&&w)h=`<span><b>${dirName(w.wd)} ${f0(w.ws)} m/s${w.gust!=null?", byar "+f0(w.gust):""}</b>${S.src==="prognos"?" (medel för området) · räknat på "+(S.basis==="byar"&&w.gust!=null?"byar":"medelvind"):""}</span>`+h;
  if(S.privOk&&S.layers.priv)h+=`<span><i style="background:rgba(70,56,50,.65);border:2px solid #281E1C"></i>Inom ${S.privM} m från brygga eller hus</span>`;
  if((S.depth||S.depthP)&&S.layers.depth)h+=`<span style="flex:1 1 100%">Djup${S.depthP?" (eget djup där det finns, annars ungefärligt)":" (ungefärligt)"}: `+DEPTH_STEPS.map((d,k)=>`<i style="background:${DEPTH_COL[k]};margin:0 3px 0 6px"></i>${k===DEPTH_STEPS.length-1?d+"+":d}`).join("")+` m</span>`;
  if(S.layers.arrows)h+=`<span style="flex:1 1 100%">Vindpilar: `+[["svag",0],["måttlig",4],["frisk",8],["hård",14],["mycket hård",20]].map(x=>`<i style="background:${windCol(x[1])};margin:0 3px 0 6px;border-radius:50%;width:10px"></i>${x[0]}`).join("")+`</span>`;
  if((S.layers.temp||S.find.on)&&tRange)h+=`<span><i style="background:#0B3550;height:2px;border:0"></i>Vattentemp, zoner om ${tStep} °C (${f0(tRange[0])} till ${f0(tRange[1])} här)</span>`;
  if(S.layers.ais)h+=`<span style="flex:1 1 100%">Fartyg (AIS): `+[["passagerare","#1F5F82"],["last","#2E7D4F"],["tank","#B0412E"],["fiske","#7A5A2E"],["bogsering, lots","#8A6D00"],["fritid","#6A4C93"],["övriga","#555"]].map(x=>`<i style="background:${x[1]};margin:0 3px 0 6px;border-radius:50%;width:10px"></i>${x[0]}`).join("")+`</span>`;
  L_.innerHTML=h}

// ------------------------------------------------------------------ våghöjdsskala på kartan
// Fem rutor med sjögångens färger och vågmönster, gränserna i meter under, och en rad med vinden som
// kartan räknar med. Är allt vatten i bilden lä står det tydligt, så att det syns att kartan fungerar.
(()=>{const st=document.createElement("style");st.textContent=`.wscale{position:absolute;left:10px;bottom:calc(24px + env(safe-area-inset-bottom,0px));z-index:900;background:rgba(255,255,255,.92);border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.25);padding:6px 8px 4px;font:600 11px/1.2 system-ui,-apple-system,Segoe UI,sans-serif;color:#14222B;pointer-events:none}
.wscale .ws-st{margin-bottom:5px;white-space:nowrap}.wscale .ws-st b{font-size:12px}.wscale .ws-row{display:flex;gap:0}.wscale .ws-row svg{display:block}
.wscale .ws-ax{position:relative;height:13px;margin-top:2px}.wscale .ws-ax span{position:absolute;transform:translateX(-50%);font-weight:500;color:#40505A}`;document.head.appendChild(st)})();
function waveSwatch(k,w,h){const gap=[0,6,8,11,14][k];let d="";if(gap)for(let x0=3;x0<w;x0+=gap)d+=` M${x0} 1 Q${x0+k+1} ${h/2} ${x0} ${h-1}`;
  if(!k)return`<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${LA_SOLID[0]}"/><path d="M9 7 q2 -2.5 4 0 t4 0 t4 0" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/><path d="M9 7 q2 -2.5 4 0 t4 0 t4 0" fill="none" stroke="rgb(70,140,195)" stroke-width="1.2" stroke-linecap="round"/></svg>`;
  return`<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${LA_SOLID[k]}"/>${d?`<path d="${d}" fill="none" stroke="#11171c" stroke-opacity="${CREST_O[k]}" stroke-width="${Math.max(.7,CREST_W[k]*.8)}"/>`:""}</svg>`}
function waveScale(st,w){const el=$("wscale");if(!el)return;if(!st||!w){el.hidden=true;return}
  const U=S.src==="egen"?S.own.sp:w.ws,gust=S.src==="egen"?null:w.gust,wind=`${U<.5?"":dirName(w.wd)+" "}${f0(U)} m/s${gust!=null&&gust>U+.5?", byar "+f0(gust):""}`;
  const head=U<.5?`<b>Vindstilla</b>`:U<1.5?`<b>Nästan vindstilla</b> · ${wind}`:st.calm?`<b>Lä i hela bilden</b> · ${wind}`:`Vind ${wind}`;
  const W=34,ticks=["0,1","0,25","0,5","1 m"];
  el.innerHTML=`<div class="ws-st">${head}</div><div class="ws-row">${[0,1,2,3,4].map(k=>waveSwatch(k,W,14)).join("")}</div>`+
    `<div class="ws-ax" style="width:${5*W}px">${ticks.map((t,i)=>`<span style="left:${(i+1)*W}px">${t}</span>`).join("")}</div>`;
  // ovanför upphovsrättsraden, hur hög den än blir
  const at=document.querySelector(".leaflet-control-attribution");el.style.bottom=`calc(${(at?at.offsetHeight:18)+6}px + env(safe-area-inset-bottom,0px))`;
  el.hidden=false}

// ------------------------------------------------------------------ tid
const WD=["sön","mån","tis","ons","tor","fre","lör"],MON=["jan","feb","mar","apr","maj","jun","jul","aug","sep","okt","nov","dec"];
function fmtTime(iso){const d=new Date(iso);return WD[d.getDay()]+" "+d.getDate()+" "+MON[d.getMonth()]+" "+String(d.getHours()).padStart(2,"0")+":00"}
function nowIndex(){const W=S.wind;if(!W)return 0;const n=Date.now();let bi=0,bd=1e15;W.times.forEach((t,i)=>{const d=Math.abs(new Date(t).getTime()-n);if(d<bd){bd=d;bi=i}});return bi}
function setTime(i){const W=S.wind;if(!W)return;S.ti=Math.max(0,Math.min(W.times.length-1,i));$("time").value=S.ti;
  const t=new Date(W.times[S.ti]),fc=t.getTime()>Date.now()+30*6e4,past=t.getTime()<Date.now()-90*6e4;
  $("when").innerHTML=fmtTime(W.times[S.ti])+`<small class="${fc?"fc":""}">${fc?"prognos":past?"tidigare":"nu"}</small>`;
  schedule()}
$("time").oninput=e=>{stopPlay();setTime(+e.target.value)};
let playT=null;const PLAY_MS=800;
function stopPlay(){if(playT){clearInterval(playT);playT=null;$("play").textContent="▶";$("play").setAttribute("aria-label","Spela upp prognosen")}}
$("play").onclick=()=>{if(playT){stopPlay();return}const W=S.wind;if(!W)return;
  if(S.ti>=W.times.length-1)setTime(nowIndex());
  $("play").textContent="❚❚";$("play").setAttribute("aria-label","Pausa");
  // nästa timme tas när steget har gått och förra omräkningen är klar, så att takten blir jämn
  let last=performance.now();
  playT=setInterval(()=>{const now=performance.now();if(now-last<PLAY_MS||busy)return;last=now;
    if(S.ti>=S.wind.times.length-1){setTime(nowIndex());return}setTime(S.ti+1)},40)};
$("prev").onclick=()=>{stopPlay();setTime(S.ti-1)};$("next").onclick=()=>{stopPlay();setTime(S.ti+1)};$("now").onclick=()=>{stopPlay();setTime(nowIndex())};

// ------------------------------------------------------------------ kontroller
document.querySelectorAll("[data-layer]").forEach(b=>b.onclick=()=>{const k=b.dataset.layer;S.layers[k]=!S.layers[k];b.setAttribute("aria-pressed",S.layers[k]);
  if(k==="ais"){if(S.layers.ais)aisStart();else aisStop();try{localStorage.setItem("ais",S.layers.ais?"1":"")}catch(_){}}schedule()});
$("findbtn").onclick=()=>{S.find.on=!S.find.on;$("findbtn").setAttribute("aria-pressed",S.find.on);$("find").hidden=!S.find.on;schedule()};
document.querySelectorAll("[data-maxk]").forEach(b=>b.onclick=()=>{S.find.maxK=+b.dataset.maxk;document.querySelectorAll("[data-maxk]").forEach(x=>x.setAttribute("aria-checked",x===b));schedule()});
function syncFind(){$("tmin").value=S.find.tmin;$("tmax").value=S.find.tmax;$("tminv").textContent=f0(S.find.tmin)+" °C";$("tmaxv").textContent=f0(S.find.tmax)+" °C"}
function syncDepth(){$("dmin").value=S.find.dmin;$("dmax").value=S.find.dmax;$("dminv").textContent=S.find.dmin+" m";$("dmaxv").textContent=S.find.dmax>=60?"valfritt":S.find.dmax+" m"}
$("dmin").oninput=e=>{S.find.dmin=Math.min(+e.target.value,S.find.dmax);syncDepth();schedule()};
$("dmax").oninput=e=>{S.find.dmax=Math.max(+e.target.value,S.find.dmin);syncDepth();schedule()};syncDepth();
$("tmin").oninput=e=>{S.find.tmin=Math.min(+e.target.value,S.find.tmax);syncFind();schedule()};
$("tmax").oninput=e=>{S.find.tmax=Math.max(+e.target.value,S.find.tmin);syncFind();schedule()};
document.querySelectorAll("[data-land]").forEach(b=>b.onclick=()=>{S.land=b.dataset.land;syncBase();document.querySelectorAll("[data-land]").forEach(x=>x.setAttribute("aria-checked",x===b));try{localStorage.setItem("land",S.land)}catch(_){}schedule()});
try{const sv=localStorage.getItem("land");if(sv&&LANDCOL[sv]!==undefined||sv==="karta"){S.land=sv;document.querySelectorAll("[data-land]").forEach(x=>x.setAttribute("aria-checked",x.dataset.land===sv))}}catch(_){}
syncBase();
document.querySelectorAll("[data-basis]").forEach(b=>b.onclick=()=>{S.basis=b.dataset.basis;document.querySelectorAll("[data-basis]").forEach(x=>x.setAttribute("aria-checked",x===b));try{localStorage.setItem("basis",S.basis)}catch(_){}schedule()});
try{const sb=localStorage.getItem("basis");if(sb==="medel"||sb==="byar"){S.basis=sb;document.querySelectorAll("[data-basis]").forEach(x=>x.setAttribute("aria-checked",x.dataset.basis===sb))}}catch(_){}
$("explain").onclick=()=>{let h=`<h3>Färger för lä och sjögång</h3><p class="note" style="margin-top:2px;padding-right:44px">Klassen bestäms av uppskattad våghöjd (signifikant våghöjd, ungefär medelhöjden av den högsta tredjedelen av vågorna). Den räknas från vindstyrkan och hur mycket öppet vatten det finns mot vinden, högst 6 km.</p>
    <table class="deftab"><tr><th>Klass</th><th>Våg</th><th>Så känns det</th></tr>`+LA_CLASSES.map((c,i)=>`<tr><td><i style="background:${c[2]}"></i>${c[1]}</td><td>${LA_DEF[i][0]}</td><td>${LA_DEF[i][1]}</td></tr>`).join("")+`</table>
    <h3>Räkna på byar eller medelvind</h3><p class="note" style="margin-top:2px"><b>Byar</b> (förvalt) räknar vågorna på den starkaste vinden i prognosen. Det ger en försiktig bild, bra när du ska ligga still och fiska. <b>Medelvind</b> stämmer bättre med hur vågorna oftast blir, men underskattar läget när det är byigt.</p>
    <h3>Vindstyrka (SMHI)</h3><table class="deftab"><tr><th>Benämning</th><th>m/s</th></tr><tr><td>Lugnt</td><td>0–0,2</td></tr><tr><td>Svag vind</td><td>0,3–3</td></tr><tr><td>Måttlig vind</td><td>4–7</td></tr><tr><td>Frisk vind</td><td>8–13</td></tr><tr><td>Hård vind</td><td>14–19</td></tr><tr><td>Mycket hård vind</td><td>20–24</td></tr><tr><td>Storm</td><td>25–32</td></tr></table>
    <h3>Vågmönster</h3><p class="note" style="margin-top:2px">Ovanpå färgerna ligger vågkammarna som linjer, tvärs mot vågornas gång. Där det finns beräkningar från vågmodellen SWAN (TU Delft) följer linjerna modellens vågriktning, som tar hänsyn till lä bakom öar, refraktion mot grunt vatten och diffraktion runt uddar. Tätare och tunnare linjer betyder mindre vågor, glesare och kraftigare linjer större vågor. I lä ritas inga linjer.</p>
    <h3>Lä för vinden</h3><p class="note" style="margin-top:2px">Bakom öar, uddar och skog är vinden svagare. Dämpningen räknas från markhöjden i Lantmäteriets höjdmodell och trädhöjden: störst närmast hindret, och vinden är nästan tillbaka efter 20 till 30 gånger hindrets höjd. Uppskruvad vind runt uddar och i smala sund ingår inte.</p>
    <h3>Höjdkurvor</h3><p class="note" style="margin-top:2px">Höjdkurvorna på land kommer från Lantmäteriets laserskannade höjdmodell. Avståndet mellan kurvorna är 10 m, och 5 m när man zoomat in; var femte kurva är kraftigare.</p>
    <h3>Detaljkarta</h3><p class="note" style="margin-top:2px"><b>Detalj</b> ritar hus, bryggor, vägar med namn, stigar, skog, bebyggelse, vassbälten och platser (färjeläge, hamn, båtramp, bränsle, affär, restaurang, badplats med mera) från OpenStreetMap i samma stil som Lantmäteriets karta, ovanpå appens egen kustlinje. Hur detaljerat det blir beror på hur väl området är karterat.</p>
    <h3>Eget djup</h3><p class="note" style="margin-top:2px">Med <b>Eget djup</b> längst ner i panelen kopplar du in ett eget, privat djup (till exempel uträknat från sjökortsbilder). Det hämtas från ett privat förråd med en nyckel som bara sparas i den här webbläsaren, och används där det finns; utanför används EMODnet.${S.depthP?" Eget djup är kopplat.":""}</p>
    <h3>Fartyg (AIS)</h3><p class="note" style="margin-top:2px">Med <b>Fartyg</b> visas fartyg som sänder AIS, till exempel färjor, Waxholmsbåtar och fraktfartyg, via en egen mellanstation och aisstream.io. Fartygen visas ungefär en halv minut i efterhand och flyttas längs sitt verkliga spår, så att de svänger där fartyget svängde. Pilar är fartyg i rörelse, prickar ligger still, och strecket bakom visar var fartyget har åkt de senaste 30 minuterna. Waxholmsbåtar och andra skärgårdsbåtar matchas mot tidtabellerna från Trafiklab (SL och Strömma), och då visas turens slutstation, nästa brygga och ungefärlig försening. De flesta fritidsbåtar har inte AIS, och täckningen beror på frivilliga mottagare. Får inte användas för navigering.</p>
    <h3>Djup</h3><p class="note" style="margin-top:2px">Djupzonerna kommer från EMODnet Bathymetry (DTM 2024). I svenska vatten är underlaget medvetet glesat av sekretesskäl, så djupen är ungefärliga: bra för att skilja grunda vikar från djupa fjärdar, men enskilda grund, kanter och smala sund syns inte. "Nära lodning" betyder att det finns en verklig mätning i närheten, "uppskattat" att djupet är uträknat från omgivningen.</p>
    <p class="note">Uppskattningen tar inte hänsyn till dyning, strömmar eller båttrafik, och vågor böjer runt små öar. Använd den som stöd, inte för navigering.</p>`;
  $("sheetc").innerHTML=h;$("sheet").classList.add("open")};
document.querySelectorAll("[data-src]").forEach(b=>b.onclick=()=>{S.src=b.dataset.src;document.querySelectorAll("[data-src]").forEach(x=>x.setAttribute("aria-checked",x===b));$("own").hidden=S.src!=="egen";schedule()});
$("hide").onclick=()=>{$("panel").classList.toggle("hidden");schedule()};
const DIR8=[["N",0],["NO",45],["O",90],["SO",135],["S",180],["SV",225],["V",270],["NV",315]];
$("dirs").innerHTML=DIR8.map(d=>`<button data-d="${d[1]}" aria-pressed="${d[1]===S.own.dir}" aria-label="Vind från ${d[0]}">${d[0]}</button>`).join("");
$("dirs").onclick=e=>{const b=e.target.closest("button");if(!b)return;S.own.dir=+b.dataset.d;$("dirs").querySelectorAll("button").forEach(x=>x.setAttribute("aria-pressed",x===b));schedule()};
$("sp").oninput=e=>{S.own.sp=+e.target.value;$("spv").textContent=S.own.sp+" m/s";schedule()};

// ------------------------------------------------------------------ tryck på kartan
let sel=null,pin=null,tapT=null;
map.on("dblclick",()=>clearTimeout(tapT));
map.on("click",e=>{clearTimeout(tapT);tapT=setTimeout(()=>{sel=e.latlng;if(pin)pin.setLatLng(sel);else pin=L.circleMarker(sel,{radius:7,weight:2.5,color:"#14222B",fillOpacity:0,interactive:false}).addTo(map);sheet()},250)});
$("close").onclick=()=>{$("sheet").classList.remove("open");sel=null;if(pin){map.removeLayer(pin);pin=null}};
function onWater(ll){const R=lastR;if(!R)return false;const p=CRS.latLngToPoint(ll,R.z),x=Math.floor(p.x-R.px0),y=Math.floor(p.y-R.py0);
  return x>=0&&y>=0&&x<R.W&&y<R.H&&!!R.water[y*R.W+x]}
function inPriv(ll){const R=lastR;if(!S.privOk||!R||!R.priv)return false;const p=CRS.latLngToPoint(ll,R.z),x=Math.floor(p.x-R.px0),y=Math.floor(p.y-R.py0);
  if(x<0||y<0||x>=R.W||y>=R.H)return false;const i=y*R.W+x;return !!(R.priv[i]&&R.water[i])}
function leeAt(ll){if(!laR||!laLee)return 1;const p=CRS.latLngToPoint(ll,laR.z),x=Math.floor(p.x-laR.px0),y=Math.floor(p.y-laR.py0);
  if(x<0||y<0||x>=laR.W||y>=laR.H)return 1;return laLee[y*laR.W+x]}
function laAt(ll){if(!laR||!laF)return null;const p=CRS.latLngToPoint(ll,laR.z),x=Math.floor(p.x-laR.px0),y=Math.floor(p.y-laR.py0);if(x<0||y<0||x>=laR.W||y>=laR.H)return null;
  const i=y*laR.W+x;return laR.water[i]?laF[i]:-1}
function sheet(){const ll=sel,W=S.wind,w=W?windAt(ll.lat,ll.lng,S.ti):null,di=tempDay(),wt=tempAt(ll.lat,ll.lng,di),la=laR?laAt(ll):null,lw=laWind;
  let h=`<h3>${fmtTime(W?W.times[S.ti]:new Date().toISOString())} · ${ll.lat.toFixed(4).replace(".",",")}° N ${ll.lng.toFixed(4).replace(".",",")}° E</h3>`;
  if(la===-1)h+=`<div class="big">Land</div>`;
  const lf=leeAt(ll),lu0=S.src==="egen"?S.own.sp:w?calcU(w):lw?calcU(lw):null,lu=lu0==null?null:lu0*lf;
  if(la===-1){h+=`<dl class="kv">`}else if(la!=null&&lu!=null){const hs=wave(lu,la);let k=0;while(hs>=LA_CLASSES[k][0])k++;
    h+=`<div class="big">${LA_CLASSES[k][1]} <small>${k===0?"":"ca "}${fmtWave(hs,k)} våg</small></div><dl class="kv"><dt>Öppet vatten mot vinden</dt><dd>${la>=CAP_M*0.98?"över 6 km":la<1000?f0(la/10)*10+" m":f1(la/1000)+" km"}</dd>`;}
  else h+=`<dl class="kv">`;
  if(w)h+=`<dt>Vind${S.src==="egen"?" (prognos)":""}</dt><dd>${dirName(w.wd)} ${f0(w.ws)} m/s${w.gust!=null?", byar "+f0(w.gust):""} <span style="font-weight:500;color:var(--muted)">(${windTerm(w.ws).toLowerCase()})</span></dd><dt>Luft</dt><dd>${f1(w.t)} °C</dd><dt>Nederbörd</dt><dd>${f1(w.pr)} mm/h</dd>`;
  if(lf<0.95&&lu0!=null&&la!==-1)h+=`<dt>Vind här</dt><dd>ca ${f0(lu)} m/s <span style="font-weight:500;color:var(--muted)">(lä bakom land och skog, ${Math.round((1-lf)*100)} % svagare)</span></dd>`;
  if(wt!=null)h+=`<dt>Vattentemp</dt><dd>${f0(wt)} °C</dd>`;
  const wet=la!=null?la>=0:onWater(ll);
  if(lastSW&&wet){const R2=lastSW.R,p=CRS.latLngToPoint(ll,R2.z),xx=Math.floor(p.x-R2.px0),yy=Math.floor(p.y-R2.py0);
    if(xx>=0&&yy>=0&&xx<R2.W&&yy<R2.H){const i=yy*R2.W+xx;if(lastSW.H[i]>=0&&lastSW.T[i]>=0)h+=`<dt>Vågor (SWAN)</dt><dd>ca ${f1(lastSW.H[i])} m, period ${f1(lastSW.T[i])} s, från ${dirName(lastSW.D[i])}</dd>`}}
  if((S.depth||S.depthP)&&wet){const own=ownDepth(ll.lat,ll.lng),d=own!=null?own:depthAt(ll.lat,ll.lng);
    if(d!=null)h+=`<dt>Djup</dt><dd>ca ${own!=null?f1(d):f0(d)} m <span style="font-weight:500;color:var(--muted)">(${own!=null?"eget djup":depthMeasured(ll.lat,ll.lng)?"nära lodning":"uppskattat"})</span></dd>`}
  if(S.find.on&&la!=null&&la>=0&&lu!=null&&wt!=null){let k=0;const hs=wave(lu,la);while(hs>=LA_CLASSES[k][0])k++;const ok=k<=S.find.maxK&&wt>=S.find.tmin&&wt<=S.find.tmax;h+=`<dt>Villkoren</dt><dd>${ok?"uppfylls":"uppfylls inte"}</dd>`}
  h+=`</dl>`;
  if(inPriv(ll))h+=`<p class="warn" style="background:rgba(60,50,45,.1);border-color:#3A322D">Inom ${S.privM} m från brygga eller hus. Här kan det vara hemfridszon, välj gärna en annan plats.</p>`;
  if(w&&la!=null&&la>=0){const g=w.gust!=null?w.gust:w.ws;if(g>=10)h+=`<p class="warn">Byar upp till ${f0(g)} m/s. Även i lä kan byarna slå ner över öarna och ge kraftig drift och snabba vindkast vid båten.</p>`}
  if(W){h+=`<div class="hours">`;for(let i=S.ti;i<W.times.length&&i<S.ti+30;i+=3){const x=windAt(ll.lat,ll.lng,i);if(!x)continue;const d=new Date(W.times[i]);
      h+=`<div>${String(d.getHours()).padStart(2,"0")}<b>${dirName(x.wd)} ${f0(x.ws)}</b>${x.gust!=null?"("+f0(x.gust)+")":""}</div>`}h+=`</div>`}
  if((S.depth||S.depthP)&&wet)h+=ownDepth(ll.lat,ll.lng)!=null?`<p class="note">Eget djup, uträknat från sjökortsbilder. Mellan djupkurvor och lodade djup är det uppskattat. Får inte användas för navigering.</p>`:`<p class="note">Djupet kommer från EMODnet och är grovt i svenska vatten (underlaget är glesat till ungefär 300 m). Grund och kanter syns inte. Får inte användas för navigering.</p>`;
  if(laR)h+=`<p class="note">Lä räknas från hur mycket öppet vatten som finns mot vinden (inom 6 km). Vågor böjer runt små öar, så verkligt lä är ofta något mindre än kartan visar.</p>`;
  $("sheetc").innerHTML=h;$("sheet").classList.add("open")}

// ------------------------------------------------------------------ eget djup (privat förråd)
// Djupet ligger i det privata förrådet Jungefeldt/djup-privat och hämtas med en nyckel (fine-grained
// token med läsrätt till just det förrådet). Nyckeln sparas bara i den här webbläsaren.
const OWN_DEPTH_URL="https://api.github.com/repos/Jungefeldt/djup-privat/contents/djup.json";
async function loadOwnDepth(quiet){let t=null;try{t=localStorage.getItem("djupNyckel")}catch(_){}
  if(!t){S.depthP=null;return}
  try{const r=await fetch(OWN_DEPTH_URL,{headers:{Authorization:"Bearer "+t,Accept:"application/vnd.github.raw+json"},cache:"no-cache"});
    if(r.status===401||r.status===403){toast("Nyckeln till eget djup fungerar inte");return}
    if(r.status===404){toast("Hittar inte djup.json i djup-privat");return}
    if(!r.ok)throw new Error(r.status);
    const G=await r.json(),dec=s=>{const b=atob(s),a=new Uint8Array(b.length);for(let i=0;i<b.length;i++)a[i]=b.charCodeAt(i);return a};
    G.D=dec(G.d);G.M=dec(G.m);delete G.d;delete G.m;S.depthP=G;$("depthchip")&&($("depthchip").hidden=false);$("depthfind")&&($("depthfind").hidden=false);
    if(!quiet)toast("Eget djup laddat");schedule()}
  catch(_){if(!quiet)toast("Eget djup kunde inte hämtas")}}
$("owndepth").onclick=()=>{let cur="";try{cur=localStorage.getItem("djupNyckel")||""}catch(_){}
  const v=window.prompt(cur?"Eget djup är kopplat. Klistra in en ny nyckel, eller töm fältet för att koppla bort:":"Klistra in nyckeln till det privata djupförrådet (djup-privat):",cur);
  if(v===null)return;try{if(v.trim())localStorage.setItem("djupNyckel",v.trim());else localStorage.removeItem("djupNyckel")}catch(_){}
  if(!v.trim()){S.depthP=null;toast("Eget djup bortkopplat");schedule();return}loadOwnDepth()};

// ------------------------------------------------------------------ fartyg (AIS)
// Fartygen hämtas var 15:e sekund från en egen mellanstation (Cloudflare Worker, se tools/ais-worker.js),
// eftersom aisstream.io inte tillåter anslutning direkt från webbläsaren. Fartygen visas AIS_LAG i
// efterhand och flyttas längs sitt verkliga spår, så att de svänger där fartyget svängde. Bara om
// positioner saknas gissas läget framåt, högst en minut, med fart, kurs och girhastighet.
const aisLayer=L.layerGroup().addTo(map),aisTrk=L.layerGroup().addTo(map),aisMk=new Map(),aisTr=new Map();let aisT=null,aisA=null,aisData=null;
const AIS_LAG=25000,AIS_GAP=120000,AIS_AHEAD=60000;
const aisNow=()=>aisData?aisData.t0+(Date.now()-aisData.loc):Date.now();
const bearing=(a,b)=>{const dx=(b[1]-a[1])*Math.cos(a[0]*Math.PI/180),dy=b[0]-a[0];return(Math.atan2(dx,dy)*180/Math.PI+360)%360};
// fartygets spårpunkter i tidsordning, med senaste rapporten sist
function aisPts(s){const h=(s.h||[]).filter(p=>p[0]!=null);const last=h[h.length-1];
  if(s.lat!=null&&(!last||s.t>last[2]))h.push([s.lat,s.lon,s.t]);return h}
// läget att visa: längs spåret vid tiden T (= nu minus AIS_LAG); efter sista punkten gissas det framåt
// med fart, kurs och girhastighet, högst AIS_AHEAD. Returnerar [lat, lon, ålder i s, riktning]
function aisPos(s){const now=aisNow(),T=now-AIS_LAG,h=aisPts(s),age=(now-s.t)/1000;
  if(!h.length)return[s.lat,s.lon,age,s.hdg!=null?s.hdg:s.cog||0];
  if(T<=h[0][2])return[h[0][0],h[0][1],age,h.length>1?bearing(h[0],h[1]):(s.hdg!=null?s.hdg:s.cog||0)];
  for(let i=h.length-2;i>=0;i--){const a=h[i],b=h[i+1];if(T<a[2])continue;if(T>b[2])break;
    if(b[2]-a[2]>AIS_GAP)return[b[0],b[1],age,bearing(a,b)];
    const f=(T-a[2])/Math.max(1,b[2]-a[2]);return[a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f,age,bearing(a,b)]}
  const p=h[h.length-1],dt=Math.min(AIS_AHEAD,T-p[2])/1000;let lat=p[0],lon=p[1],dir=s.cog!=null?s.cog:s.hdg!=null?s.hdg:null;
  if(dir==null&&h.length>1)dir=bearing(h[h.length-2],p);
  if(s.sog!=null&&s.sog>=.5&&dir!=null&&dt>0){const v=s.sog*KN,rot=s.rot||0;
    for(let k=0;k<dt;k++){const st=Math.min(1,dt-k),a=(dir+rot/60*st/2)*Math.PI/180;
      lat+=v*st*Math.cos(a)/111320;lon+=v*st*Math.sin(a)/(111320*Math.cos(lat*Math.PI/180));dir+=rot/60*st}}
  return[lat,lon,age,dir==null?0:(dir+360)%360]}
// spåret: var fartyget varit de senaste 30 minuterna, fram till där det visas nu; bryts vid luckor över 2 minuter
function aisTrack(s,lat,lon){const T=aisNow()-AIS_LAG,h=aisPts(s).filter(p=>p[2]<=T);if(!h.length)return[];const segs=[[]];let pt=null;
  for(const p of h){if(pt&&p[2]-pt[2]>AIS_GAP)segs.push([]);segs[segs.length-1].push([p[0],p[1]]);pt=p}
  const last=segs[segs.length-1];if(s.sog!=null&&s.sog>=.5&&T-h[h.length-1][2]<=AIS_GAP)last.push([lat,lon]);
  return segs.filter(g=>g.length>=2)}
// Cloudflare visar adressen utan https://, så det läggs till om det saknas
const fixUrl=v=>{v=(v||"").trim();return v&&!/^https?:\/\//i.test(v)?"https://"+v.replace(/^\/+/,""):v};
const aisUrl=()=>{try{return fixUrl(localStorage.getItem("aisUrl"))}catch(_){return""}};
function aisKind(t){if(t==null)return["okänd typ","#555"];if(t>=60&&t<70)return["passagerarfartyg","#1F5F82"];if(t>=70&&t<80)return["lastfartyg","#2E7D4F"];
  if(t>=80&&t<90)return["tankfartyg","#B0412E"];if(t===30)return["fiskefartyg","#7A5A2E"];if(t===31||t===32||t===52)return["bogserbåt","#8A6D00"];
  if(t===50)return["lotsbåt","#8A6D00"];if(t===51)return["räddningsfartyg","#8A6D00"];if(t===36)return["segelbåt","#6A4C93"];if(t===37)return["fritidsbåt","#6A4C93"];
  if(t>=40&&t<50)return["snabbgående fartyg","#1F5F82"];return["övrigt fartyg","#555"]}
const KN=.5144;
// namn med vanliga versaler och gemener: "VIKING CINDERELLA" blir "Viking Cinderella"
const shipName=n=>n?n.toLowerCase().replace(/(^|[\s\-\/.(])([a-zåäöéü])/g,(m,a,b)=>a+b.toUpperCase()).replace(/\b(Ab|Af|Ii|Iii|Iv|Mv|Ms)\b/g,x=>x.toUpperCase()):"";
// destinationen skrivs in för hand ombord; vanliga hamnkoder (UN/LOCODE) i Östersjön översätts till namn
const PORTS={SESTO:"Stockholm",SEKPS:"Kapellskär",SENYN:"Nynäshamn",SEVXO:"Vaxholm",SESOE:"Södertälje",SENOK:"Norrtälje",SEGRS:"Grisslehamn",
  SEHAN:"Hargshamn",SEOXE:"Oxelösund",SEVBY:"Visby",SEGVX:"Gävle",SEUME:"Umeå",SELLA:"Luleå",SEGOT:"Göteborg",SEMMA:"Malmö",SENRK:"Norrköping",
  FIMHQ:"Mariehamn",FILRS:"Långnäs",FIEKE:"Eckerö",FITKU:"Åbo",FIHEL:"Helsingfors",FINLI:"Nådendal",FIKOK:"Karleby",FIVAA:"Vasa",FIRAU:"Raumo",
  EETLL:"Tallinn",EEPLA:"Paldiski",LVRIX:"Riga",LVVNT:"Ventspils",LTKLJ:"Klaipėda",PLGDN:"Gdańsk",PLGDY:"Gdynia",DEROS:"Rostock",DEKEL:"Kiel",
  DETRV:"Travemünde",DKCPH:"Köpenhamn",RULED:"Sankt Petersburg",RUULU:"Ust-Luga"};
function shipDest(d){if(!d)return"";const s=d.trim().replace(/[>]+/g," > ").replace(/\s+/g," ");if(!s||/^[@.\s]*$/.test(s))return"";
  // "SE STO > FI MHQ" eller "SESTO-FIMHQ": sista hamnen är slutdestinationen
  const U=s.toUpperCase(),codes=[];for(const m of U.matchAll(/([A-Z]{2})[\s_]?([A-Z]{3})/g)){const k=m[1]+m[2];if(PORTS[k])codes.push(PORTS[k])}
  if(codes.length)return codes[codes.length-1];
  const parts=s.split(/\s*(?:=>|->|>|-|\/)\s*/).filter(Boolean);return shipName(parts[parts.length-1]||s)}
// ------------------------------------------------------------------ båtturer enligt tidtabell
// Waxholmsbåtar och andra skärgårdsbåtar matchas mot tidtabellerna (data/batturer.json, från Trafiklab):
// båtens spår de senaste minuterna jämförs med var varje tur borde vara enligt tidtabellen, med upp
// till 10 minuters försening eller tidigareläggning. Den tur som stämmer bäst väljs, om den stämmer
// tillräckligt bra. Matchningen sparas per fartyg och görs om var 30:e sekund.
let BT=null,btLoading=false;const btMatch=new Map();
function btLoad(){if(BT||btLoading)return;btLoading=true;
  getJSON("data/batturer.json").then(D=>{const S2=D.stops,base=D.dates.map(d=>new Date(+d.slice(0,4),+d.slice(4,6)-1,+d.slice(6,8)).getTime());
    BT=D.trips.map(([ri,head,di,seq])=>{const pts=[];for(let i=0;i<seq.length;i+=3){const s=S2[seq[i]];pts.push({n:s[0],lat:s[1],lon:s[2],a:base[di]+seq[i+1]*1000,d:base[di]+seq[i+2]*1000})}
      const r=D.routes[ri];return{route:r,head,pts,t0:pts[0].d,t1:pts[pts.length-1].a}});aisDraw()})
    .catch(()=>{btLoading=false})}
// var turen borde vara vid tiden t (enligt tidtabellen): vid bryggan under uppehållet, annars rakt emellan
function btPos(tr,t){const P=tr.pts;if(t<=P[0].d)return P[0];if(t>=P[P.length-1].a)return P[P.length-1];
  for(let i=0;i<P.length-1;i++){const a=P[i],b=P[i+1];if(t<=a.d)return a;if(t<b.a){const f=(t-a.d)/Math.max(1,b.a-a.d);return{lat:a.lat+(b.lat-a.lat)*f,lon:a.lon+(b.lon-a.lon)*f}}}
  return P[P.length-1]}
const distM=(a,b)=>Math.hypot((a.lat-b.lat)*111320,(a.lon-b.lon)*111320*Math.cos(a.lat*Math.PI/180));
function btFind(s){if(!BT)return null;const pass=s.type==null||(s.type>=60&&s.type<70)||(s.type>=40&&s.type<50);if(!pass||(s.len||0)>110)return null;
  const old=btMatch.get(s.id),now=aisNow();if(old&&now-old.at<30000)return old.m;
  const h=aisPts(s).filter(p=>now-p[2]<=12*60000);let m=null;
  if(h.length>=4&&h[h.length-1][2]-h[0][2]>=90000){
    const step=Math.max(1,Math.floor(h.length/10)),smp=h.filter((_,i)=>i%step===0||i===h.length-1).map(p=>({lat:p[0],lon:p[1],t:p[2]}));
    const moved=distM(smp[0],smp[smp.length-1])>150,last=smp[smp.length-1];let best=null;
    for(const tr of BT){if(now<tr.t0-20*60000||now>tr.t1+20*60000)continue;
      if(!tr.pts.some(p=>distM(p,last)<15000))continue;
      for(let sh=-10;sh<=10;sh++){const dl=sh*60000;let sum=0;for(const q of smp)sum+=distM(q,btPos(tr,q.t-dl));const sc=sum/smp.length;
        if(!best||sc<best.sc)best={tr,dl,sc}}}
    // tillräckligt nära, och båten har rört sig (en båt vid kaj kan passa vilken tur som helst)
    if(best&&best.sc<1200&&moved)m={tr:best.tr,delay:best.dl}}
  // utan ny matchning (till exempel vid brygga) behålls den senaste i högst 15 minuter
  const good=m||(old&&old.good&&now-old.goodAt<15*60000?old.good:null);
  btMatch.set(s.id,{at:now,m:good,good,goodAt:m?now:old?old.goodAt:0});return good}
function btNext(m){const ts=aisNow()-AIS_LAG-m.delay;return m.tr.pts.find(p=>p.a>=ts)||null}
const hhmm=t=>{const d=new Date(t);return String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0")};
function aisIcon(s,c,z,dir,left){const mv=s.sog!=null&&s.sog>=.5,big=(s.len||0)>=80,sz=big?32:24;
  const shape=mv?`<svg width="${sz}" height="${sz}" viewBox="-10 -10 20 20" style="transform:rotate(${dir.toFixed(0)}deg);transition:transform .8s"><path d="M0 -9 L6 7 L0 4 L-6 7 Z" fill="${c}" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/></svg>`
    :`<svg width="${sz*.7}" height="${sz*.7}" viewBox="-6 -6 12 12"><circle r="4.2" fill="${c}" stroke="#fff" stroke-width="1.6"/></svg>`;
  // namn och destination bredvid symbolen: till höger, eller till vänster nära kartans högra kant
  const bm=btFind(s),halo="text-shadow:0 0 2px #fff,0 0 2px #fff,0 0 3px #fff,0 0 4px #fff",dst=bm?bm.tr.head:shipDest(s.dest),off=(mv?sz:sz*.7)/2+3;
  const nm=z>=12&&s.n?`<span style="position:absolute;${left?`right:${off}px;text-align:right`:`left:${off}px`};top:50%;transform:translateY(-50%);white-space:nowrap;line-height:1.15;pointer-events:none">`+
    `<b style="display:block;font:700 12px system-ui;color:${c};${halo}">${esc(shipName(s.n))}</b>`+
    (dst&&z>=12?`<span style="display:block;font:600 10.5px system-ui;color:#2B3A44;${halo}">→ ${esc(dst)}</span>`:"")+`</span>`:"";
  return L.divIcon({className:"",html:`<div style="position:relative;transform:translate(-50%,-50%);display:inline-block">${shape}${nm}</div>`,iconSize:[0,0]})}
function aisDraw(){if(!aisData||!S.layers.ais)return;const z=map.getZoom(),b=map.getBounds().pad(.2),seen=new Set(),W=map.getSize().x;
  for(const s of aisData.ships){const [lat,lon,age,dir]=aisPos(s);if(age>900||!b.contains([lat,lon]))continue;seen.add(s.id);
    const left=map.latLngToContainerPoint([lat,lon]).x>W-190,bm=btFind(s);
    const [kind,c]=aisKind(s.type),key=[z>=12,s.sog!=null&&s.sog>=.5,Math.round(dir/3),c,(s.len||0)>=80,s.n,s.dest,left,bm?bm.tr.head:""].join("|");let m=aisMk.get(s.id);
    if(!m){m=L.marker([lat,lon],{pane:"lbl",icon:aisIcon(s,c,z,dir,left),keyboard:false,zIndexOffset:500}).addTo(aisLayer);m._k=key;aisMk.set(s.id,m);
      m.on("click",e=>{L.DomEvent.stopPropagation(e);clearTimeout(tapT);aisSheet(s.id)})}
    else{m.setLatLng([lat,lon]);if(m._k!==key){m.setIcon(aisIcon(s,c,z,dir,left));m._k=key}}
    const segs=aisTrack(s,lat,lon);let tr=aisTr.get(s.id);
    if(segs.length){if(!tr){tr=L.polyline(segs,{color:c,weight:2.4,opacity:.6,lineCap:"round",lineJoin:"round",interactive:false}).addTo(aisTrk);aisTr.set(s.id,tr)}
      else{tr.setLatLngs(segs);tr.setStyle({color:c})}}
    else if(tr){aisTrk.removeLayer(tr);aisTr.delete(s.id)}}
  for(const [id,m] of aisMk)if(!seen.has(id)){aisLayer.removeLayer(m);aisMk.delete(id)}
  for(const [id,tr] of aisTr)if(!seen.has(id)){aisTrk.removeLayer(tr);aisTr.delete(id)}}
function aisSheet(id){const s=aisData&&aisData.ships.find(x=>x.id===id);if(!s)return;const [kind]=aisKind(s.type),[,,age]=aisPos(s);
  const ag=age<90?`${Math.round(age)} s`:`${Math.round(age/60)} min`;
  const dst=shipDest(s.dest),bm=btFind(s);let tur="";
  if(bm){const r=bm.tr.route,nx=btNext(bm),dm=Math.round(bm.delay/60000),line=r[1]||(r[0]?"linje "+r[0]:"");
    tur=`<dt>Tur</dt><dd>${esc(r[2]||"")}${line?`, ${esc(line)}`:""}, mot ${esc(bm.tr.head)}</dd>`+
      (nx?`<dt>Nästa brygga</dt><dd>${esc(nx.n)}, ${hhmm(nx.a)} enligt tidtabellen${Math.abs(dm)>=1?` <span style="font-weight:500;color:var(--muted)">(ca ${Math.abs(dm)} min ${dm>0?"sen":"tidig"})</span>`:""}</dd>`:"")+
      `<dt>Slutstation</dt><dd>${esc(bm.tr.pts[bm.tr.pts.length-1].n)}, ${hhmm(bm.tr.t1+bm.delay)}</dd>`}
  $("sheetc").innerHTML=`<h3>${s.n?esc(shipName(s.n)):"Fartyg utan namn"}</h3><dl class="kv"><dt>Typ</dt><dd>${kind}${s.len?`, ${s.len} m`:""}</dd>${tur}
    <dt>Fart</dt><dd>${s.sog!=null?`${f1(s.sog)} knop (${f1(s.sog*KN*3.6)} km/h)`:"okänd"}</dd><dt>Kurs</dt><dd>${s.cog!=null?Math.round(s.cog)+"°":"okänd"}</dd>
    ${bm?"":`<dt>Destination</dt>`}${bm?"":`<dd>${dst?esc(dst)+(dst.toUpperCase()!==s.dest.trim().toUpperCase()?` <span style="font-weight:500;color:var(--muted)">(${esc(s.dest.trim())})</span>`:""):"inte angiven"}</dd>`}<dt>Senaste position</dt><dd>för ${ag} sedan</dd><dt>MMSI</dt><dd>${s.id}</dd></dl>
    <p class="note">Fartyget visas ungefär en halv minut i efterhand, längs de positioner det rapporterat. Får inte användas för navigering.</p>`;$("sheet").classList.add("open")}
async function aisPoll(){if(!S.layers.ais||document.hidden)return;const u=aisUrl();if(!u)return;
  let r;try{r=await fetch(u,{cache:"no-store"})}catch(_){toast("Fartygen kunde inte hämtas: ingen kontakt med "+u.replace(/^https?:\/\//,""));return}
  let j;try{j=await r.json()}catch(_){toast(`Fartygen kunde inte hämtas: adressen svarade inte med fartygsdata (${r.status})`);return}
  if(j.error){toast("AIS: "+j.error);return}
  aisData={t0:j.t,loc:Date.now(),ships:j.ships||[]};aisDraw();if(j.err)console.warn("AIS:",j.err)}
function aisAsk(){const v=window.prompt("Adress till AIS-mellanstationen (till exempel https://ais.dittnamn.workers.dev). Töm fältet för att ta bort:",aisUrl());
  if(v===null)return null;const u=fixUrl(v);try{if(u)localStorage.setItem("aisUrl",u);else localStorage.removeItem("aisUrl")}catch(_){}return u}
function aisStart(){aisStop(true);if(!aisUrl()&&!aisAsk()){S.layers.ais=false;$("aischip").setAttribute("aria-pressed","false");return}btLoad();
  aisPoll();aisT=setInterval(aisPoll,15000);aisA=setInterval(aisDraw,1000)}
function aisStop(keep){clearInterval(aisT);clearInterval(aisA);aisT=aisA=null;if(!keep){aisLayer.clearLayers();aisMk.clear();aisTrk.clearLayers();aisTr.clear()}}
map.on("zoomend moveend",()=>{if(S.layers.ais)aisDraw()});
document.addEventListener("visibilitychange",()=>{if(!document.hidden&&S.layers.ais)aisPoll()});
$("aisset").onclick=()=>{const v=aisAsk();if(v===null)return;if(v&&S.layers.ais)aisStart();else if(!v){aisStop();S.layers.ais=false;$("aischip").setAttribute("aria-pressed","false")}};
try{if(localStorage.getItem("ais")&&aisUrl()){S.layers.ais=true;$("aischip").setAttribute("aria-pressed","true");setTimeout(aisStart,1500)}}catch(_){}

// ------------------------------------------------------------------ egna observationer av sjön
// Du anger vilken sjö du ser och kan låta telefonen mäta båtens gungning i 60 sekunder. Varje observation
// sparas i den här webbläsaren med plats, tid, bedömning, mätning och vad kartan visade just där,
// så att kartans träffsäkerhet kan räknas ut. Kan exporteras som CSV.
(()=>{const st=document.createElement("style");st.textContent=`.obsb{display:grid;gap:6px;margin:8px 0}.obsb button{display:flex;align-items:center;gap:10px;text-align:left;padding:8px 10px;border-radius:10px;border:1px solid rgba(0,0,0,.15);background:#fff;font:500 14px system-ui;color:#14222B}
.obsb button i{width:26px;height:18px;border-radius:4px;flex:none;border:1px solid rgba(0,0,0,.15)}.obsb button small{display:block;color:#5A6770;font-size:12px}
.obsrow{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}.obsrow button{padding:7px 12px;border-radius:9px;border:1px solid rgba(0,0,0,.2);background:#fff;font:600 13px system-ui}`;document.head.appendChild(st)})();
const OBS_TXT=["Blankt eller små krusningar","Små vågor utan vita toppar","Tydliga vågor, enstaka vita toppar","Många vita toppar","Hög, krabb sjö"];
const loadObs=()=>{try{return JSON.parse(localStorage.getItem("obs")||"[]")}catch(_){return[]}};
const saveObs=a=>{try{localStorage.setItem("obs",JSON.stringify(a))}catch(_){toast("Kunde inte spara observationen")}};
// vad kartan visar på en plats just nu (samma beräkning som när man trycker på kartan)
function predictedAt(ll){const la=laR?laAt(ll):null;if(la==null||la<0)return null;
  const w=S.wind?windAt(ll.lat,ll.lng,S.ti):null,lu0=S.src==="egen"?S.own.sp:w?calcU(w):laWind?calcU(laWind):null;if(lu0==null)return null;
  let hs=wave(lu0*leeAt(ll),la);
  if(lastSW){const R2=lastSW.R,p=CRS.latLngToPoint(ll,R2.z),xx=Math.floor(p.x-R2.px0),yy=Math.floor(p.y-R2.py0);
    if(xx>=0&&yy>=0&&xx<R2.W&&yy<R2.H){const i=yy*R2.W+xx;if(lastSW.H[i]>=0)hs=lastSW.H[i]}}
  let k=0;while(hs>=LA_CLASSES[k][0])k++;return{k,hs,ws:w?w.ws:null,gust:w?w.gust:null,wd:w?w.wd:null}}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function settle(){await sleep(200);for(let i=0;i<80&&(busy||again);i++)await sleep(100)}
// position: GPS om det finns, annars kartans mitt
function getPos(){return new Promise(res=>{if(!navigator.geolocation){res(null);return}
  navigator.geolocation.getCurrentPosition(p=>res({lat:p.coords.latitude,lng:p.coords.longitude,acc:p.coords.accuracy}),()=>res(null),{enableHighAccuracy:true,timeout:8000,maximumAge:20000})})}
// --- båtens gungning: vertikal acceleration ur telefonens sensorer, spektrum, våghöjd och period
function fft(re,im){const n=re.length;for(let i=1,j=0;i<n;i++){let b=n>>1;for(;j&b;b>>=1)j^=b;j^=b;if(i<j){let t=re[i];re[i]=re[j];re[j]=t;t=im[i];im[i]=im[j];im[j]=t}}
  for(let len=2;len<=n;len<<=1){const a=-2*Math.PI/len,wr=Math.cos(a),wi=Math.sin(a),h=len>>1;
    for(let i=0;i<n;i+=len){let cr=1,ci=0;for(let j=0;j<h;j++){const p=i+j,q=p+h,vr=re[q]*cr-im[q]*ci,vi=re[q]*ci+im[q]*cr;
        re[q]=re[p]-vr;im[q]=im[p]-vi;re[p]+=vr;im[p]+=vi;const t=cr*wr-ci*wi;ci=cr*wi+ci*wr;cr=t}}}}
function analyzeMotion(rec){if(rec.length<200)return null;const t0=rec[0][0],T=(rec[rec.length-1][0]-t0)/1000;if(T<30)return null;
  // tyngdkraftens riktning som glidande medel över ca 2 s; vertikal acceleration = projektion minus g
  const fs=10,n=Math.floor(T*fs),az=new Float64Array(n),cnt=new Uint16Array(n);let gx=rec[0][1],gy=rec[0][2],gz=rec[0][3];
  for(let i=0;i<rec.length;i++){const [t,x,y,z]=rec[i],dt=i?Math.min(.2,(t-rec[i-1][0])/1000):0,al=Math.min(1,dt/2);
    gx+=(x-gx)*al;gy+=(y-gy)*al;gz+=(z-gz)*al;const g=Math.hypot(gx,gy,gz)||9.81,v=(x*gx+y*gy+z*gz)/g-g,b=Math.floor((t-t0)/1000*fs);
    if(b>=0&&b<n){az[b]+=v;cnt[b]++}}
  for(let i=0;i<n;i++)az[i]=cnt[i]?az[i]/cnt[i]:(i?az[i-1]:0);
  // Welch-spektrum (256 punkter, 50 % överlapp, Hann-fönster)
  const N=256;if(n<N)return null;const S=new Float64Array(N/2),win=new Float64Array(N);let w2=0;
  for(let i=0;i<N;i++){win[i]=.5-.5*Math.cos(2*Math.PI*i/(N-1));w2+=win[i]*win[i]}
  let segs=0;for(let s=0;s+N<=n;s+=N/2){let mu=0;for(let i=0;i<N;i++)mu+=az[s+i];mu/=N;const re=new Float64Array(N),im=new Float64Array(N);
    for(let i=0;i<N;i++)re[i]=(az[s+i]-mu)*win[i];fft(re,im);for(let k=1;k<N/2;k++)S[k]+=2*(re[k]*re[k]+im[k]*im[k])/(fs*w2);segs++}
  // från acceleration till höjd: dela med (2πf)^4, inom vågornas band (perioder 0,8 till 4 s)
  const df=fs/N;let m0=0,best=0,fp=0;
  for(let k=1;k<N/2;k++){const f=k*df;if(f<.25||f>1.25)continue;const e=S[k]/segs/Math.pow(2*Math.PI*f,4);m0+=e*df;if(e>best){best=e;fp=f}}
  return{hs:4*Math.sqrt(m0),tp:fp?1/fp:null,dur:T}}
let motion=null;
async function measureMotion(sec,onTick){if(typeof DeviceMotionEvent==="undefined")throw new Error("Telefonen saknar rörelsesensor");
  if(typeof DeviceMotionEvent.requestPermission==="function"){const p=await DeviceMotionEvent.requestPermission();if(p!=="granted")throw new Error("Rörelsesensorn fick inte användas")}
  const rec=[],h=e=>{const a=e.accelerationIncludingGravity;if(a&&a.x!=null)rec.push([performance.now(),a.x,a.y,a.z])};
  window.addEventListener("devicemotion",h);motion={stop:false};
  for(let s=sec;s>0&&!motion.stop;s--){onTick(s);await sleep(1000)}
  window.removeEventListener("devicemotion",h);const stopped=motion.stop;motion=null;if(stopped)return null;
  if(rec.length<100)throw new Error("Fick inga mätvärden från rörelsesensorn");return analyzeMotion(rec)}
function obsStats(){const a=loadObs().filter(o=>o.pk!=null);if(!a.length)return"Inga jämförbara observationer än.";
  const n=a.length,hit=a.filter(o=>o.k===o.pk).length,near=a.filter(o=>Math.abs(o.k-o.pk)<=1).length,bias=a.reduce((s,o)=>s+(o.k-o.pk),0)/n;
  const m=a.filter(o=>o.mhs!=null&&o.phs!=null&&o.phs>0.03);let mt="";
  if(m.length){const r=m.map(o=>o.mhs/o.phs).sort((x,y)=>x-y),med=r[Math.floor(r.length/2)];mt=` Uppmätt våghöjd är i mitten ${f1(med)} gånger kartans (${m.length} mätningar).`}
  const lean=Math.abs(bias)<.25?"ingen tydlig skevhet":bias>0?`kartan visar i snitt ${f1(bias)} klass för lugnt`:`kartan visar i snitt ${f1(-bias)} klass för grovt`;
  return`${n} ${n===1?"observation":"observationer"}: rätt klass ${Math.round(hit/n*100)} %, högst en klass fel ${Math.round(near/n*100)} %, ${lean}.${mt}`}
function obsCSV(){const a=loadObs(),hd="tid;lat;lon;noggrannhet_m;observerat;kartan;kartans_vaghojd_m;uppmatt_vaghojd_m;uppmatt_period_s;vind_ms;byar_ms;vindriktning;kalla";
  const r=a.map(o=>[o.t,o.lat,o.lng,o.acc!=null?Math.round(o.acc):"",LA_CLASSES[o.k][1],o.pk!=null?LA_CLASSES[o.pk][1]:"",o.phs!=null?o.phs.toFixed(2):"",o.mhs!=null?o.mhs.toFixed(2):"",o.mtp!=null?o.mtp.toFixed(1):"",
    o.ws!=null?o.ws.toFixed(1):"",o.gust!=null?o.gust.toFixed(1):"",o.wd!=null?Math.round(o.wd):"",o.src].join(";").replace(/\./g,","));
  const b=new Blob(["\ufeff"+[hd,...r].join("\n")],{type:"text/csv"}),u=URL.createObjectURL(b),el=document.createElement("a");
  el.href=u;el.download="sjoobservationer.csv";document.body.appendChild(el);el.click();el.remove();setTimeout(()=>URL.revokeObjectURL(u),2000)}
async function obsOpen(){sel=null;if(pin){map.removeLayer(pin);pin=null}
  $("sheetc").innerHTML=`<h3>Hur är sjön här?</h3><p class="note">Hämtar position …</p>`;$("sheet").classList.add("open");
  const gp=await getPos(),c=map.getCenter(),pos=gp||{lat:c.lat,lng:c.lng,acc:null},ll=L.latLng(pos.lat,pos.lng);
  // jämför med kartan för nuvarande timme, på din plats
  if(S.ti!==nowIndex())setTime(nowIndex());if(!map.getBounds().pad(-.1).contains(ll))map.setView(ll,Math.max(map.getZoom(),13),{animate:false});
  await settle();const pr=predictedAt(ll);
  const mk=(k)=>`<button data-k="${k}"><i style="background:${LA_SOLID[k]}"></i><span>${LA_CLASSES[k][1]}<small>${OBS_TXT[k]}</small></span></button>`;
  $("sheetc").innerHTML=`<h3>Hur är sjön här?</h3>
    <p class="note" style="margin-top:2px">${gp?`Din position (±${Math.round(gp.acc)} m)`:"Ingen GPS: kartans mitt används"}${pr?` · kartan visar <b>${LA_CLASSES[pr.k][1].toLowerCase()}</b> (${fmtWave(pr.hs,pr.k)})`:" · kartan har ingen beräkning här"}</p>
    <div class="obsb">${[0,1,2,3,4].map(mk).join("")}</div>
    <label style="display:flex;gap:8px;align-items:flex-start;font:14px system-ui"><input type="checkbox" id="obsm" checked style="margin-top:3px"><span>Mät båtens gungning i 60 s<br><small style="color:#5A6770">Lägg telefonen still i båten, gärna mitt i, medan den mäter.</small></span></label>
    <div id="obsmsg" class="note"></div>
    <h3 style="margin-top:14px">Mina observationer</h3><p class="note" id="obsstat">${obsStats()}</p>
    <div class="obsrow"><button id="obsexp">Exportera CSV</button><button id="obsclr">Rensa alla</button></div>`;
  $("sheetc").querySelectorAll(".obsb button").forEach(b=>b.onclick=async()=>{const k=+b.dataset.k,o={t:new Date().toISOString(),lat:+pos.lat.toFixed(5),lng:+pos.lng.toFixed(5),acc:pos.acc,k,
      pk:pr?pr.k:null,phs:pr?+pr.hs.toFixed(3):null,ws:pr?pr.ws:null,gust:pr?pr.gust:null,wd:pr?pr.wd:null,src:S.src+"/"+S.basis};
    $("sheetc").querySelectorAll(".obsb button").forEach(x=>x.disabled=true);
    if($("obsm").checked){const msg=$("obsmsg");msg.innerHTML=`Mäter … <b id="obscd">60</b> s <button id="obsstop" style="margin-left:8px">Avbryt</button>`;
      $("obsstop").onclick=()=>{if(motion)motion.stop=true};
      try{const r=await measureMotion(60,s=>{const e=$("obscd");if(e)e.textContent=s});
        if(!r){msg.textContent="Mätningen avbröts, observationen sparades utan mätning.";}
        else{o.mhs=+r.hs.toFixed(3);o.mtp=r.tp?+r.tp.toFixed(1):null;msg.innerHTML=`Uppmätt: ca <b>${f1(r.hs)} m</b>${r.tp?`, period ${f1(r.tp)} s`:""}. Små båtar följer inte de kortaste vågorna helt, så mätningen blir ofta något låg.`}}
      catch(e){msg.textContent=e.message+". Observationen sparades utan mätning."}}
    const a=loadObs();a.push(o);saveObs(a);toast("Observationen sparad");$("obsstat").textContent=obsStats();
    $("sheetc").querySelectorAll(".obsb button").forEach(x=>x.disabled=false)});
  $("obsexp").onclick=obsCSV;
  $("obsclr").onclick=()=>{if(confirm("Ta bort alla sparade observationer?")){saveObs([]);$("obsstat").textContent=obsStats()}}}
$("obs").onclick=obsOpen;
$("close").addEventListener("click",()=>{if(motion)motion.stop=true});

// ------------------------------------------------------------------ min position
let me=null,watch=null;
$("loc").onclick=()=>{if(me){map.setView(me.getLatLng(),Math.max(map.getZoom(),13));return}if(!navigator.geolocation){toast("Positionen är inte tillgänglig");return}
  watch=navigator.geolocation.watchPosition(p=>{const ll=[p.coords.latitude,p.coords.longitude];if(!me){me=L.marker(ll,{interactive:false,icon:L.divIcon({className:"",html:'<div class="me"></div>',iconSize:[22,22]})}).addTo(map);map.setView(ll,Math.max(map.getZoom(),13))}else me.setLatLng(ll)},
    ()=>toast("Kunde inte hämta din position"),{enableHighAccuracy:true,maximumAge:10000})};

// ------------------------------------------------------------------ start
// Alla startfiler hämtas samtidigt; kartan ritas så fort vinden, masken och läet finns, och det som
// kommer senare (djup, höjdkurvor, temperatur) läggs till när det kommer.
(async()=>{
  const dec=s=>{const b=atob(s),a=new Uint8Array(b.length);for(let i=0;i<b.length;i++)a[i]=b.charCodeAt(i);return a};
  const get=u=>getJSON(u).catch(()=>null);
  const P={names:get("mask/namn.json"),swan:get("data/swan/index.json"),vind:get("data/vind/index.json"),info:get("mask/info.json"),
    priv:get("mask/privat/info.json"),wind:get("data/wind.json"),temp:get("data/temp.json"),djup:get("data/djup.json"),terr:get("data/terrang.json")};
  loadOwnDepth(true);
  const [names,X,V,info,pi,W]=await Promise.all([P.names,P.swan,P.vind,P.info,P.priv,P.wind]);
  if(names)S.names=names;
  if(X&&X.done&&X.done.length)S.swan=X;
  if(V&&V.done&&V.done.length===V.dirs.length)S.vind=V;
  if(info){if(info.zooms&&info.zooms.length)MASK_MAX=Math.min(15,Math.max(...info.zooms));const [w,s,e,n]=info.bounds;map.setMaxBounds(L.latLngBounds([s,w],[n,e]).pad(.4))}
  if(pi){S.privOk=true;S.privM=pi.meter||25}else $("privchip")&&($("privchip").hidden=true);
  if(W){S.wind=W;$("time").max=W.times.length-1}else{toast("Ingen vinddata än");$("when").textContent="Ingen vinddata"}
  setTime(nowIndex());schedule();
  P.temp.then(T=>{if(!T)return;S.temp=T;S.T=dec(T.t);smoothTemp();schedule()});
  P.djup.then(G=>{if(!G){$("depthchip")&&($("depthchip").hidden=true);$("depthfind")&&($("depthfind").hidden=true);return}
    G.D=dec(G.d);G.M=dec(G.m);delete G.d;delete G.m;S.depth=G;schedule()});
  // höjdmodellen för höjdkurvorna
  P.terr.then(T=>{if(!T){$("contourchip")&&($("contourchip").hidden=true);return}T.H=dec(T.h);delete T.h;S.terr=T;schedule()});
})();
if("serviceWorker" in navigator)navigator.serviceWorker.register("sw.js").catch(()=>{});
// be telefonen att inte rensa bort det som sparats (kustmasken, djupet, läet och SWAN)
try{navigator.storage&&navigator.storage.persist&&navigator.storage.persist()}catch(_){}
