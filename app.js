/* Skärgårdskartan: lä, vind, väder och vattentemperatur på öppna kartor. */
(function () {
"use strict";
const $ = id => document.getElementById(id);
const CRS = L.CRS.EPSG3857;
let toastT; function toast(s){const t=$("toast");t.textContent=s;t.classList.add("show");clearTimeout(toastT);toastT=setTimeout(()=>t.classList.remove("show"),2400)}

// ------------------------------------------------------------------ karta
const map = L.map("map",{zoomControl:false,minZoom:8,maxZoom:17,center:[59.6,18.8],zoom:10});
map.attributionControl.setPrefix(false);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"© OpenStreetMap"}).addTo(map);
L.tileLayer("https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png",{maxZoom:18,attribution:"Sjömärken © OpenSeaMap · SMHI · Copernicus Marine"}).addTo(map);
L.control.scale({imperial:false,position:"topleft"}).addTo(map);
map.createPane("tint").style.zIndex=300; map.getPane("tint").style.pointerEvents="none"; map.getPane("tint").style.mixBlendMode="color";
map.createPane("ov").style.zIndex=350; map.getPane("ov").style.pointerEvents="none";
map.createPane("lbl").style.zIndex=640; map.getPane("lbl").style.pointerEvents="none";

// Bild-lager vars innehåll ritas direkt i en canvas
const CanvasOverlay=L.ImageOverlay.extend({_initImage(){const c=this._image=L.DomUtil.create("canvas","leaflet-image-layer overlay"+(this._zoomAnimated?" leaflet-zoom-animated":""));c.onselectstart=L.Util.falseFn;c.onmousemove=L.Util.falseFn}});
const overlays={};
function showCanvas(R,draw,pane){pane=pane||"ov";const b=L.latLngBounds(CRS.pointToLatLng(L.point(R.px0,R.py0+R.H),R.z),CRS.pointToLatLng(L.point(R.px0+R.W,R.py0),R.z));
  let o=overlays[pane];if(!o){o=overlays[pane]=new CanvasOverlay("",b,{pane,interactive:false,opacity:1}).addTo(map)}else o.setBounds(b);
  const c=o.getElement();c.width=R.W;c.height=R.H;const x=c.getContext("2d"),img=x.createImageData(R.W,R.H);draw(img.data);x.putImageData(img,0,0)}
function hideCanvas(pane){pane=pane||"ov";if(overlays[pane]){map.removeLayer(overlays[pane]);delete overlays[pane]}}
const LANDCOL={gul:[244,226,160],vit:[246,246,242]};

// ------------------------------------------------------------------ data
const S={basis:"byar",land:"gul",wind:null,temp:null,T:null,layers:{la:true,temp:false,arrows:true,waves:true},find:{on:false,maxK:0,tmin:null,tmax:null},src:"prognos",own:{dir:225,sp:8},ti:0};
async function getJSON(u){const r=await fetch(u,{cache:"no-cache"});if(!r.ok)throw new Error(u+" "+r.status);return r.json()}

// ------------------------------------------------------------------ land/vatten-mask
const tiles=new Map();
function tile(z,x,y){const k=z+"/"+x+"/"+y;if(tiles.has(k))return tiles.get(k);
  const p=new Promise(res=>{const im=new Image();im.onload=()=>{const c=document.createElement("canvas");c.width=c.height=256;const g=c.getContext("2d");g.drawImage(im,0,0);
      const d=g.getImageData(0,0,256,256).data,a=new Uint8Array(65536);for(let i=0;i<65536;i++)a[i]=d[i*4]>127?1:0;res(a)};
    im.onerror=()=>res(null);im.src="mask/"+k+".png"});
  tiles.set(k,p);return p}
async function region(z,px0,py0,W,H){const water=new Uint8Array(W*H);const tx0=Math.floor(px0/256),ty0=Math.floor(py0/256),tx1=Math.floor((px0+W-1)/256),ty1=Math.floor((py0+H-1)/256);
  const jobs=[];for(let tx=tx0;tx<=tx1;tx++)for(let ty=ty0;ty<=ty1;ty++)jobs.push(tile(z,tx,ty).then(a=>({tx,ty,a})));
  for(const {tx,ty,a} of await Promise.all(jobs)){const ox=tx*256-px0,oy=ty*256-py0;
    for(let yy=Math.max(0,oy);yy<Math.min(H,oy+256);yy++){const ry=(yy-oy)*256,wy=yy*W;
      for(let xx=Math.max(0,ox);xx<Math.min(W,ox+256);xx++)water[wy+xx]=a?a[ry+xx-ox]:1}}
  return{z,px0,py0,W,H,water}}
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
let laR=null,laF=null,laWind=null,laU=null,fetchCache={key:null,F:null};

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
const zoneLayer=L.layerGroup().addTo(map),seaLayer=L.layerGroup().addTo(map);
let tRange=null,tStep=0.5,laT=null;
function chooseStep(r){return r<=6?1:2}
const fmtStep=v=>(Math.round(v*100)/100).toString().replace(".",",");
let seq=0,busy=false,again=false;
async function redraw(){if(busy){again=true;return}busy=true;const my=++seq;
  try{lblLayer.clearLayers();zoneLayer.clearLayers();seaLayer.clearLayers();
    const Lyr=S.layers,F_=S.find,needLa=Lyr.la||F_.on,needT=Lyr.temp||F_.on,di=needT?tempDay():-1;
    const haveT=needT&&di>=0&&S.temp,w=needLa?domainWind(S.ti):null,haveLa=needLa&&w&&w.ws!=null;
    const tintOn=S.land!=="karta";if(!tintOn)hideCanvas("tint");
    if(!haveLa&&!haveT&&!tintOn){hideCanvas();laR=null;laT=null;drawArrows(uiBoxes());legend();if(sel)sheet();return}
    const zz=map.getZoom(),mz=zz<=10?11:zz<=13?12:13,b=map.getBounds(),nw=CRS.latLngToPoint(b.getNorthWest(),mz),se=CRS.latLngToPoint(b.getSouthEast(),mz);
    let x0=Math.floor(nw.x),y0=Math.floor(nw.y),x1=Math.ceil(se.x),y1=Math.ceil(se.y);const vx0=x0,vy0=y0,vx1=x1,vy1=y1;
    const m=mpp(mz,map.getCenter().lat),cap=CAP_M/m;
    if(haveLa){const th=w.wd*Math.PI/180,ux=Math.sin(th),uy=-Math.cos(th);if(ux>-0.4)x1+=cap;if(ux<0.4)x0-=cap;if(uy<0.4)y0-=cap;if(uy>-0.4)y1+=cap;
      x0=Math.floor(x0);y0=Math.floor(y0);x1=Math.ceil(x1);y1=Math.ceil(y1)}
    const R=await region(mz,x0,y0,x1-x0,y1-y0);if(my!==seq)return;const N=R.W*R.H,WA=R.water;
    if(tintOn){const lc=LANDCOL[S.land];showCanvas(R,D=>{for(let i=0;i<N;i++){if(WA[i])continue;const p=i*4;D[p]=lc[0];D[p+1]=lc[1];D[p+2]=lc[2];D[p+3]=255}},"tint")}
    if(!haveLa&&!haveT){hideCanvas();laR=null;laT=null;drawArrows(uiBoxes());legend();if(sel)sheet();return}
    // lä
    // riktningen avrundas till 5 grader; samma vy och riktning återanvänder beräkningen (snabb uppspelning)
    let F=null;if(haveLa){const dr=Math.round(w.wd/5)*5,key=[mz,R.px0,R.py0,R.W,R.H,dr].join("|");
      if(fetchCache.key===key)F=fetchCache.F;else{const A=fetchPass(R,dr-20,cap),B=fetchPass(R,dr,cap),C=fetchPass(R,dr+20,cap);F=new Float32Array(N);for(let i=0;i<N;i++)F[i]=(A[i]+2*B[i]+C[i])/4*m;fetchCache={key,F}}}
    laR=haveLa?R:null;laF=F;laWind=haveLa?w:null;
    let UF=null;if(haveLa){UF=new Float32Array(N);if(S.src==="egen")UF.fill(S.own.sp);else{const st=64,gw=Math.ceil(R.W/st)+1,gh=Math.ceil(R.H/st)+1,G2=new Float32Array(gw*gh);
        for(let gy=0;gy<gh;gy++)for(let gx=0;gx<gw;gx++){const ll=CRS.pointToLatLng(L.point(R.px0+gx*st,R.py0+gy*st),mz),lw=windAt(ll.lat,ll.lng,S.ti);G2[gy*gw+gx]=lw&&lw.ws!=null?calcU(lw):calcU(w)}
        for(let y=0;y<R.H;y++){const fy=y/st,y0=fy|0,ty=fy-y0,y1=Math.min(gh-1,y0+1);for(let x=0;x<R.W;x++){const fx=x/st,x0=fx|0,tx=fx-x0,x1=Math.min(gw-1,x0+1);
          UF[y*R.W+x]=(G2[y0*gw+x0]*(1-tx)+G2[y0*gw+x1]*tx)*(1-ty)+(G2[y1*gw+x0]*(1-tx)+G2[y1*gw+x1]*tx)*ty}}}}
    laU=UF;
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
    // måla
    const showLa=haveLa&&Lyr.la,showT=haveT&&Lyr.temp,findOn=F_.on&&haveLa&&haveT,KARR=showLa&&!findOn?new Int16Array(N).fill(-999):null;
    showCanvas(R,D=>{for(let i=0;i<N;i++){if(!WA[i])continue;const p=i*4;let r=0,g=0,bb=0,a=0;
        if(findOn){let k=0;const h=wave(UF[i],F[i]);while(h>=LA_CLASSES[k][0])k++;const tv=TV[i],ok=k<=F_.maxK&&tv>=F_.tmin&&tv<=F_.tmax;
          if(ok){r=214;g=24;bb=138;a=170}else{r=70;g=80;bb=88;a=95}}
        else if(showLa){let k=0;const h=wave(UF[i],F[i]);while(h>=LA_CLASSES[k][0])k++;KARR[i]=k;const c=LA_RGBA[k];r=c[0];g=c[1];bb=c[2];a=c[3]*255}
        else if(showT){let k=Math.round(((BAND[i]+.5)*tStep)/24*255);k=k<0?0:k>255?255:k;r=TLUT[k*3];g=TLUT[k*3+1];bb=TLUT[k*3+2];a=150}
        D[p]=r;D[p+1]=g;D[p+2]=bb;D[p+3]=a}
      // zongränser för temperaturen, som djupkurvor
      if(showT||findOn){const W2=R.W;for(let y=0;y<R.H-1;y++)for(let x=0;x<W2-1;x++){const i=y*W2+x,bnd=BAND[i];if(bnd===-999)continue;
          const r_=BAND[i+1],d_=BAND[i+W2];if((r_!==-999&&r_!==bnd)||(d_!==-999&&d_!==bnd)){const p=i*4;D[p]=11;D[p+1]=53;D[p+2]=80;D[p+3]=230}}}});
    // etiketter: vindpilar först, sedan sjögång, sedan vattentemperatur, utan krockar
    const boxes=drawArrows(uiBoxes());
    if(showT||findOn)placeLabels(boxes,zoneCands(R,BAND,mz,vx0,vy0,vx1,vy1,b=>{const s=(b*tStep)+"–"+((b+1)*tStep)+"°";return{html:'<div class="zlbl">'+s+'</div>',w:s.length*7+6,h:16}},5,260,30),zoneLayer);
    if(showLa&&KARR&&S.layers.waves)placeLabels(boxes,zoneCands(R,KARR,mz,vx0,vy0,vx1,vy1,(k,i)=>{const h=wave(UF[i],F[i]),a=fmtWave(h,k),b2=LA_CLASSES[k][1].replace(" sjö","").toLowerCase();
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
// Ytor som täcks av tidsraden, knapparna och panelen, så att inga etiketter hamnar under dem.
function uiBoxes(){const m=$("map").getBoundingClientRect(),out=[];
  document.querySelectorAll(".bar,.side,.panel:not(.hidden),.sheet.open,.leaflet-control-scale,.leaflet-control-attribution").forEach(el=>{const r=el.getBoundingClientRect();if(r.width&&r.height)out.push([r.left-m.left,r.top-m.top,r.right-m.left,r.bottom-m.top])});return out}
// Lägger ut etiketter i prioritetsordning och hoppar över allt som skulle krocka.
function placeLabels(boxes,cands,layer){cands.sort((a,b)=>b.score-a.score);const sz=map.getSize();
  for(const c of cands){const p=map.latLngToContainerPoint(c.ll),bx=[p.x-c.w/2-3,p.y-c.h/2-2,p.x+c.w/2+3,p.y+c.h/2+2];
    if(bx[0]<2||bx[1]<2||bx[2]>sz.x-2||bx[3]>sz.y-2)continue;
    if(boxes.some(o=>bx[0]<o[2]&&bx[2]>o[0]&&bx[1]<o[3]&&bx[3]>o[1]))continue;boxes.push(bx);
    L.marker(c.ll,{pane:"lbl",interactive:false,keyboard:false,icon:L.divIcon({className:"",html:c.html,iconSize:[0,0]})}).addTo(layer)}}
let rT=null;const schedule=()=>{clearTimeout(rT);rT=setTimeout(redraw,60)};
map.on("moveend",schedule);

// ------------------------------------------------------------------ vindpilar
const arrowLayer=L.layerGroup().addTo(map);
function drawArrows(ui){arrowLayer.clearLayers();const boxes=(ui||[]).slice();if(!S.layers.arrows)return boxes;
  const add=(ll,wd,ws,gust,big)=>{const s=big?44:36,p=map.latLngToContainerPoint(ll),bx=[p.x-34,p.y-s/2,p.x+34,p.y+s/2+34];
    const sz=map.getSize();if(bx[0]<2||bx[1]<2||bx[2]>sz.x-2||bx[3]>sz.y-2)return;
    if(boxes.some(o=>bx[0]<o[2]&&bx[2]>o[0]&&bx[1]<o[3]&&bx[3]>o[1]))return;arrowAt(ll,wd,ws,gust,big);boxes.push(bx)};
  if(S.src==="egen"){add(map.getCenter(),S.own.dir,S.own.sp,null,true);return boxes}
  const W=S.wind;if(!W)return boxes;const ki=k=>W.keys.indexOf(k),b=map.getBounds().pad(.05),z=map.getZoom(),every=z<=9?3:z<=10?2:1;
  W.points.forEach((p,i)=>{const r=W.series[i][S.ti];if(!r||r[ki("ws")]==null)return;const row=Math.round((p[0]-W.points[0][0])/0.1),col=Math.round((p[1]-W.points[0][1])/0.15);
    if(row%every||col%every)return;if(!b.contains(p))return;add(L.latLng(p[0],p[1]),r[ki("wd")],r[ki("ws")],r[ki("gust")])});
  return boxes}
function arrowAt(ll,wd,ws,gust,big){const s=big?44:36,c=windCol(ws);
  const html=`<svg width="${s}" height="${s}" viewBox="-16 -16 32 32" style="transform:rotate(${wd+180}deg)"><path d="M0 -14 L9 4 L2.5 1.5 L2.5 13 L-2.5 13 L-2.5 1.5 L-9 4 Z" fill="${c}" stroke="#fff" stroke-width="2.4" stroke-linejoin="round" paint-order="stroke"/></svg><span style="border-color:${c}"><b>${f0(ws)}${gust!=null?" ("+f0(gust)+")":""}</b><em>${windTerm(ws).replace(" vind","").toLowerCase()}</em></span>`;
  L.marker(ll,{pane:"lbl",interactive:false,keyboard:false,icon:L.divIcon({className:"arrow",html,iconSize:[76,s+34],iconAnchor:[38,s/2]})}).addTo(arrowLayer)}

// ------------------------------------------------------------------ förklaring
function legend(){const L_=$("legend"),w=laWind||domainWind(S.ti);let h="";
  if(S.find.on)h+=`<span><i style="background:rgba(214,24,138,.67)"></i>Uppfyller villkoren</span><span><i style="background:rgba(70,80,88,.37)"></i>Övrigt vatten</span>`;
  else if(S.layers.la)h+=LA_CLASSES.map(c=>`<span><i style="background:${c[2]}"></i>${c[1]}</span>`).join("");
  else if(S.layers.temp&&tRange)h+=`<div class="grad" style="background:linear-gradient(90deg,${TSTOPS.map(s=>s[1]+" "+(s[0]/24*100)+"%").join(",")})"></div><div class="gl"><span>0</span><span>6</span><span>12</span><span>18</span><span>24 °C</span></div>`;
  if((S.layers.la||S.find.on)&&w)h=`<span><b>${dirName(w.wd)} ${f0(w.ws)} m/s${w.gust!=null?", byar "+f0(w.gust):""}</b>${S.src==="prognos"?" (medel för området) · räknat på "+(S.basis==="byar"&&w.gust!=null?"byar":"medelvind"):""}</span>`+h;
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
$("tmin").oninput=e=>{S.find.tmin=Math.min(+e.target.value,S.find.tmax);syncFind();schedule()};
$("tmax").oninput=e=>{S.find.tmax=Math.max(+e.target.value,S.find.tmin);syncFind();schedule()};
document.querySelectorAll("[data-land]").forEach(b=>b.onclick=()=>{S.land=b.dataset.land;document.querySelectorAll("[data-land]").forEach(x=>x.setAttribute("aria-checked",x===b));try{localStorage.setItem("land",S.land)}catch(_){}schedule()});
try{const sv=localStorage.getItem("land");if(sv&&LANDCOL[sv]!==undefined||sv==="karta"){S.land=sv;document.querySelectorAll("[data-land]").forEach(x=>x.setAttribute("aria-checked",x.dataset.land===sv))}}catch(_){}
document.querySelectorAll("[data-basis]").forEach(b=>b.onclick=()=>{S.basis=b.dataset.basis;document.querySelectorAll("[data-basis]").forEach(x=>x.setAttribute("aria-checked",x===b));try{localStorage.setItem("basis",S.basis)}catch(_){}schedule()});
try{const sb=localStorage.getItem("basis");if(sb==="medel"||sb==="byar"){S.basis=sb;document.querySelectorAll("[data-basis]").forEach(x=>x.setAttribute("aria-checked",x.dataset.basis===sb))}}catch(_){}
$("explain").onclick=()=>{let h=`<h3>Färger för lä och sjögång</h3><p class="note" style="margin-top:2px;padding-right:44px">Klassen bestäms av uppskattad våghöjd (signifikant våghöjd, ungefär medelhöjden av den högsta tredjedelen av vågorna). Den räknas från vindstyrkan och hur mycket öppet vatten det finns mot vinden, högst 6 km.</p>
    <table class="deftab"><tr><th>Klass</th><th>Våg</th><th>Så känns det</th></tr>`+LA_CLASSES.map((c,i)=>`<tr><td><i style="background:${c[2]}"></i>${c[1]}</td><td>${LA_DEF[i][0]}</td><td>${LA_DEF[i][1]}</td></tr>`).join("")+`</table>
    <h3>Räkna på byar eller medelvind</h3><p class="note" style="margin-top:2px"><b>Byar</b> (förvalt) räknar vågorna på den starkaste vinden i prognosen. Det ger en försiktig bild, bra när du ska ligga still och fiska. <b>Medelvind</b> stämmer bättre med hur vågorna oftast blir, men underskattar läget när det är byigt.</p>
    <h3>Vindstyrka (SMHI)</h3><table class="deftab"><tr><th>Benämning</th><th>m/s</th></tr><tr><td>Lugnt</td><td>0–0,2</td></tr><tr><td>Svag vind</td><td>0,3–3</td></tr><tr><td>Måttlig vind</td><td>4–7</td></tr><tr><td>Frisk vind</td><td>8–13</td></tr><tr><td>Hård vind</td><td>14–19</td></tr><tr><td>Mycket hård vind</td><td>20–24</td></tr><tr><td>Storm</td><td>25–32</td></tr></table>
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
function laAt(ll){if(!laR||!laF)return null;const p=CRS.latLngToPoint(ll,laR.z),x=Math.floor(p.x-laR.px0),y=Math.floor(p.y-laR.py0);if(x<0||y<0||x>=laR.W||y>=laR.H)return null;
  const i=y*laR.W+x;return laR.water[i]?laF[i]:-1}
function sheet(){const ll=sel,W=S.wind,w=W?windAt(ll.lat,ll.lng,S.ti):null,di=tempDay(),wt=tempAt(ll.lat,ll.lng,di),la=laR?laAt(ll):null,lw=laWind;
  let h=`<h3>${fmtTime(W?W.times[S.ti]:new Date().toISOString())} · ${ll.lat.toFixed(4).replace(".",",")}° N ${ll.lng.toFixed(4).replace(".",",")}° E</h3>`;
  if(la===-1)h+=`<div class="big">Land</div>`;
  const lu=S.src==="egen"?S.own.sp:w?calcU(w):lw?calcU(lw):null;
  if(la===-1){h+=`<dl class="kv">`}else if(la!=null&&lu!=null){const hs=wave(lu,la);let k=0;while(hs>=LA_CLASSES[k][0])k++;
    h+=`<div class="big">${LA_CLASSES[k][1]} <small>${k===0?"":"ca "}${fmtWave(hs,k)} våg</small></div><dl class="kv"><dt>Öppet vatten mot vinden</dt><dd>${la>=CAP_M*0.98?"över 6 km":la<1000?f0(la/10)*10+" m":f1(la/1000)+" km"}</dd>`;}
  else h+=`<dl class="kv">`;
  if(w)h+=`<dt>Vind${S.src==="egen"?" (prognos)":""}</dt><dd>${dirName(w.wd)} ${f0(w.ws)} m/s${w.gust!=null?", byar "+f0(w.gust):""} <span style="font-weight:500;color:var(--muted)">(${windTerm(w.ws).toLowerCase()})</span></dd><dt>Luft</dt><dd>${f1(w.t)} °C</dd><dt>Nederbörd</dt><dd>${f1(w.pr)} mm/h</dd>`;
  if(wt!=null)h+=`<dt>Vattentemp</dt><dd>${f0(wt)} °C</dd>`;
  if(S.find.on&&la!=null&&la>=0&&lu!=null&&wt!=null){let k=0;const hs=wave(lu,la);while(hs>=LA_CLASSES[k][0])k++;const ok=k<=S.find.maxK&&wt>=S.find.tmin&&wt<=S.find.tmax;h+=`<dt>Villkoren</dt><dd>${ok?"uppfylls":"uppfylls inte"}</dd>`}
  h+=`</dl>`;
  if(w&&la!=null&&la>=0){const g=w.gust!=null?w.gust:w.ws;if(g>=10)h+=`<p class="warn">Byar upp till ${f0(g)} m/s. Även i lä kan byarna slå ner över öarna och ge kraftig drift och snabba vindkast vid båten.</p>`}
  if(W){h+=`<div class="hours">`;for(let i=S.ti;i<W.times.length&&i<S.ti+30;i+=3){const x=windAt(ll.lat,ll.lng,i);if(!x)continue;const d=new Date(W.times[i]);
      h+=`<div>${String(d.getHours()).padStart(2,"0")}<b>${dirName(x.wd)} ${f0(x.ws)}</b>${x.gust!=null?"("+f0(x.gust)+")":""}</div>`}h+=`</div>`}
  if(laR)h+=`<p class="note">Lä räknas från hur mycket öppet vatten som finns mot vinden (inom 6 km). Vågor böjer runt små öar, så verkligt lä är ofta något mindre än kartan visar.</p>`;
  $("sheetc").innerHTML=h;$("sheet").classList.add("open")}

// ------------------------------------------------------------------ min position
let me=null,watch=null;
$("loc").onclick=()=>{if(me){map.setView(me.getLatLng(),Math.max(map.getZoom(),13));return}if(!navigator.geolocation){toast("Positionen är inte tillgänglig");return}
  watch=navigator.geolocation.watchPosition(p=>{const ll=[p.coords.latitude,p.coords.longitude];if(!me){me=L.marker(ll,{interactive:false,icon:L.divIcon({className:"",html:'<div class="me"></div>',iconSize:[22,22]})}).addTo(map);map.setView(ll,Math.max(map.getZoom(),13))}else me.setLatLng(ll)},
    ()=>toast("Kunde inte hämta din position"),{enableHighAccuracy:true,maximumAge:10000})};

// ------------------------------------------------------------------ start
(async()=>{
  try{const info=await getJSON("mask/info.json");const [w,s,e,n]=info.bounds;map.setMaxBounds(L.latLngBounds([s,w],[n,e]).pad(.4))}catch(_){}
  try{S.wind=await getJSON("data/wind.json");$("time").max=S.wind.times.length-1}catch(_){toast("Ingen vinddata än");$("when").textContent="Ingen vinddata"}
  try{S.temp=await getJSON("data/temp.json");const b=atob(S.temp.t),a=new Uint8Array(b.length);for(let i=0;i<b.length;i++)a[i]=b.charCodeAt(i);S.T=a;smoothTemp()}catch(_){}
  setTime(nowIndex());schedule()})();
if("serviceWorker" in navigator)navigator.serviceWorker.register("sw.js").catch(()=>{});
})();
