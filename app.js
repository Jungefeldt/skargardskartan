/* Skärgårdskartan: lä, vind, väder och vattentemperatur på öppna kartor. */
(function () {
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

// ------------------------------------------------------------------ rita om
// Skikten räknas i samma rutnät: lä (öppet vatten mot vinden) och vattentemperatur
// per vattenpixel. Lä visas som yta, temperaturen som zoner med linjer emellan.
const zoneLayer=L.layerGroup().addTo(map),seaLayer=L.layerGroup().addTo(map),nameLayer=L.layerGroup().addTo(map);
// Egna namn från OpenStreetMap, ritade ovanpå alla lager så att de alltid syns.
// Orter först, sedan större öar och fjärdar, mindre namn dyker upp när man zoomar in.
const KIND_PRI={ort:0,land:1,vatten:2};
function nameCands(){const N=S.names;if(!N)return[];const z=map.getZoom(),b=map.getBounds(),out=[];
  for(const r of N){if(r[4]>z||!b.contains([r[1],r[2]]))continue;const fs=r[3]==="ort"?14:r[3]==="vatten"?13:13;
    out.push({ll:L.latLng(r[1],r[2]),html:`<div class="nm nm-${r[3]}">${r[0].replace(/</g,"&lt;")}</div>`,w:r[0].length*fs*.58+8,h:fs+6,
      score:1e6-(KIND_PRI[r[3]]*1e5)-r[4]*1e4+Math.min(9999,r[5]*100)})}
  return out}
let tRange=null,tStep=0.5,laT=null;
function chooseStep(r){return r<=6?1:2}
const fmtStep=v=>(Math.round(v*100)/100).toString().replace(".",",");
let seq=0,busy=false,again=false;
async function redraw(){if(busy){again=true;return}busy=true;const my=++seq;
  try{lblLayer.clearLayers();zoneLayer.clearLayers();seaLayer.clearLayers();
    const Lyr=S.layers,F_=S.find,needLa=Lyr.la||F_.on,needT=Lyr.temp||F_.on,di=needT?tempDay():-1;
    const haveT=needT&&di>=0&&S.temp,w=needLa?domainWind(S.ti):null,haveLa=needLa&&w&&w.ws!=null;
    hideCanvas("tint");
    const privOn=S.privOk&&Lyr.priv;
    const zz=map.getZoom(),mz=zz<=10?11:zz<=13?12:13,b=map.getBounds(),nw=CRS.latLngToPoint(b.getNorthWest(),mz),se=CRS.latLngToPoint(b.getSouthEast(),mz);
    let x0=Math.floor(nw.x),y0=Math.floor(nw.y),x1=Math.ceil(se.x),y1=Math.ceil(se.y);const vx0=x0,vy0=y0,vx1=x1,vy1=y1;
    const m=mpp(mz,map.getCenter().lat),cap=CAP_M/m;
    if(haveLa){const th=w.wd*Math.PI/180,ux=Math.sin(th),uy=-Math.cos(th);if(ux>-0.4)x1+=cap;if(ux<0.4)x0-=cap;if(uy<0.4)y0-=cap;if(uy>-0.4)y1+=cap;
      x0=Math.floor(x0);y0=Math.floor(y0);x1=Math.ceil(x1);y1=Math.ceil(y1)}
    const R=await region(mz,x0,y0,x1-x0,y1-y0);if(my!==seq)return;const N=R.W*R.H,WA=R.water;
    lastR=R;
    // kustlinje: skarp vektorlinje i skärmens upplösning, som på ett sjökort
    await drawCoast();if(my!==seq)return;
    if(!haveLa&&!haveT&&!privOn&&!(S.depth&&Lyr.depth)){hideCanvas();hideCanvas("zones");hideCanvas("crests");crestSet=null;reliefHide();laR=null;laT=null;drawArrows(placeNames(),true);legend();if(sel)sheet();return}
    // lä
    // riktningen avrundas till 5 grader; samma vy och riktning återanvänder beräkningen (snabb uppspelning)
    let F=null;if(haveLa){const dr=Math.round(w.wd/5)*5,key=[mz,R.px0,R.py0,R.W,R.H,dr].join("|");
      if(fetchCache.key===key)F=fetchCache.F;else{const A=fetchPass(R,dr-20,cap),B=fetchPass(R,dr,cap),C=fetchPass(R,dr+20,cap);F=new Float32Array(N);for(let i=0;i<N;i++)F[i]=(A[i]+2*B[i]+C[i])/4*m;fetchCache={key,F}}}
    laR=haveLa?R:null;laF=F;laWind=haveLa?w:null;
    let UF=null;if(haveLa){UF=new Float32Array(N);if(S.src==="egen")UF.fill(S.own.sp);else{const st=64,gw=Math.ceil(R.W/st)+1,gh=Math.ceil(R.H/st)+1,G2=new Float32Array(gw*gh);
        for(let gy=0;gy<gh;gy++)for(let gx=0;gx<gw;gx++){const ll=CRS.pointToLatLng(L.point(R.px0+gx*st,R.py0+gy*st),mz),lw=windAt(ll.lat,ll.lng,S.ti);G2[gy*gw+gx]=lw&&lw.ws!=null?calcU(lw):calcU(w)}
        for(let y=0;y<R.H;y++){const fy=y/st,y0=fy|0,ty=fy-y0,y1=Math.min(gh-1,y0+1);for(let x=0;x<R.W;x++){const fx=x/st,x0=fx|0,tx=fx-x0,x1=Math.min(gw-1,x0+1);
          UF[y*R.W+x]=(G2[y0*gw+x0]*(1-tx)+G2[y0*gw+x1]*tx)*(1-ty)+(G2[y1*gw+x0]*(1-tx)+G2[y1*gw+x1]*tx)*ty}}}}
    // lä bakom öar och skog: vinden dämpas där land och träd skymmer i vindens riktning
    let LF=null;if(haveLa&&S.vind){LF=await leeField(R,mz,w.wd);if(my!==seq)return;if(LF)for(let i=0;i<N;i++)if(WA[i])UF[i]*=LF[i]}
    laU=UF;laLee=LF;
    // vattentemperatur per pixel
    let TV=null,BAND=null;
    if(haveT){const G=S.temp,T=S.TF,base=di*G.nx*G.ny,rowFy=new Float32Array(R.H),colFx=new Float32Array(R.W);TV=new Float32Array(N);
      for(let y=0;y<R.H;y++){const lat=CRS.pointToLatLng(L.point(R.px0,R.py0+y+.5),mz).lat;rowFy[y]=Math.max(0,Math.min(G.ny-1,(lat-G.lat0)/G.dlat))}
      for(let x=0;x<R.W;x++){const lon=CRS.pointToLatLng(L.point(R.px0+x+.5,R.py0),mz).lng;colFx[x]=Math.max(0,Math.min(G.nx-1,(lon-G.lon0)/G.dlon))}
      let lo=99,hi=-99;
      for(let y=0;y<R.H;y++){const fy=rowFy[y],ya=fy|0,yb=Math.min(G.ny-1,ya+1),ty=fy-ya,r0=base+ya*G.nx,r1=base+yb*G.nx,inV=R.py0+y>=vy0&&R.py0+y<vy1;
        for(let x=0;x<R.W;x++){const i=y*R.W+x;if(!WA[i])continue;const fx=colFx[x],xa=fx|0,xb=Math.min(G.nx-1,xa+1),tx=fx-xa;
          const v=(T[r0+xa]*(1-tx)+T[r0+xb]*tx)*(1-ty)+(T[r1+xa]*(1-tx)+T[r1+xb]*tx)*ty;TV[i]=v;
          if(inV&&R.px0+x>=vx0&&R.px0+x<vx1){if(v<lo)lo=v;if(v>hi)hi=v}}}
      if(lo>hi){lo=hi=TV.find(v=>v)||0}
      tRange=[lo,hi];tStep=chooseStep(hi-lo);BAND=new Int16Array(N);for(let i=0;i<N;i++)BAND[i]=WA[i]?Math.floor(TV[i]/tStep):-999;
      {const smin=Math.floor(lo)-1,smax=Math.ceil(hi)+1;for(const id of ["tmin","tmax"]){$(id).min=smin;$(id).max=smax}}
      if(S.find.tmin==null){S.find.tmin=Math.floor(lo);S.find.tmax=Math.ceil(hi);syncFind()}}
    laT=TV;
    // djup per vattenpunkt (för djupskiktet och djupfiltret i Hitta plats)
    const patMode=(S.wstyle==="monster"||S.wstyle==="rorlig")&&haveLa&&Lyr.la&&!F_.on;
    const useDF=F_.on&&S.depth&&(F_.dmin>0||F_.dmax<60),needD=S.depth&&(Lyr.depth||useDF);let DV=null,DB=null;
    if(needD){const G=S.depth,Dg=G.D,GW=G.nx,rowF=new Float32Array(R.H),colF=new Float32Array(R.W);DV=new Float32Array(N);DB=new Int16Array(N).fill(-999);
      for(let y=0;y<R.H;y++){const lat=CRS.pointToLatLng(L.point(R.px0,R.py0+y+.5),mz).lat;rowF[y]=Math.max(0,Math.min(G.ny-1.001,(lat-G.lat0)/G.dlat))}
      for(let x=0;x<R.W;x++){const lon=CRS.pointToLatLng(L.point(R.px0+x+.5,R.py0),mz).lng;colF[x]=Math.max(0,Math.min(G.nx-1.001,(lon-G.lon0)/G.dlon))}
      for(let y=0;y<R.H;y++){const fy=rowF[y],ya=fy|0,ty=fy-ya,r0=ya*GW,r1=r0+GW;for(let x=0;x<R.W;x++){const i=y*R.W+x;if(!WA[i])continue;const fx=colF[x],xa=fx|0,tx=fx-xa;
          const d=((Dg[r0+xa]*(1-tx)+Dg[r0+xa+1]*tx)*(1-ty)+(Dg[r1+xa]*(1-tx)+Dg[r1+xa+1]*tx)*ty)/2;DV[i]=d;DB[i]=depthBand(d)}}}
    // SWAN-fält för vågmönstret, om det finns för området
    let SW=null;if(patMode&&S.swan){const C=await swanCase(w.wd,S.src==="egen"?S.own.sp:calcU(w));if(my!==seq)return;if(C){SW=swanSample(R,mz,C);SW.dir=C.dir;
        // utanför SWAN-området: våghöjd från den enklare beräkningen och vågriktning efter vinden
        for(let i=0;i<N;i++)if(WA[i]&&SW.H[i]<0){SW.H[i]=wave(UF[i],F[i]);SW.D[i]=w.wd;SW.T[i]=-1}
        // SWAN räknar med samma vind överallt; i vindlä bakom land och skog blir vågorna lägre
        if(LF)for(let i=0;i<N;i++)if(SW.T[i]>=0&&SW.H[i]>0)SW.H[i]*=LF[i]}}
    lastSW=SW?{R,mz,...SW}:null;
    // klasser per vattenpunkt (används både för ytorna och etiketterna)
    const showLa=haveLa&&Lyr.la,showT=haveT&&Lyr.temp,findOn=F_.on&&haveLa&&haveT;
    const HS=i=>SW&&SW.H[i]>=0?SW.H[i]:wave(UF[i],F[i]);
    let KARR=null,FOK=null;
    if(showLa&&!findOn){KARR=new Int16Array(N).fill(-999);for(let i=0;i<N;i++){if(!WA[i])continue;let k=0;const h=HS(i);while(h>=LA_CLASSES[k][0])k++;KARR[i]=k}}
    if(findOn){FOK=new Int16Array(N).fill(-999);for(let i=0;i<N;i++){if(!WA[i])continue;let k=0;const h=wave(UF[i],F[i]);while(h>=LA_CLASSES[k][0])k++;const tv=TV[i];
        FOK[i]=k<=F_.maxK&&tv>=F_.tmin&&tv<=F_.tmax&&!(S.privOk&&R.priv[i])&&(!useDF||(DV[i]>=F_.dmin&&DV[i]<=F_.dmax))?1:0}}
    hideCanvas();
    const showD=!!(S.depth&&Lyr.depth&&DB),pat=patMode&&!!KARR;
    let RELIEF=null;if(pat&&S.wstyle==="rorlig"&&reliefPossible(w.wd)){RELIEF=new Float32Array(N);for(let i=0;i<N;i++)if(WA[i])RELIEF[i]=HS(i)}
    drawZones(R,vx0,vy0,vx1,vy1,mz,{RELIEF,FOK,KARR:pat?null:KARR,KPAT:pat?KARR:null,BAND:(showT||findOn)?BAND:null,
      tempFill:showT&&!showLa&&!findOn&&!showD,wdir:w?w.wd:null,wspd:w?(S.src==="egen"?S.own.sp:calcU(w)):null,SW:pat?SW:null,FV:pat?F:null,UV:pat?UF:null,mpz:m,DB:showD?DB:null,depthFill:showD&&((!showLa&&!findOn)||pat),priv:privOn?R.priv:null});
    // etiketter: namn först, sedan vindpilar, vattentemperatur och sjögång, utan krockar
    const boxes=placeNames();drawArrows(boxes,true);
    if(showT||findOn)placeLabels(boxes,zoneCands(R,BAND,mz,vx0,vy0,vx1,vy1,b=>{const s=(b*tStep)+"–"+((b+1)*tStep)+"°";return{html:'<div class="zlbl">'+s+'</div>',w:s.length*7+6,h:16}},5,260,30),zoneLayer);
    if(showD)placeLabels(boxes,zoneCands(R,DB,mz,vx0,vy0,vx1,vy1,b=>{const s=depthTxt(b);return{html:'<div class="dlbl">'+s+'</div>',w:s.length*6.6+6,h:15}},5,280,30),zoneLayer);
    if(showLa&&KARR&&S.layers.waves)placeLabels(boxes,zoneCands(R,KARR,mz,vx0,vy0,vx1,vy1,(k,i)=>{const h=HS(i),a=fmtWave(h,k),b2=LA_CLASSES[k][1].replace(" sjö","").toLowerCase();
      return{html:'<div class="slbl">'+waveIcon(k)+'<b>'+a+'</b><em>'+b2+'</em></div>',w:Math.max(a.length,b2.length)*7.2+14,h:46}},8,240,40),seaLayer);
    legend();if(sel)sheet()}
  catch(e){console.error(e)}
  finally{busy=false;if(again){again=false;redraw()}}}
// Etikettkandidater för zoner, räknade bara inom det som syns. Varje synlig zondel får en
// etikett i sin mest inre punkt, och stora zoner flera med avstånd emellan.
function zoneCands(R,ARR,mz,vx0,vy0,vx1,vy1,mk,minSize,sepPx,size){const sc=Math.pow(2,map.getZoom()-mz),c=Math.max(3,Math.round(10/sc)),ox=vx0-R.px0,oy=vy0-R.py0;
  const CW=Math.floor((vx1-vx0)/c),CH=Math.floor((vy1-vy0)/c),n=CW*CH;if(CW<3||CH<3)return[];
  const cb=new Int16Array(n),dist=new Int16Array(n).fill(-1),comp=new Int32Array(n).fill(-1),q=new Int32Array(n);
  for(let cy=0;cy<CH;cy++)for(let cx=0;cx<CW;cx++){const yy=oy+cy*c+(c>>1),xx=ox+cx*c+(c>>1);cb[cy*CW+cx]=yy>=0&&xx>=0&&yy<R.H&&xx<R.W?ARR[yy*R.W+xx]:-999}
  let qh=0,qt=0;for(let j=0;j<n;j++){if(cb[j]===-999)continue;const x=j%CW,y=(j/CW)|0;
    if(x===0||y===0||x===CW-1||y===CH-1||cb[j-1]!==cb[j]||cb[j+1]!==cb[j]||cb[j-CW]!==cb[j]||cb[j+CW]!==cb[j]){dist[j]=1;q[qt++]=j}}
  while(qh<qt){const j=q[qh++],x=j%CW;for(const k of [x>0?j-1:-1,x<CW-1?j+1:-1,j-CW,j+CW]){if(k<0||k>=n||dist[k]!==-1||cb[k]!==cb[j])continue;dist[k]=dist[j]+1;q[qt++]=k}}
  const out=[],sep=sepPx/(sc*c),sep2=sep*sep,need=Math.max(2,Math.ceil(size/(2*sc*c)));
  for(let j=0;j<n;j++){if(cb[j]===-999||comp[j]!==-1)continue;let h=0,t2=0;q[t2++]=j;comp[j]=j;
    while(h<t2){const u=q[h++],x=u%CW;for(const k of [x>0?u-1:-1,x<CW-1?u+1:-1,u-CW,u+CW]){if(k<0||k>=n||comp[k]!==-1||cb[k]!==cb[j])continue;comp[k]=j;q[t2++]=k}}
    if(t2<minSize)continue;const cells=Array.from(q.subarray(0,t2)).filter(u=>dist[u]>=need).sort((a,b)=>dist[b]-dist[a]),picked=[];
    for(const u of cells){const ux=u%CW,uy=(u/CW)|0;if(picked.some(p=>(p[0]-ux)**2+(p[1]-uy)**2<sep2))continue;picked.push([ux,uy]);
      const px=vx0+ux*c+c/2,py=vy0+uy*c+c/2,ix=(oy+uy*c+(c>>1))*R.W+ox+ux*c+(c>>1),m=mk(cb[u],ix);if(!m)continue;
      out.push({ll:CRS.pointToLatLng(L.point(px,py),mz),html:m.html,w:m.w,h:m.h,score:dist[u]});if(picked.length>=4)break}}
  return out}
// Kustlinjen räknas fram ur masken med "marching squares" och ritas som en tunn linje.
// Masken hämtas i så hög upplösning som zoomen kräver (upp till ca 10 m per punkt).
const MS=[[],[[0,.5,.5,1]],[[.5,1,1,.5]],[[0,.5,1,.5]],[[.5,0,1,.5]],[[.5,0,0,.5],[.5,1,1,.5]],[[.5,0,.5,1]],[[.5,0,0,.5]],
  [[.5,0,0,.5]],[[.5,0,.5,1]],[[.5,0,1,.5],[0,.5,.5,1]],[[.5,0,1,.5]],[[0,.5,1,.5]],[[.5,1,1,.5]],[[0,.5,.5,1]],[]];
// Slutna, utjämnade konturer runt alla punkter där M=1. Koordinater i halva punkter med
// en ram på 2, så att PX=(v-2)*h ger läget i en canvas med skalan 2h per punkt.
function traceLoops(M0,W0,H0,r){r=r==null?3:r;const W=W0+2,H=H0+2,M=new Uint8Array(W*H);for(let y=0;y<H0;y++)M.set(M0.subarray(y*W0,(y+1)*W0),(y+1)*W+1);
  const segs=[];for(let y=0;y<H-1;y++){const r0=y*W,r1=r0+W;for(let xx=0;xx<W-1;xx++){
      const cs=(M[r0+xx]?8:0)|(M[r0+xx+1]?4:0)|(M[r1+xx+1]?2:0)|(M[r1+xx]?1:0);if(cs===0||cs===15)continue;
      for(const s of MS[cs])segs.push(2*xx+1+2*s[0],2*y+1+2*s[1],2*xx+1+2*s[2],2*y+1+2*s[3])}}
  const KEY=p=>p[0]*65536+p[1],adj=new Map(),n=segs.length/4,used=new Uint8Array(n);
  for(let i=0;i<n;i++)for(const e of [0,2]){const kk=segs[i*4+e]*65536+segs[i*4+e+1];let l=adj.get(kk);if(!l)adj.set(kk,l=[]);l.push(i)}
  const lines=[];
  for(let i=0;i<n;i++){if(used[i])continue;used[i]=1;let pts=[[segs[i*4],segs[i*4+1]],[segs[i*4+2],segs[i*4+3]]];
    for(const dir of [1,0]){for(;;){const end=dir?pts[pts.length-1]:pts[0],l=adj.get(KEY(end));let nx=-1;if(l)for(const j of l)if(!used[j]){nx=j;break}if(nx<0)break;used[nx]=1;
        const a2=[segs[nx*4],segs[nx*4+1]],b2=[segs[nx*4+2],segs[nx*4+3]],other=(a2[0]===end[0]&&a2[1]===end[1])?b2:a2;if(dir)pts.push(other);else pts.unshift(other)}}
    lines.push(pts)}
  const smooth=p=>{if(p.length<3)return p;const closed=p[0][0]===p[p.length-1][0]&&p[0][1]===p[p.length-1][1],o2=[];if(!closed)o2.push(p[0]);
    for(let i=0;i<p.length-1;i++){const a3=p[i],b3=p[i+1];o2.push([.75*a3[0]+.25*b3[0],.75*a3[1]+.25*b3[1]],[.25*a3[0]+.75*b3[0],.25*a3[1]+.75*b3[1]])}
    if(closed)o2.push(o2[0]);else o2.push(p[p.length-1]);return o2};
  const avg=(p,r)=>{const L2=p.length;if(L2<2*r+2)return p;const closed=p[0][0]===p[L2-1][0]&&p[0][1]===p[L2-1][1],o2=[];
    for(let i=0;i<L2;i++){let sx=0,sy=0,c2=0;for(let j=-r;j<=r;j++){let q=i+j;if(closed){q=(q+L2-1)%(L2-1)}else{if(q<0||q>=L2)continue}sx+=p[q][0];sy+=p[q][1];c2++}o2.push([sx/c2,sy/c2])}
    if(!closed){o2[0]=p[0];o2[L2-1]=p[L2-1]}return o2};
  const out=lines.map(p=>smooth(r?avg(p,r):p));out.W=W;out.H=H;return out}
function fillLoops(x,loops,h,color){const PX=v=>(v-2)*h;x.fillStyle=color;x.beginPath();
  for(const p of loops){x.moveTo(PX(p[0][0]),PX(p[0][1]));for(let i=1;i<p.length;i++)x.lineTo(PX(p[i][0]),PX(p[i][1]));x.closePath()}x.fill("evenodd")}
function strokeLoops(x,loops,h,color,width){const PX=v=>(v-2)*h,W=loops.W,H=loops.H,edge=q=>q[0]<2.6||q[1]<2.6||q[0]>2*W-2.6||q[1]>2*H-2.6;
  x.lineWidth=width;x.lineJoin="round";x.lineCap="round";x.strokeStyle=color;x.beginPath();
  for(const p of loops){let pen=false;for(const q of p){if(edge(q)){pen=false;continue}if(pen)x.lineTo(PX(q[0]),PX(q[1]));else{x.moveTo(PX(q[0]),PX(q[1]));pen=true}}}x.stroke()}
function overlayCanvas(pane,z,px0,py0,W0,H0,k){const b=L.latLngBounds(CRS.pointToLatLng(L.point(px0,py0+H0),z),CRS.pointToLatLng(L.point(px0+W0,py0),z));
  let o=overlays[pane];if(!o){o=overlays[pane]=new CanvasOverlay("",b,{pane,interactive:false}).addTo(map)}else o.setBounds(b);
  const c=o.getElement();c.width=Math.round(W0*k);c.height=Math.round(H0*k);const x=c.getContext("2d");x.clearRect(0,0,c.width,c.height);return x}
// Färger som täckande toner (blandade mot kartans vattenblå), så att zonerna inte blandas med varandra
const SEA=[170,211,223],mixc=(c,a)=>`rgb(${c.map((v,i)=>Math.round(v*a+SEA[i]*(1-a))).join(",")})`;
const LA_SOLID=LA_RGBA.map(c=>mixc(c.slice(0,3),c[3]));
const FIND_SOLID=[mixc([70,80,88],.37),mixc([214,24,138],.67)];
// Vågmönster för sjögången: tunna svarta vågstreck, längre och högre ju grövre sjö (lä får inget mönster)
const WAVE_PAT=[null,{l:8,a:.8,s:9,w:.6,o:.42},{l:14,a:2.1,s:12,w:.8,o:.58},{l:21,a:3.4,s:15,w:1.05,o:.72},{l:28,a:4.8,s:18,w:1.35,o:.85}];
// Vågkammarnas tjocklek och styrka per klass: tunna och ljusa vid krusning, kraftiga och mörka vid hård sjö
const CREST_W=[0,.6,1.3,2.2,3.0],CREST_O=[0,.45,.65,.84,.94];   // för förklaringen (mitt i varje klass)
// Vågprofilen är en trokoid: spetsiga toppar åt det håll vinden blåser, rundade dalar bakom
const WAVE_Q=.62;
function waveLine(g,tw,yc,A,steps){for(let s=0;s<=steps;s++){const t=2*Math.PI*s/steps,X=tw*(t-WAVE_Q*Math.sin(t))/(2*Math.PI),Y=yc-A*Math.cos(t);if(s)g.lineTo(X,Y);else g.moveTo(X,Y)}}
function wavePattern(ctx,k,dpr,ox,oy,ang){const P=WAVE_PAT[k];if(!P)return null;const tw=Math.round(P.l*dpr),th=Math.round(P.s*dpr),c=document.createElement("canvas");c.width=tw;c.height=th;
  const g=c.getContext("2d");g.strokeStyle=`rgba(15,20,25,${P.o})`;g.lineWidth=P.w*dpr;g.lineCap="round";g.lineJoin="round";g.beginPath();
  waveLine(g,tw,th/2,P.a*dpr,48);g.stroke();
  // kammarna ligger tvärs mot vinden; mönstret är fast mot kartan och vrids efter vindriktningen
  const pat=ctx.createPattern(c,"repeat");if(pat.setTransform&&typeof DOMMatrix!=="undefined")pat.setTransform(new DOMMatrix().translateSelf(-ox,-oy).rotateSelf(ang||0));return pat}
function wavePatternSVG(k){const P=WAVE_PAT[k];if(!P)return'<i style="background:#fff"></i>';const w=28,h=12,gap=[0,5,8,12,16][k],bow=[0,1,2,3,4][k];let d="";
  for(let x0=2;x0<w;x0+=gap)d+=` M${x0} 0 Q${x0+bow*2} ${h/2} ${x0} ${h}`;
  return`<svg width="${w}" height="${h}" style="vertical-align:-2px;border:1px solid rgba(0,0,0,.2);border-radius:3px;background:#D6E9F5"><path d="${d}" fill="none" stroke="#11171c" stroke-opacity="${CREST_O[k]}" stroke-width="${CREST_W[k]}"/></svg>`}
// Steglös tjocklek och mörkhet på vågkammarna efter våghöjden (interpolerat mellan klassernas värden)
const CREST_GRADE=[[0.1,.5,.42],[0.25,1.0,.6],[0.5,1.8,.78],[1.0,2.8,.92],[1.6,3.3,.96]];
function crestWidth(H){const G=CREST_GRADE;if(H<=G[0][0])return G[0][1];for(let i=1;i<G.length;i++)if(H<=G[i][0]){const a=G[i-1],b=G[i];return a[1]+(b[1]-a[1])*(H-a[0])/(b[0]-a[0])}return G[G.length-1][1]}
function crestOpacity(w){const G=CREST_GRADE;if(w<=G[0][1])return G[0][2]*Math.max(0,w)/G[0][1];for(let i=1;i<G.length;i++)if(w<=G[i][1]){const a=G[i-1],b=G[i];return a[2]+(b[2]-a[2])*(w-a[1])/(b[1]-a[1])}return G[G.length-1][2]}
// Ritar linjer vars tjocklek följer våghöjden längs linjen. Våghöjden jämnas ut längs linjen och
// tjockleken delas i fina steg, så att övergångarna blir mjuka utan synliga skarvar. Där en linje
// tar slut smalnar den av och tonas ut, i stället för att sluta tvärt.
function strokeGraded(x,lines,dpr,hAt,toC,isEdge,vAt){const STEP=.1,TAPER=80*dpr,THIN=.35,buckets=new Map();
  for(const Lp of lines){const n=Lp.length;if(n<2)continue;const H=new Float32Array(n);for(let i=0;i<n;i++)H[i]=hAt(Lp[i]);
    // dela upp i sammanhängande bitar (där det inte är lä) och mät avståndet längs varje bit
    let a=0;while(a<n){while(a<n&&H[a]<0.1)a++;if(a>=n)break;let b=a;while(b+1<n&&H[b+1]>=0.1)b++;
      const C=[];for(let i=a;i<=b;i++){const c=toC(Lp[i]),v=vAt?vAt(Lp[i]):[0,0];C.push([c[0],c[1],v[0],v[1]])}const D=new Float32Array(C.length);
      for(let i=1;i<C.length;i++)D[i]=D[i-1]+Math.hypot(C[i][0]-C[i-1][0],C[i][1]-C[i-1][1]);const len=D[C.length-1];
      // ändar som bara går ut över kartbildens kant tonas inte ut
      const edge=p=>isEdge&&isEdge(p),t0=!(edge(Lp[a])||(a>0&&edge(Lp[a-1]))),t1=!(edge(Lp[b])||(b<n-1&&edge(Lp[b+1])));
      const tl=Math.min(TAPER,t0&&t1?len/2:len);
      let run=null,lev=-1;
      for(let q=0;q<C.length;q++){const i=a+q;let s=0,c=0;for(let j=Math.max(a,i-6);j<=Math.min(b,i+6);j++){s+=H[j];c++}
        // mot ändarna: först smalnar linjen av mjukt till ett tunt streck, sedan tonas det tunna strecket bort
        const e=Math.min(t0?D[q]:1e9,t1?len-D[q]:1e9),tp=tl>0?Math.min(1,e/tl):0,full=crestWidth(s/c),o0=crestOpacity(full);let w,o;
        if(tp<.4){w=Math.min(THIN,full);o=o0*.85*(tp/.4)}
        else{const u=(tp-.4)/.6,sm=u*u*(3-2*u);w=THIN+(full-THIN)*sm;o=o0*(.85+.15*sm)}
        const l=Math.max(1,Math.round(w/STEP)),oq=Math.round(o*20),key=l*100+oq;
        if(oq<1){run=null;lev=-1;continue}
        if(key!==lev||!run){if(run)run.push(C[q]);run=[];lev=key;let bk=buckets.get(key);if(!bk)buckets.set(key,bk=[]);bk.push(run)}run.push(C[q])}
      a=b+1}}
  // linjerna sparas som tjocklek, färg och punkter [x, y, förflyttning x, förflyttning y]
  const out=[];for(const [key,runs] of buckets){const w=Math.floor(key/100)*STEP,o=(key%100)/20;
    out.push({w:w*dpr,c:`rgba(15,20,25,${o.toFixed(3)})`,runs:runs.filter(r=>r.length>=2).map(r=>Float32Array.from(r.flat()))})}
  return out}
// Ritar vågkammarna, förflyttade en andel (frac) av avståndet till nästa kam i gångriktningen.
// Animeras frac från 0 till 1 vandrar varje kam fram till där nästa låg, så rörelsen loopar sömlöst.
let crestSet=null,animOn=false,animT0=0,animRAF=0;
const WAVE_PERIOD_MS=2600;      // en vågperiod i animationen
function drawCrestSet(frac){const A=crestSet;if(!A)return;const x=A.x;x.clearRect(0,0,A.cw,A.ch);x.lineCap="round";x.lineJoin="round";
  for(const b of A.buckets){x.lineWidth=b.w;x.strokeStyle=b.c;x.beginPath();
    for(const r of b.runs){x.moveTo(r[0]+frac*r[2],r[1]+frac*r[3]);for(let i=4;i<r.length;i+=4)x.lineTo(r[i]+frac*r[i+2],r[i+1]+frac*r[i+3])}x.stroke()}
  A.clip(x)}
let animPh=0,animLast=0;
function animLoop(ts){if(!animOn||!crestSet){animRAF=0;animLast=0;return}if(animLast)animPh=(animPh+Math.min(100,ts-animLast)*animRate()/WAVE_PERIOD_MS)%1;animLast=ts;
  drawCrestSet(animPh);animRAF=requestAnimationFrame(animLoop)}
function startAnim(){animOn=S.wstyle==="rorlig";if(!animOn&&animRAF){cancelAnimationFrame(animRAF);animRAF=0}
  if(animOn&&crestSet&&!animRAF){animT0=performance.now();animRAF=requestAnimationFrame(animLoop)}}
document.addEventListener("visibilitychange",()=>{if(document.hidden){cancelAnimationFrame(animRAF);animRAF=0}else startAnim()});
// ------------------------------------------------------------------ rörliga vågor i relief (WebGL)
// Vågytan räknas på grafikkortet som en summa av många vågor med olika riktning och längd
// (kortkammad vindsjö, fler små än stora). Varje våg uttrycks i fasfälten P (längs vågornas
// gångriktning) och Q (tvärs över), som räknats i förväg från SWAN (data/fas), så att vågorna
// följer SWAN:s riktning och böjer sig runt öarna. Längre vågor går fortare, så mönstret
// upprepar sig aldrig. Ytan skuggas som en terrängkarta med ljuset lågt från det håll vågorna
// går mot: framsidorna ljusa, baksidorna i skugga.
const NCOMP=48,F0=1/2.6,REL_EX=20;   // REL_EX: hur mycket vågornas höjd överdrivs i skuggningen
const WCOMP=(()=>{let s=12345;const rnd=()=>{s=(s*1103515245+12345)%2147483648;return s/2147483648};
  const gauss=()=>{let u=0;while(!u)u=rnd();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*rnd())};
  const out=[];let sum=0;
  for(let i=0;i<NCOMP;i++){const r=Math.exp(Math.log(0.6)+(i+rnd())/NCOMP*Math.log(10));const spread=0.45+0.25*Math.max(0,Math.log(r));
    const th=Math.max(-1.5,Math.min(1.5,gauss()*spread));
    const a=(r<1?Math.exp(-(Math.log(r)**2)/0.08):Math.pow(r,-2))*Math.cos(th)**2*Math.sqrt(-2*Math.log(Math.max(1e-6,rnd())));
    out.push([r*1.6,th,a,rnd()*2*Math.PI]);sum+=a*a}
  const n=Math.sqrt(sum);return out.map(c=>[c[0],c[1],c[2]/n,c[3]])})();
const WG={ok:null,gl:null,canvas:null,prog:null,u:{},tex:{},name:null,raf:0,t0:performance.now(),st:null,tAcc:0,last:0};
// tempo i animationen efter zoom: snabbare inzoomat, långsammare utzoomat (zoom 13 = normalt)
// Taket är verklig takt: vågperioden i animationen blir aldrig kortare än riktiga vågors period
// vid den aktuella vinden (JONSWAP, ca 4 km vindsträcka). Utzoomat går vågorna långsammare.
let rateCap=1;
const animRate=()=>Math.min(rateCap,Math.pow(1.5,map.getZoom()-13));
function setRateCap(U,uS){U=Math.max(2,U||10);const Treal=0.286*Math.cbrt(9.81*4000/(U*U))*U/9.81,Tvis=1/(F0*Math.sqrt(1.6*uS));rateCap=Math.max(.3,Math.min(1.2,Tvis/Treal))}
const VS="attribute vec2 a;varying vec2 v;void main(){v=vec2(a.x*.5+.5,.5-a.y*.5);gl_Position=vec4(a,0.,1.);}";
const FS=`precision highp float;
varying vec2 v;
uniform sampler2D uP,uQ,uHW;
uniform vec4 uPR,uGeo,uGrid,uC[${NCOMP}],uD[${NCOMP}];
uniform vec2 uN,uM;
uniform float uT,uPx,uEx,uS;
uniform vec2 uTx;
float hash(vec2 p){p=mod(p,997.);return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
float lace(vec2 p){return .55*vnoise(p)+.3*vnoise(p*2.3+7.1)+.15*vnoise(p*5.1+3.7);}   // oregelbunden skumstruktur
float dec(sampler2D s,vec2 ij){vec4 c=texture2D(s,(ij+.5)/uN);return(c.r*65280.+c.g*255.)/65535.;}
float fld(sampler2D s,vec2 g){vec2 p=g-.5,i=floor(p),f=p-i;
  return mix(mix(dec(s,i),dec(s,i+vec2(1.,0.)),f.x),mix(dec(s,i+vec2(0.,1.)),dec(s,i+vec2(1.,1.)),f.x),f.y);}
void main(){
  vec4 hw=texture2D(uHW,v);if(hw.g<.02){gl_FragColor=vec4(0.);return;}
  float H=hw.r*255./200.,dist=hw.b*255.*.5;                           // våghöjd (m), avstånd till land (m)
  // åt vilket håll land ligger (avståndsfältets lutning)
  float dR=texture2D(uHW,v+vec2(uTx.x,0.)).b,dL=texture2D(uHW,v-vec2(uTx.x,0.)).b;
  float dU=texture2D(uHW,v-vec2(0.,uTx.y)).b,dD=texture2D(uHW,v+vec2(0.,uTx.y)).b;
  vec2 gd=vec2(dR-dL,dU-dD);
  float lon=mix(uGeo.x,uGeo.y,v.x),lat=mix(uGeo.z,uGeo.w,v.y);
  vec2 g=vec2((lon-uGrid.x)/uGrid.z,(uGrid.y-lat)/uGrid.w);
  float P=uPR.x+(uPR.y-uPR.x)*fld(uP,g),Q=uPR.z+(uPR.w-uPR.z)*fld(uQ,g);
  float Px=uPR.x+(uPR.y-uPR.x)*fld(uP,g+vec2(1.,0.)),Py=uPR.x+(uPR.y-uPR.x)*fld(uP,g+vec2(0.,1.));
  float Qx=uPR.z+(uPR.w-uPR.z)*fld(uQ,g+vec2(1.,0.)),Qy=uPR.z+(uPR.w-uPR.z)*fld(uQ,g+vec2(0.,1.));
  vec2 gP=vec2((Px-P)/uM.x,(P-Py)/uM.y),gQ=vec2((Qx-Q)/uM.x,(Q-Qy)/uM.y);   // per meter, öster och norr
  float lam=1./max(length(gP),1e-5);
  // svagare vind: kortare och långsammare vågor (uS > 1 gör alla vågor kortare)
  vec2 gr=vec2(0.);float eta=0.,ss=sqrt(uS);
  for(int i=0;i<${NCOMP};i++){vec4 c=uC[i];vec4 d=uD[i];
    float fade=smoothstep(3.,8.,lam*d.y/(uS*uPx));if(fade<=0.)continue;     // för korta vågor för pixlarna tonas bort
    float a=uS*(c.x*P+c.y*Q)-d.x*ss*uT+c.w;float A=c.z*fade;
    gr-=A*uS*sin(a)*(c.x*gP+c.y*gQ);eta+=A*cos(a);}
  // nära land dör vågorna ut
  float D0=25.+60.*H,near=1.-smoothstep(0.,D0,dist);
  // konturlinje runt varje vågtopp: avståndet till nivån eta=0,35 i pixlar, så att linjen alltid är ungefär en pixel bred
  float inkPx=abs(eta-.35)/max(length(gr),1e-6)/uPx;
  float ink=(1.-smoothstep(.45,1.3,inkPx))*smoothstep(.06,.3,H)*(1.-near);
  // brantare toppar och flackare dalar, som hos riktiga vindvågor: ger skarpare kanter
  gr*=H*uEx*(1.-.75*near)*(1.+1.3*clamp(eta,0.,1.2));
  vec3 n=normalize(vec3(-gr,1.));
  vec2 tr=gP/max(length(gP),1e-6);float e=.61;                      // ljuset 35 grader upp, från dit vågorna går
  float lit=max(dot(n,vec3(tr*cos(e),sin(e))),0.)/sin(e);
  float soft=mix(.3,.15,clamp(H/.5,0.,1.));
  float rel=(1.-soft)*lit+soft*pow(n.z,4.);
  rel=mix(1.,rel,smoothstep(.02,.4,H));                               // låg sjö: bara svaga krusningar
  vec3 base=mix(vec3(.667,.827,.875),vec3(.463,.659,.776),clamp(H/.45,0.,1.));
  rel=rel<1.?pow(rel,1.6):rel;                                        // mörkare skuggsidor, tydligare kant mot den ljusa sidan
  vec3 col=base*(.38+.62*clamp(rel,0.,1.6))+.26*clamp(rel-1.,0.,1.);
  col=mix(col,vec3(.07,.15,.23),ink*.65);                             // konturlinjen
  // Skum: (1) bränningar där kammarna slår mot en exponerad strand, (2) en sköljzon längs strandkanten
  // som pulserar när vågorna sköljer upp, (3) vita gäss på de högsta kammarna i grov sjö.
  // Skummet har en oregelbunden struktur som följer med vågorna.
  float expo=length(gd)>.002?clamp(dot(tr,-normalize(gd)),0.,1.):0.;
  float h=smoothstep(.08,.35,H);
  float crest=smoothstep(.0,.6,eta);
  float zone=1.-smoothstep(0.,20.+55.*H,dist),swash=1.-smoothstep(0.,10.+28.*H,dist);
  float shore=expo*h*zone,wcp=smoothstep(.3,.65,H)*smoothstep(.5,.9,eta)*(1.-near);
  if(shore>.01||wcp>.01){                                              // strukturen räknas bara där det kan bli skum
    vec2 fp=vec2(uS*P*5.-uT*.5,uS*Q*5.);
    float l1=lace(fp),l2=lace(fp*2.1+3.3);
    float brk=shore*(1.3*crest*smoothstep(.3,.55,l1)+.6*smoothstep(.5,.7,l2));
    float sw=expo*h*swash*(.55+.45*sin(uT*1.7+uS*P*6.283))*smoothstep(.3,.55,l1);
    float foam=clamp(brk+sw+1.2*wcp*smoothstep(.45,.65,l2),0.,.95);
    col=mix(col,vec3(.97,.985,.99)*(.93+.07*clamp(lit,0.,1.)),foam);}
  gl_FragColor=vec4(col,clamp(hw.g*1.5,0.,1.));}`;
function glInit(canvas){try{
  const gl=canvas.getContext("webgl",{premultipliedAlpha:false,antialias:false,alpha:true});if(!gl)return false;
  const sh=(type,src)=>{const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s};
  const p=gl.createProgram();gl.attachShader(p,sh(gl.VERTEX_SHADER,VS));gl.attachShader(p,sh(gl.FRAGMENT_SHADER,FS));gl.linkProgram(p);
  if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p));
  gl.useProgram(p);const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
  const al=gl.getAttribLocation(p,"a");gl.enableVertexAttribArray(al);gl.vertexAttribPointer(al,2,gl.FLOAT,false,0,0);
  for(const k of ["uP","uQ","uHW","uPR","uGeo","uGrid","uN","uM","uT","uPx","uEx","uS","uTx","uC","uD"])WG.u[k]=gl.getUniformLocation(p,k);
  const C=new Float32Array(NCOMP*4),D=new Float32Array(NCOMP*4);
  WCOMP.forEach(([r,th,a,ph],i)=>{C.set([2*Math.PI*r*Math.cos(th),2*Math.PI*r*Math.sin(th),a,ph],i*4);D.set([2*Math.PI*F0*Math.sqrt(r),1/r,0,0],i*4)});
  gl.uniform4fv(WG.u.uC,C);gl.uniform4fv(WG.u.uD,D);gl.uniform1f(WG.u.uEx,window.__ex||REL_EX);gl.uniform1i(WG.u.uP,0);gl.uniform1i(WG.u.uQ,1);gl.uniform1i(WG.u.uHW,2);
  WG.gl=gl;WG.canvas=canvas;WG.prog=p;WG.name=null;return true}catch(e){console.warn("Rörliga vågor i relief stöds inte här:",e);return false}}
function glTex(unit,src,linear,w,h){const gl=WG.gl,t=WG.tex[unit]||(WG.tex[unit]=gl.createTexture());gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,t);
  const f=linear?gl.LINEAR:gl.NEAREST;gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,f);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,f);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  if(src instanceof Uint8Array)gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,src);else gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,src)}
const fasImgs=new Map();
function fasImg(name){if(fasImgs.has(name))return fasImgs.get(name);
  const ld=s=>new Promise((res,rej)=>{const im=new Image();im.onload=()=>res(im);im.onerror=rej;im.src="data/fas/"+name+"_"+s+".png"});
  const p=Promise.all([ld("p"),ld("q")]).catch(()=>null);fasImgs.set(name,p);return p}
function fasName(wd){const X=S.fas;if(!X)return null;let best=null,bd=1e9;for(const d of X.dirs){const nm="d"+String(Math.round(d*10)).padStart(4,"0");if(!X.done.includes(nm))continue;
  const dd=Math.abs(((wd-d+540)%360)-180);if(dd<bd){bd=dd;best=nm}}return best}
function reliefPossible(wd){return WG.ok!==false&&!!S.fas&&!!fasName(wd)}
function reliefHide(){cancelAnimationFrame(WG.raf);WG.raf=0;WG.last=0;WG.st=null;if(overlays.relief)overlays.relief.getElement().style.display="none"}
function reliefFrame(){const st=WG.st,gl=WG.gl;if(!st||!gl||document.hidden){WG.raf=0;WG.last=0;return}
  // tiden räknas framåt bild för bild, så att tempot kan ändras utan att vågorna hoppar
  const now=performance.now();if(WG.last)WG.tAcc+=Math.min(.1,(now-WG.last)/1000)*animRate();WG.last=now;
  gl.viewport(0,0,WG.canvas.width,WG.canvas.height);gl.uniform1f(WG.u.uT,WG.tAcc);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
  WG.raf=requestAnimationFrame(reliefFrame)}
document.addEventListener("visibilitychange",()=>{if(!document.hidden&&WG.st&&!WG.raf)WG.raf=requestAnimationFrame(reliefFrame)});
// Avstånd till närmaste land i kartpunkter (snabb tvåpassmetod, 3-4-avstånd)
function landDist(R,cx0,cy0,W0,H0){const n=W0*H0,D=new Float32Array(n),INF=1e9;
  for(let y=0;y<H0;y++)for(let x=0;x<W0;x++)D[y*W0+x]=R.water[(cy0+y)*R.W+cx0+x]?INF:0;
  for(let y=0;y<H0;y++)for(let x=0;x<W0;x++){const i=y*W0+x;let d=D[i];if(!d)continue;
    if(x>0)d=Math.min(d,D[i-1]+3);if(y>0){d=Math.min(d,D[i-W0]+3);if(x>0)d=Math.min(d,D[i-W0-1]+4);if(x<W0-1)d=Math.min(d,D[i-W0+1]+4)}D[i]=d}
  for(let y=H0-1;y>=0;y--)for(let x=W0-1;x>=0;x--){const i=y*W0+x;let d=D[i];if(!d)continue;
    if(x<W0-1)d=Math.min(d,D[i+1]+3);if(y<H0-1){d=Math.min(d,D[i+W0]+3);if(x<W0-1)d=Math.min(d,D[i+W0+1]+4);if(x>0)d=Math.min(d,D[i+W0-1]+4)}D[i]=d}
  for(let i=0;i<n;i++)D[i]=D[i]>=INF?1e4:D[i]/3;return D}
async function reliefShow(R,cx0,cy0,W0,H0,k,mz,Hc,wd,U){const name=fasName(wd),imgs=await fasImg(name);if(!imgs){WG.ok=false;reliefHide();schedule();return}
  const px0=R.px0+cx0,py0=R.py0+cy0,b=L.latLngBounds(CRS.pointToLatLng(L.point(px0,py0+H0),mz),CRS.pointToLatLng(L.point(px0+W0,py0),mz));
  let o=overlays.relief;if(!o){o=overlays.relief=new CanvasOverlay("",b,{pane:"relief",interactive:false}).addTo(map)}else o.setBounds(b);
  const c=o.getElement();c.style.display="";
  // på skärmar med hög upplösning räknas ytan i något lägre upplösning, för att spara batteri
  const dpr=window.devicePixelRatio||1,kg=k/Math.max(1,dpr/1.5),cw=Math.round(W0*kg),ch=Math.round(H0*kg);
  if(c.width!==cw||c.height!==ch){c.width=cw;c.height=ch}
  if(WG.canvas!==c&&!glInit(c)){WG.ok=false;reliefHide();schedule();return}
  WG.ok=true;const gl=WG.gl,X=S.fas;
  if(WG.name!==name){glTex(0,imgs[0],false);glTex(1,imgs[1],false);WG.name=name}
  // våghöjd (röd, 200 per meter), vatten (grön) och avstånd till land (blå, halvmeter, högst 127 m)
  const LD=landDist(R,cx0,cy0,W0,H0),mpz=mpp(mz,(CRS.pointToLatLng(L.point(px0,py0),mz).lat));
  const hw=new Uint8Array(W0*H0*4);for(let y=0;y<H0;y++)for(let x=0;x<W0;x++){const i=y*W0+x,j=(cy0+y)*R.W+cx0+x;
    hw[i*4]=Math.min(255,Math.round(Math.max(0,Hc[j])*200));hw[i*4+1]=R.water[j]?255:0;hw[i*4+2]=Math.min(255,Math.round(Math.max(0,LD[i]-.5)*mpz*2));hw[i*4+3]=255}
  glTex(2,hw,true,W0,H0);
  // vindstyrkan avgör hur långa vågorna är: vid 10 m/s som fasfälten, kortare i svagare vind
  const uS=Math.max(.75,Math.min(4,10/Math.max(1,U||10)));setRateCap(U,uS);
  gl.uniform1f(WG.u.uS,uS);gl.uniform2f(WG.u.uTx,1/W0,1/H0);
  const nw=CRS.pointToLatLng(L.point(px0,py0),mz),se=CRS.pointToLatLng(L.point(px0+W0,py0+H0),mz),r=X.range[name],lat=(nw.lat+se.lat)/2;
  gl.uniform4f(WG.u.uPR,r[0],r[1],r[2],r[3]);gl.uniform4f(WG.u.uGeo,nw.lng,se.lng,nw.lat,se.lat);
  gl.uniform4f(WG.u.uGrid,X.lon0,X.lat0,X.dlon,X.dlat);gl.uniform2f(WG.u.uN,X.nx,X.ny);
  gl.uniform2f(WG.u.uM,X.dlon*111320*Math.cos(lat*Math.PI/180),X.dlat*111320);gl.uniform1f(WG.u.uPx,mpp(mz,lat)/kg);
  WG.st={name};if(!WG.raf)WG.raf=requestAnimationFrame(reliefFrame)}

// Vågkammar som följer SWAN:s vågriktning: jämnt fördelade linjer som hela tiden ligger tvärs
// mot vågornas gång. Där vågorna böjer sig (mot grunt vatten, runt uddar och in i lä) böjer sig
// linjerna med. Avståndet mellan linjerna och deras tjocklek följer våghöjden.
function drawSwanCrests(x,Z,R,cx0,cy0,W0,H0,k,h,dpr,mz,A,lvl){const sc=Math.pow(2,map.getZoom()-mz),n=W0*H0,SW=Z.SW;
  const Hc=new Float32Array(n).fill(-1),cxv=new Float32Array(n),cyv=new Float32Array(n);
  for(let y=0;y<H0;y++){const s=(cy0+y)*R.W+cx0;for(let xx=0;xx<W0;xx++){const i=y*W0+xx,j=s+xx;if(SW.H[j]<0)continue;Hc[i]=SW.H[j];
    const b=(SW.D[j]+180)*Math.PI/180;cxv[i]=Math.cos(b);cyv[i]=Math.sin(b)}}   // kamriktning = tvärs mot gångriktningen
  // jämna ut riktningsfältet lite (som dubbelvinkel, så att motsatta riktningar inte tar ut varandra)
  const c2=new Float32Array(n),s2=new Float32Array(n);for(let i=0;i<n;i++){c2[i]=cxv[i]*cxv[i]-cyv[i]*cyv[i];s2[i]=2*cxv[i]*cyv[i]}
  const bl=(a,r)=>{const T=new Float32Array(n);for(let y=0;y<H0;y++){let s=0,c=0;const o=y*W0;for(let xx=0;xx<Math.min(r,W0);xx++){s+=a[o+xx];c++}
      for(let xx=0;xx<W0;xx++){if(xx+r<W0){s+=a[o+xx+r];c++}if(xx-r-1>=0){s-=a[o+xx-r-1];c--}T[o+xx]=s/c}}
    for(let xx=0;xx<W0;xx++){let s=0,c=0;for(let y=0;y<Math.min(r,H0);y++){s+=T[y*W0+xx];c++}
      for(let y=0;y<H0;y++){if(y+r<H0){s+=T[(y+r)*W0+xx];c++}if(y-r-1>=0){s-=T[(y-r-1)*W0+xx];c--}a[y*W0+xx]=s/c}}};
  const rr=Math.max(1,Math.round(2/sc));bl(c2,rr);bl(s2,rr);
  for(let i=0;i<n;i++){const a=Math.atan2(s2[i],c2[i])/2;cxv[i]=Math.cos(a);cyv[i]=Math.sin(a)}
  const sep=i=>(9+30*Math.sqrt(Math.min(Math.max(Hc[i],0),1.4)/1.4))/sc;            // avstånd mellan kammar i kartpunkter
  const at=(px,py)=>{const xx=px|0,yy=py|0;return xx>=0&&yy>=0&&xx<W0&&yy<H0?yy*W0+xx:-1};
  // rutnät för att hålla avstånd mellan linjerna
  const cs=Math.max(2,4/sc),gw=Math.ceil(W0/cs)+1,gh=Math.ceil(H0/cs)+1,grid=new Array(gw*gh);
  const near=(px,py,d)=>{const gx=(px/cs)|0,gy=(py/cs)|0,r=Math.ceil(d/cs);for(let yy=Math.max(0,gy-r);yy<=Math.min(gh-1,gy+r);yy++)for(let xx=Math.max(0,gx-r);xx<=Math.min(gw-1,gx+r);xx++){
      const g=grid[yy*gw+xx];if(!g)continue;for(let q=0;q<g.length;q+=2){const ddx=g[q]-px,ddy=g[q+1]-py;if(ddx*ddx+ddy*ddy<d*d)return true}}return false};
  const add=(px,py)=>{const j=((py/cs)|0)*gw+((px/cs)|0);(grid[j]||(grid[j]=[])).push(px,py)};
  const lines=[],step=.6;
  const trace=(sx,sy)=>{const pts=[[sx,sy]];for(const dir of [1,-1]){let px=sx,py=sy,i0=at(px,py),vx=cxv[i0]*dir,vy=cyv[i0]*dir;
      for(let s=0;s<6000;s++){const i=at(px,py);if(i<0||Hc[i]<0.1)break;let ux=cxv[i],uy=cyv[i];if(ux*vx+uy*vy<0){ux=-ux;uy=-uy}
        const mx=px+ux*step*.5,my=py+uy*step*.5,j=at(mx,my);if(j<0||Hc[j]<0.1)break;let wx=cxv[j],wy=cyv[j];if(wx*ux+wy*uy<0){wx=-wx;wy=-wy}
        const nx2=px+wx*step,ny2=py+wy*step;if(near(nx2,ny2,sep(i)*.5))break;px=nx2;py=ny2;vx=wx;vy=wy;
        if(dir>0)pts.push([px,py]);else pts.unshift([px,py])}}
    return pts};
  // frön: börja där vågorna är högst, lägg sedan nya frön ett linjeavstånd ut från varje färdig linje
  const cand=[];for(let y=2;y<H0;y+=Math.max(3,(6/sc)|0))for(let xx=2;xx<W0;xx+=Math.max(3,(6/sc)|0)){const i=y*W0+xx;if(Hc[i]>=0.1)cand.push(i)}
  cand.sort((a,b)=>Hc[b]-Hc[a]);const queue=[];let ci=0;
  for(let guard=0;guard<20000;guard++){let s=null;
    while(queue.length&&!s){const q=queue.shift(),i=at(q[0],q[1]);if(i>=0&&Hc[i]>=0.1&&!near(q[0],q[1],sep(i)*.95))s=q}
    while(!s&&ci<cand.length){const i=cand[ci++],px=i%W0+.5,py=(i/W0|0)+.5;if(!near(px,py,sep(i)*.95))s=[px,py]}
    if(!s)break;const pts=trace(s[0],s[1]);if(pts.length<4)continue;
    for(const p of pts)add(p[0],p[1]);lines.push(pts);
    for(let q=0;q<pts.length;q+=6){const p=pts[q],i=at(p[0],p[1]);if(i<0)continue;const d=sep(i),nx3=-cyv[i],ny3=cxv[i];
      queue.push([p[0]+nx3*d,p[1]+ny3*d],[p[0]-nx3*d,p[1]-ny3*d])}}
  // rita linjerna med tjocklek som följer våghöjden steglöst
  // gångriktningen (dit vågorna går) per punkt, för animationen
  const tvx=new Float32Array(n),tvy=new Float32Array(n);
  for(let y=0;y<H0;y++){const s=(cy0+y)*R.W+cx0;for(let xx=0;xx<W0;xx++){const i=y*W0+xx,j=s+xx;if(SW.H[j]<0)continue;const b=(SW.D[j]+180)*Math.PI/180;tvx[i]=Math.sin(b);tvy[i]=-Math.cos(b)}}
  return strokeGraded(x,lines,dpr,p=>{const i=at(p[0],p[1]);return i<0?-1:Hc[i]},p=>[p[0]*k,p[1]*k],p=>p[0]<2||p[1]<2||p[0]>W0-2||p[1]>H0-2,
    p=>{const i=at(p[0],p[1]);if(i<0)return[0,0];const d=sep(i)*k;return[tvx[i]*d,tvy[i]*d]})}
// Zonerna i vattnet som mjuka ytor med tunna konturlinjer: lä och sjögång, temperatur, Hitta plats och hemfridszoner
function drawZones(R,vx0,vy0,vx1,vy1,mz,Z){const mg=4,cx0=Math.max(0,vx0-R.px0-mg),cy0=Math.max(0,vy0-R.py0-mg),cx1=Math.min(R.W,vx1-R.px0+mg),cy1=Math.min(R.H,vy1-R.py0+mg),W0=cx1-cx0,H0=cy1-cy0;
  if(W0<4||H0<4){hideCanvas("zones");hideCanvas("crests");crestSet=null;reliefHide();return}
  const dpr=window.devicePixelRatio||1;let k=Math.pow(2,map.getZoom()-mz)*dpr;k=Math.min(k,4096/W0,4096/H0);const h=k/2;
  const x=overlayCanvas("zones",mz,R.px0+cx0,R.py0+cy0,W0,H0,k),n=W0*H0;
  const crop=A=>{const o=new Int16Array(n);for(let y=0;y<H0;y++){const s=(cy0+y)*R.W+cx0;for(let xx=0;xx<W0;xx++)o[y*W0+xx]=A[s+xx]}return o};
  // låt klasserna fortsätta två punkter in under land, så att ytorna når ända fram till kustlinjen
  const dil=A=>{for(let pass=0;pass<2;pass++){const B=A.slice();for(let y=1;y<H0-1;y++)for(let xx=1;xx<W0-1;xx++){const i=y*W0+xx;if(A[i]!==-999)continue;
        const m=Math.max(A[i-1],A[i+1],A[i-W0],A[i+W0]);if(m!==-999)B[i]=m}A=B}return A};
  const lvl=(A,t)=>{const M=new Uint8Array(n);for(let i=0;i<n;i++)M[i]=A[i]!==-999&&A[i]>=t?1:0;return M};
  const bands=(A,levels,line,lw)=>{const lo=levels[0][0];for(const [t,col] of levels){const loops=traceLoops(lvl(A,t),W0,H0);fillLoops(x,loops,h,col);if(line&&t>lo)strokeLoops(x,loops,h,line,lw)}};
  let tb=null;
  if(Z.BAND){tb=dil(crop(Z.BAND));}
  if(Z.FOK)bands(dil(crop(Z.FOK)),[[0,FIND_SOLID[0]],[1,FIND_SOLID[1]]],"rgba(90,10,60,.55)",1.2*dpr);
  else if(Z.KARR)bands(dil(crop(Z.KARR)),LA_SOLID.map((c,i)=>[i,c]),"rgba(25,45,70,.45)",1*dpr);
  else if(Z.depthFill&&Z.DB){const db=dil(crop(Z.DB));let lo=99,hi=-1;for(let i=0;i<n;i++){if(db[i]===-999)continue;if(db[i]<lo)lo=db[i];if(db[i]>hi)hi=db[i]}
    if(lo<=hi){const lev=[];for(let b2=lo;b2<=hi;b2++)lev.push([b2,DEPTH_COL[b2]]);bands(db,lev,null,0)}}
  else if(Z.tempFill&&tb){let lo=1e9,hi=-1e9;for(let i=0;i<n;i++){if(tb[i]===-999)continue;if(tb[i]<lo)lo=tb[i];if(tb[i]>hi)hi=tb[i]}
    if(lo<=hi){const lev=[];for(let b2=lo;b2<=hi;b2++){let kk=Math.round(((b2+.5)*tStep)/24*255);kk=kk<0?0:kk>255?255:kk;lev.push([b2,mixc([TLUT[kk*3],TLUT[kk*3+1],TLUT[kk*3+2]],.6)])}
      bands(tb,lev,null,0)}}
  // Sjögång som vågkammar ovanpå djupet: linjerna ligger tvärs mot vinden, buktar ut i vindens
  // riktning där sjön är utvecklad och släpar efter i lä bakom öar och stränder. Avståndet mellan
  // linjerna växer med våghöjden. Linjerna är nivåkurvor för en "fas" som räknas per punkt.
  let crestB=null,relief=false;
  if(Z.KPAT&&Z.RELIEF){relief=true;reliefShow(R,cx0,cy0,W0,H0,k,mz,Z.RELIEF,Z.wdir,Z.wspd)}
  else if(Z.KPAT&&Z.SW){crestB=drawSwanCrests(x,Z,R,cx0,cy0,W0,H0,k,h,dpr,mz,dil(crop(Z.KPAT)),lvl);}
  else if(Z.KPAT&&Z.FV&&Z.UV&&!relief){const A=dil(crop(Z.KPAT)),PX=v=>(v-2)*h,sc=Math.pow(2,map.getZoom()-mz),mz_m=Z.mpz;
    const th=(Z.wdir+180)*Math.PI/180,dx=Math.sin(th),dy=-Math.cos(th),gx0=R.px0+cx0,gy0=R.py0+cy0;
    // fetch och vind för utsnittet (land får grannens värden, så att linjerna fortsätter jämnt in mot stranden)
    const Fc=new Float32Array(n),Uc=new Float32Array(n),ok=new Uint8Array(n);
    for(let y=0;y<H0;y++){const s=(cy0+y)*R.W+cx0;for(let xx=0;xx<W0;xx++){const i=y*W0+xx;if(R.water[s+xx]){Fc[i]=Z.FV[s+xx];Uc[i]=Z.UV[s+xx];ok[i]=1}}}
    for(let pass=0;pass<4;pass++)for(let y=1;y<H0-1;y++)for(let xx=1;xx<W0-1;xx++){const i=y*W0+xx;if(ok[i])continue;
      for(const j of [i-1,i+1,i-W0,i+W0])if(ok[j]===1){Fc[i]=Fc[j];Uc[i]=Uc[j];ok[i]=2;break}}
    // avstånd mellan kammar (som 1/avstånd) och eftersäpning i lä, utjämnade över några hundra meter
    const inv=new Float32Array(n),bow=new Float32Array(n),HV=new Float32Array(n);
    for(let i=0;i<n;i++){const F2=Math.min(Fc[i],CAP_M),Hs=Math.min(wave(Uc[i],F2),1.4);HV[i]=wave(Uc[i],F2);const lamPx=Math.max(4*sc,9+30*Math.sqrt(Hs/1.4));
      inv[i]=sc/(lamPx*mz_m);bow[i]=(300+1300*Math.sqrt(Hs))*(1-Math.sqrt(F2/CAP_M))}
    const blur=(A2,r)=>{const T=new Float32Array(n);for(let pass=0;pass<2;pass++){
        for(let y=0;y<H0;y++){let s2=0,c2=0;const o=y*W0;for(let xx=0;xx<Math.min(r,W0);xx++){s2+=A2[o+xx];c2++}
          for(let xx=0;xx<W0;xx++){const a2=xx+r,b2=xx-r-1;if(a2<W0){s2+=A2[o+a2];c2++}if(b2>=0){s2-=A2[o+b2];c2--}T[o+xx]=s2/c2}}
        for(let xx=0;xx<W0;xx++){let s2=0,c2=0;for(let y=0;y<Math.min(r,H0);y++){s2+=T[y*W0+xx];c2++}
          for(let y=0;y<H0;y++){const a2=y+r,b2=y-r-1;if(a2<H0){s2+=T[a2*W0+xx];c2++}if(b2>=0){s2-=T[b2*W0+xx];c2--}A2[y*W0+xx]=s2/c2}}}};
    const rb=Math.max(5,Math.round(240/mz_m));blur(inv,rb);blur(bow,rb);
    // fasen räknas steg för steg i vindens riktning, så att linjerna aldrig korsar varandra
    const P=new Float32Array(n),inv0=sc/(20*mz_m),ux=-dx,uy=-dy;
    if(Math.abs(ux)>=Math.abs(uy)){const sx=ux>0?1:-1,tt=1/Math.abs(ux),ddy=uy*tt;
      for(let k2=0;k2<W0;k2++){const xx=sx>0?W0-1-k2:k2,px=xx+sx,edge=px<0||px>=W0;
        for(let y=0;y<H0;y++){const i=y*W0+xx;const s0=((gx0+xx)*dx+(gy0+y)*dy)*mz_m*inv0;
          if(edge){P[i]=s0;continue}const yy=y+ddy;if(yy<0||yy>H0-1){P[i]=s0;continue}const y0=yy|0,f=yy-y0,y1=y0+1<H0?y0+1:y0;
          P[i]=P[y0*W0+px]*(1-f)+P[y1*W0+px]*f+tt*mz_m*inv[i]}}}
    else{const sy=uy>0?1:-1,tt=1/Math.abs(uy),ddx=ux*tt;
      for(let k2=0;k2<H0;k2++){const y=sy>0?H0-1-k2:k2,py=y+sy,edge=py<0||py>=H0;
        for(let xx=0;xx<W0;xx++){const i=y*W0+xx;const s0=((gx0+xx)*dx+(gy0+y)*dy)*mz_m*inv0;
          if(edge){P[i]=s0;continue}const x2=xx+ddx;if(x2<0||x2>W0-1){P[i]=s0;continue}const x0=x2|0,f=x2-x0,x1=x0+1<W0?x0+1:x0;
          P[i]=P[py*W0+x0]*(1-f)+P[py*W0+x1]*f+tt*mz_m*inv[i]}}}
    const M=new Uint8Array(n);for(let i=0;i<n;i++)M[i]=Math.floor(P[i]-bow[i]*inv[i])&1;
    const crest=traceLoops(M,W0,H0,3),WW=crest.W,HH=crest.H;
    // linjerna med steglös tjocklek; lä (under 0,1 m) och ramen ritas inte
    crestB=strokeGraded(x,crest,dpr,q=>{if(q[0]<2.6||q[1]<2.6||q[0]>2*WW-2.6||q[1]>2*HH-2.6)return -1;
        const xx=Math.floor((q[0]-2)/2),yy=Math.floor((q[1]-2)/2);if(xx<0||yy<0||xx>=W0||yy>=H0)return -1;const i=yy*W0+xx;return A[i]>=1?HV[i]:-1},
      q=>[PX(q[0]),PX(q[1])],q=>q[0]<6||q[1]<6||q[0]>2*WW-6||q[1]>2*HH-6,
      q=>{const xx=Math.min(W0-1,Math.max(0,Math.floor((q[0]-2)/2))),yy=Math.min(H0-1,Math.max(0,Math.floor((q[1]-2)/2))),d=k/(inv[yy*W0+xx]*mz_m);return[dx*d,dy*d]})}
  // temperaturgränser som tunna linjer, som djupkurvor
  if(tb){let lo=1e9,hi=-1e9;for(let i=0;i<n;i++){if(tb[i]===-999)continue;if(tb[i]<lo)lo=tb[i];if(tb[i]>hi)hi=tb[i]}
    for(let b2=lo+1;b2<=hi;b2++)strokeLoops(x,traceLoops(lvl(tb,b2),W0,H0),h,"#0B3550",1.3*dpr)}
  // djupkurvor som tunna blå linjer, som på sjökortet
  if(Z.DB){const db=dil(crop(Z.DB));let lo=99,hi=-1;for(let i=0;i<n;i++){if(db[i]===-999)continue;if(db[i]<lo)lo=db[i];if(db[i]>hi)hi=db[i]}
    for(let b2=lo+1;b2<=hi;b2++)strokeLoops(x,traceLoops(lvl(db,b2),W0,H0),h,b2<=2?"rgba(30,90,150,.85)":"rgba(40,100,160,.55)",(b2<=2?1.2:.9)*dpr)}
  if(Z.priv){const P=crop(Z.priv),WAc=crop(R.water),M=new Uint8Array(n);for(let i=0;i<n;i++)M[i]=P[i]&&WAc[i]?1:0;
    const loops=traceLoops(M,W0,H0);fillLoops(x,loops,h,"rgba(70,56,50,.72)");strokeLoops(x,loops,h,"#281E1C",1.4*dpr)}
  // klipp bort allt som hamnat innanför kustlinjen, så att zonerna slutar exakt vid stranden
  const C=lastCoast;let clip=()=>{};
  if(C){const f=Math.pow(2,mz-C.cz),ox=R.px0+cx0,oy=R.py0+cy0,TX=v=>((C.x0+(v-2)/2)*f-ox)*k,TY=v=>((C.y0+(v-2)/2)*f-oy)*k;
    const path=new Path2D();for(const p of C.loops){path.moveTo(TX(p[0][0]),TY(p[0][1]));for(let i=1;i<p.length;i++)path.lineTo(TX(p[i][0]),TY(p[i][1]));path.closePath()}
    clip=xx=>{xx.save();xx.globalCompositeOperation="destination-out";xx.fillStyle="#000";xx.fill(path,"evenodd");xx.restore()};clip(x)}
  // vågkammarna i ett eget lager, så att de kan ritas om (animeras) utan att resten räknas om
  if(crestB){const x2=overlayCanvas("crests",mz,R.px0+cx0,R.py0+cy0,W0,H0,k);crestSet={x:x2,cw:x2.canvas.width,ch:x2.canvas.height,buckets:crestB,clip};
    drawCrestSet(0);startAnim()}
  else{crestSet=null;hideCanvas("crests")}
  if(!relief)reliefHide()}
let MASK_MAX=13,lastCoast=null;
async function drawCoast(){const zz=map.getZoom(),cz=Math.min(MASK_MAX,Math.max(11,zz)),bnd=map.getBounds().pad(.3),
  nw=CRS.latLngToPoint(bnd.getNorthWest(),cz),se=CRS.latLngToPoint(bnd.getSouthEast(),cz),x0=Math.floor(nw.x),y0=Math.floor(nw.y),W0=Math.ceil(se.x)-x0,H0=Math.ceil(se.y)-y0;
  const R=await region(cz,x0,y0,W0,H0),dpr=window.devicePixelRatio||1;
  let k=Math.pow(2,zz-cz)*dpr;k=Math.min(k,4096/W0,4096/H0);const h=k/2;
  const x=overlayCanvas("coast",cz,x0,y0,W0,H0,k),LAND=new Uint8Array(W0*H0);for(let i=0;i<LAND.length;i++)LAND[i]=R.water[i]?0:1;
  // mild utjämning: tar bort trappstegen men behåller uddar och vikar (lite mer när man zoomat förbi maskens upplösning)
  const loops=traceLoops(LAND,W0,H0,zz-cz>=1?2:1);lastCoast={loops,cz,x0,y0};
  // landyta innanför konturen, i sjökortsfärg (inte när vanlig karta är vald)
  if(S.land!=="karta"){const lc=LANDCOL[S.land];fillLoops(x,loops,h,`rgba(${lc[0]},${lc[1]},${lc[2]},.94)`)}
  if(S.terr&&S.layers.contours)drawContours(x,cz,x0,y0,k,zz);
  strokeLoops(x,loops,h,"#15191D",1.5*dpr)}
// Höjdkurvor på land ur Lantmäteriets höjdmodell (data/terrang.json, ca 20 m mellan punkterna).
// Tätare kurvor ju mer man zoomar in; var femte kurva är lite kraftigare.
let contourCache={key:null,lev:null};
function drawContours(x,cz,x0,y0,k,zz){const T=S.terr;if(zz<12)return;const step=zz>=14?5:10,bold=zz>=14?25:50;
  const b=map.getBounds().pad(.05);
  const c0=Math.max(0,Math.floor((b.getWest()-T.lon0)/T.dlon)),c1=Math.min(T.nx,Math.ceil((b.getEast()-T.lon0)/T.dlon));
  const r0=Math.max(0,Math.floor((T.lat0-b.getNorth())/T.dlat)),r1=Math.min(T.ny,Math.ceil((T.lat0-b.getSouth())/T.dlat));
  const W=c1-c0,H=r1-r0;if(W<3||H<3)return;
  const key=[c0,r0,W,H,step].join("|");let lev=contourCache.key===key?contourCache.lev:null;
  if(!lev){const sub=new Uint8Array(W*H);let hi=0;for(let r=0;r<H;r++){const o=(r0+r)*T.nx+c0;for(let c=0;c<W;c++){const v=T.H[o+c];sub[r*W+c]=v;if(v>hi)hi=v}}
    lev=[];for(let L=step;L<=hi;L+=step){const M=new Uint8Array(W*H);for(let i=0;i<M.length;i++)M[i]=sub[i]>=L?1:0;lev.push([L,traceLoops(M,W,H,2)])}
    contourCache={key,lev}}
  const N=256*Math.pow(2,cz),RAD=Math.PI/180;
  const TX=v=>(((T.lon0+(c0+(v-2)/2)*T.dlon)+180)/360*N-x0)*k;
  const TY=v=>{const s=Math.sin((T.lat0-(r0+(v-2)/2)*T.dlat)*RAD);return((.5-Math.log((1+s)/(1-s))/(4*Math.PI))*N-y0)*k};
  const dpr=window.devicePixelRatio||1;x.lineJoin="round";x.lineCap="round";
  for(const [L,loops] of lev){const strong=L%bold===0;x.lineWidth=(strong?1.1:.6)*dpr;x.strokeStyle=strong?"rgba(120,82,40,.75)":"rgba(140,100,55,.5)";x.beginPath();
    const Wl=loops.W,Hl=loops.H,edge=q=>q[0]<2.6||q[1]<2.6||q[0]>2*Wl-2.6||q[1]>2*Hl-2.6;
    for(const p of loops){let pen=false;for(const q of p){if(edge(q)){pen=false;continue}const X=TX(q[0]),Y=TY(q[1]);if(pen)x.lineTo(X,Y);else{x.moveTo(X,Y);pen=true}}}
    x.stroke()}}
// Ytor som täcks av tidsraden, knapparna och panelen, så att inga etiketter hamnar under dem.
function uiBoxes(){const m=$("map").getBoundingClientRect(),out=[];
  document.querySelectorAll(".bar,.side,.panel:not(.hidden),.sheet.open,.ruler,.leaflet-control-attribution").forEach(el=>{const r=el.getBoundingClientRect();if(r.width&&r.height)out.push([r.left-m.left,r.top-m.top,r.right-m.left,r.bottom-m.top])});return out}
// Lägger ut etiketter i prioritetsordning och hoppar över allt som skulle krocka.
function placeNames(){nameLayer.clearLayers();const boxes=uiBoxes();if(S.layers.names!==false)placeLabels(boxes,nameCands(),nameLayer,"names");return boxes}
function placeLabels(boxes,cands,layer,pane){cands.sort((a,b)=>b.score-a.score);const sz=map.getSize();
  for(const c of cands){const p=map.latLngToContainerPoint(c.ll),bx=[p.x-c.w/2-3,p.y-c.h/2-2,p.x+c.w/2+3,p.y+c.h/2+2];
    if(bx[0]<2||bx[1]<2||bx[2]>sz.x-2||bx[3]>sz.y-2)continue;
    if(boxes.some(o=>bx[0]<o[2]&&bx[2]>o[0]&&bx[1]<o[3]&&bx[3]>o[1]))continue;boxes.push(bx);
    L.marker(c.ll,{pane:pane||"lbl",interactive:false,keyboard:false,icon:L.divIcon({className:"",html:c.html,iconSize:[0,0]})}).addTo(layer)}}
let rT=null;const schedule=()=>{clearTimeout(rT);rT=setTimeout(redraw,60)};
map.on("moveend",schedule);

// ------------------------------------------------------------------ vindpilar
const arrowLayer=L.layerGroup().addTo(map);
function drawArrows(ui,shared){arrowLayer.clearLayers();const boxes=shared?ui:(ui||[]).slice();if(!S.layers.arrows)return boxes;
  const add=(ll,wd,ws,gust,big)=>{const s=big?44:36,p=map.latLngToContainerPoint(ll),bx=[p.x-34,p.y-s/2,p.x+34,p.y+s/2+34];
    const sz=map.getSize();if(bx[0]<2||bx[1]<2||bx[2]>sz.x-2||bx[3]>sz.y-2)return;
    if(boxes.some(o=>bx[0]<o[2]&&bx[2]>o[0]&&bx[1]<o[3]&&bx[3]>o[1]))return false;arrowAt(ll,wd,ws,gust,big);boxes.push(bx);return true};
  if(S.src==="egen"){add(map.getCenter(),S.own.dir,S.own.sp,null,true);return boxes}
  const W=S.wind;if(!W)return boxes;const ki=k=>W.keys.indexOf(k),b=map.getBounds().pad(.05),z=map.getZoom(),every=z<=9?3:z<=10?2:1;
  let placed=0;
  W.points.forEach((p,i)=>{const r=W.series[i][S.ti];if(!r||r[ki("ws")]==null)return;const row=Math.round((p[0]-W.points[0][0])/0.1),col=Math.round((p[1]-W.points[0][1])/0.15);
    if(row%every||col%every)return;if(!b.contains(p))return;if(add(L.latLng(p[0],p[1]),r[ki("wd")],r[ki("ws")],r[ki("gust")]))placed++});
  // inzoomat kan alla prognospunkter hamna utanför bilden: rita då en pil med vinden för platsen,
  // på en ledig plats så nära mitten som möjligt (helst över vatten)
  if(!placed){const sz=map.getSize(),cands=[];
    for(let gy=1;gy<8;gy++)for(let gx=1;gx<8;gx++){const pt=L.point(sz.x*gx/8,sz.y*gy/8),ll=map.containerPointToLatLng(pt);
      cands.push({ll,d:Math.hypot(pt.x-sz.x/2,pt.y-sz.y/2)+(onWater(ll)?0:1e4)})}
    cands.sort((a,c)=>a.d-c.d);
    for(const c of cands){const lw=windAt(c.ll.lat,c.ll.lng,S.ti);if(!lw||lw.ws==null)continue;if(add(c.ll,lw.wd,lw.ws,lw.gust))break}}
  return boxes}
function arrowAt(ll,wd,ws,gust,big){const s=big?44:36,c=windCol(ws);
  const html=`<svg width="${s}" height="${s}" viewBox="-16 -16 32 32" style="transform:rotate(${wd+180}deg)"><path d="M0 -14 L9 4 L2.5 1.5 L2.5 13 L-2.5 13 L-2.5 1.5 L-9 4 Z" fill="${c}" stroke="#fff" stroke-width="2.4" stroke-linejoin="round" paint-order="stroke"/></svg><span style="border-color:${c}"><b>${f0(ws)}${gust!=null?" ("+f0(gust)+")":""}</b><em>${windTerm(ws).replace(" vind","").toLowerCase()}</em></span>`;
  L.marker(ll,{pane:"lbl",interactive:false,keyboard:false,icon:L.divIcon({className:"arrow",html,iconSize:[76,s+34],iconAnchor:[38,s/2]})}).addTo(arrowLayer)}

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
let playT=null;
function stopPlay(){if(playT){clearInterval(playT);playT=null;$("play").textContent="▶";$("play").setAttribute("aria-label","Spela upp prognosen")}}
$("play").onclick=()=>{if(playT){stopPlay();return}const W=S.wind;if(!W)return;
  if(S.ti>=W.times.length-1)setTime(nowIndex());
  $("play").textContent="❚❚";$("play").setAttribute("aria-label","Pausa");
  playT=setInterval(()=>{if(S.ti>=S.wind.times.length-1){setTime(nowIndex());return}setTime(S.ti+1)},700)};
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
    <h3>Vågmönster</h3><p class="note" style="margin-top:2px">Varje linje är en vågkam och ligger tvärs mot vågornas gång. Där det finns beräkningar från vågmodellen SWAN (TU Delft) följer linjerna modellens vågriktning, som tar hänsyn till lä bakom öar, refraktion mot grunt vatten och diffraktion runt uddar. Tätare och tunnare linjer betyder mindre vågor, glesare och kraftigare linjer större vågor. <b>Rörliga vågor</b> visar i stället vågytan i relief, med ljuset från det håll vågorna går mot: framsidorna är ljusa och baksidorna skuggade. Vitt skum syns där vågorna bryter mot en strand som de går rakt mot, som en sköljzon längs strandkanten, och som vita gäss på de högsta kammarna när sjön är grov. Vågornas höjd är kraftigt överdriven och avståndet mellan dem förstorat, så att de syns i kartskala.</p>
    <h3>Lä för vinden</h3><p class="note" style="margin-top:2px">Bakom öar, uddar och skog är vinden svagare. Dämpningen räknas från markhöjden i Lantmäteriets höjdmodell och skogen i OpenStreetMap (räknad som 15 m hög): störst närmast hindret, och vinden är nästan tillbaka efter 20 till 30 gånger hindrets höjd. Uppskruvad vind runt uddar och i smala sund ingår inte.</p>
    <h3>Höjdkurvor</h3><p class="note" style="margin-top:2px">Höjdkurvorna på land kommer från Lantmäteriets laserskannade höjdmodell. Avståndet mellan kurvorna är 10 m, och 5 m när man zoomat in; var femte kurva är kraftigare.</p>
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
  try{const G=await getJSON("data/djup.json"),dec=s=>{const b=atob(s),a=new Uint8Array(b.length);for(let i=0;i<b.length;i++)a[i]=b.charCodeAt(i);return a};
    G.D=dec(G.d);G.M=dec(G.m);delete G.d;delete G.m;S.depth=G}catch(_){$("depthchip")&&($("depthchip").hidden=true);$("depthfind")&&($("depthfind").hidden=true)}
  try{const pi=await getJSON("mask/privat/info.json");S.privOk=true;S.privM=pi.meter||25}catch(_){$("privchip")&&($("privchip").hidden=true)}
  try{const info=await getJSON("mask/info.json");if(info.zooms&&info.zooms.length)MASK_MAX=Math.min(15,Math.max(...info.zooms));const [w,s,e,n]=info.bounds;map.setMaxBounds(L.latLngBounds([s,w],[n,e]).pad(.4))}catch(_){}
  try{S.wind=await getJSON("data/wind.json");$("time").max=S.wind.times.length-1}catch(_){toast("Ingen vinddata än");$("when").textContent="Ingen vinddata"}
  try{S.temp=await getJSON("data/temp.json");const b=atob(S.temp.t),a=new Uint8Array(b.length);for(let i=0;i<b.length;i++)a[i]=b.charCodeAt(i);S.T=a;smoothTemp()}catch(_){}
  setTime(nowIndex());schedule()})();
if("serviceWorker" in navigator)navigator.serviceWorker.register("sw.js").catch(()=>{});
})();
