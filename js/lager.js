/* Skärgårdskartan, lager.js: Kartlagren: vågkammar efter SWAN, zoner, kustlinje, höjdkurvor och etiketter.
   Filerna i js/ laddas i ordning från index.html och delar variabler med varandra. */
"use strict";
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
