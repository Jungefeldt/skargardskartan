/* Skärgårdskartan, grund.js: Grund: karta, data, vind, djup, SWAN, lä för vinden och vattentemperatur.
   Filerna i js/ laddas i ordning från index.html och delar variabler med varandra. */
"use strict";
const $ = id => document.getElementById(id);
const CRS = L.CRS.EPSG3857;
let toastT; function toast(s){const t=$("toast");t.textContent=s;t.classList.add("show");clearTimeout(toastT);toastT=setTimeout(()=>t.classList.remove("show"),2400)}

// ------------------------------------------------------------------ karta
// startar inzoomad över Trälhavet (Lervik, Oranjeholmen och Stora Älgö), så att det går snabbt att se läget
const map = L.map("map",{zoomControl:false,minZoom:8,maxZoom:17,center:[59.447,18.392],zoom:13});
map.attributionControl.setPrefix(false);
// OpenStreetMap visas bara när ”Karta” är valt; annars syns endast appens egna färger (vatten som bakgrund),
// så att det aldrig blinkar till en annan karta när man flyttar sig eller när något laddar
const osm=L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19});
map.attributionControl.addAttribution("© OpenStreetMap");
function syncBase(){const karta=S.land==="karta";if(karta&&!map.hasLayer(osm))osm.addTo(map);if(!karta&&map.hasLayer(osm))map.removeLayer(osm);
  map.getContainer().style.background=karta?"#ddd":"#AAD3DF"}
// sjömärken ligger ovanpå alla färgade lager (men under namn och etiketter), så att de alltid syns
map.createPane("seamarks").style.zIndex=380; map.getPane("seamarks").style.pointerEvents="none";
L.tileLayer("https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png",{pane:"seamarks",maxZoom:18,attribution:"Sjömärken © OpenSeaMap · SMHI · Copernicus Marine · EMODnet"}).addTo(map);
// Linjal: randig skala med jämna avstånd, som på ett sjökort
(()=>{const st=document.createElement("style");st.textContent=`.ruler{margin:calc(110px + env(safe-area-inset-top,0px)) 0 0 10px!important;padding:5px 8px 4px;background:rgba(255,255,255,.88);border-radius:6px;box-shadow:0 1px 4px rgba(0,0,0,.25);font:600 11px/1 system-ui,-apple-system,Segoe UI,sans-serif;color:#14222B;pointer-events:none}
.ruler .rb{display:flex;height:6px;border:1.5px solid #14222B;box-sizing:content-box}.ruler .rb i{flex:1;background:#14222B}.ruler .rb i:nth-child(even){background:#fff}
.ruler .rl{position:relative;height:13px;margin-top:3px}.ruler .rl span{position:absolute;transform:translateX(-50%);white-space:nowrap}.ruler .rl span:first-child{transform:none}.ruler .rl span:last-child{transform:translateX(-100%)}`;document.head.appendChild(st)})();
const Ruler=L.Control.extend({options:{position:"topleft"},
  onAdd(){const d=L.DomUtil.create("div","ruler");this._d=d;map.on("zoomend moveend resize",this._u,this);setTimeout(()=>this._u(),0);return d},
  _u(){const sz=map.getSize(),y=sz.y/2,maxPx=Math.max(80,Math.min(240,sz.x*.42));
    const m=map.distance(map.containerPointToLatLng([10,y]),map.containerPointToLatLng([10+maxPx,y]));
    const p=Math.pow(10,Math.floor(Math.log10(m)));let n=p,segs=5;for(const [f,s] of [[1,5],[2,4],[2.5,5],[5,5]])if(f*p<=m){n=f*p;segs=s}
    const px=Math.round(maxPx*n/m),fmt=v=>v>=1000?(String(Math.round(v/10)/100).replace(".",","))+" km":Math.round(v)+" m";
    this._d.innerHTML=`<div class="rb" style="width:${px}px">${"<i></i>".repeat(segs)}</div><div class="rl" style="width:${px}px"><span style="left:0">0</span>${px>=150?`<span style="left:50%">${n>=1000?String(Math.round(n/20)/100).replace(".",","):Math.round(n/2)}</span>`:""}<span style="left:100%">${fmt(n)}</span></div>`}});
new Ruler().addTo(map);
map.createPane("tint").style.zIndex=300; map.getPane("tint").style.pointerEvents="none"; map.getPane("tint").style.mixBlendMode="color";
map.createPane("zones").style.zIndex=345; map.getPane("zones").style.pointerEvents="none";
map.createPane("crests").style.zIndex=346; map.getPane("crests").style.pointerEvents="none";
map.createPane("relief").style.zIndex=347; map.getPane("relief").style.pointerEvents="none";
map.createPane("ov").style.zIndex=350; map.getPane("ov").style.pointerEvents="none";
map.createPane("coast").style.zIndex=360; map.getPane("coast").style.pointerEvents="none";
map.createPane("lbl").style.zIndex=640; map.getPane("lbl").style.pointerEvents="none";
map.createPane("names").style.zIndex=660; map.getPane("names").style.pointerEvents="none";

// Bild-lager vars innehåll ritas direkt i en canvas
const CanvasOverlay=L.ImageOverlay.extend({_initImage(){const c=this._image=L.DomUtil.create("canvas","leaflet-image-layer overlay"+(this._zoomAnimated?" leaflet-zoom-animated":""));c.onselectstart=L.Util.falseFn;c.onmousemove=L.Util.falseFn}});
const overlays={};
function showCanvas(R,draw,pane){pane=pane||"ov";const b=L.latLngBounds(CRS.pointToLatLng(L.point(R.px0,R.py0+R.H),R.z),CRS.pointToLatLng(L.point(R.px0+R.W,R.py0),R.z));
  let o=overlays[pane];if(!o){o=overlays[pane]=new CanvasOverlay("",b,{pane,interactive:false,opacity:1}).addTo(map)}else o.setBounds(b);
  const c=o.getElement();c.width=R.W;c.height=R.H;const x=c.getContext("2d"),img=x.createImageData(R.W,R.H);draw(img.data);x.putImageData(img,0,0)}
function hideCanvas(pane){pane=pane||"ov";if(overlays[pane]){map.removeLayer(overlays[pane]);delete overlays[pane]}}
const LANDCOL={gul:[244,226,160],vit:[246,246,242]};

// ------------------------------------------------------------------ data
const S={wstyle:"farg",basis:"byar",land:"gul",wind:null,temp:null,T:null,layers:{la:true,temp:false,arrows:true,waves:true,priv:true,names:true,depth:false,contours:true},privOk:false,find:{on:false,maxK:0,tmin:null,tmax:null,dmin:0,dmax:60},src:"prognos",own:{dir:225,sp:8},ti:0};
async function getJSON(u){const r=await fetch(u,{cache:"no-cache"});if(!r.ok)throw new Error(u+" "+r.status);return r.json()}

// ------------------------------------------------------------------ land/vatten-mask
const tiles=new Map();
function tile(z,x,y,pre){pre=pre||"mask/";const k=pre+z+"/"+x+"/"+y;if(tiles.has(k))return tiles.get(k);
  const p=new Promise(res=>{const im=new Image();im.onload=()=>{const c=document.createElement("canvas");c.width=c.height=256;const g=c.getContext("2d");g.drawImage(im,0,0);
      const d=g.getImageData(0,0,256,256).data,a=new Uint8Array(65536);for(let i=0;i<65536;i++)a[i]=d[i*4]>127?1:0;res(a)};
    im.onerror=()=>res(null);im.src=k+".png"});
  tiles.set(k,p);return p}
async function region(z,px0,py0,W,H){const water=new Uint8Array(W*H),priv=new Uint8Array(W*H),pz=Math.max(11,Math.min(13,z));const tx0=Math.floor(px0/256),ty0=Math.floor(py0/256),tx1=Math.floor((px0+W-1)/256),ty1=Math.floor((py0+H-1)/256);
  const jobs=[];for(let tx=tx0;tx<=tx1;tx++)for(let ty=ty0;ty<=ty1;ty++)jobs.push(Promise.all([tile(z,tx,ty),S.privOk&&pz===z?tile(z,tx,ty,"mask/privat/"):null]).then(([a,p])=>({tx,ty,a,p})));
  for(const {tx,ty,a,p} of await Promise.all(jobs)){const ox=tx*256-px0,oy=ty*256-py0;
    for(let yy=Math.max(0,oy);yy<Math.min(H,oy+256);yy++){const ry=(yy-oy)*256,wy=yy*W;
      for(let xx=Math.max(0,ox);xx<Math.min(W,ox+256);xx++){water[wy+xx]=a?a[ry+xx-ox]:1;if(p)priv[wy+xx]=p[ry+xx-ox]}}}
  return{z,px0,py0,W,H,water,priv}}
const mpp=(z,lat)=>156543.034*Math.cos(lat*Math.PI/180)/Math.pow(2,z);

// ------------------------------------------------------------------ lä
// Öppet vatten (fetch) mot vinden räknas för varje vattenpixel i ett svep:
// värdet tas från grannen i vindens riktning plus ett steg. Land nollställer.
function fetchPass(R,dirDeg,capPx){const W=R.W,H=R.H,wa=R.water,F=new Float32Array(W*H),th=dirDeg*Math.PI/180,ux=Math.sin(th),uy=-Math.cos(th);
  if(Math.abs(ux)>=Math.abs(uy)){const sx=ux>0?1:-1,t=1/Math.abs(ux),dy=uy*t;
    for(let k=0;k<W;k++){const x=sx>0?W-1-k:k,px=x+sx,edge=px<0||px>=W;
      for(let y=0;y<H;y++){const i=y*W+x;if(!wa[i]){F[i]=0;continue}if(edge){F[i]=capPx;continue}
        const yy=y+dy;if(yy<0||yy>H-1){F[i]=capPx;continue}const y0=yy|0,f=yy-y0,y1=y0+1<H?y0+1:y0;
        const v=F[y0*W+px]*(1-f)+F[y1*W+px]*f+t;F[i]=v>capPx?capPx:v}}}
  else{const sy=uy>0?1:-1,t=1/Math.abs(uy),dx=ux*t;
    for(let k=0;k<H;k++){const y=sy>0?H-1-k:k,py=y+sy,edge=py<0||py>=H;
      for(let x=0;x<W;x++){const i=y*W+x;if(!wa[i]){F[i]=0;continue}if(edge){F[i]=capPx;continue}
        const xx=x+dx;if(xx<0||xx>W-1){F[i]=capPx;continue}const x0=xx|0,f=xx-x0,x1=x0+1<W?x0+1:x0;
        const v=F[py*W+x0]*(1-f)+F[py*W+x1]*f+t;F[i]=v>capPx?capPx:v}}}
  return F}
const CAP_M=6000;
// Våghöjd vid begränsat öppet vatten (JONSWAP), max fullt utvecklad sjö
const wave=(U,F)=>Math.min(0.000511*U*Math.sqrt(F),0.0214*U*U);
const LA_CLASSES=[[0.1,"Lä","rgba(196,232,250,.82)"],[0.25,"Krusning","rgba(38,104,186,.62)"],[0.5,"Måttlig sjö","rgba(150,110,205,.6)"],[1,"Grov sjö","rgba(228,110,52,.65)"],[99,"Hård sjö","rgba(190,38,44,.68)"]];
const LA_DEF=[["under 0,1 m","Blankt eller små krusningar. Båten ligger still, lätt att ankra och fiska på drift."],
  ["0,1–0,25 m","Små vågor utan vita toppar. Bekvämt att fiska från liten båt."],
  ["0,25–0,5 m","Tydliga vågor, enstaka vita toppar. Båten gungar, stänk vid gång, svårare att stå upp och kasta."],
  ["0,5–1 m","Många vita toppar. Obekvämt och blött i mindre öppen båt, fiske blir svårt."],
  ["över 1 m","Hög och krabb sjö. Olämpligt för små båtar."]];
// SMHI:s benämningar för vindstyrka
const WIND_TERMS=[[0.3,"Lugnt"],[4,"Svag vind"],[8,"Måttlig vind"],[14,"Frisk vind"],[20,"Hård vind"],[25,"Mycket hård vind"],[33,"Storm"],[999,"Orkan"]];
const windTerm=v=>v==null?"":WIND_TERMS.find(x=>v<x[0])[1];
// Färg på vindpilarna efter medelvind: grön svag, gul måttlig, orange frisk, röd hård, mörkröd mycket hård
const WIND_COL=[[4,"#2E9E5B"],[8,"#D9A400"],[14,"#E8731C"],[20,"#D0281F"],[999,"#7A1238"]];
const windCol=v=>WIND_COL.find(x=>(v||0)<x[0])[1];
// Liten vågsymbol i klassens färg, högre våg för grövre sjö
const WAVE_COL=["#5FA9D6","#2668BA","#8E62CF","#E46E34","#BE262C"];
function waveIcon(k){const a=[1,2,3,4,5][k],y=8,c=WAVE_COL[k];
  return `<svg class="wv" width="22" height="14" viewBox="0 0 22 14" aria-hidden="true"><path d="M1 ${y} q2.5 ${-a} 5 0 t5 0 t5 0 t5 0" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/><path d="M1 ${y} q2.5 ${-a} 5 0 t5 0 t5 0 t5 0" fill="none" stroke="${c}" stroke-width="2.2" stroke-linecap="round"/></svg>`}
// Våghöjd som text, avrundad men alltid inom klassens gränser
const fmtWave=(h,k)=>{if(k===0)return"under 0,1 m";const lo=[0,.1,.3,.5,1][k],hi=[0,.2,.4,.9,99][k];return f1(Math.min(hi,Math.max(lo,Math.round(h*10)/10)))+" m"};
const LA_RGBA=LA_CLASSES.map(c=>c[2].match(/[\d.]+/g).map(Number));
let laR=null,laF=null,laWind=null,laU=null,laLee=null,fetchCache={key:null,F:null},lastR=null,lastSW=null;

// ------------------------------------------------------------------ vind på en plats och tid
let KI=null;
function windAt(lat,lon,ti){const W=S.wind;if(!W)return null;if(!KI)KI={ws:W.keys.indexOf("ws"),wd:W.keys.indexOf("wd"),gust:W.keys.indexOf("gust"),t:W.keys.indexOf("t"),pr:W.keys.indexOf("pr")};
  let sw=0,su=0,sv=0,sg=0,sgw=0,st=0,stw=0,sp=0,spw=0,best=null,bd=1e9;const cl=Math.cos(lat*Math.PI/180),P=W.points,SR=W.series;
  for(let i=0;i<P.length;i++){const r=SR[i][ti];if(!r)continue;const p=P[i],dx=(p[1]-lon)*cl,dy=p[0]-lat,d=dx*dx+dy*dy;
    if(d<bd){bd=d;best=r}if(d>0.09)continue;const ws=r[KI.ws],wd=r[KI.wd];if(ws==null||wd==null)continue;const w=1/(d+1e-5),a=wd*Math.PI/180;
    su+=w*ws*Math.sin(a);sv+=w*ws*Math.cos(a);sw+=w;const g=r[KI.gust],tt=r[KI.t],pp=r[KI.pr];
    if(g!=null){sg+=w*g;sgw+=w}if(tt!=null){st+=w*tt;stw+=w}if(pp!=null){sp+=w*pp;spw+=w}}
  if(!sw){if(!best)return null;return{ws:best[KI.ws],wd:best[KI.wd],gust:best[KI.gust],t:best[KI.t],pr:best[KI.pr]}}
  const ws=Math.hypot(su,sv)/sw;let wd=Math.atan2(su,sv)*180/Math.PI;if(wd<0)wd+=360;
  return{ws,wd,gust:sgw?sg/sgw:null,t:stw?st/stw:null,pr:spw?sp/spw:null}}
function currentWind(){if(S.src==="egen")return{ws:S.own.sp,wd:S.own.dir,gust:null};const c=map.getCenter();return windAt(c.lat,c.lng,S.ti)}
// Riktningen som lä räknas för: medel för hela området vid vald tid, så att resultatet
// inte ändras när kartan flyttas eller zoomas.
const domCache={};
function domainWind(ti){if(S.src==="egen")return{ws:S.own.sp,wd:S.own.dir,gust:null};const W=S.wind;if(!W)return null;const k=ti;if(domCache[k])return domCache[k];
  const ki=x=>W.keys.indexOf(x);let su=0,sv=0,n=0,sw=0,sg=0,ng=0;
  W.series.forEach(row=>{const r=row[ti];if(!r||r[ki("ws")]==null||r[ki("wd")]==null)return;const a=r[ki("wd")]*Math.PI/180;su+=r[ki("ws")]*Math.sin(a);sv+=r[ki("ws")]*Math.cos(a);sw+=r[ki("ws")];n++;if(r[ki("gust")]!=null){sg+=r[ki("gust")];ng++}});
  if(!n)return null;let wd=Math.atan2(su,sv)*180/Math.PI;if(wd<0)wd+=360;return domCache[k]={ws:sw/n,wd,gust:ng?sg/ng:null}}
// byar eller medelvind (egen vind räknas alltid som angiven styrka)
const calcU=w=>S.basis==="byar"&&w.gust!=null?Math.max(w.ws,w.gust):w.ws;
const DIR16=["N","NNO","NO","ONO","O","OSO","SO","SSO","S","SSV","SV","VSV","V","VNV","NV","NNV"];
const dirName=d=>DIR16[Math.round(d/22.5)%16];
const f1=v=>v==null||isNaN(v)?"–":v.toFixed(1).replace(".",",");
const f0=v=>v==null||isNaN(v)?"–":String(Math.round(v));

// ------------------------------------------------------------------ djup (EMODnet)
// Djupzoner i sjökortsstil: grunt är mörkare blått, djupt nästan vitt.
const DEPTH_STEPS=[0,3,6,10,15,20,30,50],DEPTH_COL=["#86BDE4","#A2CDEC","#BCDBF1","#D1E7F5","#E1EFF8","#ECF5FA","#F4F9FC","#FAFCFD"];
const depthBand=d=>{let k=0;while(k<DEPTH_STEPS.length-1&&d>=DEPTH_STEPS[k+1])k++;return k};
const depthTxt=k=>k===DEPTH_STEPS.length-1?`över ${DEPTH_STEPS[k]} m`:`${DEPTH_STEPS[k]}–${DEPTH_STEPS[k+1]} m`;
function depthAt(lat,lon){const G=S.depth;if(!G)return null;let fy=(lat-G.lat0)/G.dlat,fx=(lon-G.lon0)/G.dlon;if(fy<0||fx<0||fy>G.ny-1||fx>G.nx-1)return null;
  const y0=fy|0,x0=fx|0,y1=Math.min(G.ny-1,y0+1),x1=Math.min(G.nx-1,x0+1),ty=fy-y0,tx=fx-x0,D=G.D,W=G.nx;
  return((D[y0*W+x0]*(1-tx)+D[y0*W+x1]*tx)*(1-ty)+(D[y1*W+x0]*(1-tx)+D[y1*W+x1]*tx)*ty)/2}
function depthMeasured(lat,lon){const G=S.depth;if(!G)return false;const y=Math.round((lat-G.lat0)/G.dlat),x=Math.round((lon-G.lon0)/G.dlon);
  if(y<0||x<0||y>=G.ny||x>=G.nx)return false;const i=y*G.nx+x;return !!(G.M[i>>3]&(128>>(i&7)))}

// ------------------------------------------------------------------ SWAN
// Vågfält beräknade med vågmodellen SWAN för ett antal vindriktningar och vindstyrkor.
// För aktuell vind väljs närmaste riktning och de två närmaste styrkorna, och våghöjden
// interpoleras mellan dem. Används för vågmönstret när det finns för området.
const swanFiles=new Map();
function swanFile(name){if(swanFiles.has(name))return swanFiles.get(name);
  const p=getJSON("data/swan/"+(S.swan&&S.swan.dir?S.swan.dir+"/":"")+name+".json").then(r=>{const dec=s=>{const b=atob(s),a=new Uint8Array(b.length);for(let i=0;i<b.length;i++)a[i]=b.charCodeAt(i);return a};
    return{hs:dec(r.hs),tm:dec(r.tm),di:dec(r.di)}}).catch(()=>null);swanFiles.set(name,p);return p}
const swanName=(d,u)=>"d"+String(Math.round(d*10)).padStart(4,"0")+"_s"+String(u).padStart(2,"0");
async function swanCase(wd,U){const X=S.swan;if(!X)return null;const done=new Set(X.done);
  let best=null,bd=1e9;for(const d of X.dirs){const dd=Math.abs(((wd-d+540)%360)-180);if(dd<bd&&X.speeds.some(u=>done.has(swanName(d,u)))){bd=dd;best=d}}
  if(best==null)return null;const sp=X.speeds.filter(u=>done.has(swanName(best,u)));
  let a=sp[0],b=sp[0];for(const u of sp){if(u<=U)a=u;if(u>=U&&b<U)b=u}if(U>=sp[sp.length-1])a=b=sp[sp.length-1];if(U<=sp[0])a=b=sp[0];
  const [A,B]=await Promise.all([swanFile(swanName(best,a)),swanFile(swanName(best,b))]);if(!A||!B)return null;
  const t=b>a?(U-a)/(b-a):0,scale=a===b?U/a:1;return{A,B,t,scale,dir:best}}
// SWAN-fältet samplat på kartans rutnät: våghöjd (m), period (s) och vågriktning (grader, varifrån)
function swanSample(R,mz,C){const X=S.swan,N=R.W*R.H,H=new Float32Array(N).fill(-1),T=new Float32Array(N),D=new Float32Array(N);
  const rowF=new Float32Array(R.H),colF=new Float32Array(R.W);
  for(let y=0;y<R.H;y++){const lat=CRS.pointToLatLng(L.point(R.px0,R.py0+y+.5),mz).lat;rowF[y]=(lat-X.lat0)/X.dlat}
  for(let x=0;x<R.W;x++){const lon=CRS.pointToLatLng(L.point(R.px0+x+.5,R.py0),mz).lng;colF[x]=(lon-X.lon0)/X.dlon}
  const nx=X.nx,ny=X.ny,v=(arr,i)=>arr[i];
  for(let y=0;y<R.H;y++){const fy=rowF[y];if(fy<0||fy>ny-1.001)continue;const y0=fy|0,ty=fy-y0;
    for(let x=0;x<R.W;x++){const i=y*R.W+x;if(!R.water[i])continue;const fx=colF[x];if(fx<0||fx>nx-1.001)continue;const x0=fx|0,tx=fx-x0;
      let sh=0,st=0,sw=0,sx=0,sy=0;
      for(const [j,wt] of [[y0*nx+x0,(1-tx)*(1-ty)],[y0*nx+x0+1,tx*(1-ty)],[(y0+1)*nx+x0,(1-tx)*ty],[(y0+1)*nx+x0+1,tx*ty]]){
        const ha=C.A.hs[j],hb=C.B.hs[j];if(ha===255||hb===255||wt<=0)continue;
        sh+=wt*((ha*(1-C.t)+hb*C.t)/100);st+=wt*((C.A.tm[j]*(1-C.t)+C.B.tm[j]*C.t)/25);
        const a=(C.A.di[j]/254*360)*Math.PI/180;sx+=wt*Math.sin(a);sy+=wt*Math.cos(a);sw+=wt}
      if(sw>0){H[i]=sh/sw*C.scale;T[i]=st/sw;let d=Math.atan2(sx,sy)*180/Math.PI;if(d<0)d+=360;D[i]=d}}}
  return{H,T,D}}

// ------------------------------------------------------------------ lä för vinden
// Hur mycket vinden dämpas bakom öar, uddar och skog (från Lantmäteriets höjdmodell och skog i
// OpenStreetMap), en bild per vindriktning. Mellan riktningarna interpoleras det.
const vindFiles=new Map();
function vindFile(name){if(vindFiles.has(name))return vindFiles.get(name);
  const p=new Promise(res=>{const im=new Image();im.onload=()=>{const c=document.createElement("canvas");c.width=im.width;c.height=im.height;const g=c.getContext("2d");g.drawImage(im,0,0);
      const d=g.getImageData(0,0,im.width,im.height).data,a=new Uint8Array(im.width*im.height);for(let i=0;i<a.length;i++)a[i]=d[i*4];res(a)};
    im.onerror=()=>res(null);im.src="data/vind/"+name+".png"});
  vindFiles.set(name,p);return p}
let leeCache={key:null,LF:null};
async function leeField(R,mz,wd){const X=S.vind;if(!X)return null;
  const key=[mz,R.px0,R.py0,R.W,R.H,Math.round(wd)].join("|");if(leeCache.key===key)return leeCache.LF;
  const n=X.dirs.length,step=360/n,f=((wd%360)+360)%360/step,a=Math.floor(f)%n,b=(a+1)%n,t=f-Math.floor(f);
  const nm=d=>"d"+String(Math.round(X.dirs[d]*10)).padStart(4,"0");
  const [A,B]=await Promise.all([vindFile(nm(a)),vindFile(nm(b))]);if(!A||!B)return null;
  const N=R.W*R.H,LF=new Float32Array(N).fill(1),nx=X.nx,ny=X.ny,sc=X.scale||200;
  const rowF=new Float32Array(R.H),colF=new Float32Array(R.W);
  for(let y=0;y<R.H;y++){const lat=CRS.pointToLatLng(L.point(R.px0,R.py0+y+.5),mz).lat;rowF[y]=(X.lat0-lat)/X.dlat-.5}
  for(let x=0;x<R.W;x++){const lon=CRS.pointToLatLng(L.point(R.px0+x+.5,R.py0),mz).lng;colF[x]=(lon-X.lon0)/X.dlon-.5}
  for(let y=0;y<R.H;y++){const fy=rowF[y];if(fy<0||fy>ny-1.001)continue;const y0=fy|0,ty=fy-y0;
    for(let x=0;x<R.W;x++){const i=y*R.W+x;if(!R.water[i])continue;const fx=colF[x];if(fx<0||fx>nx-1.001)continue;const x0=fx|0,tx=fx-x0;
      const j=y0*nx+x0,bil=G=>(G[j]*(1-tx)+G[j+1]*tx)*(1-ty)+(G[j+nx]*(1-tx)+G[j+nx+1]*tx)*ty;
      LF[i]=Math.min(1,(bil(A)*(1-t)+bil(B)*t)/sc)}}
  leeCache={key,LF};return LF}

// ------------------------------------------------------------------ vattentemperatur
function tempAt(lat,lon,di){const G=S.temp;if(!G||di<0)return null;let fy=(lat-G.lat0)/G.dlat,fx=(lon-G.lon0)/G.dlon;
  fy=fy<0?0:fy>G.ny-1?G.ny-1:fy;fx=fx<0?0:fx>G.nx-1?G.nx-1:fx;const y0=fy|0,x0=fx|0,y1=Math.min(G.ny-1,y0+1),x1=Math.min(G.nx-1,x0+1),ty=fy-y0,tx=fx-x0,b=di*G.nx*G.ny,T=S.TF;
  return (T[b+y0*G.nx+x0]*(1-tx)+T[b+y0*G.nx+x1]*tx)*(1-ty)+(T[b+y1*G.nx+x0]*(1-tx)+T[b+y1*G.nx+x1]*tx)*ty}
const TSTOPS=[[0,"#2B4C8C"],[6,"#3F8FC0"],[12,"#9CCFC4"],[16,"#F1E3A6"],[20,"#EE9A5A"],[24,"#C8402E"]];
const TLUT=(()=>{const hex=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)),L_=new Uint8ClampedArray(256*3);
  for(let i=0;i<256;i++){const v=i/255*24;let k=0;while(k<TSTOPS.length-2&&v>TSTOPS[k+1][0])k++;const a=TSTOPS[k],b=TSTOPS[k+1],t=Math.max(0,Math.min(1,(v-a[0])/(b[0]-a[0]))),A=hex(a[1]),B=hex(b[1]);
    for(let j=0;j<3;j++)L_[i*3+j]=Math.round(A[j]+(B[j]-A[j])*t)}return L_})();
function tempDay(){const G=S.temp;if(!G||!S.wind)return -1;const t=new Date(S.wind.times[S.ti]),ds=new Date(t.getTime()-t.getTimezoneOffset()*6e4).toISOString().slice(0,10);
  let i=G.dates.indexOf(ds);if(i<0)i=ds<G.dates[0]?0:ds>G.dates.at(-1)?G.dates.length-1:-1;return i}
function smoothTemp(){const G=S.temp,n=G.nx*G.ny,F=new Float32Array(S.T.length);for(let i=0;i<F.length;i++)F[i]=S.T[i]/10-2;
  const tmp=new Float32Array(n);for(let d=0;d<G.dates.length;d++){const o=d*n;for(let pass=0;pass<2;pass++){
    for(let y=0;y<G.ny;y++)for(let x=0;x<G.nx;x++){let s=0,c=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const yy=y+dy,xx=x+dx;if(yy<0||xx<0||yy>=G.ny||xx>=G.nx)continue;s+=F[o+yy*G.nx+xx];c++}tmp[y*G.nx+x]=s/c}
    F.set(tmp,o)}}S.TF=F}
const lblLayer=L.layerGroup().addTo(map);
