// Довідник БпАК і вертольота EasyWAR: Bayraktar TB2, tailsitter-дрони й SH-60B у польоті над ландшафтом.
// Код перенесено з опублікованого інтерактивного довідника; змінено лише завантаження: моделі читаються з локальних файлів `models/*.glb`,
// three береться з npm (без CDN), шрифти — локальні (../fonts).
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {RoomEnvironment} from '../room-env.js';
import {fetchBuffer, makeClock} from '../guide-kit.js';
import {creditHtml} from '../credits.js';
import {MODEL_URLS, LAND_URL} from './models.js';
import {SPEC} from './spec.js';

const $=s=>document.querySelector(s);
const T=THREE,PI=Math.PI,D2R=PI/180,G=9.81;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const ease=(c,t,k,dt)=>c+(t-c)*(1-Math.exp(-k*dt));
const smooth=x=>{x=clamp(x,0,1);return x*x*(3-2*x);};
const lerp=(a,b,t)=>a+(b-a)*t;
const wrap=a=>{while(a>PI)a-=2*PI;while(a<-PI)a+=2*PI;return a;};
const stage=$('#stage'),cv=$('#cv');
const SKY=0xa7b6c1;

/* ---------- renderer / scene ---------- */
const R=new T.WebGLRenderer({canvas:cv,antialias:true});
R.setPixelRatio(Math.min(devicePixelRatio,2));R.toneMapping=T.ACESFilmicToneMapping;R.toneMappingExposure=1.0;R.outputColorSpace=T.SRGBColorSpace;
const scene=new T.Scene();scene.background=new T.Color(SKY);scene.fog=new T.Fog(SKY,380,1250);
scene.environment=new T.PMREMGenerator(R).fromScene(new RoomEnvironment(),0.04).texture;
const sun=new T.DirectionalLight(0xfff1dc,2.0);sun.position.set(60,110,40);scene.add(sun);
scene.add(new T.HemisphereLight(0xdde6ee,0x4a4d43,.7));
const cam=new T.PerspectiveCamera(36,1,.15,3200);
const oc=new OrbitControls(cam,cv);oc.enableDamping=true;oc.dampingFactor=.08;oc.minDistance=2.5;oc.maxDistance=420;oc.enablePan=false;oc.maxPolarAngle=PI*.495;
cv.addEventListener('pointerdown',()=>cv.classList.add('drag'));addEventListener('pointerup',()=>cv.classList.remove('drag'));
const world=new T.Group();scene.add(world);

/* ---------- helpers ---------- */
function canvasTex(w,h,fn){const c=document.createElement('canvas');c.width=w;c.height=h;fn(c.getContext('2d'),w,h);const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;t.anisotropy=4;return t;}
const glowTex=canvasTex(128,128,(x,w)=>{const g=x.createRadialGradient(w/2,w/2,0,w/2,w/2,w/2);g.addColorStop(0,'rgba(255,255,255,1)');g.addColorStop(.25,'rgba(255,255,255,.7)');g.addColorStop(1,'rgba(255,255,255,0)');x.fillStyle=g;x.fillRect(0,0,w,w);});
const puffTex=canvasTex(128,128,(x,w)=>{for(let i=0;i<9;i++){const cx=w*(.3+Math.random()*.4),cy=w*(.3+Math.random()*.4),r=w*(.14+Math.random()*.16);const g=x.createRadialGradient(cx,cy,0,cx,cy,r);g.addColorStop(0,'rgba(255,255,255,.55)');g.addColorStop(1,'rgba(255,255,255,0)');x.fillStyle=g;x.fillRect(0,0,w,w);}});
const shadowTex=canvasTex(128,128,(x,w)=>{const g=x.createRadialGradient(w/2,w/2,0,w/2,w/2,w/2);g.addColorStop(0,'rgba(0,0,0,.62)');g.addColorStop(.55,'rgba(0,0,0,.34)');g.addColorStop(1,'rgba(0,0,0,0)');x.fillStyle=g;x.fillRect(0,0,w,w);});
function sprite(tex,color,size,blend){const s=new T.Sprite(new T.SpriteMaterial({map:tex,color,transparent:true,depthWrite:false,blending:blend||T.NormalBlending}));s.scale.set(size,size,1);return s;}
const loader=new GLTFLoader();loader.setMeshoptDecoder(MeshoptDecoder);
const parseGLB=buf=>new Promise((res,rej)=>loader.parse(buf,'',res,rej));
const V3=(a,b,c)=>Array.isArray(a)?new T.Vector3(a[0],a[1],a[2]):new T.Vector3(a,b,c);

/* ---------- landscape: 3x3 mirrored photogrammetry tiles, flat apron/runway in the middle ---------- */
const LAND={ready:false,g:new T.Group(),S:1.2,YS:.5,GW:140,GH:104,H:null,y0:0,L:0,W:0,bb:null};world.add(LAND.g);
const PAD={cx:-100,ax:200,az:24,bl:80};
function padW(x,z){const dx=Math.max(0,Math.abs(x-PAD.cx)-PAD.ax),dz=Math.max(0,Math.abs(z)-PAD.az);return 1-smooth(Math.hypot(dx,dz)/PAD.bl);}
async function loadLand(){try{
  const g=await parseGLB(await fetchBuffer(LAND_URL));
  g.scene.updateMatrixWorld(true);let mesh=null;g.scene.traverse(o=>{if(o.isMesh)mesh=o;});if(!mesh)return;
  const geo=mesh.geometry.clone();
  for(const name of ['position','uv']){const at=geo.attributes[name];if(!at)continue;const n=at.itemSize,f=new Float32Array(at.count*n);for(let i=0;i<at.count;i++){f[i*n]=at.getX(i);if(n>1)f[i*n+1]=at.getY(i);if(n>2)f[i*n+2]=at.getZ(i);}geo.setAttribute(name,new T.BufferAttribute(f,n));}
  if(geo.attributes.normal)geo.deleteAttribute('normal');
  geo.applyMatrix4(mesh.matrixWorld);geo.scale(LAND.S,LAND.S*LAND.YS,LAND.S);
  const pa=geo.attributes.position;
  // height under the origin -> the apron level
  let sh=0,sn=0;for(let i=0;i<pa.count;i++){const x=pa.getX(i),z=pa.getZ(i);if(Math.hypot(x-PAD.cx,z)<18){sh+=pa.getY(i);sn++;}}
  const h0=sn?sh/sn:0;
  for(let i=0;i<pa.count;i++){const w=padW(pa.getX(i),pa.getZ(i));if(w>0)pa.setY(i,lerp(pa.getY(i),h0,w));}
  geo.computeBoundingBox();const bb=geo.boundingBox,sz=bb.getSize(new T.Vector3());LAND.L=sz.x;LAND.W=sz.z;LAND.bb=bb;
  const GW=LAND.GW,GH=LAND.GH,sum=new Float32Array(GW*GH),cnt=new Uint16Array(GW*GH);
  for(let i=0;i<pa.count;i++){const gx=clamp(((pa.getX(i)-bb.min.x)/sz.x*GW)|0,0,GW-1),gz=clamp(((pa.getZ(i)-bb.min.z)/sz.z*GH)|0,0,GH-1);sum[gz*GW+gx]+=pa.getY(i);cnt[gz*GW+gx]++;}
  const H=new Float32Array(GW*GH);for(let i=0;i<H.length;i++)H[i]=cnt[i]?sum[i]/cnt[i]:NaN;
  for(let it=0;it<14;it++)for(let j=0;j<GH;j++)for(let i=0;i<GW;i++){const k=j*GW+i;if(!isNaN(H[k]))continue;let a=0,n=0;[[1,0],[-1,0],[0,1],[0,-1]].forEach(([di,dj])=>{const x=i+di,y=j+dj;if(x<0||y<0||x>=GW||y>=GH)return;const h=H[y*GW+x];if(!isNaN(h)){a+=h;n++;}});if(n)H[k]=a/n;}
  for(let i=0;i<H.length;i++)if(isNaN(H[i]))H[i]=h0;
  LAND.H=H;LAND.y0=-h0;
  const mat=mesh.material;mat.side=T.FrontSide;mat.fog=true;if(mat.map){mat.map.colorSpace=T.SRGBColorSpace;mat.map.anisotropy=Math.min(8,R.capabilities.getMaxAnisotropy());}
  for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++){const t=new T.Mesh(geo,mat);t.scale.set(i&1?-1:1,1,j&1?-1:1);
    t.position.set(i*LAND.L+(i&1?bb.min.x+bb.max.x:0),LAND.y0,j*LAND.W+(j&1?bb.min.z+bb.max.z:0));t.frustumCulled=false;LAND.g.add(t);}
  // runway and apron markings
  const rw=canvasTex(1024,128,(x,w,h)=>{x.fillStyle='#4b4e52';x.fillRect(0,0,w,h);x.fillStyle='#d7d9d6';for(let i=0;i<14;i++){x.fillRect(8,12+i*7,36,4);x.fillRect(w-44,12+i*7,36,4);}x.fillRect(0,4,w,3);x.fillRect(0,h-7,w,3);for(let i=0;i<14;i++)x.fillRect(90+i*68,h/2-3,38,6);x.globalAlpha=.07;for(let i=0;i<500;i++){x.fillStyle=Math.random()<.5?'#000':'#fff';x.fillRect(Math.random()*w,Math.random()*h,2+Math.random()*10,1);}});
  const strip=new T.Mesh(new T.PlaneGeometry(380,30),new T.MeshBasicMaterial({map:rw,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}));strip.rotation.x=-PI/2;strip.position.set(-100,.06,0);world.add(strip);
  const hp=canvasTex(256,256,(x,w)=>{x.fillStyle='#74777a';x.beginPath();x.arc(w/2,w/2,w/2-2,0,2*PI);x.fill();x.strokeStyle='#e9d36b';x.lineWidth=7;x.beginPath();x.arc(w/2,w/2,w/2-14,0,2*PI);x.stroke();x.fillStyle='#e9d36b';x.fillRect(w*.33,w*.28,w*.07,w*.44);x.fillRect(w*.6,w*.28,w*.07,w*.44);x.fillRect(w*.33,w*.47,w*.34,w*.07);});
  const pad=new T.Mesh(new T.CircleGeometry(15,48),new T.MeshBasicMaterial({map:hp,transparent:true,polygonOffset:true,polygonOffsetFactor:-4,polygonOffsetUnits:-4}));pad.rotation.x=-PI/2;pad.position.set(0,.09,0);world.add(pad);
  LAND.ready=true;}catch(e){console.warn('land',e);window.__landErr=String(e);}}
function hAt(x,z){if(!LAND.H)return 0;const bb=LAND.bb,L=LAND.L,W=LAND.W;
  const nx=Math.floor((x-bb.min.x)/L),nz=Math.floor((z-bb.min.z)/W);let lx=x-nx*L,lz=z-nz*W;
  if(nx&1)lx=bb.min.x+bb.max.x-lx;if(nz&1)lz=bb.min.z+bb.max.z-lz;
  const GW=LAND.GW,GH=LAND.GH,fx=clamp((lx-bb.min.x)/L*(GW-1),0,GW-1.001),fz=clamp((lz-bb.min.z)/W*(GH-1),0,GH-1.001);
  const i=fx|0,j=fz|0,a=fx-i,b=fz-j,H=LAND.H;
  return H[j*GW+i]*(1-a)*(1-b)+H[j*GW+i+1]*a*(1-b)+H[(j+1)*GW+i]*(1-a)*b+H[(j+1)*GW+i+1]*a*b+LAND.y0;}

/* ---------- effects ---------- */
const FX={puffs:[]};const efx=new T.Group();world.add(efx);
function puff(p,col,size,vx,vy,vz,life,a,grow){if(FX.puffs.length>140)return;const s=sprite(puffTex,col,size);s.position.copy(p);s.material.opacity=a||.5;efx.add(s);FX.puffs.push({s,t:0,life,vx,vy,vz,a:a||.5,grow:grow||1.5});}
function stepFX(dt){for(const o of FX.puffs){o.t+=dt;const f=o.t/o.life;o.s.position.x+=o.vx*dt;o.s.position.y+=o.vy*dt;o.s.position.z+=o.vz*dt;o.s.scale.setScalar(o.s.scale.x+dt*o.grow);o.s.material.opacity=o.a*(1-f)*(1-f);if(o.t>o.life){efx.remove(o.s);o.s.material.dispose();o.dead=true;}}FX.puffs=FX.puffs.filter(o=>!o.dead);}
function clearFX(){FX.puffs.forEach(o=>efx.remove(o.s));FX.puffs=[];}
const shadow=new T.Mesh(new T.PlaneGeometry(1,1),new T.MeshBasicMaterial({map:shadowTex,transparent:true,depthWrite:false,fog:false,polygonOffset:true,polygonOffsetFactor:-6,polygonOffsetUnits:-6}));shadow.rotation.x=-PI/2;shadow.renderOrder=2;world.add(shadow);
const targetMark=new T.Group();{const r=new T.Mesh(new T.TorusGeometry(5,.35,8,36),new T.MeshBasicMaterial({color:0xe0553a,fog:false}));targetMark.add(r);const r2=r.clone();r2.scale.setScalar(.45);targetMark.add(r2);targetMark.visible=false;world.add(targetMark);}

/* ---------- model loading / surgery ---------- */
function bakeMesh(o,F){
  o.updateWorldMatrix(true,false);const m=new T.Matrix4().multiplyMatrices(F,o.matrixWorld);
  const g=o.geometry,pa=g.attributes.position,na=g.attributes.normal,ua=g.attributes.uv,n=pa.count;
  const pos=new Float32Array(n*3),nor=new Float32Array(n*3),uv=new Float32Array(n*2),v=new T.Vector3(),nm=new T.Matrix3().getNormalMatrix(m);
  for(let i=0;i<n;i++){v.fromBufferAttribute(pa,i).applyMatrix4(m);pos[i*3]=v.x;pos[i*3+1]=v.y;pos[i*3+2]=v.z;
    if(na){v.fromBufferAttribute(na,i).applyMatrix3(nm).normalize();nor[i*3]=v.x;nor[i*3+1]=v.y;nor[i*3+2]=v.z;}
    if(ua){uv[i*2]=ua.getX(i);uv[i*2+1]=ua.getY(i);}}
  let ix;if(g.index){ix=new Uint32Array(g.index.array);}else{ix=new Uint32Array(n);for(let i=0;i<n;i++)ix[i]=i;}
  const geo=new T.BufferGeometry();geo.setAttribute('position',new T.BufferAttribute(pos,3));if(na)geo.setAttribute('normal',new T.BufferAttribute(nor,3));if(ua)geo.setAttribute('uv',new T.BufferAttribute(uv,2));
  return {pos,ix,geo,mat:Array.isArray(o.material)?o.material[0]:o.material,claimed:new Uint8Array(ix.length/3)};
}
function subMesh(src,tris,mat){
  const out=new Uint32Array(tris.length*3);for(let i=0;i<tris.length;i++){const t=tris[i];out[i*3]=src.ix[t*3];out[i*3+1]=src.ix[t*3+1];out[i*3+2]=src.ix[t*3+2];}
  const g=new T.BufferGeometry();for(const k in src.geo.attributes)g.setAttribute(k,src.geo.attributes[k]);g.setIndex(new T.BufferAttribute(out,1));
  const me=new T.Mesh(g,mat||src.mat);return me;
}
const cacheM={};
async function buildModel(key){
  if(cacheM[key])return cacheM[key];
  const c=CFG[key],sp=SPEC[key];
  const gl=await parseGLB(await fetchBuffer(MODEL_URLS[key]));
  gl.scene.updateMatrixWorld(true);
  const q=new T.Quaternion().setFromEuler(new T.Euler(0,(c.rotY||0)*D2R,(c.rotZ||0)*D2R,'YXZ'));
  const F=new T.Matrix4().compose(V3(c.off),q,new T.Vector3(c.s,c.s,c.s));
  const srcs=[];gl.scene.traverse(o=>{if(o.isMesh&&o.geometry)srcs.push(bakeMesh(o,F));});
  const mats=new Set();srcs.forEach(s=>mats.add(s.mat));
  // GLB з alphaMode BLEND ставить depthWrite=false; матеріали тут примусово непрозорі, тож глибину вони мають писати,
  // інакше результат залежить від порядку малювання (за id матеріалу) і ландшафт, створений пізніше, перемальовує деталі.
  mats.forEach(m=>{if(m.color)m.color.multiplyScalar(c.bright||1);m.metalness=Math.min(m.metalness,.25);m.envMap=scene.environment;m.envMapIntensity=c.env||1;m.transparent=false;m.depthWrite=true;m.opacity=1;m.side=T.DoubleSide;m.needsUpdate=true;if(m.map)m.map.anisotropy=4;});
  const m={key,c,sp,srcs,F};return cacheM[key]=m;
}
const P=(m,p)=>V3(p).applyMatrix4(m.F);
const Dv=(m,a)=>V3(a).transformDirection(m.F);
function rleTris(rl){const out=[];for(const [s,n] of rl)for(let t=s;t<s+n;t++)out.push(t);return out;}
function partMeshes(m,names,matFn){const out=[];[].concat(names).forEach(nm=>{for(const mi in m.sp){const rl=m.sp[mi][nm];if(!rl)continue;const s=m.srcs[+mi],tris=rleTris(rl);tris.forEach(t=>s.claimed[t]=1);out.push(subMesh(s,tris,matFn?matFn(s.mat):null));}});return out;}
function restMeshes(m){const out=[];m.srcs.forEach(s=>{const tris=[];for(let t=0;t<s.claimed.length;t++)if(!s.claimed[t])tris.push(t);if(tris.length)out.push(subMesh(s,tris));});return out;}
function mkFrame(parent,p){const g=new T.Group();g.position.copy(p);const inner=new T.Group();inner.position.copy(p).multiplyScalar(-1);g.add(inner);parent.add(g);return {g,inner,p:p.clone()};}
const ZERO=new T.Vector3();
const discMat=(col,op)=>new T.MeshBasicMaterial({color:col,transparent:true,opacity:op,depthWrite:false,side:T.DoubleSide,fog:true});

/* rig helpers: spinning part (propeller / rotor / wheel) with optional blur disc */
function addSpin(rig,m,parent,names,pivot,axis,o){
  o=o||{};const pv=P(m,pivot),ax=Dv(m,axis);
  const fr=mkFrame(parent,pv);
  const bm=o.fade?(mat=>{const c=mat.clone();c.transparent=true;c.depthWrite=true;return c;}):null;
  const ms=partMeshes(m,names,bm);ms.forEach(me=>fr.inner.add(me));
  const sp={fr,ax,ang:0,w:0,dir:o.dir||1,R:o.R||1,mats:o.fade?ms.map(me=>me.material):[],disc:null,wheel:!!o.wheel,rad:o.rad||1};
  if(o.disc){const d=new T.Mesh(new T.CircleGeometry(o.R,40),discMat(o.disc,0));d.quaternion.setFromUnitVectors(new T.Vector3(0,0,1),ax);d.position.copy(pv);d.visible=false;parent.add(d);sp.disc=d;sp.dmax=o.dmax||.2;}
  rig.spins.push(sp);return sp;
}
function spinStep(sp,w,dt){ // w: rad/s (signed by dir), blur from |w|
  sp.w=w;sp.ang+=w*sp.dir*dt;sp.fr.g.quaternion.setFromAxisAngle(sp.ax,sp.ang);
  if(sp.disc){const b=smooth((Math.abs(w)-sp.bl0)/(sp.bl1-sp.bl0));sp.disc.visible=b>.02;sp.disc.material.opacity=b*sp.dmax;sp.mats.forEach(mt=>{mt.opacity=1-.62*b;});}
}
function addHinge(rig,m,parent,names,pivot,axis,teDirModel){
  const pv=P(m,pivot),ax=Dv(m,axis),te=Dv(m,teDirModel||[0,0,-1]);
  const fr=mkFrame(parent,pv);partMeshes(m,names).forEach(me=>fr.inner.add(me));
  const mv=new T.Vector3().crossVectors(ax,te);const sign=mv.y>=0?1:-1; // positive angle: trailing edge up
  return {fr,ax,sign};
}
const hingeSet=(h,a)=>h.fr.g.quaternion.setFromAxisAngle(h.ax,a*h.sign);

/* ---------- aircraft configs ---------- */
const CFG={
 tb2:{kind:'plane',rotY:90,s:1,off:[-.4,0,0],bright:1,env:1,
  name:'Bayraktar TB2 · ударно-розвідувальний БпАК',short:'Bayraktar TB2',role:'Середньовисотний літакового типу БпАК · розвідка й ураження',
  dims:'розмах крила ≈12 м · довжина ≈6,5 м (за моделлю)',
  desc:['Турецький (Baykar) БпАК літакового типу зі штовхаючим гвинтом у хвостовій частині, двобалковим хвостом із V-подібним оперенням і візуально-інфрачервоною турелью (ОЕС) під носом. У ЗСУ застосовується з 2019 року для розвідки, коригування вогню й ураження.',
        'У моделі: гвинт крутиться (з розмиттям на високих обертах), елерони й керма V-оперення відхиляються за маневром, шасі прибирається після зльоту, а ОЕС можна «повернути». Політ відбувається над фотограмметричним ландшафтом: зліт зі смуги, патрулювання по колу, заход і посадка.'],
  facts:[['Розмах крила','≈12 м'],['Довжина','≈6,5 м'],['Злітна маса','≈700 кг'],['Двигун','Rotax 912 · ≈100 к.с.'],['Крейсерська швидкість','≈130 км/год'],['Макс. швидкість','≈220 км/год'],['Тривалість польоту','до 27 год'],['Практична стеля','≈7,6 км']],
  anim:['гвинт-штовхач із розмиттям','елерони (крен) і кермо V-оперення (тангаж/курс)','колеса й стійки шасі: випуск і прибирання','ОЕС під носом: огляд ліворуч-праворуч','нахил у повороті, тінь на землі'],
  phases:[{id:'park',n:'Стоянка',k:'1'},{id:'takeoff',n:'Зліт',k:'2'},{id:'patrol',n:'Патрулювання',k:'3'},{id:'land',n:'Посадка',k:'4'}],
  start:{x:-285,z:0},cam:{d:20,h:.32},
  sim:{vr:27,vc:34,va:29,orb:215,cx:-560,alt:75,bank:30,gh:0}},
 d1l:{kind:'tail',rotZ:-90,s:1,off:[.2,0,0],bright:2.4,env:1.1,
  name:'D1L «Duck» · tailsitter VTOL FPV',short:'D1L «Duck»',role:'FPV-квадрокоптер схеми tailsitter VTOL · вертикальний зліт, політ як літак',
  dims:'довжина й розмах ≈1,8–1,9 м (за моделлю)',
  desc:['Безпілотник схеми tailsitter: стартує вертикально «на хвості», потім нахиляється на 90° і летить уперед як літак на чотирьох гвинтах, а для посадки знову стає «сторч». Відкритих технічних даних на модель у файлі моделі немає, тому наведено лише те, що видно на самій моделі.',
        'У моделі: чотири триплопатеві гвинти обертаються (пари — у протилежні боки), корпус нахиляється в залежності від швидкості: 90° при висінні, майже горизонтально в круїзі. Режими: вертикальний зліт, перехід у горизонтальний політ, зависання, посадка на хвіст.'],
  facts:[['Схема','tailsitter VTOL · 4 гвинти'],['Лопаті','3 на гвинт, 12 всього'],['Старт і посадка','вертикально, на хвостове оперення'],['Розміри','за моделлю: ≈1,8 × 1,9 м'],['Технічні дані','у файлах відсутні']],
  anim:['4 гвинти у 2 площинах, пари крутяться в протилежні боки','розмиття гвинтів за обертами','перехід 90° → горизонтальний політ (залежить від швидкості)','нахил у віражі, тінь і пил від потоку на малій висоті'],
  phases:[{id:'park',n:'Стоянка',k:'1'},{id:'takeoff',n:'Вертикальний зліт',k:'2'},{id:'cruise',n:'Горизонтальний політ',k:'3'},{id:'hover',n:'Зависання',k:'4'},{id:'land',n:'Посадка',k:'5'}],
  start:{x:0,z:0},cam:{d:7,h:.5},
  sim:{vt:13,vc:24,orb:75,alt:28,sit:.7,rpmH:150,rpmC:210}},
 sky:{kind:'tail',rotZ:-90,s:1,off:[.3,0,0],bright:2.0,env:1.1,
  name:'Skyfall P1-Sun · tailsitter FPV-перехоплювач',short:'Skyfall P1-Sun',role:'FPV-перехоплювач схеми tailsitter · швидкий розгін по дузі',
  dims:'висота ≈1,9 м, розмах ≈1,7 м (за моделлю)',
  desc:['Безпілотник-перехоплювач схеми tailsitter: вертикальний старт, різкий розгін і політ як літак, чотири гвинти на кінцях X-подібних балок. Відкритих технічних даних на цю модель у файлі моделі немає, тому наведено лише те, що видно на моделі.',
        'У моделі, окрім режимів D1L (зліт, політ по колу, зависання, посадка), є «Перехоплення»: різкий розгін по дузі до умовної точки зустрічі (позначена кільцем), далі гальмування, розворот у висіння. Зброї й ураження в моделі немає, це лише траєкторія.'],
  facts:[['Схема','tailsitter VTOL · 4 гвинти (X)'],['Лопаті','2 на гвинт, 8 всього'],['Старт і посадка','вертикально, на хвостове оперення'],['Розміри','за моделлю: ≈1,9 × 1,7 м'],['Технічні дані','у файлах відсутні']],
  anim:['4 двохлопатеві гвинти, пари крутяться в протилежні боки','розмиття гвинтів за обертами','перехід 90° → горизонтальний політ','«Перехоплення»: розгін по дузі до умовної точки (кільце)','нахил у віражі, тінь і пил на малій висоті'],
  phases:[{id:'park',n:'Стоянка',k:'1'},{id:'takeoff',n:'Вертикальний зліт',k:'2'},{id:'cruise',n:'Горизонтальний політ',k:'3'},{id:'intercept',n:'Перехоплення',k:'4'},{id:'hover',n:'Зависання',k:'5'},{id:'land',n:'Посадка',k:'6'}],
  start:{x:0,z:0},cam:{d:7,h:.5},
  sim:{vt:14,vc:26,orb:80,alt:30,sit:.65,rpmH:170,rpmC:230}},
 sh:{kind:'heli',rotY:90,s:.00812,off:[-2.087,0,.02],bright:1.7,env:1,
  name:'SH-60B Seahawk · корабельний вертоліт',short:'SH-60B Seahawk',role:'Протичовновий і багатоцільовий корабельний гелікоптер (США)',
  dims:'довжина корпусу ≈15 м · несучий гвинт ≈16 м (за моделлю)',
  desc:['Корабельний вертоліт родини UH-60 компанії Sikorsky для протичовнової й протикорабельної боротьби, пошуку й порятунку; базується на фрегатах і ескортних кораблях. Модель-довідник: стоїть на колісному шасі з хвостовими колесами.',
        'У моделі: чотирилопатевий несучий гвинт і чотирилопатевий хвостовий гвинт відокремлені й обертаються з розмиттям, шасі крутиться під час руління, корпус нахиляється при розгоні й у віражі. Режими: стоянка, руління, зліт і зависання, політ по колу, посадка.'],
  facts:[['Екіпаж','3'],['Несучий гвинт','≈16,4 м · 4 лопаті'],['Довжина корпусу','≈15,3 м'],['Макс. злітна маса','≈9 900 кг'],['Двигуни','2 × GE T700 · ≈1 800 к.с. кожен'],['Макс. швидкість','≈270 км/год'],['Практична стеля','≈3,7 км'],['Оберти несучого гвинта','≈258 об/хв']],
  anim:['несучий гвинт (4 лопаті) і втулка','хвостовий гвинт, окремий вузол','колеса: руління по майданчику','нахил при розгоні, крен у віражі, пил від потоку','розмиття лопатей за обертами'],
  phases:[{id:'park',n:'Стоянка',k:'1'},{id:'taxi',n:'Руління',k:'2'},{id:'takeoff',n:'Зліт і зависання',k:'3'},{id:'orbit',n:'Політ по колу',k:'4'},{id:'hover',n:'Зависання',k:'5'},{id:'land',n:'Посадка',k:'6'}],
  start:{x:0,z:0},cam:{d:40,h:.3},
  sim:{vc:40,orb:300,alt:90,hov:30,rpm:27}}
};
const ORDER=['tb2','d1l','sky','sh'];

/* ---------- rig construction ---------- */
let RIG=null,M=null,CUR=null;
function bladeBl(sp,b0,b1){sp.bl0=b0;sp.bl1=b1;return sp;}
function buildRig(m){
  const key=m.key,c=m.c,rig={m,key,root:new T.Group(),spins:[],hinges:{},gear:null,eo:null};
  const body=mkFrame(rig.root,ZERO);rig.body=body;const par=body.inner;
  if(key==='tb2'){
    const gN=mkFrame(par,new T.Vector3(0,.88,0)),gL=mkFrame(par,ZERO),gR=mkFrame(par,ZERO);
    partMeshes(m,'gearN').forEach(me=>gN.inner.add(me));partMeshes(m,'gearL').forEach(me=>gL.inner.add(me));partMeshes(m,'gearR').forEach(me=>gR.inner.add(me));
    rig.gear={gN,gL,gR};
    rig.wN=addSpin(rig,m,gN.inner,'wheelN',[0,.145,2.48],[1,0,0],{wheel:1,rad:.145});
    rig.wL=addSpin(rig,m,gL.inner,'wheelL',[-1,.145,.46],[1,0,0],{wheel:1,rad:.145});
    rig.wR=addSpin(rig,m,gR.inner,'wheelR',[1,.145,.46],[1,0,0],{wheel:1,rad:.145});
    rig.prop=bladeBl(addSpin(rig,m,par,'prop',[0,1.138,-.63],[0,0,1],{fade:1,R:.92,disc:0xd3d7da,dmax:.2}),14,40);
    rig.eo=addSpin(rig,m,par,'eo',[0,.56,1.76],[0,1,0],{});
    partMeshes(m,'eoFork').forEach(me=>par.add(me));
    rig.hinges.ailR=addHinge(rig,m,par,'ailR',[5.05,1.21,.23],[1.85,.105,-.02]);
    rig.hinges.ailL=addHinge(rig,m,par,'ailL',[-5.05,1.21,.23],[-1.85,.105,-.02]);
    rig.hinges.rvR=addHinge(rig,m,par,'rvR',[.55,1.7,-2.78],[.69,-.72,0]);
    rig.hinges.rvL=addHinge(rig,m,par,'rvL',[-.55,1.7,-2.78],[-.69,-.72,0]);
  }else if(key==='d1l'){
    const H=[['rotE',.6,0,1],['rotW',-.6,0,1],['rotN',0,.6,-1],['rotS',0,-.6,-1]];
    H.forEach(([n,x,z,d])=>{rig[n]=bladeBl(addSpin(rig,m,par,n,[x,-.19,z],[0,1,0],{dir:d,fade:1,R:.37,disc:0xd5d9dc,dmax:.28}),25,90);});
  }else if(key==='sky'){
    const H=[['rotA',.65,.65,1],['rotB',-.65,.65,-1],['rotC',.65,-.65,-1],['rotD',-.65,-.65,1]];
    H.forEach(([n,x,z,d])=>{rig[n]=bladeBl(addSpin(rig,m,par,n,[x,-.545,z],[0,1,0],{dir:d,fade:1,R:.31,disc:0xd5d9dc,dmax:.3}),25,90);});
  }else if(key==='sh'){
    const U=1/.00812;
    rig.mr=bladeBl(addSpin(rig,m,par,'mrotor',[2.5,440,256.5],[0,1,0],{fade:1,R:1008*.00812,disc:0xe3e6e8,dmax:.13}),8,30);
    rig.tr=bladeBl(addSpin(rig,m,par,'trotor',[36,446,-894.5],[1,0,0],{fade:1,R:200*.00812,disc:0xe3e6e8,dmax:.16}),40,120);
    rig.wL=addSpin(rig,m,par,'wheelL',[-152.5,35,396.5],[1,0,0],{wheel:1,rad:35*.00812});
    rig.wR=addSpin(rig,m,par,'wheelR',[152.5,35,396.5],[1,0,0],{wheel:1,rad:35*.00812});
    rig.tL=addSpin(rig,m,par,'twheelL',[-14.5,24.5,-177.5],[1,0,0],{wheel:1,rad:24.5*.00812});
    rig.tR=addSpin(rig,m,par,'twheelR',[14.5,24.5,-177.5],[1,0,0],{wheel:1,rad:24.5*.00812});
  }
  restMeshes(m).forEach(me=>par.add(me));
  rig.spins.forEach(s=>{if(s.bl0===undefined){s.bl0=1e9;s.bl1=2e9;}});
  return rig;
}

/* ---------- state ---------- */
const S={mode:'park',t:0,x:0,y:0,z:0,vx:0,vy:0,vz:0,psi:0,th:0,ph:0,v:0,gam:0,onG:true,rpm:0,
  gear:0,gearT:0,eoOn:0,eoA:0,ail:0,ele:0,rud:0,phd:0,ax:0,az:0,afwd:0,aright:0,toast:'',toastT:0,
  path:null,pu:0,pv:0,dustT:0,cam:'follow',hx:0,hz:0,taxiX:0,wheelDist:0,sw:0,man:0};
const KEY={l:0,r:0,u:0,d:0};
function setToast(t,s){S.toast=t;S.toastT=s||1.8;}

function resetState(){
  const c=CUR,st=c.start||{x:0,z:0};
  Object.assign(S,{mode:'park',t:0,x:st.x,y:0,z:st.z,vx:0,vy:0,vz:0,psi:0,th:0,ph:0,v:0,gam:0,onG:true,rpm:0,gear:0,gearT:0,eoOn:0,eoA:0,ail:0,ele:0,rud:0,phd:0,ax:0,az:0,afwd:0,aright:0,path:null,pu:0,toastT:0,wheelDist:0,hx:0,hz:0,taxiX:0,dustT:0});
  if(c.kind==='plane'){S.y=hAt(S.x,S.z)+c.sim.gh;}
  else if(c.kind==='tail'){S.y=hAt(S.x,S.z)+c.sim.sit;S.th=PI/2;}
  else if(c.kind==='heli'){S.y=hAt(S.x,S.z)+.02;}
  targetMark.visible=false;
}

/* ---------- flight simulation ---------- */
function groundY(x,z,gh){return hAt(x,z)+gh;}
function accelUpdate(dt,ovx,ovy,ovz){ // low-passed acceleration in body frame
  const ax=(S.vx-ovx)/Math.max(dt,1e-3),az=(S.vz-ovz)/Math.max(dt,1e-3);
  const cs=Math.cos(S.psi),sn=Math.sin(S.psi);
  const af=ax*cs-az*sn,ar=ax*sn+az*cs;
  S.afwd=ease(S.afwd,af,3,dt);S.aright=ease(S.aright,ar,3,dt);
}
function steerVel(tx,ty,tz,vmax,amax,dt,vmaxV,kdecel){ // point-mass approach with deceleration profile
  const dx=tx-S.x,dy=ty-S.y,dz=tz-S.z,dist=Math.hypot(dx,dy,dz)||1e-6;
  const sp=Math.min(vmax,Math.sqrt(2*(kdecel||.6)*amax*dist));
  let wx=dx/dist*sp,wy=dy/dist*sp,wz=dz/dist*sp;
  if(vmaxV!==undefined)wy=clamp(wy,-vmaxV,vmaxV);
  const ax=clamp((wx-S.vx)*1.4,-amax,amax),ay=clamp((wy-S.vy)*1.6,-amax*.7,amax*.7),az=clamp((wz-S.vz)*1.4,-amax,amax);
  S.vx+=ax*dt;S.vy+=ay*dt;S.vz+=az*dt;
  return dist;
}
function orbitVel(c,dt,vmax,amax,alt,R0,cx,cz){ // fly a right-hand circle around (cx,cz)
  const dx=S.x-cx,dz=S.z-cz,r=Math.hypot(dx,dz)||1e-6,rx=dx/r,rz=dz/r,tx=-rz,tz=rx;
  const e=clamp((r-R0)/R0*2.2,-1,1);
  let dirx=tx-e*rx,dirz=tz-e*rz;const dl=Math.hypot(dirx,dirz);dirx/=dl;dirz/=dl;
  const wy=clamp((Math.max(alt,hAt(S.x,S.z)+14)-S.y)*.5,-4,4);
  const ax=clamp((dirx*vmax-S.vx)*1.3,-amax,amax),az=clamp((dirz*vmax-S.vz)*1.3,-amax,amax),ay=clamp((wy-S.vy)*1.4,-3,3);
  S.vx+=ax*dt;S.vz+=az*dt;S.vy+=ay*dt;
}
function integrate(dt){S.x+=S.vx*dt;S.y+=S.vy*dt;S.z+=S.vz*dt;}
function headFromVel(dt,vmin,rate){const h=Math.hypot(S.vx,S.vz);if(h>vmin){const pd=Math.atan2(-S.vz,S.vx);S.psi=wrap(S.psi+clamp(wrap(pd-S.psi),-rate*dt,rate*dt));}}

function simPlane(dt){
  const c=CUR,P_=c.sim;const G0=P_.gh;let vt=0,altT=S.y,orbit=false,line=false,ret=false,psiD=null;
  S.t+=dt;const m=S.mode;
  switch(m){
   case 'park':vt=0;break;
   case 'roll':vt=P_.vc;if(S.v>=P_.vr&&S.t>1){S.onG=false;S.gam=.1;S.mode='climb';S.t=0;setToast('Відрив · набір висоти');}break;
   case 'climb':vt=P_.vc;altT=P_.alt;orbit=true;if(S.y>P_.alt-6){S.mode='orbit';S.t=0;}break;
   case 'orbit':vt=P_.vc;altT=P_.alt+Math.sin(S.t*.12)*6;orbit=true;break;
   case 'ret':{vt=P_.va+2;altT=Math.max(23,S.y-8*dt*0+0);altT=23;orbit=true;if(Math.abs(S.x-P_.cx)<45&&Math.abs(S.z)<32&&Math.cos(S.psi)>.93&&S.y<48){S.mode='final';S.t=0;setToast('Заходження на посадку');}break;}
   case 'final':{vt=P_.va;line=true;const tdx=-235;altT=Math.max(0,(tdx-S.x)*.058+1.5);if(S.y<4.5&&S.x>-700){S.mode='flare';S.t=0;}if(S.x>tdx+120){S.mode='ret';S.t=0;setToast('Прохід повз смугу · ще раз');}break;}
   case 'flare':vt=P_.va*.84;line=true;altT=0;if(S.y<=G0+.05&&!S.onG){S.onG=true;S.mode='rollout';S.t=0;S.gam=0;setToast('Приземлення');for(let i=0;i<8;i++)puff(new T.Vector3(S.x,S.y+.3,S.z),0xcfc7b4,1.4+Math.random()*1.6,-S.v*.15,.6+Math.random()*.8,(Math.random()-.5)*3,1.8,.55,2.2);}break;
   case 'rollout':vt=0;if(S.v<.6){S.v=0;S.mode='park';S.t=0;setToast('Стоянка');}break;
  }
  // gear
  S.gearT=(S.mode==='park'||S.mode==='roll'||S.mode==='final'||S.mode==='flare'||S.mode==='rollout'||(S.mode==='ret'&&S.y<72))?0:((S.mode==='climb'&&S.y<7)?0:1);
  if(S.manualGear!==undefined)S.gearT=S.manualGear;
  S.gear=clamp(S.gear+clamp(S.gearT-S.gear,-dt*.4,dt*.4),0,1);
  // speed
  const acc=S.onG?(vt>S.v?3.0:(m==='rollout'?4.2:2.5)):(vt>S.v?2.4:2.0);
  if(m==='roll'||S.mode==='climb'||S.mode==='orbit'||ret||line||m==='flare')S.v+=clamp(vt-S.v,-acc*dt,acc*dt);
  else if(m==='rollout')S.v=Math.max(0,S.v-acc*dt);
  // heading/bank
  let pd=S.psi;
  if(orbit){const cx=P_.cx,cz=P_.orb,dx=S.x-cx,dz=S.z-cz,r=Math.hypot(dx,dz)||1,rx=dx/r,rz=dz/r,e=clamp((r-P_.orb)/P_.orb*2.5,-1,1);let dxx=-rz-e*rx,dzz=rx-e*rz;pd=Math.atan2(-dzz,dxx);}
  else if(ret){pd=psiD;}
  else if(line||m==='roll'||m==='rollout'||m==='park'){const look=m==='final'||m==='flare'?220:400;pd=Math.atan2(S.z,look)*(S.onG?.3:1);}
  const err=wrap(pd-S.psi);
  const phMax=P_.bank*D2R;
  let phd=S.onG?0:clamp(-err*1.5,-phMax,phMax);
  if(!S.onG&&line&&S.y<6)phd*=clamp(S.y/6,0,1);
  S.phd=phd;S.ph+=(phd-S.ph)*Math.min(1,dt*2.2);
  // manual overrides
  if(S.man&&!S.onG){S.ph+=((KEY.r-KEY.l)*P_.bank*D2R-S.ph)*Math.min(1,dt*3);S.phd=(KEY.r-KEY.l)*P_.bank*D2R;}
  if(S.v>4){if(S.onG)S.psi=wrap(S.psi+clamp(err,-.25*dt,.25*dt));else S.psi=wrap(S.psi-G*Math.tan(S.ph)/Math.max(S.v,12)*dt);}
  // vertical
  let gd=0;
  if(!S.onG){gd=clamp((altT-S.y)*.07,-.15,.17);if(m==='flare')gd=-.02;if(S.man)gd=(KEY.u-KEY.d)*.12;}
  const gtau=m==='climb'&&S.t<2?3:1.3;
  if(!S.onG)S.gam+=(gd-S.gam)*Math.min(1,dt*gtau);
  // pitch
  let thT=0;
  if(m==='roll'){thT=lerp(0,8*D2R,smooth((S.v-.84*P_.vr)/(.16*P_.vr)));}
  else if(!S.onG){thT=S.gam+(.05+Math.max(0,(P_.vc-S.v))*.004);if(m==='flare')thT=Math.max(thT,.1);}
  S.th+=(thT-S.th)*Math.min(1,dt*3);
  // integrate
  const cg=Math.cos(S.gam);S.vx=S.v*cg*Math.cos(S.psi);S.vz=-S.v*cg*Math.sin(S.psi);S.vy=S.onG?0:S.v*Math.sin(S.gam);
  S.x+=S.vx*dt;S.z+=S.vz*dt;S.y+=S.vy*dt;
  const gy=groundY(S.x,S.z,G0);
  if(S.onG){S.y=gy;S.gam=0;}else if(S.y<gy){S.y=gy;if(m==='climb'){S.gam=Math.max(S.gam,0);}else if(m!=='flare'&&m!=='final'){}}
  if(m==='final'&&S.y<=gy+.05&&!S.onG){S.onG=true;S.mode='rollout';S.gam=0;}
  // control surfaces
  S.ail=ease(S.ail,clamp((S.phd-S.ph)*1.1,-.3,.3)+(S.onG?0:0),8,dt);
  S.ele=ease(S.ele,clamp((gd-S.gam)*3+(S.mode==='roll'&&S.v>.9*P_.vr?.2:0),-.3,.3),6,dt);
  S.rud=ease(S.rud,clamp(err*.5,-.25,.25),5,dt);
  // propeller rpm
  const wT=S.mode==='park'?(S.rpm>3?0:0):22+55*clamp(S.v/P_.vc,0,1);
  S.rpm=ease(S.rpm,wT,S.mode==='park'?.6:1.4,dt);
  S.wheelDist+=S.onG?S.v*dt:0;
  S.ground=S.onG;
}
function simHeli(dt){
  const c=CUR,P_=c.sim;S.t+=dt;const m=S.mode;
  const ovx=S.vx,ovy=S.vy,ovz=S.vz;
  const hy=hAt(S.x,S.z)+.02;
  let rpmT=P_.rpm;
  switch(m){
   case 'park':rpmT=0;S.vx=S.vy=S.vz=0;S.x=ease(S.x,S.x,1,dt);break;
   case 'taxi':{rpmT=P_.rpm*.5;const tx=S.taxiX;const d=tx-S.x;const v=clamp(d*.5,-3,3);S.vx=ease(S.vx,v,1.5,dt);S.vz=ease(S.vz,0,1.5,dt);S.vy=0;S.y=hy;if(Math.abs(d)<.3&&Math.abs(S.vx)<.15){S.mode='park';}break;}
   case 'takeoff':{if(S.rpm>P_.rpm*.93){steerVel(S.hx,S.hz*0+P_.hov,S.hz,6,2.4,dt,3.2);}else{S.vx=S.vy=S.vz=0;S.y=hy;}if(Math.abs(S.y-P_.hov)<1.2&&S.rpm>P_.rpm*.93&&S.t>3){S.mode='hover';setToast('Зависання');}break;}
   case 'hover':{steerVel(S.hx,P_.hov,S.hz,P_.vc,4.2,dt,4);break;}
   case 'orbit':{orbitVel(c,dt,P_.vc,3.4,P_.alt,P_.orb,0,P_.orb);break;}
   case 'land':{const d=Math.hypot(S.x-S.hx,S.z-S.hz);
     if(d>8&&S.y>12){steerVel(S.hx,Math.max(P_.hov,S.y-1),S.hz,P_.vc,4,dt,4);}
     else{const tgtY=hy;const vd=clamp((S.y-tgtY)*.35+.7,.7,2.4);const dx=S.hx-S.x,dz=S.hz-S.z;S.vx=ease(S.vx,clamp(dx*.6,-3,3),2,dt);S.vz=ease(S.vz,clamp(dz*.6,-3,3),2,dt);S.vy=ease(S.vy,-vd,2,dt);}
     if(S.y<=hy+.03){S.y=hy;S.vx=S.vy=S.vz=0;S.mode='park';setToast('Посадка · стоянка');for(let i=0;i<6;i++)puff(new T.Vector3(S.x,hy+.5,S.z),0xcfc7b4,3+Math.random()*3,(Math.random()-.5)*6,.5,(Math.random()-.5)*6,2.2,.5,3);}break;}
  }
  if(m!=='taxi'&&m!=='park'&&!(m==='takeoff'&&S.rpm<=P_.rpm*.93))integrate(dt);else if(m==='taxi'){S.x+=S.vx*dt;S.z+=S.vz*dt;}
  const gy=hAt(S.x,S.z)+.02;if(S.y<gy){S.y=gy;if(S.vy<0)S.vy=0;}
  S.onG=S.y<=gy+.05;
  S.rpm=ease(S.rpm,rpmT,m==='park'?.45:.75,dt);
  const hs=Math.hypot(S.vx,S.vz);
  if(hs>5)headFromVel(dt,5,1.0);else if(m==='hover'||m==='takeoff'||m==='land'){const pd=0;S.psi=wrap(S.psi+clamp(wrap(pd-S.psi),-.5*dt,.5*dt));}
  accelUpdate(dt,ovx,ovy,ovz);
  const lat=Math.atan2(S.aright,G),fw=Math.atan2(S.afwd,G);
  const ph=clamp(lat,-.6,.6)*(S.onG?0:1),th=(-fw*.9-(hs/P_.vc)*.1)*(S.onG?0:1);
  S.ph=ease(S.ph,ph,3,dt);S.th=ease(S.th,th,3,dt);
  S.v=hs;S.wheelDist+=S.onG?S.vx*dt:0;S.ground=S.onG;
}
function simTail(dt){
  const c=CUR,P_=c.sim;S.t+=dt;const m=S.mode;
  const ovx=S.vx,ovy=S.vy,ovz=S.vz;
  const sit=P_.sit,hy=hAt(S.x,S.z)+sit;
  let rpmT=P_.rpmH;
  switch(m){
   case 'park':rpmT=0;S.vx=S.vy=S.vz=0;S.y=hy;break;
   case 'takeoff':{if(S.rpm>P_.rpmH*.9){steerVel(S.hx,P_.alt,S.hz,5,4,dt,4.5);}else{S.vx=S.vy=S.vz=0;S.y=hy;}if(S.y>P_.alt-2&&S.t>2){S.mode='hover';setToast('Зависання');}break;}
   case 'hover':{steerVel(S.hx,P_.alt,S.hz,P_.vc,6,dt,4);break;}
   case 'cruise':{rpmT=P_.rpmH+(P_.rpmC-P_.rpmH)*smooth(Math.hypot(S.vx,S.vz)/P_.vc);orbitVel(c,dt,P_.vc,5,P_.alt,P_.orb,0,P_.orb);break;}
   case 'intercept':{rpmT=P_.rpmC;const pth=S.path;S.pu+=dt/pth.T;const u=Math.min(1,S.pu);const sp=1-Math.pow(1-u,2.2);// accelerate hard along the arc
      const v=lerp(2,pth.vmax,Math.pow(u,.75))*(u<1?1:1);
      // advance by arclength
      S.ps=(S.ps||0)+v*dt;const s=Math.min(1,S.ps/pth.len);
      const p=bez(pth.p,s),tg=bezT(pth.p,s);
      const ox=S.x,oy=S.y,oz=S.z;S.x=p.x;S.y=p.y;S.z=p.z;S.vx=(S.x-ox)/dt;S.vy=(S.y-oy)/dt;S.vz=(S.z-oz)/dt;
      if(s>=1){S.mode='hover';S.hx=S.x*.0;S.hz=S.z*.0;setToast('Точка зустрічі · гальмування й зависання');targetMark.visible=false;}
      break;}
   case 'land':{const d=Math.hypot(S.x-S.hx,S.z-S.hz);
     if(d>6&&S.y>10){steerVel(S.hx,Math.max(P_.alt*.6,S.y-1),S.hz,P_.vc,6,dt,4);}
     else{const vd=clamp((S.y-hy)*.45+.6,.6,2.4);S.vx=ease(S.vx,clamp((S.hx-S.x)*.7,-3,3),2,dt);S.vz=ease(S.vz,clamp((S.hz-S.z)*.7,-3,3),2,dt);S.vy=ease(S.vy,-vd,2,dt);}
     if(S.y<=hy+.03){S.y=hy;S.vx=S.vy=S.vz=0;S.mode='park';setToast('Посадка на хвіст · стоянка');for(let i=0;i<5;i++)puff(new T.Vector3(S.x,hy+.3,S.z),0xcfc7b4,1.5+Math.random()*1.5,(Math.random()-.5)*4,.5,(Math.random()-.5)*4,1.8,.5,2);}break;}
  }
  if(m!=='park'&&!(m==='takeoff'&&S.rpm<=P_.rpmH*.9)&&m!=='intercept')integrate(dt);
  const gy=hAt(S.x,S.z)+sit;if(S.y<gy){S.y=gy;if(S.vy<0)S.vy=0;}
  S.onG=S.y<=gy+.06;
  S.rpm=ease(S.rpm,rpmT,m==='park'?.9:1.3,dt);
  const hs=Math.hypot(S.vx,S.vz);
  if(hs>5)headFromVel(dt,5,1.4);
  accelUpdate(dt,ovx,ovy,ovz);
  const lam=smooth(hs/P_.vt);
  S.th=ease(S.th,(PI/2)*(1-lam)+(-.06)*lam,6,dt);
  S.ph=ease(S.ph,clamp(Math.atan2(S.aright,G),-.9,.9)*lam,4,dt);
  S.v=hs;S.ground=S.onG;
}
function bez(p,t){const u=1-t;return new T.Vector3().set(0,0,0).addScaledVector(p[0],u*u*u).addScaledVector(p[1],3*u*u*t).addScaledVector(p[2],3*u*t*t).addScaledVector(p[3],t*t*t);}
function bezT(p,t){const u=1-t;return new T.Vector3().addScaledVector(p[1].clone().sub(p[0]),3*u*u).addScaledVector(p[2].clone().sub(p[1]),6*u*t).addScaledVector(p[3].clone().sub(p[2]),3*t*t).normalize();}
function startIntercept(){
  const P_=CUR.sim;const p0=new T.Vector3(S.x,S.y,S.z),h=new T.Vector3(Math.cos(S.psi),0,-Math.sin(S.psi));
  const r=new T.Vector3(Math.sin(S.psi),0,Math.cos(S.psi));
  const up=new T.Vector3(0,1,0);
  const p1=p0.clone().addScaledVector(h,60).addScaledVector(up,10),p2=p0.clone().addScaledVector(h,180).addScaledVector(r,90).addScaledVector(up,28),p3=p0.clone().addScaledVector(h,210).addScaledVector(r,230).addScaledVector(up,P_.alt*.4);
  // arclength estimate
  let len=0,pv=bez([p0,p1,p2,p3],0);for(let i=1;i<=40;i++){const q=bez([p0,p1,p2,p3],i/40);len+=q.distanceTo(pv);pv=q;}
  S.path={p:[p0,p1,p2,p3],len,vmax:58,T:5};S.pu=0;S.ps=0;
  targetMark.position.copy(p3);targetMark.visible=true;targetMark.lookAt(p3.clone().sub(h));
}

/* ---------- modes ---------- */
function setMode(id){
  const c=CUR;if(!c)return;S.toastT=0;
  if(c.kind==='plane'){
    if(id==='park'){resetState();rig_apply(true);}
    else if(id==='takeoff'){if(S.mode==='park'||S.mode==='rollout'){S.mode='roll';S.t=0;S.onG=true;setToast('Розбіг');}else if(S.mode!=='roll'){S.mode='orbit';}}
    else if(id==='patrol'){if(S.mode==='park'){S.mode='roll';S.t=0;setToast('Розбіг · далі патрулювання');}else if(S.mode==='ret'||S.mode==='final'){S.mode='orbit';S.t=0;}else if(S.mode==='flare'||S.mode==='rollout'){}else S.mode='orbit';}
    else if(id==='land'){if(!S.onG&&S.mode!=='final'&&S.mode!=='flare'){S.mode='ret';S.t=0;setToast('Повернення на посадку');}}
  }else if(c.kind==='heli'){
    if(id==='park'){resetState();rig_apply(true);}
    else if(id==='taxi'){if(S.mode==='park'||S.mode==='taxi'){S.mode='taxi';S.taxiX=S.taxiX>10?0:30;setToast(S.taxiX>10?'Руління вперед':'Руління назад');}}
    else if(id==='takeoff'){if(S.onG){S.hx=S.x;S.hz=S.z;S.mode='takeoff';S.t=0;setToast('Запуск гвинта · зліт');}}
    else if(id==='orbit'){if(S.onG){S.hx=S.x;S.hz=S.z;S.mode='takeoff';S.t=0;S.after='orbit';}else S.mode='orbit';}
    else if(id==='hover'){if(!S.onG){S.mode='hover';S.hx=0;S.hz=0;}}
    else if(id==='land'){if(!S.onG){S.mode='land';S.hx=0;S.hz=0;setToast('Посадка на майданчик');}}
  }else{
    if(id==='park'){resetState();rig_apply(true);}
    else if(id==='takeoff'){if(S.onG){S.hx=S.x;S.hz=S.z;S.mode='takeoff';S.t=0;setToast('Вертикальний зліт');}}
    else if(id==='cruise'){if(S.onG){S.hx=S.x;S.hz=S.z;S.mode='takeoff';S.t=0;S.after='cruise';}else{S.mode='cruise';setToast('Перехід у горизонтальний політ');}}
    else if(id==='intercept'){if(!S.onG){if(S.mode==='cruise'||S.mode==='intercept'){}S.mode='intercept';startIntercept();setToast('Перехоплення · розгін по дузі');}else{S.hx=S.x;S.hz=S.z;S.mode='takeoff';S.t=0;S.after='intercept';}}
    else if(id==='hover'){if(!S.onG){S.mode='hover';S.hx=0;S.hz=0;setToast('Гальмування · перехід у зависання');}}
    else if(id==='land'){if(!S.onG){S.mode='land';S.hx=0;S.hz=0;setToast('Посадка на хвіст');}}
  }
  S.manualGear=undefined;S.curPhase=id;buildChipsState();
}

/* ---------- apply state to rig ---------- */
const E=new T.Euler(0,0,0,'YZX');
function rig_apply(force){
  const rig=RIG;if(!rig)return;
  rig.root.position.set(S.x,S.y,S.z);E.set(S.ph,S.psi,S.th,'YZX');rig.root.rotation.copy(E);
  const gy=hAt(S.x,S.z),alt=S.y-gy;
  shadow.position.set(S.x,gy+.12,S.z);
  const sz=(CUR.kind==='plane'?13:CUR.kind==='heli'?16:3.6)*(1+alt*.012);shadow.scale.set(sz,sz*(CUR.kind==='heli'?1:1),1);
  shadow.material.opacity=clamp(1-alt/(CUR.kind==='plane'?160:90),.1,1);
}
function poseRig(dt){
  const rig=RIG,key=rig.key,P_=CUR.sim;
  if(key==='tb2'){
    spinStep(rig.prop,S.rpm,dt);
    const wr=S.wheelDist/.145;const gdn=S.gear<.5;
    [rig.wN,rig.wL,rig.wR].forEach(w=>{w.ang=wr;w.fr.g.quaternion.setFromAxisAngle(w.ax,-wr);});
    const g=smooth(S.gear),G_=rig.gear;
    G_.gN.g.scale.y=lerp(1,.12,g);G_.gN.g.visible=g<.97;
    G_.gL.g.position.y=.66*g;G_.gR.g.position.y=.66*g;G_.gL.g.visible=G_.gR.g.visible=g<.97;
    hingeSet(rig.hinges.ailR,S.ail);hingeSet(rig.hinges.ailL,-S.ail);
    hingeSet(rig.hinges.rvR,S.ele+S.rud);hingeSet(rig.hinges.rvL,S.ele-S.rud);
    S.eoA=ease(S.eoA,S.eoOn?Math.sin(S.t*.9)*1.15:0,4,dt);rig.eo.fr.g.quaternion.setFromAxisAngle(rig.eo.ax,S.eoA);
  }else if(key==='d1l'||key==='sky'){
    const w=S.rpm;['rotE','rotW','rotN','rotS','rotA','rotB','rotC','rotD'].forEach(n=>{if(rig[n])spinStep(rig[n],w,dt);});
  }else if(key==='sh'){
    spinStep(rig.mr,S.rpm,dt);spinStep(rig.tr,S.rpm*4.62,dt);
    const wr=S.wheelDist/(35*.00812),wt=S.wheelDist/(24.5*.00812);
    [rig.wL,rig.wR].forEach(w=>w.fr.g.quaternion.setFromAxisAngle(w.ax,-wr));[rig.tL,rig.tR].forEach(w=>w.fr.g.quaternion.setFromAxisAngle(w.ax,-wt));
  }
}

/* ---------- UI ---------- */
const CH={};let busy=false;
function chip(row,label,key,on){const b=document.createElement('button');b.className='chip';b.type='button';b.innerHTML=(key?`<kbd>${key}</kbd>`:'')+`<span>${label}</span>`;b.onclick=on;$(row).appendChild(b);return b;}
function holdChip(row,label,key,hk){const b=chip(row,label,key,()=>{});b.onclick=null;
  let t0=0;const on=e=>{if(e)e.preventDefault();KEY[hk]=1;t0=performance.now();if(!S.man)toggleMan(true);};
  const off=()=>{const d=260-(performance.now()-t0);if(KEY[hk]&&d>0)setTimeout(()=>{KEY[hk]=0;},d);else KEY[hk]=0;};
  b.addEventListener('pointerdown',on);['pointerup','pointercancel','pointerleave','blur'].forEach(ev=>b.addEventListener(ev,off));b.style.touchAction='none';return b;}
function toggleMan(on){S.man=on?1:0;if(CH.man)CH.man.classList.toggle('on',!!S.man);}
function buildChips(){
  ['#rowV','#rowP','#rowL','#rowH','#rowC'].forEach(r=>$(r).innerHTML='');
  CH.v={};ORDER.forEach(k=>{CH.v[k]=chip('#rowV',CFG[k].short,'',()=>selectModel(k));});
  CH.p={};CUR.phases.forEach(p=>{CH.p[p.id]=chip('#rowP',p.n,p.k,()=>setMode(p.id));});
  CH.man=null;
  if(CUR.kind==='plane'){chip('#rowL','Вручну','M',()=>toggleMan(!S.man));CH.man=$('#rowL').lastChild;holdChip('#rowL','Крен ←','←','l');holdChip('#rowL','Крен →','→','r');holdChip('#rowL','Нахил ↑','↑','u');holdChip('#rowL','Нахил ↓','↓','d');}
  $('#rowL').parentElement.style.display=CUR.kind==='plane'?'':'none';
  if(CUR.kind==='plane'){CH.gear=chip('#rowH','Шасі: прибрати / випустити','G',()=>{S.manualGear=S.gearT>.5?0:1;setToast(S.manualGear?'Шасі прибирається':'Шасі випускається');});CH.eo=chip('#rowH','ОЕС: огляд','E',()=>{S.eoOn=S.eoOn?0:1;CH.eo.classList.toggle('on',!!S.eoOn);});}
  $('#rowH').parentElement.style.display=CUR.kind==='plane'?'':'none';
  CH.cam={};[['follow','Стежити','C'],['obs','З землі',''],['free','Огляд','']].forEach(([id,n,k])=>{CH.cam[id]=chip('#rowC',n,k,()=>setCam(id));});
  buildChipsState();
}
function buildChipsState(){
  if(!CUR)return;Object.keys(CH.v||{}).forEach(k=>CH.v[k].classList.toggle('on',k===CUR.key));
  Object.keys(CH.p||{}).forEach(k=>CH.p[k].classList.toggle('on',S.curPhase===k));
  Object.keys(CH.cam||{}).forEach(k=>CH.cam[k].classList.toggle('on',S.cam===k));
}
function fillInfo(){const c=CUR;
  $('#i-name').textContent=c.name;$('#i-role').textContent=c.role;
  $('#i-desc').innerHTML=c.desc.map(p=>'<p>'+p+'</p>').join('');
  $('#i-facts').innerHTML=c.facts.map(f=>'<div><dt>'+f[0]+'</dt><dd>'+f[1]+'</dd></div>').join('');
  $('#i-anim').innerHTML=c.anim.map(a=>'<li>'+a+'</li>').join('');
  $('#i-cred').innerHTML=creditHtml('uav/'+c.key);
  $('#title').textContent=c.short;$('#dims').textContent=c.dims;
}

/* ---------- camera ---------- */
const obsPos=new T.Vector3(-40,3.5,-34);
function setCam(id){S.cam=id;oc.enabled=id!=='obs';cam.fov=36;cam.updateProjectionMatrix();
  if(id==='obs'){obsPos.set(S.x-60,Math.max(hAt(S.x,S.z),0)+3,S.z-48);if(CUR.kind==='plane')obsPos.set(CUR.sim.cx,Math.max(hAt(CUR.sim.cx,CUR.sim.orb),0)+2.5,CUR.sim.orb);cam.position.copy(obsPos);}
  if(id==='free'){oc.target.set(S.x,S.y+1,S.z);}
  buildChipsState();}
function placeCamera(){const c=CUR.cam;const d=c.d;const p=new T.Vector3(S.x,S.y+1,S.z);oc.target.copy(p);cam.position.set(p.x-d*.8,p.y+d*c.h+1,p.z+d*.9);oc.update();}
const _w=new T.Vector3();
function camStep(dt){
  const tg=_w.set(S.x,S.y+(CUR.kind==='plane'?1:.6),S.z);
  if(S.cam==='follow'){const k=1-Math.exp(-(9+Math.hypot(S.vx,S.vy,S.vz)*.7)*dt);const dx=(tg.x-oc.target.x)*k,dy=(tg.y-oc.target.y)*k,dz=(tg.z-oc.target.z)*k;oc.target.x+=dx;oc.target.y+=dy;oc.target.z+=dz;cam.position.x+=dx;cam.position.y+=dy;cam.position.z+=dz;oc.update();}
  else if(S.cam==='obs'){cam.position.copy(obsPos);cam.lookAt(tg);const dist=cam.position.distanceTo(tg);cam.fov=clamp(2*Math.atan((CUR.kind==='plane'?9:CUR.kind==='heli'?12:3)/dist)*180/PI,5,36);cam.updateProjectionMatrix();}
  else{oc.update();}
  if(S.cam!=='obs'){const gy=hAt(cam.position.x,cam.position.z)+1.5;if(cam.position.y<gy)cam.position.y=gy;}
}

/* ---------- model switching ---------- */
async function selectModel(key){
  if(busy||(CUR&&CUR.key===key))return;busy=true;$('#load').hidden=false;$('#load').textContent='Завантаження моделі';
  try{
    const m=await buildModel(key);
    if(RIG){world.remove(RIG.root);}
    clearFX();M=m;CUR=CFG[key];CUR.key=key;
    RIG=buildRig(m);world.add(RIG.root);
    resetState();S.curPhase='park';S.after=null;S.manualGear=undefined;S.man=0;
    fillInfo();buildChips();rig_apply(true);poseRig(0);placeCamera();setCam(S.cam==='obs'?'obs':'follow');
    $('#load').hidden=true;
  }catch(e){console.error(e);$('#load').textContent='Не вдалося завантажити модель';window.__err=String(e&&e.stack||e);}
  busy=false;
}

addEventListener('keydown',e=>{if(e.target.tagName==='INPUT'||!CUR)return;const c=e.code;
  const idx={Digit1:0,Digit2:1,Digit3:2,Digit4:3,Digit5:4,Digit6:5}[c];
  if(idx!==undefined&&CUR.phases[idx]){setMode(CUR.phases[idx].id);return;}
  if(CUR.kind==='plane'){const k={ArrowLeft:'l',ArrowRight:'r',ArrowUp:'u',ArrowDown:'d'}[e.key];if(k){e.preventDefault();KEY[k]=1;if(!S.man)toggleMan(true);return;}
    if(c==='KeyM')toggleMan(!S.man);else if(c==='KeyG'&&CH.gear)CH.gear.click();else if(c==='KeyE'&&CH.eo)CH.eo.click();}
  if(c==='KeyC'){const o=['follow','obs','free'];setCam(o[(o.indexOf(S.cam)+1)%3]);}});
addEventListener('keyup',e=>{const k={ArrowLeft:'l',ArrowRight:'r',ArrowUp:'u',ArrowDown:'d'}[e.key];if(k)KEY[k]=0;});
addEventListener('blur',()=>{KEY.l=KEY.r=KEY.u=KEY.d=0;});

/* ---------- frame ---------- */
function resize(){const w=stage.clientWidth,h=stage.clientHeight;R.setSize(w,h,false);cam.aspect=w/h;cam.updateProjectionMatrix();}
new ResizeObserver(resize).observe(stage);resize();
const clock=makeClock();const st=$('#status');
function loop(){if(!window.__paused)requestAnimationFrame(loop);frame(Math.min(.05,clock.getDelta()));}
function dustStep(dt){
  const k=CUR.kind;if(k==='plane'){if(S.onG&&S.v>8){S.dustT-=dt;if(S.dustT<=0){S.dustT=.12;puff(new T.Vector3(S.x-3,S.y+.2,S.z),0xcfc7b4,.9+Math.random()*.8,-S.v*.1,.3,(Math.random()-.5)*1.5,1.2,.28,1.4);}}return;}
  const alt=S.y-hAt(S.x,S.z)-(k==='tail'?CUR.sim.sit:0);const lim=k==='heli'?22:9;
  if(alt<lim&&S.rpm>(k==='heli'?14:80)){S.dustT-=dt;if(S.dustT<=0){S.dustT=k==='heli'?.07:.1;const gy=hAt(S.x,S.z)+.3;const n=k==='heli'?2:1;
    for(let i=0;i<n;i++){const a=Math.random()*2*PI,rr=k==='heli'?(4+Math.random()*4):(1+Math.random()*1.2),sp=k==='heli'?(7+Math.random()*4):(3.5+Math.random()*2);
      puff(new T.Vector3(S.x+Math.cos(a)*rr,gy,S.z+Math.sin(a)*rr),0xcdc3ac,(k==='heli'?2.6:1.1)+Math.random()*1.2,Math.cos(a)*sp,.35+Math.random()*.5,Math.sin(a)*sp,k==='heli'?2.4:1.6,.42*(1-alt/lim),k==='heli'?3.2:1.4);}}}
}
function frame(dt,nr){
  if(CUR&&RIG){
    S.toastT-=dt;
    if(dt>0){if(CUR.kind==='plane')simPlane(dt);else if(CUR.kind==='heli')simHeli(dt);else simTail(dt);}
    // chained modes (take off, then do X)
    if(S.after&&S.mode==='hover'){const a=S.after;S.after=null;setMode(a);}
    if(S.after&&S.mode==='park')S.after=null;
    if(CUR.kind==='plane'&&S.mode==='roll'&&S.curPhase==='takeoff'&&false){}
    rig_apply();poseRig(dt);stepFX(dt);dustStep(dt);
    camStep(dt);
    const sp=Math.round(S.v*3.6),alt=Math.max(0,S.y-hAt(S.x,S.z)-(CUR.kind==='tail'?CUR.sim.sit:0));
    const MN={park:'Стоянка',roll:'Розбіг',climb:'Набір висоти',orbit:'Політ по колу',ret:'Повернення до смуги',final:'Заходження на посадку',flare:'Вирівнювання',rollout:'Пробіг',taxi:'Руління',takeoff:'Зліт',hover:'Зависання',cruise:'Горизонтальний політ',intercept:'Перехоплення',land:'Посадка'};
    let text=S.toastT>0?S.toast:(MN[S.mode]||S.mode);
    text+=' · '+sp+' км/год · висота '+Math.round(alt)+' м'+(CUR.kind==='plane'&&S.mode!=='park'?'':'');
    if(S.man&&CUR.kind==='plane')text+=' · вручну';
    if(CUR.kind==='tail'&&S.mode!=='park')text+=' · нахил '+Math.round(S.th/D2R)+'°';
    if(st.textContent!==text)st.textContent=text;st.classList.toggle('toast',S.toastT>0);
  }
  if(!nr)R.render(scene,cam);
}

/* ---------- boot ---------- */
window.__tick=(n,dt)=>{for(let i=0;i<n;i++)frame(dt||1/30,i<n-1);};window.__snap=()=>{frame(0);return cv.toDataURL('image/png');};
window.__S=S;window.__setMode=setMode;window.__sel=selectModel;window.__cam=setCam;window.__rig=()=>RIG;window.__land=LAND;window.__hAt=hAt;window.__cur=()=>CUR;window.__KEY=KEY;
window.__ready=()=>!!RIG&&LAND.ready&&!busy;
const first=new URLSearchParams(location.search).get('m')||ORDER[0];
selectModel(first);
setTimeout(loadLand,500);
loop();

