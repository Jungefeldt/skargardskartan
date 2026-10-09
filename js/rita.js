/* Skärgårdskartan, rita.js: Beräkning och ritning av zoner: omritning, etiketter, konturer och vågkammar.
   Filerna i js/ laddas i ordning från index.html och delar variabler med varandra. */
"use strict";
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
// släpper fram webbläsaren mellan tunga steg, så att vågor och pilar fortsätter röra sig under omräkningen
const yieldUI=()=>new Promise(r=>setTimeout(r,0));
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
    // fönstret: det som syns plus en liten marginal; allt som räknas per punkt räknas bara här
    const wx0=Math.max(0,vx0-R.px0-10),wx1=Math.min(R.W,vx1-R.px0+10),wy0=Math.max(0,vy0-R.py0-10),wy1=Math.min(R.H,vy1-R.py0+10),win=[wx0,wx1,wy0,wy1];
    let nwi=0;const WI=new Int32Array(Math.max(0,(wx1-wx0)*(wy1-wy0)));for(let y=wy0;y<wy1;y++){const o=y*R.W;for(let x=wx0;x<wx1;x++)if(WA[o+x])WI[nwi++]=o+x}
    // kustlinje: skarp vektorlinje i skärmens upplösning, som på ett sjökort
    await drawCoast();if(my!==seq)return;await yieldUI();
    // första gången: sjömärkena efter land, och vågor och vind först när sjömärkena har laddat (högst 1,5 s)
    if(!map.hasLayer(seamarkLayer)){seamarkLayer.addTo(map);await new Promise(r=>{let d=false;const f=()=>{if(!d){d=true;r()}};seamarkLayer.once("load",f);setTimeout(f,1500)})}
    if(!haveLa&&!haveT&&!privOn&&!((S.depth||S.depthP)&&Lyr.depth)){hideCanvas();hideCanvas("zones");hideCanvas("crests");crestSet=null;reliefHide();laR=null;laT=null;drawArrows(placeNames(),true);legend();if(sel)sheet();return}
    // lä
    // riktningen avrundas till 5 grader; samma vy och riktning återanvänder beräkningen (snabb uppspelning)
    let F=null;if(haveLa){const dr=Math.round(w.wd/5)*5,key=[mz,R.px0,R.py0,R.W,R.H,dr].join("|");
      if(fetchCache.key===key)F=fetchCache.F;else{const A=fetchPass(R,dr-20,cap),B=fetchPass(R,dr,cap),C=fetchPass(R,dr+20,cap);F=new Float32Array(N);for(let i=0;i<N;i++)F[i]=(A[i]+2*B[i]+C[i])/4*m;fetchCache={key,F};await yieldUI()}}
    laR=haveLa?R:null;laF=F;laWind=haveLa?w:null;
    let UF=null;if(haveLa){UF=new Float32Array(N);if(S.src==="egen")UF.fill(S.own.sp);else{const st=64,gw=Math.ceil(R.W/st)+1,gh=Math.ceil(R.H/st)+1,G2=new Float32Array(gw*gh);
        for(let gy=Math.floor(wy0/st);gy<=Math.min(gh-1,Math.ceil(wy1/st));gy++)for(let gx=Math.floor(wx0/st);gx<=Math.min(gw-1,Math.ceil(wx1/st));gx++){const ll=CRS.pointToLatLng(L.point(R.px0+gx*st,R.py0+gy*st),mz),lw=windAt(ll.lat,ll.lng,S.ti);G2[gy*gw+gx]=lw&&lw.ws!=null?calcU(lw):calcU(w)}
        for(let y=wy0;y<wy1;y++){const fy=y/st,y0=fy|0,ty=fy-y0,y1=Math.min(gh-1,y0+1);for(let x=wx0;x<wx1;x++){const fx=x/st,x0=fx|0,tx=fx-x0,x1=Math.min(gw-1,x0+1);
          UF[y*R.W+x]=(G2[y0*gw+x0]*(1-tx)+G2[y0*gw+x1]*tx)*(1-ty)+(G2[y1*gw+x0]*(1-tx)+G2[y1*gw+x1]*tx)*ty}}}}
    // lä bakom öar och skog: vinden dämpas där land och träd skymmer i vindens riktning
    let LF=null;if(haveLa&&S.vind){LF=await leeField(R,mz,w.wd,win);if(my!==seq)return;if(LF)for(let q=0;q<nwi;q++){const i=WI[q];UF[i]*=LF[i]}}
    await yieldUI();
    laU=UF;laLee=LF;
    // vattentemperatur per pixel
    let TV=null,BAND=null;
    if(haveT){const G=S.temp,T=S.TF,base=di*G.nx*G.ny,rowFy=new Float32Array(R.H),colFx=new Float32Array(R.W);TV=new Float32Array(N);
      for(let y=0;y<R.H;y++){const lat=CRS.pointToLatLng(L.point(R.px0,R.py0+y+.5),mz).lat;rowFy[y]=Math.max(0,Math.min(G.ny-1,(lat-G.lat0)/G.dlat))}
      for(let x=0;x<R.W;x++){const lon=CRS.pointToLatLng(L.point(R.px0+x+.5,R.py0),mz).lng;colFx[x]=Math.max(0,Math.min(G.nx-1,(lon-G.lon0)/G.dlon))}
      let lo=99,hi=-99;
      for(let y=wy0;y<wy1;y++){const fy=rowFy[y],ya=fy|0,yb=Math.min(G.ny-1,ya+1),ty=fy-ya,r0=base+ya*G.nx,r1=base+yb*G.nx,inV=R.py0+y>=vy0&&R.py0+y<vy1;
        for(let x=wx0;x<wx1;x++){const i=y*R.W+x;if(!WA[i])continue;const fx=colFx[x],xa=fx|0,xb=Math.min(G.nx-1,xa+1),tx=fx-xa;
          const v=(T[r0+xa]*(1-tx)+T[r0+xb]*tx)*(1-ty)+(T[r1+xa]*(1-tx)+T[r1+xb]*tx)*ty;TV[i]=v;
          if(inV&&R.px0+x>=vx0&&R.px0+x<vx1){if(v<lo)lo=v;if(v>hi)hi=v}}}
      if(lo>hi){lo=hi=TV.find(v=>v)||0}
      tRange=[lo,hi];tStep=chooseStep(hi-lo);BAND=new Int16Array(N).fill(-999);for(let q=0;q<nwi;q++){const i=WI[q];BAND[i]=Math.floor(TV[i]/tStep)}
      {const smin=Math.floor(lo)-1,smax=Math.ceil(hi)+1;for(const id of ["tmin","tmax"]){$(id).min=smin;$(id).max=smax}}
      if(S.find.tmin==null){S.find.tmin=Math.floor(lo);S.find.tmax=Math.ceil(hi);syncFind()}}
    laT=TV;
    // djup per vattenpunkt (för djupskiktet och djupfiltret i Hitta plats)
    const patMode=(S.wstyle==="monster"||S.wstyle==="rorlig")&&haveLa&&Lyr.la&&!F_.on;
    const hasD=!!(S.depth||S.depthP),useDF=F_.on&&hasD&&(F_.dmin>0||F_.dmax<60),needD=hasD&&(Lyr.depth||useDF);let DV=null,DB=null;
    if(needD){DV=new Float32Array(N);DB=new Int16Array(N).fill(-999)}
    if(needD&&S.depth){const G=S.depth,Dg=G.D,GW=G.nx,rowF=new Float32Array(R.H),colF=new Float32Array(R.W);
      for(let y=0;y<R.H;y++){const lat=CRS.pointToLatLng(L.point(R.px0,R.py0+y+.5),mz).lat;rowF[y]=Math.max(0,Math.min(G.ny-1.001,(lat-G.lat0)/G.dlat))}
      for(let x=0;x<R.W;x++){const lon=CRS.pointToLatLng(L.point(R.px0+x+.5,R.py0),mz).lng;colF[x]=Math.max(0,Math.min(G.nx-1.001,(lon-G.lon0)/G.dlon))}
      for(let y=wy0;y<wy1;y++){const fy=rowF[y],ya=fy|0,ty=fy-ya,r0=ya*GW,r1=r0+GW;for(let x=wx0;x<wx1;x++){const i=y*R.W+x;if(!WA[i])continue;const fx=colF[x],xa=fx|0,tx=fx-xa;
          const d=((Dg[r0+xa]*(1-tx)+Dg[r0+xa+1]*tx)*(1-ty)+(Dg[r1+xa]*(1-tx)+Dg[r1+xa+1]*tx)*ty)/2;DV[i]=d;DB[i]=depthBand(d)}}}
    // eget djup (privat, från sjökortsbilder) ersätter EMODnet där det finns
    if(needD&&S.depthP){const lat=new Float64Array(R.H),lon=new Float64Array(R.W);
      for(let y=wy0;y<wy1;y++)lat[y]=CRS.pointToLatLng(L.point(R.px0,R.py0+y+.5),mz).lat;
      for(let x=wx0;x<wx1;x++)lon[x]=CRS.pointToLatLng(L.point(R.px0+x+.5,R.py0),mz).lng;
      for(let q=0;q<nwi;q++){const i=WI[q],y=(i/R.W)|0,x=i-y*R.W,d=ownDepth(lat[y],lon[x]);if(d!=null){DV[i]=d;DB[i]=depthBand(d)}}}
    // SWAN-fält för vågmönstret, om det finns för området
    let SW=null;if(patMode&&S.swan){const C=await swanCase(w.wd,S.src==="egen"?S.own.sp:calcU(w));if(my!==seq)return;if(C){SW=swanSample(R,mz,C,win);SW.dir=C.dir;
        // utanför SWAN-området: våghöjd från den enklare beräkningen och vågriktning efter vinden
        for(let q=0;q<nwi;q++){const i=WI[q];if(SW.H[i]<0){SW.H[i]=wave(UF[i],F[i]);SW.D[i]=w.wd;SW.T[i]=-1}}
        // SWAN räknar med samma vind överallt; i vindlä bakom land och skog blir vågorna lägre
        if(LF)for(let q=0;q<nwi;q++){const i=WI[q];if(SW.T[i]>=0&&SW.H[i]>0)SW.H[i]*=LF[i]}}
      await yieldUI()}
    lastSW=SW?{R,mz,...SW}:null;
    // klasser per vattenpunkt (används både för ytorna och etiketterna)
    const showLa=haveLa&&Lyr.la,showT=haveT&&Lyr.temp,findOn=F_.on&&haveLa&&haveT;
    const HS=i=>SW&&SW.H[i]>=0?SW.H[i]:wave(UF[i],F[i]);
    let KARR=null,FOK=null;
    if(showLa&&!findOn){KARR=new Int16Array(N).fill(-999);for(let q=0;q<nwi;q++){const i=WI[q];let k=0;const h=HS(i);while(h>=LA_CLASSES[k][0])k++;KARR[i]=k}}
    if(findOn){FOK=new Int16Array(N).fill(-999);for(let q=0;q<nwi;q++){const i=WI[q];let k=0;const h=wave(UF[i],F[i]);while(h>=LA_CLASSES[k][0])k++;const tv=TV[i];
        FOK[i]=k<=F_.maxK&&tv>=F_.tmin&&tv<=F_.tmax&&!(S.privOk&&R.priv[i])&&(!useDF||(DV[i]>=F_.dmin&&DV[i]<=F_.dmax))?1:0}}
    hideCanvas();
    const showD=!!(hasD&&Lyr.depth&&DB),pat=patMode&&!!KARR;
    let RELIEF=null;if(pat&&S.wstyle==="rorlig"&&reliefPossible(w.wd)){RELIEF=new Float32Array(N);for(let q=0;q<nwi;q++){const i=WI[q];RELIEF[i]=HS(i)}}
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
