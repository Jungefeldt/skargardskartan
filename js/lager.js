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
let MASK_MAX=13,lastCoast=null,coastKey=null;
async function drawCoast(){const zz=map.getZoom(),cz=Math.min(MASK_MAX,Math.max(11,zz)),bnd=map.getBounds().pad(.3),
  nw=CRS.latLngToPoint(bnd.getNorthWest(),cz),se=CRS.latLngToPoint(bnd.getSouthEast(),cz),x0=Math.floor(nw.x),y0=Math.floor(nw.y),W0=Math.ceil(se.x)-x0,H0=Math.ceil(se.y)-y0;
  // samma vy och samma inställningar som förra gången (till exempel nytt tidssteg): rita inte om
  const ck=[zz,cz,x0,y0,W0,H0,S.land,S.layers.contours,!!S.terr,!!S.trees,!!S.osm,window.devicePixelRatio].join("|");
  if(ck===coastKey&&lastCoast&&overlays.coast)return;
  const R=await region(cz,x0,y0,W0,H0),dpr=window.devicePixelRatio||1;
  let k=Math.pow(2,zz-cz)*dpr;k=Math.min(k,4096/W0,4096/H0);const h=k/2;
  const x=overlayCanvas("coast",cz,x0,y0,W0,H0,k),LAND=new Uint8Array(W0*H0);for(let i=0;i<LAND.length;i++)LAND[i]=R.water[i]?0:1;
  // mild utjämning: tar bort trappstegen men behåller uddar och vikar (lite mer när man zoomat förbi maskens upplösning)
  const loops=traceLoops(LAND,W0,H0,zz-cz>=1?2:1);lastCoast={loops,cz,x0,y0};
  // landyta innanför konturen, i sjökortsfärg (inte när vanlig karta är vald)
  const det=S.land==="detalj";
  if(det){fillLoops(x,loops,h,OSM_COL.oppen);if(S.osm)drawDetail(x,cz,x0,y0,k,zz,loops,h,W0,H0);else osmLoad();
    // terrängskuggning (markhöjd och träd) som skugga ovanpå detaljkartans färger
    if(S.terr)drawTerrain(x,loops,h,cz,x0,y0,k,"multiply")}
  else if(S.land!=="karta"){const lc=LANDCOL[S.land];fillLoops(x,loops,h,`rgba(${lc[0]},${lc[1]},${lc[2]},.94)`);
    // terrängskuggning med skog ovanpå landfärgen, klippt till kustlinjen
    if(S.terr&&S.layers.contours)drawTerrain(x,loops,h,cz,x0,y0,k)}
  if(S.terr&&S.layers.contours)drawContours(x,cz,x0,y0,k,zz);
  // detaljkartan: blå strandlinje som hos Lantmäteriet, och bryggorna ovanpå
  strokeLoops(x,loops,h,det?"#2896E1":"#15191D",(det?1.3:1.5)*dpr);
  if(det&&S.osm){drawReeds(x,cz,x0,y0,k,zz,W0,H0);drawPiers(x,cz,x0,y0,k,zz,W0,H0)}coastKey=ck}
// ------------------------------------------------------------------ detaljkarta (OpenStreetMap)
// Hus, bryggor, vägar, stigar och marktyper från OpenStreetMap (data/osm/detalj.json), ritade i
// Lantmäteriets stil ovanpå appens egen kustlinje. Laddas först när Detalj väljs.
const OSM_COL={oppen:"rgb(255,252,226)",skog:"rgb(214,237,193)",bebyggd:"rgb(244,206,152)",industri:"rgb(225,205,190)",
  aker:"rgb(250,240,190)",berg:"rgb(232,228,215)",vatmark:"rgb(214,232,214)",strand:"rgb(250,240,200)"};
const OSM_ORDER=["skog","aker","oppen","vatmark","berg","strand","industri","bebyggd"];
// vassbälten (OSM: wetland=reedbed) ute i vattnet: grönt med små vassymboler, som på Lantmäteriets karta
let reedPat=null;
function drawReeds(x,cz,x0,y0,k,zz,W0,H0){if(zz<12)return;const O=S.osm,N=256*Math.pow(2,cz),vis=osmView(cz,x0,y0,W0,H0),dpr=window.devicePixelRatio||1;
  const P=new Path2D();let any=false;
  for(const f of O.l){if(f.c!=="vass"||f.a.length<6||!vis(f))continue;const a=f.a;P.moveTo((a[0]*N-x0)*k,(a[1]*N-y0)*k);for(let i=2;i<a.length;i+=2)P.lineTo((a[i]*N-x0)*k,(a[i+1]*N-y0)*k);P.closePath();any=true}
  if(!any)return;
  x.fillStyle="rgba(150,190,110,.55)";x.fill(P,"evenodd");
  if(zz>=14){const s=Math.round(9*dpr);if(!reedPat||reedPat.s!==s){const c=document.createElement("canvas");c.width=c.height=s;const g=c.getContext("2d");g.strokeStyle="rgba(50,105,40,.9)";g.lineWidth=Math.max(1,.9*dpr);
      g.beginPath();g.moveTo(s*.3,s*.85);g.lineTo(s*.3,s*.35);g.moveTo(s*.5,s*.85);g.lineTo(s*.5,s*.2);g.moveTo(s*.7,s*.85);g.lineTo(s*.7,s*.4);g.moveTo(s*.2,s*.85);g.lineTo(s*.8,s*.85);g.stroke();reedPat={s,p:x.createPattern(c,"repeat")}}
    x.fillStyle=reedPat.p;x.fill(P,"evenodd")}
  x.strokeStyle="rgba(70,120,55,.7)";x.lineWidth=.8*dpr;x.stroke(P)}
let osmLoading=false;
function osmLoad(){if(S.osm||osmLoading)return;osmLoading=true;
  getJSON("data/osm/detalj.json").then(D=>{const o=D.origin,s=D.scale,RAD=Math.PI/180;
    // koordinaterna räknas om till kartans projektion (0-1) en gång, med en ruta runt varje objekt för snabb gallring
    const prep=(c,cls)=>{const a=new Float64Array(c.length);let x0=1,y0=1,x1=0,y1=0;
      for(let i=0;i<c.length;i+=2){const lon=o[0]+c[i]/s,sn=Math.sin((o[1]+c[i+1]/s)*RAD),mx=(lon+180)/360,my=.5-Math.log((1+sn)/(1-sn))/(4*Math.PI);
        a[i]=mx;a[i+1]=my;if(mx<x0)x0=mx;if(mx>x1)x1=mx;if(my<y0)y0=my;if(my>y1)y1=my}
      return{a,bb:[x0,y0,x1,y1],c:cls}};
    S.osm={b:D.b.map(c=>prep(c)),p:D.p.map(c=>prep(c)),v:D.v.map(([cl,c,nm])=>Object.assign(prep(c,cl),{nm:nm||""})),l:D.l.map(([cl,c])=>prep(c,cl)),
      q:(D.q||[]).map(([t,x,y,nm])=>{const f=prep([x,y]);return{t,mx:f.a[0],my:f.a[1],nm:nm||""}})};
    coastKey=null;schedule()})
    .catch(()=>{osmLoading=false;toast("Detaljkartan är inte klar än, försöker igen senare")})}
function osmView(cz,x0,y0,W0,H0){const N=256*Math.pow(2,cz),v=[x0/N,y0/N,(x0+W0)/N,(y0+H0)/N];
  return f=>!(f.bb[2]<v[0]||f.bb[0]>v[2]||f.bb[3]<v[1]||f.bb[1]>v[3])}
function osmPath(x,f,N,x0,y0,k,close){const a=f.a;x.moveTo((a[0]*N-x0)*k,(a[1]*N-y0)*k);for(let i=2;i<a.length;i+=2)x.lineTo((a[i]*N-x0)*k,(a[i+1]*N-y0)*k);if(close)x.closePath()}
function drawDetail(x,cz,x0,y0,k,zz,loops,h,W0,H0){const O=S.osm,N=256*Math.pow(2,cz),vis=osmView(cz,x0,y0,W0,H0),dpr=window.devicePixelRatio||1,PX=v=>(v-2)*h;
  x.save();x.beginPath();for(const p of loops){x.moveTo(PX(p[0][0]),PX(p[0][1]));for(let i=1;i<p.length;i++)x.lineTo(PX(p[i][0]),PX(p[i][1]));x.closePath()}x.clip("evenodd");
  // marktyper: skog först, bebyggelse överst
  for(const cls of OSM_ORDER){if(cls==="vass")continue;x.fillStyle=OSM_COL[cls];x.beginPath();let any=false;for(const f of O.l)if(f.c===cls&&f.a.length>=6&&vis(f)){osmPath(x,f,N,x0,y0,k,true);any=true}if(any)x.fill()}
  x.lineJoin="round";x.lineCap="round";
  // vägar (från zoom 12) och stigar (prickade, från zoom 14)
  if(zz>=12)for(const [cl,w] of [[3,1.6],[2,2.6],[1,3.6]]){x.strokeStyle="rgb(168,168,170)";x.lineWidth=w*dpr*Math.min(1.4,Math.pow(1.25,zz-14));x.beginPath();
    for(const f of O.v)if(f.c===cl&&vis(f))osmPath(x,f,N,x0,y0,k,false);x.stroke()}
  if(zz>=14){x.strokeStyle="rgb(140,140,140)";x.lineWidth=1.7*dpr;x.setLineDash([.1,4.5*dpr]);x.beginPath();
    for(const f of O.v)if(f.c===4&&vis(f))osmPath(x,f,N,x0,y0,k,false);x.stroke();x.setLineDash([])}
  // hus (från zoom 14)
  if(zz>=14){x.fillStyle="rgb(196,138,88)";x.strokeStyle="rgb(110,70,40)";x.lineWidth=.7*dpr;x.beginPath();
    for(const f of O.b)if(f.a.length>=6&&vis(f))osmPath(x,f,N,x0,y0,k,true);x.fill();if(zz>=15)x.stroke()}
  x.restore()}
// bryggor och pirar som mörka streck ut i vattnet (från zoom 13), ovanpå strandlinjen
function drawPiers(x,cz,x0,y0,k,zz,W0,H0){if(zz<13)return;const O=S.osm,N=256*Math.pow(2,cz),vis=osmView(cz,x0,y0,W0,H0),dpr=window.devicePixelRatio||1;
  x.fillStyle=x.strokeStyle="rgb(70,70,72)";x.lineJoin="round";x.lineCap="butt";x.lineWidth=Math.max(1.2,Math.min(4,2.6*Math.pow(1.6,zz-15)))*dpr;
  const fillB=new Path2D(),lineB=new Path2D();
  for(const f of O.p){if(!vis(f))continue;const a=f.a,n=a.length,closed=n>=8&&a[0]===a[n-2]&&a[1]===a[n-1],P=closed?fillB:lineB;
    P.moveTo((a[0]*N-x0)*k,(a[1]*N-y0)*k);for(let i=2;i<n;i+=2)P.lineTo((a[i]*N-x0)*k,(a[i+1]*N-y0)*k);if(closed)P.closePath()}
  x.fill(fillB);x.stroke(lineB)}
// ------------------------------------------------------------------ satellit (Sentinel-2)
// Vass, grumligt vatten eller alger från satellitbilder (data/satellit), som en färgad bild över vattnet.
const SATC={};
function satLoad(k){if(SATC[k])return SATC[k];
  SATC[k]=new Promise((res,rej)=>{const im=new Image();im.onload=()=>{const M=S.satMeta,[lo,hi]=M.skalor[k],c=document.createElement("canvas");c.width=im.width;c.height=im.height;
      const g=c.getContext("2d");g.drawImage(im,0,0);const D=g.getImageData(0,0,c.width,c.height),d=D.data,n=c.width*c.height;
      // grumlighet och alger: färgskalan efter fördelningen i bilden (2 och 98 procent)
      let p2=lo,p98=hi;if(k!=="vass"){const hist=new Uint32Array(256);let tot=0;for(let i=0;i<n;i++){const q=d[i*4];if(q){hist[q]++;tot++}}
        let acc=0,a2=-1,a98=-1;for(let q=1;q<256;q++){acc+=hist[q];if(a2<0&&acc>=tot*.02)a2=q;if(a98<0&&acc>=tot*.98)a98=q}
        p2=lo+(a2-1)/254*(hi-lo);p98=lo+(a98-1)/254*(hi-lo)}
      const ramp=k==="alger"?[[40,90,150],[70,150,130],[90,170,50]]:[[30,75,145],[90,150,170],[180,140,80]];
      for(let i=0;i<n;i++){const q=d[i*4];if(!q){d[i*4+3]=0;continue}const v=lo+(q-1)/254*(hi-lo);
        if(k==="vass"){if(v<.22){d[i*4+3]=0;continue}const a=Math.min(1,(v-.22)/.35);d[i*4]=30;d[i*4+1]=115;d[i*4+2]=30;d[i*4+3]=Math.round(90+150*a)}
        else{const t=Math.max(0,Math.min(1,(v-p2)/Math.max(1e-6,p98-p2))),j=t<.5?0:1,u=t<.5?t*2:t*2-1,A=ramp[j],B=ramp[j+1];
          for(let ch=0;ch<3;ch++)d[i*4+ch]=Math.round(A[ch]+(B[ch]-A[ch])*u);d[i*4+3]=150}}
      g.putImageData(D,0,0);res(c)};im.onerror=()=>{delete SATC[k];rej()};im.src="data/satellit/"+k+".png"});
  return SATC[k]}
let satAttr=false;
async function drawSat(){const k=S.sat,M=S.satMeta;
  if(!k||!M){if(overlays.sat){map.removeLayer(overlays.sat);delete overlays.sat}legend();return}
  let c;try{c=await satLoad(k)}catch(_){toast("Satellitbilden kunde inte laddas");return}
  if(S.sat!==k)return;
  const b=L.latLngBounds([M.lat0-M.ny*M.dlat,M.lon0],[M.lat0,M.lon0+M.nx*M.dlon]);let o=overlays.sat;
  if(!o){o=overlays.sat=new CanvasOverlay("",b,{pane:"sat",interactive:false}).addTo(map)}else o.setBounds(b);
  const e=o.getElement();e.width=c.width;e.height=c.height;const g=e.getContext("2d");g.clearRect(0,0,e.width,e.height);g.drawImage(c,0,0);
  if(!satAttr){map.attributionControl.addAttribution("Satellit: Copernicus Sentinel-2");satAttr=true}
  legend()}

// Terrängskuggning: markhöjd från Lantmäteriet plus trädhöjd från Skogsstyrelsen, skuggad med ljuset
// från nordväst som på en terrängkarta. Skog tonas grön och blir upphöjd, så att berg och skogsdungar
// får djup. Bilden byggs en gång (rader jämnt fördelade i kartans projektion) och skalas sedan.
let terrImg=null,terrKey=null;
function terrainImage(){const T=S.terr,tr=S.trees,det=S.land==="detalj",lc=det?[255,255,255]:LANDCOL[S.land];if(!T||!lc)return null;
  const key=S.land+"|"+(tr?1:0);if(terrKey===key)return terrImg;
  const nx=T.nx,ny=T.ny,RAD=Math.PI/180,merc=lat=>Math.log(Math.tan(Math.PI/4+lat*RAD/2));
  const yT=merc(T.lat0),yB=merc(T.lat0-ny*T.dlat);
  // höjd (mark + träd) i meter, rad för rad i kartans projektion
  const Z=new Float32Array(nx*ny),C=new Float32Array(nx*ny),G=new Uint8Array(nx*ny);
  for(let r=0;r<ny;r++){const lat=(2*Math.atan(Math.exp(yT+(r+.5)*(yB-yT)/ny))-Math.PI/2)/RAD,fy=Math.max(0,Math.min(ny-1.001,(T.lat0-lat)/T.dlat-.5)),y0=fy|0,ty=fy-y0;
    for(let c=0;c<nx;c++){const a=y0*nx+c,b=a+nx,g=T.H[a]*(1-ty)+T.H[b]*ty,tv=tr?(tr[a]*(1-ty)+tr[b]*ty):0,i=r*nx+c;
      G[i]=g>.5?1:0;C[i]=G[i]?tv:0;Z[i]=g+C[i]}}
  const dxm=T.dlon*111320*Math.cos((T.lat0-ny*T.dlat/2)*RAD),dym=T.dlat*111320,EX=1.6;
  const az=315*RAD,el=40*RAD,Lx=Math.cos(el)*Math.sin(az),Ly=Math.cos(el)*Math.cos(az),Lz=Math.sin(el);
  const FOREST=[150,182,120],cv=document.createElement("canvas");cv.width=nx;cv.height=ny;
  const g2=cv.getContext("2d"),img=g2.createImageData(nx,ny),d=img.data;
  for(let r=0;r<ny;r++)for(let c=0;c<nx;c++){const i=r*nx+c;if(!G[i])continue;
    const zx=(Z[r*nx+Math.min(nx-1,c+1)]-Z[r*nx+Math.max(0,c-1)])/(2*dxm)*EX,zy=(Z[Math.max(0,r-1)*nx+c]-Z[Math.min(ny-1,r+1)*nx+c])/(2*dym)*EX;
    const nl=Math.hypot(zx,zy,1),sh=Math.max(0,(-zx*Lx-zy*Ly+Lz)/nl)/Lz;          // 1 = plan mark
    const f=det?0:Math.min(1,C[i]/8),v=det?Math.max(.62,Math.min(1,.7+.3*sh)):Math.max(.55,Math.min(1.12,.62+.38*sh));
    for(let j=0;j<3;j++)d[i*4+j]=Math.min(255,(lc[j]*(1-f)+FOREST[j]*f)*v);d[i*4+3]=240}
  g2.putImageData(img,0,0);terrImg={cv,yT,yB};terrKey=key;return terrImg}
function drawTerrain(x,loops,h,cz,x0,y0,k,blend){const T=S.terr,I=terrainImage();if(!I)return;
  const N=256*Math.pow(2,cz),PX=v=>(v-2)*h,R2=180/Math.PI;
  const left=((T.lon0+180)/360*N-x0)*k,right=((T.lon0+T.nx*T.dlon+180)/360*N-x0)*k;
  const top=((.5-I.yT/(2*Math.PI))*N-y0)*k,bot=((.5-I.yB/(2*Math.PI))*N-y0)*k;
  x.save();x.beginPath();for(const p of loops){x.moveTo(PX(p[0][0]),PX(p[0][1]));for(let i=1;i<p.length;i++)x.lineTo(PX(p[i][0]),PX(p[i][1]));x.closePath()}
  x.clip("evenodd");x.imageSmoothingEnabled=true;if(blend)x.globalCompositeOperation=blend;x.drawImage(I.cv,left,top,right-left,bot-top);x.restore()}
// Höjdkurvor på land ur Lantmäteriets höjdmodell (data/terrang.json, ca 20 m mellan punkterna).
// Tätare kurvor ju mer man zoomar in; var femte kurva är lite kraftigare.
let contourCache={key:null,lev:null};
// Höjdkurvorna för hela området räknas en gång i bakgrunden, en nivå i taget, och återanvänds sedan
// när kartan flyttas. Tills de är klara räknas bara det som syns.
const CONT={};
function contourBuild(step){if(CONT[step]||!S.terr)return;const T=S.terr,W=T.nx,H=T.ny,c={lev:[],done:false};CONT[step]=c;
  let hi=0;for(let i=0;i<T.H.length;i++)if(T.H[i]>hi)hi=T.H[i];let L=step;
  const idle=window.requestIdleCallback?f=>requestIdleCallback(f,{timeout:2000}):f=>setTimeout(f,50);
  const next=()=>{if(L>hi){c.done=true;coastKey=null;schedule();return}
    const M=new Uint8Array(W*H);for(let i=0;i<M.length;i++)M[i]=T.H[i]>=L?1:0;const loops=traceLoops(M,W,H,2);
    for(const p of loops){let a=1e9,b=1e9,e=-1e9,d=-1e9;for(const q of p){if(q[0]<a)a=q[0];if(q[0]>e)e=q[0];if(q[1]<b)b=q[1];if(q[1]>d)d=q[1]}p.bb=[a,b,e,d]}
    c.lev.push([L,loops]);L+=step;idle(next)};
  idle(next)}
function drawContours(x,cz,x0,y0,k,zz){const T=S.terr;if(zz<12)return;const step=zz>=14?5:10,bold=zz>=14?25:50;
  const b=map.getBounds().pad(.05);
  let c0=Math.max(0,Math.floor((b.getWest()-T.lon0)/T.dlon)),c1=Math.min(T.nx,Math.ceil((b.getEast()-T.lon0)/T.dlon));
  let r0=Math.max(0,Math.floor((T.lat0-b.getNorth())/T.dlat)),r1=Math.min(T.ny,Math.ceil((T.lat0-b.getSouth())/T.dlat));
  let W=c1-c0,H=r1-r0;if(W<3||H<3)return;
  const full=CONT[step]&&CONT[step].done?CONT[step]:null;contourBuild(step);
  const vb=[2*c0,2*r0,2*c1+4,2*r1+4];                                      // det synliga, i kurvornas koordinater
  const key=[c0,r0,W,H,step].join("|");let lev=full?full.lev:contourCache.key===key?contourCache.lev:null;
  if(full){c0=0;r0=0;W=T.nx;H=T.ny}
  if(!lev){const sub=new Uint8Array(W*H);let hi=0;for(let r=0;r<H;r++){const o=(r0+r)*T.nx+c0;for(let c=0;c<W;c++){const v=T.H[o+c];sub[r*W+c]=v;if(v>hi)hi=v}}
    lev=[];for(let L=step;L<=hi;L+=step){const M=new Uint8Array(W*H);for(let i=0;i<M.length;i++)M[i]=sub[i]>=L?1:0;lev.push([L,traceLoops(M,W,H,2)])}
    contourCache={key,lev}}
  const N=256*Math.pow(2,cz),RAD=Math.PI/180;
  const TX=v=>(((T.lon0+(c0+(v-2)/2)*T.dlon)+180)/360*N-x0)*k;
  const TY=v=>{const s=Math.sin((T.lat0-(r0+(v-2)/2)*T.dlat)*RAD);return((.5-Math.log((1+s)/(1-s))/(4*Math.PI))*N-y0)*k};
  const dpr=window.devicePixelRatio||1;x.lineJoin="round";x.lineCap="round";
  for(const [L,loops] of lev){const strong=L%bold===0;x.lineWidth=(strong?1.1:.6)*dpr;x.strokeStyle=strong?"rgba(120,82,40,.75)":"rgba(140,100,55,.5)";x.beginPath();
    const Wl=loops.W,Hl=loops.H,edge=q=>q[0]<2.6||q[1]<2.6||q[0]>2*Wl-2.6||q[1]>2*Hl-2.6;
    for(const p of loops){if(full&&p.bb&&(p.bb[2]<vb[0]||p.bb[0]>vb[2]||p.bb[3]<vb[1]||p.bb[1]>vb[3]))continue;   // utanför bilden
      let pen=false;for(const q of p){if(edge(q)){pen=false;continue}const X=TX(q[0]),Y=TY(q[1]);if(pen)x.lineTo(X,Y);else{x.moveTo(X,Y);pen=true}}}
    x.stroke()}}
// Ytor som täcks av tidsraden, knapparna och panelen, så att inga etiketter hamnar under dem.
function uiBoxes(){const m=$("map").getBoundingClientRect(),out=[];
  document.querySelectorAll(".bar,.side,.panel:not(.hidden),.sheet.open,.ruler,.leaflet-control-attribution").forEach(el=>{const r=el.getBoundingClientRect();if(r.width&&r.height)out.push([r.left-m.left,r.top-m.top,r.right-m.left,r.bottom-m.top])});return out}
// Lägger ut etiketter i prioritetsordning och hoppar över allt som skulle krocka.
function placeNames(){nameLayer.clearLayers();const boxes=uiBoxes();
  if(S.layers.names!==false){placeLabels(boxes,nameCands(),nameLayer,"names");if(S.land==="detalj"&&S.osm)placeLabels(boxes,detailCands(),nameLayer,"names")}
  return boxes}
// ------------------------------------------------------------------ platser och vägnamn i detaljkartan
// typ: [symbol, färg, från zoom, prioritet, namn från zoom]
const POI={farja:["⛴","#1F5F82",13,9,15],hamn:["⚓","#1F5F82",13,8,15],ramp:["⛵","#1F5F82",14,7,99],bransle:["⛽","#B0412E",14,7,16],
  affar:["🛒","#7A5A2E",14,6,15],mat:["🍴","#7A5A2E",15,5,16],bad:["🏊","#2E86B0",15,4,99],camping:["⛺","#3E7A3A",15,4,16],
  boende:["🛏","#7A5A2E",15,3,16],wc:["WC","#555",16,2,99],parkering:["P","#3A5FA8",16,1,99]};
const mercLL=(mx,my)=>L.latLng(Math.atan(Math.sinh(Math.PI*(1-2*my)))*180/Math.PI,mx*360-180);
const esc=s=>s.replace(/&/g,"&amp;").replace(/</g,"&lt;");
function detailCands(){const O=S.osm,z=map.getZoom(),b=map.getBounds(),N=256*Math.pow(2,z),out=[];
  const nw=map.project(b.getNorthWest(),z),se=map.project(b.getSouthEast(),z),v=[nw.x/N,nw.y/N,se.x/N,se.y/N];
  // platssymboler, de viktigaste först
  for(const q of O.q){const P=POI[q.t];if(!P||z<P[2]||q.mx<v[0]||q.mx>v[2]||q.my<v[1]||q.my>v[3])continue;
    const nm=q.nm&&z>=P[4]?esc(q.nm.length>22?q.nm.slice(0,21)+"…":q.nm):"",txt=P[0].length<=2&&/[A-Z]/.test(P[0]);
    const html=`<div style="position:absolute;transform:translate(-11px,-11px);display:flex;align-items:center;gap:4px;white-space:nowrap;pointer-events:none">`+
      `<span style="width:22px;height:22px;border-radius:50%;background:#fff;border:2px solid ${P[1]};display:flex;align-items:center;justify-content:center;font:${txt?"700 10px":"13px"} system-ui;color:${P[1]};box-shadow:0 1px 3px rgba(0,0,0,.3)">${P[0]}</span>`+
      (nm?`<span style="font:600 11px system-ui;color:${P[1]};text-shadow:0 0 2px #fff,0 0 2px #fff,0 0 3px #fff">${nm}</span>`:"")+`</div>`;
    const w=nm?28+nm.length*6.3:24;out.push({ll:mercLL(q.mx,q.my),html,w:w*2-24,h:24,score:5e5+P[3]*1e4})}
  // vägnamn längs vägarna (från zoom 15): på den längsta synliga raka biten, en gång per namn
  if(z>=15){const best=new Map();
    for(const f of O.v){if(!f.nm||f.bb[2]<v[0]||f.bb[0]>v[2]||f.bb[3]<v[1]||f.bb[1]>v[3])continue;const a=f.a;
      // längsta nästan raka sträckan (flera bitar i rad som svänger mindre än 25 grader)
      const W=se.x-nw.x,H=se.y-nw.y,px=i=>[a[i]*N-nw.x,a[i+1]*N-nw.y];let s0=0,len=0,dir=null;
      const take=(i0,i1,L)=>{if(L<=0)return;const p0=px(i0),p1=px(i1),cx=(p0[0]+p1[0])/2,cy=(p0[1]+p1[1])/2;if(cx<20||cy<20||cx>W-20||cy>H-20)return;
        const o=best.get(f.nm);if(!o||L>o.len)best.set(f.nm,{len:L,x1:p0[0],y1:p0[1],x2:p1[0],y2:p1[1],mx:(a[i0]+a[i1])/2,my:(a[i0+1]+a[i1+1])/2})};
      for(let i=0;i+3<a.length;i+=2){const p1=px(i),p2=px(i+2),dx=p2[0]-p1[0],dy=p2[1]-p1[1],l=Math.hypot(dx,dy),d=Math.atan2(dy,dx);
        if(dir!==null&&Math.abs(((d-dir)*180/Math.PI+540)%360-180)>25){take(s0,i,len);s0=i;len=0}
        len+=l;dir=d}
      take(s0,a.length-2,len)}
    for(const [nm,s] of best){const tw=nm.length*6.2+6;if(s.len<tw*.8)continue;let ang=Math.atan2(s.y2-s.y1,s.x2-s.x1)*180/Math.PI;if(ang>90)ang-=180;if(ang<-90)ang+=180;
      const r=ang*Math.PI/180,bw=Math.abs(tw*Math.cos(r))+Math.abs(14*Math.sin(r)),bh=Math.abs(tw*Math.sin(r))+Math.abs(14*Math.cos(r));
      out.push({ll:mercLL(s.mx,s.my),html:`<div style="position:absolute;transform:translate(-50%,-50%) rotate(${ang.toFixed(1)}deg);font:italic 500 11px system-ui;color:#5A5A5A;white-space:nowrap;text-shadow:0 0 2px #fff,0 0 2px #fff,0 0 3px #fff;pointer-events:none">${esc(nm)}</div>`,
        w:bw,h:bh,score:1e5+s.len})}}
  return out}
function placeLabels(boxes,cands,layer,pane){cands.sort((a,b)=>b.score-a.score);const sz=map.getSize();
  for(const c of cands){const p=map.latLngToContainerPoint(c.ll),bx=[p.x-c.w/2-3,p.y-c.h/2-2,p.x+c.w/2+3,p.y+c.h/2+2];
    if(bx[0]<2||bx[1]<2||bx[2]>sz.x-2||bx[3]>sz.y-2)continue;
    if(boxes.some(o=>bx[0]<o[2]&&bx[2]>o[0]&&bx[1]<o[3]&&bx[3]>o[1]))continue;boxes.push(bx);
    L.marker(c.ll,{pane:pane||"lbl",interactive:false,keyboard:false,icon:L.divIcon({className:"",html:c.html,iconSize:[0,0]})}).addTo(layer)}}
let rT=null;const schedule=()=>{clearTimeout(rT);rT=setTimeout(redraw,60)};
map.on("moveend",schedule);
