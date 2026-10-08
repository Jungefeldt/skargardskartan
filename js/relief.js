/* Skärgårdskartan, relief.js: Rörliga vågor i relief (WebGL).
   Filerna i js/ laddas i ordning från index.html och delar variabler med varandra. */
"use strict";
// ------------------------------------------------------------------ rörliga vågor i relief (WebGL)
// Vågytan räknas på grafikkortet som en summa av många vågor med olika längd och riktning.
// Inzoomat (zoom 15 och inåt) följer vågorna fasfälten från SWAN (data/fas), så att de böjer sig runt
// öar och in i sund. Utzoomat går de raka i SWAN:s riktning mitt i bilden, eftersom böjda fält där gav
// störande ringmönster. Läet syns ändå, eftersom våghöjden kommer från SWAN och läet. Våglängden är den
// verkliga för vinden (JONSWAP, ca 4 km vindsträcka), men aldrig kortare än 14 pixlar, så att
// vågorna syns även utzoomat. Våghöjden kommer från SWAN och läet på varje plats.
// Karaktären följer vinden: i svag vind långa, tunna krusningar åt nästan samma håll; i hård vind
// korta, branta vågor åt fler håll. Vågorna växer och avtar i våggrupper.
// Ljuset kommer alltid från nordväst, som på terrängen, så att vågorna ser upphöjda ut. Varje kam
// kastar en kort skugga. Kammar som bryter (över 6 m/s) får skum som följer kammen och lämnar ett
// spår bakåt. Mot stränder som vågorna går rakt mot blir det bränningar och en sköljzon.
// När tiden byts glider våghöjd, riktning, våglängd och vind mjukt över till de nya värdena.
const NCOMP=40,REL_EX=20;
const WCOMP=(()=>{let s=7;const rnd=()=>{s=(s*16807)%2147483647;return s/2147483647};
  const gs=()=>{let u=0;while(!u)u=rnd();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*rnd())};
  const out=[];let s1=0,s2=0;
  for(let i=0;i<NCOMP;i++){const r=Math.exp(Math.log(.65)+(i+rnd())/NCOMP*Math.log(7));
    const th=Math.max(-2.2,Math.min(2.2,gs()*(1+.35*Math.log(Math.max(r,1))))),m=Math.sqrt(-2*Math.log(Math.max(1e-6,rnd())));
    const calm=(r<1?Math.exp(-Math.pow(Math.log(r),2)/.1):Math.pow(r,-2.6))*m,rough=(r<1?Math.exp(-Math.pow(Math.log(r),2)/.1):Math.pow(r,-1.9))*m;
    out.push([r,th,calm,rough,rnd()*2*Math.PI]);s1+=calm*calm;s2+=rough*rough}
  return out.map(c=>[c[0],c[1],c[2]/Math.sqrt(s1),c[3]/Math.sqrt(s2),c[4]])})();
const WG={ok:null,gl:null,canvas:null,prog:null,u:{},tex:{},name:null,raf:0,t0:performance.now(),st:null,tAcc:0,last:0,pd:{}};
// tempo för de rörliga vågkammarna (vågmönster): snabbare inzoomat, långsammare utzoomat (zoom 13 = normalt),
// aldrig snabbare än riktiga vågor. Reliefen går i verklig takt, eftersom vågorna har verklig längd.
let rateCap=1;
const animRate=()=>Math.min(rateCap,Math.pow(1.5,map.getZoom()-13));
function setRateCap(U,uS){U=Math.max(2,U||10);const Treal=0.286*Math.cbrt(9.81*4000/(U*U))*U/9.81,Tvis=2.6/Math.sqrt(1.6*uS);rateCap=Math.max(.3,Math.min(1.2,Tvis/Treal))}
const VS="attribute vec2 a;varying vec2 v;void main(){v=vec2(a.x*.5+.5,.5-a.y*.5);gl_Position=vec4(a,0.,1.);}";
const FS=`precision highp float;
varying vec2 v;
uniform sampler2D uP,uQ,uHW,uHW2;
uniform vec4 uPR,uGeo,uGrid,uC[${NCOMP}];
uniform float uR[${NCOMP}];
uniform vec2 uCS[${NCOMP}];
uniform vec2 uN,uM,uTx;
uniform float uT,uPx,uLam,uW,uU,uSc,uBend,uMix;
uniform vec2 uTr;
float hash(vec2 p){p=mod(p,997.);return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
float lace(vec2 p){return .55*vn(p)+.3*vn(p*2.3+7.1)+.15*vn(p*5.1+3.7);}   // oregelbunden skumstruktur
float dec(sampler2D s,vec2 ij){vec4 c=texture2D(s,(ij+.5)/uN);return(c.r*65280.+c.g*255.)/65535.;}
float fld(sampler2D s,vec2 g){vec2 p=g-.5,i=floor(p),f=p-i;
  return mix(mix(dec(s,i),dec(s,i+vec2(1.,0.)),f.x),mix(dec(s,i+vec2(0.,1.)),dec(s,i+vec2(1.,1.)),f.x),f.y);}
void main(){
  vec4 hw=mix(texture2D(uHW2,v),texture2D(uHW,v),uMix);if(hw.g<.02){gl_FragColor=vec4(0.);return;}   // gammal och ny tid blandas
  float H=hw.r*255./200.,dist=hw.b*255.*.5;                           // våghöjd (m), avstånd till land (m)
  float dR=texture2D(uHW,v+vec2(uTx.x,0.)).b,dL=texture2D(uHW,v-vec2(uTx.x,0.)).b;
  float dU=texture2D(uHW,v-vec2(0.,uTx.y)).b,dD=texture2D(uHW,v+vec2(0.,uTx.y)).b;
  vec2 gd=vec2(dR-dL,dU-dD);                                           // åt vilket håll land ligger
  float lon=mix(uGeo.x,uGeo.y,v.x),lat=mix(uGeo.z,uGeo.w,v.y);
  vec2 g=vec2((lon-uGrid.x)/uGrid.z,(uGrid.y-lat)/uGrid.w);
  vec2 tr=uTr;float lam=uLam,P=0.,Q=0.;vec2 gP=vec2(0.),gQ=vec2(0.);
  if(uBend>.5){                                                        // inzoomat: böj runt öar och in i sund
    P=uPR.x+(uPR.y-uPR.x)*fld(uP,g);Q=uPR.z+(uPR.w-uPR.z)*fld(uQ,g);
    float Px=uPR.x+(uPR.y-uPR.x)*fld(uP,g+vec2(1.,0.)),Py=uPR.x+(uPR.y-uPR.x)*fld(uP,g+vec2(0.,1.));
    float Qx=uPR.z+(uPR.w-uPR.z)*fld(uQ,g+vec2(1.,0.)),Qy=uPR.z+(uPR.w-uPR.z)*fld(uQ,g+vec2(0.,1.));
    gP=vec2((Px-P)/uM.x,(P-Py)/uM.y);gQ=vec2((Qx-Q)/uM.x,(Q-Qy)/uM.y);
    float lb=1./max(length(gP),1e-5);tr=gP*lb;lam=lb/uSc;}
  vec2 cr=vec2(-tr.y,tr.x);                                            // tr: vågornas gångriktning
  vec2 x0=vec2(g.x*uM.x,-g.y*uM.y);                                    // meter, fast mot kartan
  float kp=6.2832/lam,cp=sqrt(9.81/kp);
  vec2 lt=vec2(-.7071,.7071);                                          // ljuset från nordväst
  vec2 w2=vec2(vn(x0/(lam*2.3)+11.),vn(x0/(lam*2.3)+27.))-.5;vec2 x=x0+w2*lam*.35;
  float D0=3.+6.*H,near=1.-smoothstep(0.,D0,dist);                     // vågorna går ända fram till stranden
  float amp=max(H,.005)/4./.7071*(1.-.5*near);
  bool foamOn=uU>6.&&H>.2;
  float d1=lam*.025,d2=lam*.06,d3=lam*.11,f1=lam*.07,f2=lam*.16,f3=lam*.28;
  float eta=0.,s1=0.,s2=0.,s3=0.,e1=0.,e2=0.,e3=0.;vec2 gr=vec2(0.);
  for(int i=0;i<${NCOMP};i++){vec4 c=uC[i];float ca=uCS[i].x,sa=uCS[i].y;           // riktning, räknad i förväg
    vec2 kv;float a;
    if(uBend>.5){kv=6.2832*c.x*uSc*(ca*gP+sa*gQ);a=6.2832*c.x*uSc*(ca*P+sa*Q)+dot(kv,x-x0);}
    else{kv=6.2832*c.x/lam*vec2(ca*tr.x-sa*tr.y,ca*tr.y+sa*tr.x);a=dot(kv,x);}
    float k=length(kv);
    float f=smoothstep(4.,12.,6.2832/k/uPx);if(f<=0.)continue;         // för korta vågor för pixlarna tonas bort
    a+=c.w-sqrt(9.81*k)*uT;float A=mix(c.z,uR[i],uW)*amp*f;
    eta+=A*cos(a);gr-=A*sin(a)*kv;float kt=dot(kv,lt);
    s1+=A*cos(a+kt*d1);s2+=A*cos(a+kt*d2);s3+=A*cos(a+kt*d3);
    if(foamOn){float kf=dot(kv,tr);e1+=A*cos(a+kf*f1);e2+=A*cos(a+kf*f2);e3+=A*cos(a+kf*f3);}}
  vec2 gq=vec2((dot(x,tr)-cp*.5*uT)/(lam*mix(4.,2.5,uW)),dot(x,cr)/(lam*mix(9.,3.5,uW)));
  float env=.35+1.3*(.6*vn(gq)+.4*vn(gq*2.1+5.3));                    // våggrupper
  eta*=env;gr*=env;s1*=env;s2*=env;s3*=env;
  float calm=smoothstep(.02,.18,H)*(1.-.5*near);                      // i lä nästan blankt
  float tl=3.6*amp/lam,soft=.1*amp;
  float shd=max(max(smoothstep(0.,soft,s1-eta-d1*tl),.75*smoothstep(0.,soft,s2-eta-d2*tl)),.4*smoothstep(0.,soft,s3-eta-d3*tl))*calm;
  float slope=dot(gr,lt)/max(amp*kp,1e-6)*calm;
  vec3 mid=vec3(.353,.481,.650),lit=vec3(.395,.522,.695),back=vec3(.340,.467,.636),shc=vec3(.290,.418,.584);
  vec3 col=slope<0.?mix(mid,lit,clamp(-slope*1.1,0.,1.)):mix(mid,back,clamp(slope*.9,0.,1.));
  col=mix(col,shc,shd);
  vec3 n=normalize(vec3(-gr*2.,1.));vec3 S=normalize(vec3(lt*.15,1.)),Hh=normalize(S+vec3(0.,0.,1.));
  col+=vec3(1.)*pow(max(dot(n,Hh),0.),mix(400.,700.,uW))*mix(.08,.2,uW)*(1.-shd)*calm;
  float e=eta/max(amp,1e-5);
  // skum på kammar som bryter: följer kammen och blir kvar som ett spår bakom vågen
  if(foamOn){float prob=smoothstep(6.,14.,uU)*smoothstep(.2,.45,H);
    #define BRK(p) smoothstep(1.-.55*prob,1.-.55*prob+.12,vn(vec2(dot(p,tr)-cp*uT,dot(p,cr))/lam*vec2(.9,.45)+3.7))
    #define CREST(q) smoothstep(.85,1.45,(q)/max(amp,1e-5))
    float b0=BRK(x)*CREST(eta);
    float tr3=max(max(.85*BRK(x+tr*f1)*CREST(e1*env),.6*BRK(x+tr*f2)*CREST(e2*env)),.35*BRK(x+tr*f3)*CREST(e3*env));
    vec2 fx=x0-tr*cp*.06*uT;
    float lc=.55*vn(fx/lam*7.)+.3*vn(fx/lam*15.+4.1)+.15*vn(fx/lam*31.+9.7);
    float foam=(b0*smoothstep(.28,.5,lc)+tr3*smoothstep(.62-.25*tr3,.74-.25*tr3,lc))*smoothstep(.7,1.2,env)*.95*(1.-near);
    col=mix(col,vec3(.93,.95,.98)*(.86+.14*(1.-shd)),clamp(foam,0.,.92));}
  // bränningar mot exponerade stränder och en sköljzon längs strandkanten
  float expo=length(gd)>.002?smoothstep(.45,.9,dot(tr,-normalize(gd))):0.;
  float hs=smoothstep(.25,.6,H);
  float zone=1.-smoothstep(0.,3.+5.*H,dist),swash=1.-smoothstep(0.,1.5+2.5*H,dist);   // några meter, som vid en klippstrand
  float shore=expo*hs*zone;
  if(shore>.01){vec2 fp=vec2(dot(x,tr)/lam*5.-uT*.5,dot(x,cr)/lam*5.);float l1=lace(fp),l2=lace(fp*2.1+3.3);
    float brk=shore*(.7*smoothstep(.3,1.,e)*smoothstep(.45,.65,l1)+.25*smoothstep(.6,.78,l2));
    float sw=expo*hs*swash*(.5+.5*sin(uT*1.7+dot(x,tr)/lam*6.283))*smoothstep(.45,.65,l1)*.5;
    col=mix(col,vec3(.90,.93,.97),clamp(brk+sw,0.,.6));}
  gl_FragColor=vec4(clamp(col,0.,1.),1.);}`;                         // täckande ända fram till kustlinjen
function glInit(canvas){try{
  const gl=canvas.getContext("webgl",{premultipliedAlpha:false,antialias:false,alpha:true});if(!gl)return false;
  const sh=(type,src)=>{const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s};
  const p=gl.createProgram();gl.attachShader(p,sh(gl.VERTEX_SHADER,VS));gl.attachShader(p,sh(gl.FRAGMENT_SHADER,FS));gl.linkProgram(p);
  if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p));
  gl.useProgram(p);const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
  const al=gl.getAttribLocation(p,"a");gl.enableVertexAttribArray(al);gl.vertexAttribPointer(al,2,gl.FLOAT,false,0,0);
  for(const k of ["uP","uQ","uHW","uPR","uGeo","uGrid","uN","uM","uT","uPx","uLam","uTr","uW","uU","uSc","uBend","uMix","uHW2","uTx","uC","uR","uCS"])WG.u[k]=gl.getUniformLocation(p,k);
  const C=new Float32Array(NCOMP*4),R=new Float32Array(NCOMP);
  WCOMP.forEach(([r,th,calm,rough,ph],i)=>{C.set([r,th,calm,ph],i*4);R[i]=rough});
  gl.uniform4fv(WG.u.uC,C);gl.uniform1fv(WG.u.uR,R);gl.uniform1i(WG.u.uP,0);gl.uniform1i(WG.u.uQ,1);gl.uniform1i(WG.u.uHW,2);gl.uniform1i(WG.u.uHW2,3);
  WG.gl=gl;WG.canvas=canvas;WG.prog=p;WG.name=null;return true}catch(e){console.warn("Rörliga vågor i relief stöds inte här:",e);return false}}
// SWAN:s vågriktning nära en punkt (enhetsvektor öster, norr), läst ur P-bilden som på grafikkortet
function fasDir(name,img,lon,lat){const X=S.fas,r=X.range[name];let pd=WG.pd[name];
  if(!pd){const c=document.createElement("canvas");c.width=img.width;c.height=img.height;const g=c.getContext("2d");g.drawImage(img,0,0);pd=WG.pd[name]={w:img.width,h:img.height,d:g.getImageData(0,0,img.width,img.height).data}}
  const gx=Math.max(1,Math.min(pd.w-3,Math.round((lon-X.lon0)/X.dlon))),gy=Math.max(1,Math.min(pd.h-3,Math.round((X.lat0-lat)/X.dlat)));
  const val=(x,y)=>{const i=(y*pd.w+x)*4;return r[0]+(r[1]-r[0])*(pd.d[i]*256+pd.d[i+1])/65535};
  const mx=X.dlon*111320*Math.cos(lat*Math.PI/180),my=X.dlat*111320,p=val(gx,gy);
  // medel över ett litet område, så att riktningen inte hoppar när man flyttar kartan lite
  let sx=0,sy=0,sl=0,n=0;for(let dy=-6;dy<=6;dy+=3)for(let dx=-6;dx<=6;dx+=3){const x=Math.max(1,Math.min(pd.w-3,gx+dx)),y=Math.max(1,Math.min(pd.h-3,gy+dy)),q=val(x,y);
    const ex=(val(x+1,y)-q)/mx,ny=(q-val(x,y+1))/my,l=Math.hypot(ex,ny);if(l>1e-6){sx+=ex/l;sy+=ny/l;sl+=1/l;n++}}
  const l=Math.hypot(sx,sy);return l>1e-6?[sx/l,sy/l,sl/n]:null}           // riktning öster, norr och fasfältets våglängd (m)
// mjuk övergång mellan tidssteg: värdena glider under FADE_MS
const FADE_MS=700;
function reliefUniforms(V){const gl=WG.gl,u=WG.u,l=Math.hypot(V.tx,V.ty)||1,spread=.3+.55*V.w,CS=new Float32Array(NCOMP*2);
  WCOMP.forEach((c,i)=>{CS[i*2]=Math.cos(c[1]*spread);CS[i*2+1]=Math.sin(c[1]*spread)});          // spridning åt sidorna efter vinden
  gl.uniform2fv(u.uCS,CS);gl.uniform2f(u.uTr,V.tx/l,V.ty/l);gl.uniform1f(u.uLam,V.lam);gl.uniform1f(u.uSc,V.sc);gl.uniform1f(u.uW,V.w);gl.uniform1f(u.uU,V.u)}
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
  // tiden räknas framåt bild för bild i verklig takt (vågorna har verklig längd och fart)
  const now=performance.now();if(WG.last)WG.tAcc+=Math.min(.1,(now-WG.last)/1000);WG.last=now;
  if(WG.fade){const F=WG.fade,s0=Math.min(1,(now-F.t0)/FADE_MS),s=s0*s0*(3-2*s0),A=F.from,B=F.to;
    const V={tx:A.tx+(B.tx-A.tx)*s,ty:A.ty+(B.ty-A.ty)*s,lam:A.lam*Math.pow(B.lam/A.lam,s),sc:A.sc*Math.pow(B.sc/A.sc,s),w:A.w+(B.w-A.w)*s,u:A.u+(B.u-A.u)*s};
    reliefUniforms(V);gl.uniform1f(WG.u.uMix,s);WG.cur=V;if(s0>=1)WG.fade=null}
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
  // samma utsnitt som förra gången (nytt tidssteg): blanda mjukt från den förra våghöjden
  const key=[mz,px0,py0,W0,H0,cw,ch].join("|"),same=WG.key===key&&WG.hw&&WG.cur;
  glTex(3,same?WG.hw:hw,true,W0,H0);glTex(2,hw,true,W0,H0);WG.hw=hw;WG.key=key;
  const nw=CRS.pointToLatLng(L.point(px0,py0),mz),se=CRS.pointToLatLng(L.point(px0+W0,py0+H0),mz),r=X.range[name],lat=(nw.lat+se.lat)/2;
  // vindstyrkan avgör våglängden (JONSWAP, ca 4 km vindsträcka) och vågornas karaktär; minst 14 pixlar lång
  const Uw=Math.max(1,U||8),Tp=.286*Math.cbrt(9.81*4000/(Uw*Uw))*Uw/9.81,kpr=Math.pow(2*Math.PI/Tp,2)/9.81;
  const pxm=mpp(mz,lat)/kg,lamT=Math.max(2*Math.PI/kpr,14*pxm),c0=map.getCenter();
  const to=(wd+180)*Math.PI/180,fd=fasDir(name,imgs[0],c0.lng,c0.lat)||[Math.sin(to),Math.cos(to),lamT];
  const bend=map.getZoom()>=15?1:0,V={tx:fd[0],ty:fd[1],lam:lamT,sc:fd[2]/lamT,w:Math.max(0,Math.min(1,(Uw-2)/11)),u:Uw};
  gl.uniform1f(WG.u.uBend,bend);
  if(same&&WG.bend===bend){WG.fade={t0:performance.now(),from:WG.cur,to:V};gl.uniform1f(WG.u.uMix,0);reliefUniforms(WG.cur)}
  else{WG.fade=null;reliefUniforms(V);gl.uniform1f(WG.u.uMix,1);WG.cur=V}
  WG.bend=bend;
  gl.uniform2f(WG.u.uTx,1/W0,1/H0);
  gl.uniform4f(WG.u.uPR,r[0],r[1],r[2],r[3]);gl.uniform4f(WG.u.uGeo,nw.lng,se.lng,nw.lat,se.lat);
  gl.uniform4f(WG.u.uGrid,X.lon0,X.lat0,X.dlon,X.dlat);gl.uniform2f(WG.u.uN,X.nx,X.ny);
  gl.uniform2f(WG.u.uM,X.dlon*111320*Math.cos(lat*Math.PI/180),X.dlat*111320);gl.uniform1f(WG.u.uPx,pxm);
  WG.st={name};if(!WG.raf)WG.raf=requestAnimationFrame(reliefFrame)}
