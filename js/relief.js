/* Skärgårdskartan, relief.js: Rörliga vågor i relief (WebGL).
   Filerna i js/ laddas i ordning från index.html och delar variabler med varandra. */
"use strict";
// ------------------------------------------------------------------ rörliga vågor i relief (WebGL)
// Vågytan räknas på grafikkortet som en summa av vågor i flera storlekar (oktaver), från riktiga
// krusningar till förstorade vågor för utzoomat läge. Vågorna sitter fast i kartan: när man zoomar
// ändras de aldrig, de minsta tonas bort och de större tonas in efter hur stora de blir på skärmen.
// Riktningen (SWAN, medel över ungefär en kilometer) och våglängden (verklig för vinden, JONSWAP)
// ändras bara i små steg; då tonar det gamla vågfältet ut och det nya in, så att inget förskjuts.
// Kontrast, skuggornas längd och glitter följer våghöjden från SWAN och läet på varje plats, så att
// högre sjö syns tydligt. Ljuset kommer från nordväst som på terrängen; varje kam kastar en kort skugga.
// Över 6 m/s bryter de högsta kammarna och lämnar skumspår; mot exponerade stränder blir det bränningar.
const OCT0=-2,OCT1=6,PER=6,NC=(OCT1-OCT0+1)*PER,REL_EX=20;
const WBASE=(()=>{let s=7;const rnd=()=>{s=(s*16807)%2147483647;return s/2147483647};
  const gs=()=>{let u=0;while(!u)u=rnd();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*rnd())};
  const out=[];for(let o=OCT0;o<=OCT1;o++)for(let j=0;j<PER;j++)out.push({s:Math.pow(2,o+(j+rnd())/PER),th:gs(),m:Math.sqrt(-2*Math.log(Math.max(1e-6,rnd()))),ph:rnd()*2*Math.PI});
  return out})();
// vågfältet för en riktning (tx, ty) och vindkaraktär w: (riktning/s, amplitud, fas) per våg
function waveSet(tx,ty,w){const spread=.3+.55*w,pc=2.6-.7*w,a=new Float32Array(NC*4);
  WBASE.forEach((c,i)=>{const an=Math.max(-2.2,Math.min(2.2,c.th*spread*(1+.35*Math.max(0,Math.log(1/c.s))))),ca=Math.cos(an),sa=Math.sin(an);
    a.set([(ca*tx-sa*ty)/c.s,(ca*ty+sa*tx)/c.s,(c.s<1?Math.pow(c.s,pc):1)*c.m,c.ph],i*4)});return a}
const WG={ok:null,gl:null,canvas:null,prog:null,u:{},tex:{},name:null,raf:0,t0:performance.now(),st:null,tAcc:0,last:0,pd:{}};
// tempo för de rörliga vågkammarna (vågmönster): snabbare inzoomat, långsammare utzoomat (zoom 13 = normalt)
let rateCap=1;
const animRate=()=>Math.min(rateCap,Math.pow(1.5,map.getZoom()-13));
function setRateCap(U,uS){U=Math.max(2,U||10);const Treal=0.286*Math.cbrt(9.81*4000/(U*U))*U/9.81,Tvis=2.6/Math.sqrt(1.6*uS);rateCap=Math.max(.3,Math.min(1.2,Tvis/Treal))}
const VS="attribute vec2 a;varying vec2 v;void main(){v=vec2(a.x*.5+.5,.5-a.y*.5);gl_Position=vec4(a,0.,1.);}";
const FS=`precision highp float;
varying vec2 v;
uniform sampler2D uHW,uHW2;
uniform vec4 uGeo,uGrid,uC[${NC}],uC2[${NC}];
uniform vec2 uM,uTx,uTr;
uniform float uT,uPx,uLb,uLb2,uX,uLv,uLf,uU,uMix;
float hash(vec2 p){p=mod(p,997.);return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
float lace(vec2 p){return .55*vn(p)+.3*vn(p*2.3+7.1)+.15*vn(p*5.1+3.7);}   // oregelbunden skumstruktur
void main(){
  vec4 hw=mix(texture2D(uHW2,v),texture2D(uHW,v),uMix);if(hw.g<.02){gl_FragColor=vec4(0.);return;}   // gammal och ny tid blandas
  float H=hw.r*255./200.,dist=hw.b*255.*.5;                           // våghöjd (m), avstånd till land (m)
  float dR=texture2D(uHW,v+vec2(uTx.x,0.)).b,dL=texture2D(uHW,v-vec2(uTx.x,0.)).b;
  float dU=texture2D(uHW,v-vec2(0.,uTx.y)).b,dD=texture2D(uHW,v+vec2(0.,uTx.y)).b;
  vec2 gd=vec2(dR-dL,dU-dD);                                           // åt vilket håll land ligger
  float lon=mix(uGeo.x,uGeo.y,v.x),lat=mix(uGeo.z,uGeo.w,v.y);
  vec2 x=vec2((lon-uGrid.x)/uGrid.z*uM.x,(lat-uGrid.y)/uGrid.w*uM.y);  // meter öster och norr, fast mot kartan
  vec2 tr=uTr,cr=vec2(-tr.y,tr.x),lt=vec2(-.7071,.7071);               // gångriktning, ljuset från nordväst
  float lam=uLv,cp=sqrt(9.81*lam/6.2832);
  float D0=3.+6.*H,near=1.-smoothstep(0.,D0,dist);                     // vågorna går ända fram till stranden
  float vis=clamp(pow(max(H,0.)/.45,.8),.06,1.4)*(1.-.5*near);         // högre sjö ger tydligare vågor
  bool foamOn=uU>6.&&H>.2;bool two=uX<.999;
  float d1=lam*.025,d2=lam*.06,d3=lam*.11,f1=lam*.07,f2=lam*.16,f3=lam*.28;
  // två vågfält (nytt och gammalt) under en övertoning, annars bara det nya
  float eA=0.,wA=0.,s1A=0.,s2A=0.,s3A=0.,e1A=0.,e2A=0.,e3A=0.,eB=0.,wB=0.,s1B=0.,s2B=0.,s3B=0.;vec2 gA=vec2(0.),gB=vec2(0.);
  for(int i=0;i<${NC};i++){
    vec4 c=uC[i];vec2 kv=6.2832/uLb*c.xy;float k=length(kv),lp=6.2832/k/uPx;
    float f=smoothstep(5.,12.,lp)*(1.-smoothstep(70.,150.,lp));       // bara vågor som är lagom stora på skärmen
    if(f>0.){float a=dot(kv,x)-sqrt(9.81*k)*uT+c.w,A=c.z*f;
      eA+=A*cos(a);gA-=A*sin(a)*kv;wA+=A*A;float kt=dot(kv,lt);
      s1A+=A*cos(a+kt*d1);s2A+=A*cos(a+kt*d2);s3A+=A*cos(a+kt*d3);
      if(foamOn){float kf=dot(kv,tr);e1A+=A*cos(a+kf*f1);e2A+=A*cos(a+kf*f2);e3A+=A*cos(a+kf*f3);}}
    if(two){vec4 b=uC2[i];vec2 kb=6.2832/uLb2*b.xy;float k2=length(kb),lq=6.2832/k2/uPx;
      float g=smoothstep(5.,12.,lq)*(1.-smoothstep(70.,150.,lq));
      if(g>0.){float a=dot(kb,x)-sqrt(9.81*k2)*uT+b.w,A=b.z*g;
        eB+=A*cos(a);gB-=A*sin(a)*kb;wB+=A*A;float kt=dot(kb,lt);
        s1B+=A*cos(a+kt*d1);s2B+=A*cos(a+kt*d2);s3B+=A*cos(a+kt*d3);}}}
  // normera till enhetlig storlek, så att kontrasten bara beror på våghöjden
  float nA=1./sqrt(wA*.5+1e-9),nB=1./sqrt(wB*.5+1e-9),q=lam/6.2832;
  float e=eA*nA,s1=s1A*nA,s2=s2A*nA,s3=s3A*nA;vec2 gr=gA*nA*q;
  if(two){e=mix(eB*nB,e,uX);s1=mix(s1B*nB,s1,uX);s2=mix(s2B*nB,s2,uX);s3=mix(s3B*nB,s3,uX);gr=mix(gB*nB*q,gr,uX);}
  vec2 gq=vec2(dot(x,tr)/(uLf*3.)-uT*cp/(uLf*6.),dot(x,cr)/(uLf*6.));
  float env=.45+1.1*(.6*vn(gq)+.4*vn(gq*2.1+5.3));                    // våggrupper
  e*=env;gr*=env;s1*=env;s2*=env;s3*=env;
  float calm=smoothstep(.02,.15,H);                                    // i lä nästan blankt
  float tl=4./(.45+vis)/lam,soft=.18;                                  // högre sjö ger längre skuggor
  float shd=max(max(smoothstep(0.,soft,s1-e-d1*tl),.75*smoothstep(0.,soft,s2-e-d2*tl)),.4*smoothstep(0.,soft,s3-e-d3*tl))*calm*smoothstep(.04,.35,vis);
  float slope=dot(gr,lt)*vis*calm;
  vec3 mid=vec3(.353,.481,.650),lit=vec3(.405,.532,.703),back=vec3(.335,.462,.630),shc=vec3(.282,.410,.576);
  vec3 col=slope<0.?mix(mid,lit,clamp(-slope*.9,0.,1.)):mix(mid,back,clamp(slope*.8,0.,1.));
  col=mix(col,shc,shd);
  vec3 n=normalize(vec3(-gr*.22*vis,1.));vec3 S=normalize(vec3(lt*.15,1.)),Hh=normalize(S+vec3(0.,0.,1.));
  col+=vec3(1.)*pow(max(dot(n,Hh),0.),600.)*.18*vis*(1.-shd)*calm;
  // skum på kammar som bryter: följer kammen och blir kvar som ett spår bakom vågen
  if(foamOn){float prob=smoothstep(6.,14.,uU)*smoothstep(.2,.5,H);
    #define BRK(p) smoothstep(1.-.55*prob,1.-.55*prob+.12,vn(vec2(dot(p,tr)-cp*uT,dot(p,cr))/uLf*vec2(.9,.45)+3.7))
    #define CREST(q) smoothstep(1.2,2.,(q))
    float b0=BRK(x)*CREST(e);
    float tr3=max(max(.85*BRK(x+tr*f1)*CREST(e1A*nA*env),.6*BRK(x+tr*f2)*CREST(e2A*nA*env)),.35*BRK(x+tr*f3)*CREST(e3A*nA*env));
    vec2 fx=x-tr*cp*.06*uT;
    float lc=.55*vn(fx/uLf*7.)+.3*vn(fx/uLf*15.+4.1)+.15*vn(fx/uLf*31.+9.7);
    float foam=(b0*smoothstep(.28,.5,lc)+tr3*smoothstep(.62-.25*tr3,.74-.25*tr3,lc))*smoothstep(.7,1.2,env)*.95*(1.-near)*uX;
    col=mix(col,vec3(.93,.95,.98)*(.86+.14*(1.-shd)),clamp(foam,0.,.92));}
  // bränningar mot exponerade stränder och en sköljzon längs strandkanten
  float expo=length(gd)>.002?smoothstep(.45,.9,dot(tr,-normalize(gd))):0.;
  float hs=smoothstep(.25,.6,H);
  float zone=1.-smoothstep(0.,3.+5.*H,dist),swash=1.-smoothstep(0.,1.5+2.5*H,dist);   // några meter, som vid en klippstrand
  float shore=expo*hs*zone;
  if(shore>.01){vec2 fp=vec2(dot(x,tr)/uLf*5.-uT*.5,dot(x,cr)/uLf*5.);float l1=lace(fp),l2=lace(fp*2.1+3.3);
    float brk=shore*(.7*smoothstep(.5,1.6,e)*smoothstep(.45,.65,l1)+.25*smoothstep(.6,.78,l2));
    float sw=expo*hs*swash*(.5+.5*sin(uT*1.7+dot(x,tr)/uLf*6.283))*smoothstep(.45,.65,l1)*.5;
    col=mix(col,vec3(.90,.93,.97),clamp(brk+sw,0.,.6));}
  gl_FragColor=vec4(clamp(col,0.,1.),1.);}`;                         // täckande ända fram till kustlinjen
function glInit(canvas){try{
  const gl=canvas.getContext("webgl",{premultipliedAlpha:false,antialias:false,alpha:true});if(!gl)return false;
  const sh=(type,src)=>{const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s};
  const p=gl.createProgram();gl.attachShader(p,sh(gl.VERTEX_SHADER,VS));gl.attachShader(p,sh(gl.FRAGMENT_SHADER,FS));gl.linkProgram(p);
  if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p));
  gl.useProgram(p);const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
  const al=gl.getAttribLocation(p,"a");gl.enableVertexAttribArray(al);gl.vertexAttribPointer(al,2,gl.FLOAT,false,0,0);
  for(const k of ["uHW","uHW2","uGeo","uGrid","uM","uTx","uTr","uT","uPx","uLb","uLb2","uX","uLv","uLf","uU","uMix","uC","uC2"])WG.u[k]=gl.getUniformLocation(p,k);
  gl.uniform1i(WG.u.uHW,2);gl.uniform1i(WG.u.uHW2,3);
  WG.gl=gl;WG.canvas=canvas;WG.prog=p;WG.name=null;WG.A=null;return true}catch(e){console.warn("Rörliga vågor i relief stöds inte här:",e);return false}}
// SWAN:s vågriktning nära en punkt (enhetsvektor öster, norr), läst ur P-bilden
function fasDir(name,img,lon,lat){const X=S.fas,r=X.range[name];let pd=WG.pd[name];
  if(!pd){const c=document.createElement("canvas");c.width=img.width;c.height=img.height;const g=c.getContext("2d");g.drawImage(img,0,0);pd=WG.pd[name]={w:img.width,h:img.height,d:g.getImageData(0,0,img.width,img.height).data}}
  const gx=Math.max(1,Math.min(pd.w-3,Math.round((lon-X.lon0)/X.dlon))),gy=Math.max(1,Math.min(pd.h-3,Math.round((X.lat0-lat)/X.dlat)));
  const val=(x,y)=>{const i=(y*pd.w+x)*4;return r[0]+(r[1]-r[0])*(pd.d[i]*256+pd.d[i+1])/65535};
  const mx=X.dlon*111320*Math.cos(lat*Math.PI/180),my=X.dlat*111320;
  // medel över ungefär en kilometer, så att riktningen ändras lugnt när man flyttar kartan
  let sx=0,sy=0;for(let dy=-24;dy<=24;dy+=6)for(let dx=-24;dx<=24;dx+=6){const x=Math.max(1,Math.min(pd.w-3,gx+dx)),y=Math.max(1,Math.min(pd.h-3,gy+dy)),q=val(x,y);
    const ex=(val(x+1,y)-q)/mx,ny=(q-val(x,y+1))/my,l=Math.hypot(ex,ny);if(l>1e-6){sx+=ex/l;sy+=ny/l}}
  const l=Math.hypot(sx,sy);return l>1e-6?[sx/l,sy/l]:null}
// Övertoning: riktning och våglängd byts bara i små steg och tonas då över från det gamla vågfältet;
// vindkaraktären, skärmskalan och våghöjden glider. Vid uppspelning är övergången jämn och längre än
// steget, så att rörelsen aldrig stannar.
const FADE_MS=700,PLAY_FADE_MS=1150;
function reliefFrameUniforms(s){const gl=WG.gl,u=WG.u,F=WG.fade;
  const w=F.w0+(F.w1-F.w0)*s,px=F.px0*Math.pow(F.px1/F.px0,s),lv=F.lv0*Math.pow(F.lv1/F.lv0,s);
  gl.uniform4fv(u.uC,waveSet(WG.A.tx,WG.A.ty,w));if(F.x)gl.uniform4fv(u.uC2,waveSet(WG.B.tx,WG.B.ty,w));
  gl.uniform1f(u.uX,F.x?s:1);gl.uniform1f(u.uPx,px);gl.uniform1f(u.uLv,lv);if(F.mixH){gl.uniform1f(u.uMix,s);WG.mix=s}
  WG.w=w;WG.px=px;WG.lv=lv}
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
  if(WG.fade){const F=WG.fade,s0=Math.min(1,(now-F.t0)/F.ms),s=F.lin?s0:s0*s0*(3-2*s0);reliefFrameUniforms(s);if(s0>=1)WG.fade=null}
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
  WG.name=name;
  // våghöjd (röd, 200 per meter), vatten (grön) och avstånd till land (blå, halvmeter, högst 127 m)
  const LD=landDist(R,cx0,cy0,W0,H0),mpz=mpp(mz,(CRS.pointToLatLng(L.point(px0,py0),mz).lat));
  const hw=new Uint8Array(W0*H0*4);for(let y=0;y<H0;y++)for(let x=0;x<W0;x++){const i=y*W0+x,j=(cy0+y)*R.W+cx0+x;
    hw[i*4]=Math.min(255,Math.round(Math.max(0,Hc[j])*200));hw[i*4+1]=R.water[j]?255:0;hw[i*4+2]=Math.min(255,Math.round(Math.max(0,LD[i]-.5)*mpz*2));hw[i*4+3]=255}
  // mitt i en övergång börjar nästa från det som syns just då (blandningen räknas fram här)
  const key=[mz,px0,py0,W0,H0,cw,ch].join("|"),same=WG.key===key&&WG.hw&&WG.A;let prev=hw;   // nytt utsnitt: ingen blandning av våghöjden
  if(same){const s=WG.fade&&WG.fade.mixH?WG.mix||0:1;prev=WG.hw;
    if(s<1&&WG.hwOld&&WG.hwOld.length===WG.hw.length){prev=new Uint8Array(WG.hw.length);for(let i=0;i<prev.length;i++)prev[i]=WG.hwOld[i]+(WG.hw[i]-WG.hwOld[i])*s}}
  glTex(3,prev,true,W0,H0);glTex(2,hw,true,W0,H0);WG.hwOld=prev;WG.hw=hw;WG.key=key;
  const nw=CRS.pointToLatLng(L.point(px0,py0),mz),se=CRS.pointToLatLng(L.point(px0+W0,py0+H0),mz),lat=(nw.lat+se.lat)/2;
  // våglängd för vinden (JONSWAP, ca 4 km vindsträcka), avrundad till kvarts oktaver; riktning i steg om några grader
  const Uw=Math.max(1,U||8),Tp=.286*Math.cbrt(9.81*4000/(Uw*Uw))*Uw/9.81,lr=9.81*Tp*Tp/(2*Math.PI),lb=Math.pow(2,Math.round(4*Math.log2(lr))/4);
  const c0=map.getCenter(),to=(wd+180)*Math.PI/180,fd=fasDir(name,imgs[0],c0.lng,c0.lat)||[Math.sin(to),Math.cos(to)];
  const th=Math.atan2(fd[1],fd[0]),w=Math.max(0,Math.min(1,(Uw-2)/11)),pxm=mpp(mz,lat)/kg,lv=Math.max(lb,25*pxm);
  const lf=lb*Math.pow(2,Math.max(0,Math.ceil(Math.log2(10*pxm/lb))));                   // skala för skum och våggrupper
  const turned=!WG.A||Math.abs(((th-WG.A.th)*180/Math.PI+540)%360-180)>4,longer=!WG.A||WG.A.lb!==lb;
  const playing=typeof playT!=="undefined"&&!!playT,ms=playing?PLAY_FADE_MS:FADE_MS;
  const nA=turned||longer?{th,tx:Math.cos(th),ty:Math.sin(th),lb}:WG.A;
  if(!WG.A){WG.A=WG.B=nA;WG.w=w;WG.px=pxm;WG.lv=lv;WG.fade={t0:0,ms:1,w0:w,w1:w,px0:pxm,px1:pxm,lv0:lv,lv1:lv,x:false,mixH:false};reliefFrameUniforms(1);WG.fade=null}
  else{const x=nA!==WG.A;if(x){WG.B=WG.A;WG.A=nA}
    WG.fade={t0:performance.now(),ms,lin:playing,w0:WG.w,w1:w,px0:WG.px,px1:pxm,lv0:WG.lv,lv1:lv,x,mixH:!!same};reliefFrameUniforms(0)}
  gl.uniform1f(WG.u.uLb,WG.A.lb);gl.uniform1f(WG.u.uLb2,WG.B.lb);gl.uniform2f(WG.u.uTr,WG.A.tx,WG.A.ty);gl.uniform1f(WG.u.uLf,lf);gl.uniform1f(WG.u.uU,Uw);
  gl.uniform1f(WG.u.uMix,same?0:1);WG.mix=same?0:1;
  gl.uniform2f(WG.u.uTx,1/W0,1/H0);gl.uniform4f(WG.u.uGeo,nw.lng,se.lng,nw.lat,se.lat);
  gl.uniform4f(WG.u.uGrid,X.lon0,X.lat0,X.dlon,X.dlat);gl.uniform2f(WG.u.uM,X.dlon*111320*Math.cos(lat*Math.PI/180),X.dlat*111320);
  WG.st={name};if(!WG.raf)WG.raf=requestAnimationFrame(reliefFrame)}
