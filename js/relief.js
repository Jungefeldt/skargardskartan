/* Skärgårdskartan, relief.js: Rörliga vågor i relief (WebGL).
   Filerna i js/ laddas i ordning från index.html och delar variabler med varandra. */
"use strict";
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
const FS=`#ifdef GL_OES_standard_derivatives
#extension GL_OES_standard_derivatives : enable
#define HAS_DERIV
#endif
precision highp float;
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
  vec2 gr=vec2(0.),grL=vec2(0.);float eta=0.,ss=sqrt(uS);
  for(int i=0;i<${NCOMP};i++){vec4 c=uC[i];vec4 d=uD[i];
    float fade=smoothstep(3.,8.,lam*d.y/(uS*uPx));if(fade<=0.)continue;     // för korta vågor för pixlarna tonas bort
    float a=uS*(c.x*P+c.y*Q)-d.x*ss*uT+c.w;float A=c.z*fade;
    vec2 gi=A*uS*sin(a)*(c.x*gP+c.y*gQ);gr-=gi;eta+=A*cos(a);
    grL-=gi*smoothstep(10.,22.,lam*d.y/(uS*uPx));}                      // bara de större vågorna, för konturlinjen
  // nära land dör vågorna ut
  float D0=25.+60.*H,near=1.-smoothstep(0.,D0,dist);
  // brantare toppar och flackare dalar, som hos riktiga vindvågor: ger skarpare kanter
  float gk=H*uEx*(1.-.75*near)*(1.+1.3*clamp(eta,0.,1.2));gr*=gk;grL*=gk;
  vec3 n=normalize(vec3(-gr,1.));
  vec2 tr=gP/max(length(gP),1e-6);float e=.61;                      // ljuset 35 grader upp, från dit vågorna går
  float lit=max(dot(n,vec3(tr*cos(e),sin(e))),0.)/sin(e);
  float soft=mix(.3,.15,clamp(H/.5,0.,1.));
  float rel=(1.-soft)*lit+soft*pow(n.z,4.);
  // konturlinje precis där ljus går över i skugga, så att den alltid omsluter skuggfälten;
  // fwidth ger hur mycket skuggningen ändras per pixel, så linjen blir ungefär en pixel bred
  float ink=0.;
#ifdef HAS_DERIV
  vec3 nL=normalize(vec3(-grL,1.));
  float relL=(1.-soft)*max(dot(nL,vec3(tr*cos(e),sin(e))),0.)/sin(e)+soft*pow(nL.z,4.);
  ink=(1.-smoothstep(.6,1.5,abs(relL-.72)/max(fwidth(relL),1e-4)))*smoothstep(.04,.3,H)*(1.-near);
#endif
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
  gl.getExtension("OES_standard_derivatives");      // behövs för konturlinjerna (finns i nästan alla webbläsare)
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
