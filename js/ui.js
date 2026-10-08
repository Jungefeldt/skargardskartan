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
  if(S.depth&&S.layers.depth)h+=`<span style="flex:1 1 100%">Djup (ungefärligt): `+DEPTH_STEPS.map((d,k)=>`<i style="background:${DEPTH_COL[k]};margin:0 3px 0 6px"></i>${k===DEPTH_STEPS.length-1?d+"+":d}`).join("")+` m</span>`;
  if(S.layers.arrows)h+=`<span style="flex:1 1 100%">Vindpilar: `+[["svag",0],["måttlig",4],["frisk",8],["hård",14],["mycket hård",20]].map(x=>`<i style="background:${windCol(x[1])};margin:0 3px 0 6px;border-radius:50%;width:10px"></i>${x[0]}`).join("")+`</span>`;
  if((S.layers.temp||S.find.on)&&tRange)h+=`<span><i style="background:#0B3550;height:2px;border:0"></i>Vattentemp, zoner om ${tStep} °C (${f0(tRange[0])} till ${f0(tRange[1])} här)</span>`;
  L_.innerHTML=h}

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
document.querySelectorAll("[data-layer]").forEach(b=>b.onclick=()=>{const k=b.dataset.layer;S.layers[k]=!S.layers[k];b.setAttribute("aria-pressed",S.layers[k]);schedule()});
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
document.querySelectorAll("[data-wstyle]").forEach(b=>b.onclick=()=>{S.wstyle=b.dataset.wstyle;document.querySelectorAll("[data-wstyle]").forEach(x=>x.setAttribute("aria-checked",x===b));try{localStorage.setItem("wstyle",S.wstyle)}catch(_){}schedule()});
try{const sw=localStorage.getItem("wstyle");if(sw==="farg"||sw==="monster"||sw==="rorlig"){S.wstyle=sw;document.querySelectorAll("[data-wstyle]").forEach(x=>x.setAttribute("aria-checked",x.dataset.wstyle===sw))}}catch(_){}
document.querySelectorAll("[data-basis]").forEach(b=>b.onclick=()=>{S.basis=b.dataset.basis;document.querySelectorAll("[data-basis]").forEach(x=>x.setAttribute("aria-checked",x===b));try{localStorage.setItem("basis",S.basis)}catch(_){}schedule()});
try{const sb=localStorage.getItem("basis");if(sb==="medel"||sb==="byar"){S.basis=sb;document.querySelectorAll("[data-basis]").forEach(x=>x.setAttribute("aria-checked",x.dataset.basis===sb))}}catch(_){}
$("explain").onclick=()=>{let h=`<h3>Färger för lä och sjögång</h3><p class="note" style="margin-top:2px;padding-right:44px">Klassen bestäms av uppskattad våghöjd (signifikant våghöjd, ungefär medelhöjden av den högsta tredjedelen av vågorna). Den räknas från vindstyrkan och hur mycket öppet vatten det finns mot vinden, högst 6 km.</p>
    <table class="deftab"><tr><th>Klass</th><th>Våg</th><th>Så känns det</th></tr>`+LA_CLASSES.map((c,i)=>`<tr><td><i style="background:${c[2]}"></i>${c[1]}</td><td>${LA_DEF[i][0]}</td><td>${LA_DEF[i][1]}</td></tr>`).join("")+`</table>
    <h3>Räkna på byar eller medelvind</h3><p class="note" style="margin-top:2px"><b>Byar</b> (förvalt) räknar vågorna på den starkaste vinden i prognosen. Det ger en försiktig bild, bra när du ska ligga still och fiska. <b>Medelvind</b> stämmer bättre med hur vågorna oftast blir, men underskattar läget när det är byigt.</p>
    <h3>Vindstyrka (SMHI)</h3><table class="deftab"><tr><th>Benämning</th><th>m/s</th></tr><tr><td>Lugnt</td><td>0–0,2</td></tr><tr><td>Svag vind</td><td>0,3–3</td></tr><tr><td>Måttlig vind</td><td>4–7</td></tr><tr><td>Frisk vind</td><td>8–13</td></tr><tr><td>Hård vind</td><td>14–19</td></tr><tr><td>Mycket hård vind</td><td>20–24</td></tr><tr><td>Storm</td><td>25–32</td></tr></table>
    <h3>Vågmönster</h3><p class="note" style="margin-top:2px">Varje linje är en vågkam och ligger tvärs mot vågornas gång. Där det finns beräkningar från vågmodellen SWAN (TU Delft) följer linjerna modellens vågriktning, som tar hänsyn till lä bakom öar, refraktion mot grunt vatten och diffraktion runt uddar. Tätare och tunnare linjer betyder mindre vågor, glesare och kraftigare linjer större vågor. <b>Rörliga vågor</b> visar i stället vågytan som den ser ut uppifrån, med verklig våglängd och fart för vinden när du zoomat in; utzoomat förstoras vågorna så att de syns. Ljuset kommer från nordväst som på terrängen, och varje kam kastar en kort skugga. I svag vind blir det långa, tunna krusningar, i hård vind korta och branta vågor i grupper. Över 6 m/s bryter de högsta kammarna och lämnar skumspår bakom sig, och mot stränder som vågorna går rakt mot blir det bränningar.</p>
    <h3>Lä för vinden</h3><p class="note" style="margin-top:2px">Bakom öar, uddar och skog är vinden svagare. Dämpningen räknas från markhöjden i Lantmäteriets höjdmodell och trädhöjden (${S.treesSrc||"skog från OpenStreetMap"}): störst närmast hindret, och vinden är nästan tillbaka efter 20 till 30 gånger hindrets höjd. Uppskruvad vind runt uddar och i smala sund ingår inte.</p>
    <h3>Höjdkurvor och terräng</h3><p class="note" style="margin-top:2px">Höjdkurvorna på land kommer från Lantmäteriets laserskannade höjdmodell. Avståndet mellan kurvorna är 10 m, och 5 m när man zoomat in; var femte kurva är kraftigare. Land skuggas som en terrängkarta med ljuset från nordväst, och skogen syns som gröna, upphöjda partier${S.treesSrc?" (trädhöjd: "+S.treesSrc+")":""}.</p>
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
  if(S.depth&&wet){const d=depthAt(ll.lat,ll.lng);if(d!=null)h+=`<dt>Djup</dt><dd>ca ${f0(d)} m <span style="font-weight:500;color:var(--muted)">(${depthMeasured(ll.lat,ll.lng)?"nära lodning":"uppskattat"})</span></dd>`}
  if(S.find.on&&la!=null&&la>=0&&lu!=null&&wt!=null){let k=0;const hs=wave(lu,la);while(hs>=LA_CLASSES[k][0])k++;const ok=k<=S.find.maxK&&wt>=S.find.tmin&&wt<=S.find.tmax;h+=`<dt>Villkoren</dt><dd>${ok?"uppfylls":"uppfylls inte"}</dd>`}
  h+=`</dl>`;
  if(inPriv(ll))h+=`<p class="warn" style="background:rgba(60,50,45,.1);border-color:#3A322D">Inom ${S.privM} m från brygga eller hus. Här kan det vara hemfridszon, välj gärna en annan plats.</p>`;
  if(w&&la!=null&&la>=0){const g=w.gust!=null?w.gust:w.ws;if(g>=10)h+=`<p class="warn">Byar upp till ${f0(g)} m/s. Även i lä kan byarna slå ner över öarna och ge kraftig drift och snabba vindkast vid båten.</p>`}
  if(W){h+=`<div class="hours">`;for(let i=S.ti;i<W.times.length&&i<S.ti+30;i+=3){const x=windAt(ll.lat,ll.lng,i);if(!x)continue;const d=new Date(W.times[i]);
      h+=`<div>${String(d.getHours()).padStart(2,"0")}<b>${dirName(x.wd)} ${f0(x.ws)}</b>${x.gust!=null?"("+f0(x.gust)+")":""}</div>`}h+=`</div>`}
  if(S.depth&&wet)h+=`<p class="note">Djupet kommer från EMODnet och är grovt i svenska vatten (underlaget är glesat till ungefär 300 m). Grund och kanter syns inte. Får inte användas för navigering.</p>`;
  if(laR)h+=`<p class="note">Lä räknas från hur mycket öppet vatten som finns mot vinden (inom 6 km). Vågor böjer runt små öar, så verkligt lä är ofta något mindre än kartan visar.</p>`;
  $("sheetc").innerHTML=h;$("sheet").classList.add("open")}

// ------------------------------------------------------------------ min position
let me=null,watch=null;
$("loc").onclick=()=>{if(me){map.setView(me.getLatLng(),Math.max(map.getZoom(),13));return}if(!navigator.geolocation){toast("Positionen är inte tillgänglig");return}
  watch=navigator.geolocation.watchPosition(p=>{const ll=[p.coords.latitude,p.coords.longitude];if(!me){me=L.marker(ll,{interactive:false,icon:L.divIcon({className:"",html:'<div class="me"></div>',iconSize:[22,22]})}).addTo(map);map.setView(ll,Math.max(map.getZoom(),13))}else me.setLatLng(ll)},
    ()=>toast("Kunde inte hämta din position"),{enableHighAccuracy:true,maximumAge:10000})};

// ------------------------------------------------------------------ start
(async()=>{
  try{S.names=await getJSON("mask/namn.json")}catch(_){}
  try{const X=await getJSON("data/swan/index.json");if(X.done&&X.done.length)S.swan=X}catch(_){}
  try{const X=await getJSON("data/fas/index.json");if(X.done&&X.done.length)S.fas=X}catch(_){}
  try{const V=await getJSON("data/vind/index.json");if(V.done&&V.done.length===V.dirs.length)S.vind=V}catch(_){}
  // höjdmodellen för höjdkurvorna laddas i bakgrunden
  getJSON("data/terrang.json").then(T=>{const b=atob(T.h),a=new Uint8Array(b.length);for(let i=0;i<b.length;i++)a[i]=b.charCodeAt(i);T.H=a;delete T.h;S.terr=T;schedule()})
    .catch(()=>{$("contourchip")&&($("contourchip").hidden=true)});
  // trädhöjd från Skogsstyrelsen (samma rutnät som höjdmodellen), för terrängskuggningen
  getJSON("data/trad.json").then(M=>new Promise((res,rej)=>{const im=new Image();im.onload=()=>{const c=document.createElement("canvas");c.width=im.width;c.height=im.height;
      const g=c.getContext("2d");g.drawImage(im,0,0);const d=g.getImageData(0,0,im.width,im.height).data,a=new Float32Array(im.width*im.height);
      for(let i=0;i<a.length;i++)a[i]=d[i*4]/(M.per_m||4);S.treesSrc=M.source;res(a)};im.onerror=rej;im.src="data/trad.png"}))
    .then(a=>{S.trees=a;terrKey=null;schedule()}).catch(()=>{});
  try{const G=await getJSON("data/djup.json"),dec=s=>{const b=atob(s),a=new Uint8Array(b.length);for(let i=0;i<b.length;i++)a[i]=b.charCodeAt(i);return a};
    G.D=dec(G.d);G.M=dec(G.m);delete G.d;delete G.m;S.depth=G}catch(_){$("depthchip")&&($("depthchip").hidden=true);$("depthfind")&&($("depthfind").hidden=true)}
  try{const pi=await getJSON("mask/privat/info.json");S.privOk=true;S.privM=pi.meter||25}catch(_){$("privchip")&&($("privchip").hidden=true)}
  try{const info=await getJSON("mask/info.json");if(info.zooms&&info.zooms.length)MASK_MAX=Math.min(15,Math.max(...info.zooms));const [w,s,e,n]=info.bounds;map.setMaxBounds(L.latLngBounds([s,w],[n,e]).pad(.4))}catch(_){}
  try{S.wind=await getJSON("data/wind.json");$("time").max=S.wind.times.length-1}catch(_){toast("Ingen vinddata än");$("when").textContent="Ingen vinddata"}
  try{S.temp=await getJSON("data/temp.json");const b=atob(S.temp.t),a=new Uint8Array(b.length);for(let i=0;i<b.length;i++)a[i]=b.charCodeAt(i);S.T=a;smoothTemp()}catch(_){}
  setTime(nowIndex());schedule()})();
if("serviceWorker" in navigator)navigator.serviceWorker.register("sw.js").catch(()=>{});
