// Довідник ППО EasyWAR: ЗРК і ЗСУ з маршем, фазами, виносом РЛС, пуском ракет, димом і пилом.
// Код перенесено з опублікованого інтерактивного довідника; змінено лише завантаження: моделі читаються з локальних файлів `models/*.glb`,
// three береться з npm (без CDN), шрифти — локальні (../fonts), правила поділу моделей — готові функції (specs.js).
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {RoomEnvironment} from '../room-env.js';
import {fetchBuffer, makeClock} from '../guide-kit.js';
import {creditHtml} from '../credits.js';
import {MODEL_URLS, LAND_URL} from './models.js';
import {SPECS} from './specs.js';

const $=s=>document.querySelector(s);
const T=THREE,PI=Math.PI,D2R=PI/180;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const ease=(c,t,k,dt)=>c+(t-c)*(1-Math.exp(-k*dt));
const smooth=x=>{x=clamp(x,0,1);return x*x*(3-2*x);};
const stage=$('#stage'),cv=$('#cv');
const GY=0;

/* ---------- renderer / scene ---------- */
const R=new T.WebGLRenderer({canvas:cv,antialias:true});
R.setPixelRatio(Math.min(devicePixelRatio,2));R.toneMapping=T.ACESFilmicToneMapping;R.toneMappingExposure=1.05;R.outputColorSpace=T.SRGBColorSpace;
R.setClearColor(0x111214);
const scene=new T.Scene();scene.fog=new T.Fog(0x111214,70,150);
scene.environment=new T.PMREMGenerator(R).fromScene(new RoomEnvironment(),0.04).texture;
const sun=new T.DirectionalLight(0xfff1dc,1.7);sun.position.set(18,26,12);scene.add(sun);
scene.add(new T.HemisphereLight(0xcfd6c8,0x1a1c18,.55));
const cam=new T.PerspectiveCamera(32,1,.1,600);
const ctl=new OrbitControls(cam,cv);ctl.enableDamping=true;ctl.dampingFactor=.08;ctl.minDistance=3;ctl.maxDistance=90;ctl.maxPolarAngle=PI*.49;ctl.enablePan=false;
cv.addEventListener('pointerdown',()=>cv.classList.add('drag'));addEventListener('pointerup',()=>cv.classList.remove('drag'));
const world=new T.Group();scene.add(world);
const truck=new T.Group();world.add(truck);

/* ---------- helpers ---------- */
function canvasTex(sz,fn){const c=document.createElement('canvas');c.width=c.height=sz;fn(c.getContext('2d'),sz);const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;return t;}
const glowTex=canvasTex(128,(x,s)=>{const g=x.createRadialGradient(s/2,s/2,0,s/2,s/2,s/2);g.addColorStop(0,'rgba(255,255,255,1)');g.addColorStop(.2,'rgba(255,255,255,.8)');g.addColorStop(.5,'rgba(255,255,255,.2)');g.addColorStop(1,'rgba(255,255,255,0)');x.fillStyle=g;x.fillRect(0,0,s,s);});
const puffTex=canvasTex(128,(x,s)=>{for(let i=0;i<9;i++){const cx=s*(.3+Math.random()*.4),cy=s*(.3+Math.random()*.4),r=s*(.14+Math.random()*.16);const g=x.createRadialGradient(cx,cy,0,cx,cy,r);g.addColorStop(0,'rgba(255,255,255,.55)');g.addColorStop(1,'rgba(255,255,255,0)');x.fillStyle=g;x.fillRect(0,0,s,s);}});
function sprite(tex,color,size,blend){const s=new T.Sprite(new T.SpriteMaterial({map:tex,color,transparent:true,depthWrite:false,blending:blend||T.NormalBlending}));s.scale.set(size,size,1);return s;}
const loader=new GLTFLoader();loader.setMeshoptDecoder(MeshoptDecoder);
const parseGLB=buf=>new Promise((res,rej)=>loader.parse(buf,'',res,rej));
const darkMat=new T.MeshBasicMaterial({color:0x07080a});
const steelMat=new T.MeshStandardMaterial({color:0x3b3f45,metalness:.5,roughness:.45});
const rodMat=new T.MeshStandardMaterial({color:0xa9adb3,metalness:.8,roughness:.25});
const padMat=new T.MeshStandardMaterial({color:0x2c2f33,metalness:.3,roughness:.7});
const rubberMat=new T.MeshStandardMaterial({color:0x17181a,metalness:.1,roughness:.9});
const V3=(a)=>new T.Vector3(a[0],a[1],a[2]);

/* ---------- connected components (same code runs offline in node) ---------- */
function compsOf(pos,ix,q=1e3){
  const n=pos.length/3,map=new Map(),rep=new Int32Array(n),par=[];
  const find=a=>{while(par[a]!==a){par[a]=par[par[a]];a=par[a];}return a;};
  for(let i=0;i<n;i++){const k=Math.round(pos[i*3]*q)+','+Math.round(pos[i*3+1]*q)+','+Math.round(pos[i*3+2]*q);let r=map.get(k);if(r===undefined){r=par.length;par.push(r);map.set(k,r);}rep[i]=r;}
  const nt=ix.length/3;
  for(let t=0;t<nt;t++){const a=find(rep[ix[t*3]]),b=find(rep[ix[t*3+1]]),c=find(rep[ix[t*3+2]]);if(a!==b)par[b]=a;if(find(c)!==find(a))par[find(c)]=find(a);}
  const ids=new Map(),face=new Int32Array(nt),bb=[];
  for(let t=0;t<nt;t++){const r=find(rep[ix[t*3]]);let id=ids.get(r);if(id===undefined){id=bb.length;ids.set(r,id);bb.push({mn:[1e9,1e9,1e9],mx:[-1e9,-1e9,-1e9],n:0});}
    face[t]=id;const B=bb[id];B.n++;
    for(let k=0;k<3;k++){const v=ix[t*3+k];for(let a=0;a<3;a++){const x=pos[v*3+a];if(x<B.mn[a])B.mn[a]=x;if(x>B.mx[a])B.mx[a]=x;}}}
  return {face,bb};
}
const sw=(s,p)=>s.startsWith(p),has=(s,p)=>s.includes(p);
const compileRule=fn=>fn; // правила в specs.js уже готові функції

/* ---------- model loading and surgery ---------- */
const cache={};
function bakeMesh(o,F){
  o.updateWorldMatrix(true,false);const m=new T.Matrix4().multiplyMatrices(F,o.matrixWorld);
  const g=o.geometry,pa=g.attributes.position,na=g.attributes.normal,ua=g.attributes.uv,n=pa.count;
  const pos=new Float32Array(n*3),nor=new Float32Array(n*3),uv=new Float32Array(n*2),v=new T.Vector3(),nm=new T.Matrix3().getNormalMatrix(m);
  for(let i=0;i<n;i++){v.fromBufferAttribute(pa,i).applyMatrix4(m);pos[i*3]=v.x;pos[i*3+1]=v.y;pos[i*3+2]=v.z;
    if(na){v.fromBufferAttribute(na,i).applyMatrix3(nm).normalize();nor[i*3]=v.x;nor[i*3+1]=v.y;nor[i*3+2]=v.z;}
    if(ua){uv[i*2]=ua.getX(i);uv[i*2+1]=ua.getY(i);}}
  let ix;if(g.index){ix=new Uint32Array(g.index.array);}else{ix=new Uint32Array(n);for(let i=0;i<n;i++)ix[i]=i;}
  if(m.determinant()<0)for(let t=0;t<ix.length;t+=3){const a=ix[t+1];ix[t+1]=ix[t+2];ix[t+2]=a;}
  const geo=new T.BufferGeometry();geo.setAttribute('position',new T.BufferAttribute(pos,3));if(na)geo.setAttribute('normal',new T.BufferAttribute(nor,3));if(ua)geo.setAttribute('uv',new T.BufferAttribute(uv,2));
  return {pos,ix,geo,mat:Array.isArray(o.material)?o.material[0]:o.material,name:o.name};
}
function subMesh(src,tris,mat){
  const out=new Uint32Array(tris.length*3);for(let i=0;i<tris.length;i++){const t=tris[i];out[i*3]=src.ix[t*3];out[i*3+1]=src.ix[t*3+1];out[i*3+2]=src.ix[t*3+2];}
  const g=new T.BufferGeometry();for(const k in src.geo.attributes)g.setAttribute(k,src.geo.attributes[k]);g.setIndex(new T.BufferAttribute(out,1));
  return new T.Mesh(g,mat||src.mat);
}
function fixMatrix(tf){const R3=tf.R,s=tf.s,t=tf.t;return new T.Matrix4().set(R3[0][0]*s,R3[0][1]*s,R3[0][2]*s,t[0],R3[1][0]*s,R3[1][1]*s,R3[1][2]*s,t[1],R3[2][0]*s,R3[2][1]*s,R3[2][2]*s,t[2],0,0,0,1);}
function colorOf(h){return new T.Color(h);}

async function buildModel(sp){
  if(cache[sp.key])return cache[sp.key];
  const gl=await parseGLB(await fetchBuffer(MODEL_URLS[sp.model]));
  const sc=gl.scene;sc.updateMatrixWorld(true);
  const F=fixMatrix(sp.tf),srcs=[];
  sc.traverse(o=>{if(o.isMesh&&o.geometry&&o.geometry.index!==undefined){const s=bakeMesh(o,F);s.name=o.name;srcs.push(s);}});
  // normalise materials
  const mats=new Set();srcs.forEach(s=>mats.add(s.mat));
  const br=(sp.cfg&&sp.cfg.bright)||1.25,ei=(sp.cfg&&sp.cfg.env)||1.4;
  // GLB з alphaMode BLEND ставить depthWrite=false; матеріали тут примусово непрозорі, тож глибину вони мають писати,
  // інакше результат залежить від порядку малювання (за id матеріалу) і ландшафт, створений пізніше, перемальовує гусениці та дрібні деталі.
  mats.forEach(m=>{if(m.color&&br!==1)m.color.multiplyScalar(br);m.envMap=scene.environment;m.envMapIntensity=ei;m.transparent=false;m.depthWrite=true;m.opacity=1;if(m.alphaMap)m.alphaMap=null;m.side=T.FrontSide;m.needsUpdate=true;if(m.map){m.map.anisotropy=4;}});
  // components and classification
  const rules=sp.rules.map(r=>[r[0],compileRule(r[1])]);
  const parts={};
  const add=(name,s,t)=>{(parts[name]=parts[name]||[]).push([s,t]);};
  srcs.forEach(s=>{
    const {face,bb}=compsOf(s.pos,s.ix);
    const cls=new Array(bb.length),meshn=s.name;
    for(let i=0;i<bb.length;i++){const b=bb[i];
      const c={mnx:b.mn[0],mny:b.mn[1],mnz:b.mn[2],mxx:b.mx[0],mxy:b.mx[1],mxz:b.mx[2],n:b.n,cx:(b.mn[0]+b.mx[0])/2,cy:(b.mn[1]+b.mx[1])/2,cz:(b.mn[2]+b.mx[2])/2,
        sx:b.mx[0]-b.mn[0],sy:b.mx[1]-b.mn[1],sz:b.mx[2]-b.mn[2],node:meshn,mesh:meshn};
      let k='body';for(const [nm,fn] of rules){if(fn(c,sw,has)){k=nm;break;}}cls[i]=k;}
    const lists={};for(let t=0;t<face.length;t++){const k=cls[face[t]];(lists[k]=lists[k]||[]).push(t);}
    for(const k in lists)add(k,s,lists[k]);
  });
  const m={sp,cfg:sp.cfg,srcs,parts,bbox:new T.Box3()};
  cache[sp.key]=m;return m;
}
// meshes of a part (list), optionally painted
function partMeshes(m,names,paint){
  const out=[];names=[].concat(names);
  names.forEach(n=>{(m.parts[n]||[]).forEach(([s,t])=>{
    let mat=s.mat;const pc=(paint&&paint[n])||((/^w\d+[lr]$/.test(n)&&m.cfg.wheelColor)||null);
    if(pc){const key='_p'+pc;mat=s[key]=s[key]||(()=>{const c=s.mat.clone();c.map=null;c.color=colorOf(pc);c.metalness=.15;c.roughness=.7;return c;})();}
    const me=subMesh(s,t,mat);me.userData.part=n;out.push(me);});});
  return out;
}
// a frame at model-space pivot p inside parent frame `parent`; content goes into .inner
function mkFrame(parent,p){const g=new T.Group();g.position.set(p[0],p[1],p[2]);const inner=new T.Group();inner.position.set(-p[0],-p[1],-p[2]);g.add(inner);parent.add(g);return {g,inner,p:V3(p)};}
function partBox(m,names){const b=new T.Box3(),v=new T.Vector3();[].concat(names).forEach(nm=>(m.parts[nm]||[]).forEach(([s,t])=>{for(let i=0;i<t.length;i++)for(let k=0;k<3;k++){const vi=s.ix[t[i]*3+k];v.set(s.pos[vi*3],s.pos[vi*3+1],s.pos[vi*3+2]);b.expandByPoint(v);}}));return b;}

/* ---------- landscape (photogrammetry strip, scrolls under the vehicle) ---------- */
const LAND={ready:false,g:new T.Group(),tiles:[],L:0,W:0,GW:96,GH:72,H:null,s:.2,u:0};world.add(LAND.g);
async function loadLand(){try{const g=await parseGLB(await fetchBuffer(LAND_URL));
  g.scene.updateMatrixWorld(true);let mesh=null;g.scene.traverse(o=>{if(o.isMesh)mesh=o;});if(!mesh)return;
  const geo=mesh.geometry.clone();
  for(const name of ['position','uv']){const at=geo.attributes[name];if(!at)continue;const n=at.itemSize,f=new Float32Array(at.count*n);for(let i=0;i<at.count;i++){f[i*n]=at.getX(i);if(n>1)f[i*n+1]=at.getY(i);if(n>2)f[i*n+2]=at.getZ(i);}geo.setAttribute(name,new T.BufferAttribute(f,n));}
  if(geo.attributes.normal)geo.deleteAttribute('normal');
  geo.applyMatrix4(mesh.matrixWorld);geo.scale(LAND.s,LAND.s*.45,LAND.s);
  geo.computeBoundingBox();const bb=geo.boundingBox,sz=bb.getSize(new T.Vector3());LAND.L=sz.x;LAND.W=sz.z;
  const pa=geo.attributes.position,GW=LAND.GW,GH=LAND.GH,sum=new Float32Array(GW*GH),cnt=new Uint16Array(GW*GH),v=new T.Vector3();
  for(let i=0;i<pa.count;i++){v.fromBufferAttribute(pa,i);const gx=clamp(((v.x-bb.min.x)/sz.x*GW)|0,0,GW-1),gz=clamp(((v.z-bb.min.z)/sz.z*GH)|0,0,GH-1);sum[gz*GW+gx]+=v.y;cnt[gz*GW+gx]++;}
  const H=new Float32Array(GW*GH);for(let i=0;i<H.length;i++)H[i]=cnt[i]?sum[i]/cnt[i]:NaN;
  for(let it=0;it<12;it++)for(let j=0;j<GH;j++)for(let i=0;i<GW;i++){const k=j*GW+i;if(!isNaN(H[k]))continue;let a=0,n=0;[[1,0],[-1,0],[0,1],[0,-1]].forEach(([di,dj])=>{const x=i+di,y=j+dj;if(x<0||y<0||x>=GW||y>=GH)return;const h=H[y*GW+x];if(!isNaN(h)){a+=h;n++;}});if(n)H[k]=a/n;}
  for(let i=0;i<H.length;i++)if(isNaN(H[i]))H[i]=0;LAND.H=H;LAND.bb=bb;
  const h0=hAt(0,0,true);LAND.y0=GY-h0;
  const mat=mesh.material;mat.side=T.FrontSide;if(mat.map){mat.map.colorSpace=T.SRGBColorSpace;mat.map.anisotropy=Math.min(8,R.capabilities.getMaxAnisotropy());}
  const base=new T.Mesh(geo,mat);
  for(let i=0;i<5;i++){const t=i?base.clone():base;LAND.g.add(t);LAND.tiles.push(t);}
  LAND.ready=true;placeTiles();}catch(e){console.warn('land',e);}}
function hAt(x,z,raw){if(!LAND.H)return GY;const bb=LAND.bb;const u=x-(raw?0:LAND.u);
  const L=LAND.L;const n=Math.floor((u-bb.min.x)/L);let lx=u-n*L;if(n%2)lx=bb.min.x+bb.max.x-lx;
  const fx=clamp((lx-bb.min.x)/L*(LAND.GW-1),0,LAND.GW-1.001),fz=clamp((z-bb.min.z)/LAND.W*(LAND.GH-1),0,LAND.GH-1.001);
  const i=fx|0,j=fz|0,a=fx-i,b=fz-j,H=LAND.H,GW=LAND.GW;
  const h=H[j*GW+i]*(1-a)*(1-b)+H[j*GW+i+1]*a*(1-b)+H[(j+1)*GW+i]*(1-a)*b+H[(j+1)*GW+i+1]*a*b;
  return h+(raw?0:LAND.y0);}
function placeTiles(){if(!LAND.ready)return;const L=LAND.L,bb=LAND.bb;const n0=Math.floor((-LAND.u-bb.min.x)/L)-2;
  LAND.tiles.forEach((t,k)=>{const n=n0+k;t.scale.x=n%2?-1:1;t.position.set(LAND.u+n*L+(n%2?(bb.min.x+bb.max.x):0),LAND.y0,0);});}

/* ---------- missiles and effects ---------- */
function makeMissile(sp){ // along +X, centred; nose at +L/2
  const L=sp.L,r=sp.r,g=new T.Group();
  const bodyC=new T.MeshStandardMaterial({color:sp.color||0xb8bcb4,metalness:.3,roughness:.5}),dark=new T.MeshStandardMaterial({color:0x2a2d28,metalness:.3,roughness:.6}),noseC=new T.MeshStandardMaterial({color:sp.nose||0x4e5744,metalness:.25,roughness:.6});
  const noseL=Math.max(r*4.2,L*.16),pts=[];
  const body=new T.Mesh(new T.CylinderGeometry(r,r,L-noseL-.05,20),bodyC);body.rotation.z=-PI/2;body.position.x=-L/2+.05+(L-noseL-.05)/2;g.add(body);
  for(let i=0;i<=12;i++){const f=i/12;pts.push(new T.Vector2(Math.max(.002,r*Math.sqrt(1-f*f*.97)*(1-f*.15)),f*noseL));}
  const nose=new T.Mesh(new T.LatheGeometry(pts,20),noseC);nose.rotation.z=-PI/2;nose.position.x=L/2-noseL;g.add(nose);
  const tail=new T.Mesh(new T.CylinderGeometry(r*.8,r,L*.07,18),dark);tail.rotation.z=-PI/2;tail.position.x=-L/2+L*.035;g.add(tail);
  const band=new T.Mesh(new T.CylinderGeometry(r*1.01,r*1.01,L*.04,20),dark);band.rotation.z=-PI/2;band.position.x=L/2-noseL-L*.06;g.add(band);
  const fl=Math.max(r*3.2,L*.11),fh=r*1.8;
  for(let i=0;i<4;i++){const fin=new T.Mesh(new T.BoxGeometry(fl,r*.12+.004,fh),dark);const h=new T.Group();h.rotation.x=i*PI/2+PI/4;fin.position.set(-L/2+fl*.5+.02,0,r+fh*.38);h.add(fin);g.add(h);}
  const cl=Math.max(r*2,L*.06);
  for(let i=0;i<4;i++){const fin=new T.Mesh(new T.BoxGeometry(cl,r*.1+.003,r*1.3),dark);const h=new T.Group();h.rotation.x=i*PI/2;fin.position.set(L/2-noseL-L*.1,0,r+r*.5);h.add(fin);g.add(h);}
  return g;}
const FX={rk:[],puffs:[],flashes:[],dust:[],deb:[],tr:[]};
const efx=new T.Group();world.add(efx);
const _v=new T.Vector3(),_w=new T.Vector3();
function dust(at,n,big,spread){for(let i=0;i<n;i++){const s=sprite(puffTex,0xb9ad8f,(big?2:1.2)+Math.random()*2.2);s.position.copy(at).add(new T.Vector3((Math.random()-.5)*spread,Math.random()*.6,(Math.random()-.5)*spread));efx.add(s);FX.dust.push({s,t:0,vy:.5+Math.random(),vx:(Math.random()-.5)*3,vz:(Math.random()-.5)*3,life:2.8+Math.random()*1.6});}}
function stepFX(dt){
  const g=9.8;
  FX.rk.forEach(k=>{k.t+=dt;k.life+=dt;const boost=k.t<k.sp.boost;
    if(boost){k.v+=(k.t<.4?k.sp.acc*.3:k.sp.acc)*dt;}else{k.flame.visible=false;k.v=Math.max(k.sp.vmin||60,k.v-dt*6);}
    // pitch over: turn towards the launch azimuth at the programmed elevation
    if(k.t>(k.sp.turnAt||.7)){const f=Math.min(1,dt*(k.sp.turn||.9));k.d.lerp(k.tgt,f).normalize();}
    k.m.position.addScaledVector(k.d,k.v*dt);k.m.quaternion.setFromUnitVectors(_v.set(1,0,0),k.d);
    if(k.flame.visible)k.flame.scale.setScalar(k.fs*(.8+Math.random()*.4));
    if(boost&&FX.puffs.length<220&&Math.random()<.8){const s=sprite(puffTex,0xe3e0d6,k.psz*(.9+Math.random()*.7));s.position.copy(k.m.position).addScaledVector(k.d,-k.sp.L/2-.8);efx.add(s);FX.puffs.push({s,t:0,life:2.4+Math.random()*2,vy:.35,grow:1.0});}
    const gy=hAt(k.m.position.x,k.m.position.z);
    if(k.m.position.y<gy||k.life>14||k.m.position.length()>(k.sp.range||240)){
      if(k.m.position.y<gy+1&&k.life<14){const fl=sprite(glowTex,0xffd08a,10,T.AdditiveBlending);fl.position.copy(k.m.position);fl.position.y=gy+1;efx.add(fl);FX.flashes.push({s:fl,t:0,life:.5});
        for(let i=0;i<10;i++){const s=sprite(puffTex,0x6b6558,2.5+Math.random()*3);s.position.copy(k.m.position).add(new T.Vector3((Math.random()-.5)*3,0,(Math.random()-.5)*3));s.position.y=gy+.5;efx.add(s);FX.dust.push({s,t:0,vy:1.5+Math.random()*2,vx:(Math.random()-.5)*3,vz:(Math.random()-.5)*3,life:3.5});}}
      efx.remove(k.m);k.dead=true;}});
  FX.rk=FX.rk.filter(k=>!k.dead);
  FX.tr.forEach(o=>{o.t+=dt;o.v.y-=1.8*dt;o.m.position.addScaledVector(o.v,dt);o.m.quaternion.setFromUnitVectors(_v.set(0,0,1),_w.copy(o.v).normalize());
    if(o.t>o.life||o.m.position.y<hAt(o.m.position.x,o.m.position.z)){efx.remove(o.m);o.dead=true;}});
  FX.tr=FX.tr.filter(o=>!o.dead);
  const age=(arr,fn)=>{arr.forEach(o=>{o.t+=dt;fn(o);if(o.t>o.life){efx.remove(o.s);o.dead=true;}});return arr.filter(o=>!o.dead);};
  FX.puffs=age(FX.puffs,o=>{const f=o.t/o.life;o.s.position.y+=o.vy*dt;o.s.scale.setScalar(o.s.scale.x+dt*(o.grow||1.2));o.s.material.opacity=.55*(1-f);});
  FX.dust=age(FX.dust,o=>{const f=o.t/o.life;o.s.position.x+=o.vx*dt;o.s.position.z+=o.vz*dt;o.s.position.y+=o.vy*dt;o.vy*=.96;o.s.scale.setScalar(o.s.scale.x+dt*2.5);o.s.material.opacity=.7*(1-f);});
  FX.flashes=age(FX.flashes,o=>{const f=o.t/o.life;o.s.material.opacity=1-f;o.s.scale.setScalar(o.s.scale.x*(1+dt*6));});
}
function clearFX(){[...FX.rk.map(k=>k.m),...FX.tr.map(o=>o.m),...FX.puffs.map(o=>o.s),...FX.dust.map(o=>o.s),...FX.flashes.map(o=>o.s)].forEach(o=>efx.remove(o));FX.rk=[];FX.puffs=[];FX.flashes=[];FX.dust=[];FX.tr=[];}
const tracerGeo=new T.BoxGeometry(.05,.05,1.1),tracerMat=new T.MeshBasicMaterial({color:0xffc66a,fog:false});

/* ---------- state ---------- */
let V=null,M=null,RIG=null;
const S={phase:1,speed:0,tSpeed:0,steer:0,dist:0,jack:0,jackT:0,lift:0,liftT:0,mast:0,mastT:0,elev:0,trav:0,ammo:0,firing:false,queue:0,fireT:0,wait:0,reload:0,reloadT:0,bounce:0,toast:'',toastT:0,recoil:0,follow:false,radar:true,burst:0,aimYaw:0,aimPitch:0};
const PH=[null,
 {n:'Стоянка',k:'1',on:()=>{S.tSpeed=0;S.jackT=0;S.liftT=0;S.mastT=0;},st:'Стоянка · двигун вимкнено'},
 {n:'Марш',k:'2',on:()=>{S.tSpeed=RIG&&RIG.cfg.speed?RIG.cfg.speed:14;S.jackT=0;S.liftT=0;S.mastT=0;},st:'Марш · {v} км/год'},
 {n:'Бойова позиція',k:'3',on:()=>{S.tSpeed=0;S.jackT=1;S.liftT=1;},st:'Бойова позиція'},
 {n:'Згортання',k:'4',on:()=>{S.tSpeed=0;S.liftT=0;S.jackT=0;S.mastT=0;},st:'Згортання'}];

/* ---------- rig construction (data driven, see specs) ---------- */
function buildRig(m){
  const cfg=m.cfg,root=new T.Group();if(cfg.scale)root.scale.setScalar(cfg.scale);const rig={m,cfg,root,wheels:[],steer:[],track:null,tubes:[],jacks:[],links:[],masts:[],extra:[]};
  const paint=cfg.paint||null;
  const used=new Set();
  const claim=(names)=>{[].concat(names).forEach(n=>used.add(n));};
  const body=mkFrame(root,[0,0,0]);rig.body=body;
  // wheels (parts w{axle}{l|r})
  if(cfg.wheels){const wc=cfg.wheels;
    wc.axles.forEach((ax,a)=>['l','r'].forEach(sd=>{const nm='w'+a+sd;if(!m.parts[nm])return;claim(nm);const box=partBox(m,nm),zc=(box.min.z+box.max.z)/2,yc=Array.isArray(wc.yc)?wc.yc[a]:wc.yc;
      const st=mkFrame(body.inner,[ax,yc,zc]),sp=mkFrame(st.inner,[ax,yc,zc]);partMeshes(m,nm,paint).forEach(me=>sp.inner.add(me));
      rig.wheels.push(sp.g);if(wc.steer&&wc.steer.includes(a))rig.steer.push({g:st.g,k:wc.steerK?wc.steerK[wc.steer.indexOf(a)]:1});}));}
  // tracks: road wheels + moving cleats
  if(cfg.track){const tc=cfg.track;
    if(tc.wheels)tc.wheels.forEach(w=>{const nm=w;if(!m.parts[nm])return;claim(nm);const box=partBox(m,nm),cc=box.getCenter(new T.Vector3());
      const sp=mkFrame(body.inner,[w.xc!==undefined?w.xc:cc.x,tc.yc?tc.yc:cc.y,cc.z]);partMeshes(m,nm,paint).forEach(me=>sp.inner.add(me));rig.wheels.push(sp.g);});
    if(tc.wheelRules){tc.wheelRules.forEach(nm=>{if(!m.parts[nm])return;claim(nm);const box=partBox(m,nm),cc=box.getCenter(new T.Vector3());
      const sp=mkFrame(body.inner,[cc.x,cc.y,cc.z]);partMeshes(m,nm,paint).forEach(me=>sp.inner.add(me));rig.wheels.push(sp.g);});}
    (tc.hide||[]).forEach(claim);rig.track=makeTrack(tc,body.inner);}
  if(cfg.crane){const c=cfg.crane;claim(c.part);const f=mkFrame(body.inner,c.pivot);partMeshes(m,c.part,paint).forEach(me=>f.inner.add(me));rig.craneF=f;}
  // cannon turret: turret -> (radar antenna, guns)
  if(cfg.cannon){const tu=mkFrame(body.inner,[0,0,0]);rig.turF=tu;(cfg.turretParts||[]).forEach(n=>{claim(n);partMeshes(m,n,paint).forEach(me=>tu.inner.add(me));});
    if(cfg.antenna){const an=cfg.antenna;an.parts.forEach(claim);const af=mkFrame(tu.inner,an.pivot);partMeshes(m,an.parts,paint).forEach(me=>af.inner.add(me));
      if(an.dish){claim(an.dish);af.spin=mkFrame(af.inner,an.spin);partMeshes(m,an.dish,paint).forEach(me=>af.spin.inner.add(me));}rig.antF=af;}
    const gp=cfg.gun;claim(gp.parts);rig.gunF=mkFrame(tu.inner,gp.pivot);partMeshes(m,gp.parts,paint).forEach(me=>rig.gunF.inner.add(me));}
  // launcher: yaw (optional) -> pitch about the hinge
  let yawF=null,parent=body.inner;
  if(cfg.yaw){yawF=mkFrame(body.inner,[cfg.yaw.pivot[0],0,cfg.yaw.pivot[1]]);parent=yawF.inner;(cfg.yaw.parts||[]).forEach(n=>{claim(n);partMeshes(m,n,paint).forEach(me=>yawF.inner.add(me));});}
  rig.yaw=yawF;rig.yawInner=parent;
  if(cfg.launcher){const lc=cfg.launcher;lc.parts.forEach(claim);
    const pf=mkFrame(parent,lc.pivot);partMeshes(m,lc.parts,paint).forEach(me=>pf.inner.add(me));rig.pitch=pf;
    (cfg.tubes||[]).forEach(t=>rig.tubes.push(V3(t)));
    rig.loaded=[];(cfg.loaded||[]).forEach((names,k)=>{claim(names);const arr=partMeshes(m,names,paint);arr.forEach(me=>pf.inner.add(me));rig.loaded[k]=arr;});}
  // hydraulic links: base fixed in `parent`, top rides on the launcher
  (cfg.links||[]).forEach(L=>{claim(L.part);const A=V3(L.A),B=V3(L.B),d0=B.clone().sub(A),len0=d0.length();d0.normalize();
    const g=new T.Group();g.position.copy(A);const sc=new T.Group();g.add(sc);const rot=new T.Group();sc.add(rot);rot.quaternion.setFromUnitVectors(d0,new T.Vector3(0,1,0));
    const inner=new T.Group();inner.position.copy(A).negate();rot.add(inner);partMeshes(m,L.part,paint).forEach(me=>inner.add(me));
    (L.to==='yaw'?parent:parent).add(g);rig.links.push({g,sc,A,B,len0,d0});});
  // masts: slide down / telescope
  (cfg.masts||[]).forEach(mc=>{claim(mc.part);const f=mkFrame(mc.inYaw?rig.yawInner:body.inner,mc.pivot||[0,0,0]);partMeshes(m,mc.part,paint).forEach(me=>f.inner.add(me));rig.masts.push({f,mc});
    if(mc.spin){f.spinF=mkFrame(f.inner,mc.spin);}});
  // radar head on a mast
  if(cfg.radar){const rc=cfg.radar;claim(rc.part);const pf=mkFrame(body.inner,rc.pivot);partMeshes(m,rc.part,paint).forEach(me=>pf.inner.add(me));rig.radar={f:pf,rc};}
  // procedural stabiliser jacks
  (cfg.jacks||[]).forEach(j=>{const g=new T.Group();g.position.set(j[0],j[1],j[2]);body.inner.add(g);
    const sz=j[3]||1,bd=new T.Mesh(new T.CylinderGeometry(.13*sz,.13*sz,.7*sz,16),steelMat);bd.position.y=-.2*sz;g.add(bd);
    const rod=new T.Mesh(new T.CylinderGeometry(.08*sz,.08*sz,1,14),rodMat);g.add(rod);
    const pad=new T.Mesh(new T.CylinderGeometry(.3*sz,.34*sz,.1,20),padMat);g.add(pad);rig.jacks.push({g,rod,pad,sz,h:j[4]||1.2});});
  // jack parts (modelled legs that slide up when stowed)
  (cfg.jackParts||[]).forEach(jp=>{claim(jp.part);const f=mkFrame(body.inner,jp.pivot||[0,0,0]);partMeshes(m,jp.part,paint).forEach(me=>f.inner.add(me));rig.extra.push({f,kind:'jack',dy:jp.dy,ang:jp.ang||0});});
  // special mechanisms
  (cfg.special||[]).forEach(sp=>{(sp.parts||[]).forEach(claim);});
  // whatever is left is the hull
  const rest=Object.keys(m.parts).filter(n=>!used.has(n)&&!(cfg.special||[]).some(sp=>(sp.parts||[]).includes(n)));
  rig.rest=rest;
  return rig;
}
function makeTrack(tc,parent){
  // stadium loop (x0..x1 centres, radius r) around y-centre; cleats are instanced
  const g=new T.Group();parent.add(g);const out={g,sides:[],tc};
  const r=(tc.y1-tc.y0)/2,yc=(tc.y0+tc.y1)/2,Lc=tc.x1-tc.x0,per=2*Lc+2*PI*r,N=Math.round(per/(tc.pitch||.17));
  const geo=new T.BoxGeometry(tc.pitch?tc.pitch*.8:.1,.045,tc.w);
  [-1,1].forEach(sg=>{const im=new T.InstancedMesh(geo,rubberMat,N);im.frustumCulled=false;g.add(im);out.sides.push({im,sg});});
  out.N=N;out.per=per;out.r=r;out.yc=yc;out.Lc=Lc;out.pos=new Float32Array(N*4);
  const d=new T.Object3D();
  out.update=(s)=>{ // s in metres of track travel
    for(let i=0;i<N;i++){let u=((i/N)*per+s)%per;if(u<0)u+=per;let x,y,a; // a = tangent angle
      if(u<Lc){x=tc.x0+u;y=yc-r;a=0;}                                    // bottom run, moving +x
      else if(u<Lc+PI*r){const t=(u-Lc)/r;x=tc.x1+Math.sin(t)*r;y=yc-Math.cos(t)*r;a=t;}
      else if(u<2*Lc+PI*r){x=tc.x1-(u-Lc-PI*r);y=yc+r;a=PI;}
      else{const t=(u-2*Lc-PI*r)/r;x=tc.x0-Math.sin(t)*r;y=yc+Math.cos(t)*r;a=PI+t;}
      d.position.set(x,y,0);d.rotation.set(0,0,a);d.updateMatrix();
      out.sides.forEach(sd=>{const mm=d.matrix.clone();mm.elements[14]=sd.sg*tc.zc;sd.im.setMatrixAt(i,mm);});}
    out.sides.forEach(sd=>sd.im.instanceMatrix.needsUpdate=true);};
  out.update(0);return out;
}

/* ---------- vehicle switch ---------- */
let switching=false;
const CHIPS={};
async function selectVehicle(key){
  if(switching||(M&&V&&V.key===key))return;switching=true;const sp=SPECS[key];$('#load').hidden=false;$('#load').textContent='Завантаження моделі';
  try{
    const m=await buildModel(sp);
    if(RIG){truck.remove(RIG.root);}
    clearFX();kubClear();M=m;V=sp;
    RIG=buildRig(m);truck.add(RIG.root);
    window.__RIGOBJ=RIG;
    RIG.apply&&RIG.apply();
    RIG.finish&&RIG.finish();
    finishRig(RIG);
    Object.assign(S,{toastT:0,phase:1,speed:0,tSpeed:0,jack:0,jackT:0,lift:0,liftT:0,mast:0,mastT:0,elev:sp.cfg.launcher?(sp.cfg.launcher.elev0||sp.cfg.launcher.psi0):0,ammo:(sp.cfg.tubes||[]).length||sp.cfg.ammo||0,queue:0,wait:0,reload:0,recoil:0,aimYaw:0,aimPitch:0,burst:0,trav:0});
    RIG.psiD=S.elev;
    $('#title').textContent=sp.cfg.name;$('#dims').textContent=sp.cfg.dims;$('#cv').setAttribute('aria-label','Тривимірна модель: '+sp.cfg.name);
    fillInfo(sp);
    const c=sp.cfg.cam;cam.position.set(...c.p);ctl.target.set(...c.t);
    buildChips();setPhase(1);applyAmmo();$('#load').hidden=true;
  }catch(e){console.error(e);$('#load').textContent='Не вдалося завантажити модель';window.__err=String(e&&e.stack||e);}
  switching=false;}
function finishRig(rig){ // add the remaining hull meshes
  const m=rig.m,paint=rig.cfg.paint||null;
  rig.rest.forEach(n=>partMeshes(m,n,paint).forEach(me=>rig.body.inner.add(me)));
}
function fillInfo(sp){const c=sp.cfg;
  $('#i-name').textContent=c.name;$('#i-role').textContent=c.role;
  $('#i-desc').innerHTML=c.desc.map(p=>'<p>'+p+'</p>').join('');
  $('#i-facts').innerHTML=c.facts.map(f=>'<div><dt>'+f[0]+'</dt><dd>'+f[1]+'</dd></div>').join('');
  $('#i-anim').innerHTML=c.anim.map(a=>'<li>'+a+'</li>').join('');
  $('#i-cred').innerHTML=creditHtml('ppo/'+sp.model);
}

/* ---------- poses ---------- */
const _qa=new T.Vector3();
function poseRig(dt){
  const rig=RIG,cfg=rig.cfg;
  // wheels and steering
  const wr=cfg.wheels?cfg.wheels.R*(cfg.scale||1):0;
  if(rig.wheels.length&&cfg.wheels){rig.wheels.forEach(h=>h.rotation.z=-S.dist/wr);}
  if(rig.wheels.length&&cfg.track){rig.wheels.forEach(h=>h.rotation.z=-S.dist/((cfg.track.wr||.3)*(cfg.scale||1)));}
  rig.steer.forEach(s=>s.g.rotation.y=S.steer*D2R*s.k);
  if(rig.track)rig.track.update(S.dist/(cfg.scale||1));
  // jacks (procedural): extend to the ground
  const jp=smooth(S.jack);
  rig.jacks.forEach(j=>{const L=.3*j.sz+j.h*jp;j.rod.scale.y=L;j.rod.position.y=-.1*j.sz-L/2;j.pad.position.y=-.1*j.sz-L;});
  rig.extra.forEach(e=>{if(e.kind==='jack'){e.f.g.position.y=e.f.p.y+e.dy*(1-jp);if(e.ang)e.f.g.rotation.x=e.ang*D2R*(1-jp);}});
  // yaw / pitch
  const ls=smooth(S.lift);
  if(rig.yaw){rig.yaw.g.rotation.y=S.trav*D2R*ls;}
  if(rig.pitch){const lc=cfg.launcher;const e=lc.psiS+(S.elev-lc.psiS)*ls;rig.pitch.g.rotation.z=(e-lc.psi0)*D2R-(S.recoil*Math.sin(S.recoil*22)*.004);
    rig.pitch.g.position.y=rig.pitch.p.y+(lc.liftY||0)*(1-ls);rig.pitch.g.position.x=rig.pitch.p.x+(lc.liftX||0)*(1-ls);}
  // links
  if(rig.links.length){rig.body.g.updateMatrixWorld(true);
    rig.links.forEach(l=>{const parent=l.g.parent;parent.updateWorldMatrix(true,false);
      _qa.copy(l.B);rig.pitch.inner.localToWorld(_qa);parent.worldToLocal(_qa); // B in parent frame
      const d=_qa.sub(l.A);const len=d.length();d.normalize();
      l.g.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),d);l.sc.scale.set(1,len/l.len0,1);});}
  // masts
  const mp=smooth(S.mast);
  rig.masts.forEach(ms=>{const mc=ms.mc;if(mc.dy!==undefined)ms.f.g.position.y=ms.f.p.y+mc.dy*(1-mp);if(mc.k0!==undefined)ms.f.g.scale.y=mc.k0+(1-mc.k0)*mp;
    if(mc.spin&&ms.f.spinF)ms.f.spinF.g.rotation.y+=dt*mc.rps*mp;});
  if(rig.radar){const rc=rig.radar.rc;const hm=rig.masts[rc.mast];if(hm){const k=hm.f.g.scale.y;rig.radar.f.g.position.y=rig.radar.f.p.y+(rc.pivot[1]-hm.f.p.y)*(k-1);}rig.radar.f.g.rotation.y+=dt*rc.rps*smooth(S.mast)*(S.radar?1:0);if(rc.tilt)rig.radar.f.g.rotation.z=rc.tilt*D2R*(1-mp);}
  if(rig.loaded&&rig.loaded.length){const n=rig.tubes.length,fired=n-S.ammo,ord=cfg.order;rig.loaded.forEach((arr,k)=>{const pos=ord?ord.indexOf(k):k;const vis=pos>=fired;arr.forEach(me=>{me.visible=vis;});});}
  RIGX.pose&&RIGX.pose(rig,dt);
}
const RIGX={};

/* ---------- firing ---------- */
function tubeWorld(k){const rig=RIG;const p=rig.tubes[k].clone();rig.pitch.inner.updateWorldMatrix(true,false);rig.pitch.inner.localToWorld(p);
  const lc=rig.cfg.launcher,d=new T.Vector3(Math.cos(lc.psi0*D2R),Math.sin(lc.psi0*D2R),0).transformDirection(rig.pitch.inner.matrixWorld).normalize();return {p,d};}
function canFire(){return RIG&&RIG.cfg.launcher&&S.phase===3&&!S.reload&&S.lift>.97&&S.ammo>0&&!S.wait;}
function launch(){
  const rig=RIG,cfg=rig.cfg,sp=cfg.missile,n=rig.tubes.length,idx=n-S.ammo,order=cfg.order,k=order?order[idx]:idx;S.ammo--;applyAmmo();
  const {p,d}=tubeWorld(k);
  const r=makeMissile(sp);r.position.copy(p).addScaledVector(d,-sp.L*.15);r.quaternion.setFromUnitVectors(new T.Vector3(1,0,0),d);
  const flame=sprite(glowTex,0xffc477,sp.flame||3,T.AdditiveBlending);flame.position.x=-sp.L/2-(sp.flame||3)*.35;r.add(flame);efx.add(r);
  // programmed turn towards the launch azimuth, then a shallow climb
  const az=new T.Vector3(1,0,0);az.applyAxisAngle(new T.Vector3(0,1,0),(rig.yaw?rig.yaw.g.rotation.y:0)+(cfg.launchYaw||0)*D2R);
  const tgt=new T.Vector3(az.x*Math.cos(sp.climb*D2R),Math.sin(sp.climb*D2R),az.z*Math.cos(sp.climb*D2R)).normalize();
  FX.rk.push({m:r,d:d.clone(),tgt,v:sp.v0||4,t:0,flame,life:0,sp,fs:sp.flame||3,psz:sp.smoke||1.1});
  S.recoil=1;S.toast='Пуск · '+cfg.short+' · ракета '+(idx+1)+' з '+n;S.toastT=1.6;
  const fl=sprite(glowTex,0xffe3b0,(sp.flame||3)*2.4,T.AdditiveBlending);fl.position.copy(p).addScaledVector(d,.3);efx.add(fl);FX.flashes.push({s:fl,t:0,life:.3});
  // hot launch: smoke boils out of the canister and a dust cloud rises at the base
  for(let i=0;i<(sp.puffs||8);i++){const s=sprite(puffTex,0xe3ddd0,1.5+Math.random()*2);s.position.copy(p).add(new T.Vector3((Math.random()-.5)*1.6,(Math.random()-.5)*1.6,(Math.random()-.5)*1.6));efx.add(s);FX.puffs.push({s,t:0,life:2.2+Math.random()*1.5,vy:.7,grow:1.7});}
  const base=new T.Vector3();rig.pitch.g.getWorldPosition(base);const gr=base.clone();gr.y=hAt(base.x,base.z)+.4;dust(gr,sp.dust||10,true,sp.dustSpread||5);
  return true;}
function fireOne(){if(!canFire())return false;if(RIG.cfg.shilka)return false;return launch();}

/* ---------- Shilka-type cannon ---------- */
const cannon={t:0,k:0};
function cannonStep(dt){const rig=RIG,c=rig.cfg.cannon;if(!c)return;
  if(S.burst>0){S.burst-=dt;cannon.t-=dt;
    while(cannon.t<=0){cannon.t+=1/c.rate;const mz=c.muzzles[cannon.k%c.muzzles.length];cannon.k++;
      const p=new T.Vector3(mz[0],mz[1],mz[2]);rig.gunF.inner.updateWorldMatrix(true,false);rig.gunF.inner.localToWorld(p);
      const d=new T.Vector3(1,0,0).transformDirection(rig.gunF.inner.matrixWorld).normalize();
      const m=new T.Mesh(tracerGeo,tracerMat);m.position.copy(p);efx.add(m);
      const sp=new T.Vector3().copy(d).add(new T.Vector3((Math.random()-.5)*.012,(Math.random()-.5)*.012,(Math.random()-.5)*.012)).normalize().multiplyScalar(c.v);
      FX.tr.push({m,v:sp,t:0,life:1.1});
      const fl=sprite(glowTex,0xffcf8a,.9,T.AdditiveBlending);fl.position.copy(p).addScaledVector(d,.25);efx.add(fl);FX.flashes.push({s:fl,t:0,life:.07});
      if(Math.random()<.35){const s=sprite(puffTex,0xcfcabd,.7+Math.random()*.6);s.position.copy(p).addScaledVector(d,.4);efx.add(s);FX.puffs.push({s,t:0,life:1.4,vy:.3,grow:1.4});}
      S.recoil=1;}
    if(S.burst<=0){S.toast='Черга завершена';S.toastT=1;}}
}

/* ---------- ammo / chips ---------- */
function applyAmmo(){const n=RIG&&RIG.cfg.kub?(RIG.cfg.ammo||3):(RIG&&RIG.tubes?RIG.tubes.length:0);const a=$('#ammo');a.innerHTML='';
  const cols=RIG&&RIG.cfg.ammoCols||0;a.style.display=n?'flex':'none';
  for(let i=0;i<n;i++){const order=RIG.cfg.order,k=order?order.indexOf(i):i;const d=document.createElement('i');const idx=order?order.indexOf(i):i;d.className=(i>=n-S.ammo?'on':'');d.style.order=i;a.appendChild(d);}
  updateChips();}
function chip(row,label,key,on){const b=document.createElement('button');b.className='chip';b.type='button';b.innerHTML=(key?`<kbd>${key}</kbd>`:'')+`<span>${label}</span>`;b.onclick=on;$(row).appendChild(b);return b;}
const CH={};
const HOLD={up:0,dn:0,lf:0,rt:0};
function holdChip(row,label,key,hk){const b=chip(row,label,key,()=>{});b.onclick=null;
  let t0=0;const on=e=>{if(e)e.preventDefault();if(!aimOK())return;HOLD[hk]=1;t0=performance.now();};
  const off=()=>{const d=260-(performance.now()-t0);if(HOLD[hk]&&d>0)setTimeout(()=>{HOLD[hk]=0;},d);else HOLD[hk]=0;};
  b.addEventListener('pointerdown',on);['pointerup','pointercancel','pointerleave','blur'].forEach(ev=>b.addEventListener(ev,off));
  b.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' ')on(e);});b.addEventListener('keyup',off);
  b.style.touchAction='none';return b;}
const aimOK=()=>RIG&&S.phase===3&&!S.reload&&S.lift>.5;
function buildChips(){
  ['#rowP','#rowL','#rowW'].forEach(r=>$(r).innerHTML='');
  PH.forEach((p,i)=>{if(!p)return;CH['p'+i]=chip('#rowP',p.n,p.k,()=>setPhase(i));});
  CH.up=holdChip('#rowL','Підняти','↑','up');CH.dn=holdChip('#rowL','Опустити','↓','dn');CH.lf=holdChip('#rowL','Вліво','←','lf');CH.rt=holdChip('#rowL','Вправо','→','rt');
  CH.fire=chip('#rowW',RIG.cfg.cannon?'Черга':'Пуск','X',()=>{doFire();});
  CH.salvo=chip('#rowW',RIG.cfg.cannon?'Довга черга':'Залп','Z',()=>{doSalvo();});
  CH.rel=chip('#rowW','Перезарядити','H',()=>startReload());
  CH.radar=chip('#rowW','РЛС','G',()=>{S.radar=!S.radar;updateChips();});
  CH.follow=chip('#rowW','Стежити за ракетою','C',()=>{S.follow=!S.follow;CH.follow.classList.toggle('on',S.follow);});
  CH.mast=null;
  const rv=$('#rowV');
  if(!rv.children.length){Object.keys(SPECS).forEach((k,i)=>{CH['v'+k]=chip('#rowV',SPECS[k].cfg.short,'',()=>selectVehicle(k));});}
  const noMarch=RIG.cfg.noMarch;CH.p2.style.display=noMarch?'none':'';
  CH.lf.style.display=CH.rt.style.display=(RIG.cfg.yaw||RIG.cfg.cannon)?'':'none';
  CH.rel.style.display=RIG.cfg.cannon?'none':'';
  CH.fire.style.display=CH.salvo.style.display=(RIG.cfg.launcher||RIG.cfg.cannon)?'':'none';
  CH.follow.style.display=RIG.cfg.launcher?'':'none';
  CH.radar.style.display=(RIG.radar||RIG.cfg.antenna)?'':'none';
  const sp=RIG.cfg.special&&RIG.cfg.special.find(s=>s.kind==='crane');
  if(RIG.cfg.kub){CH.fire.firstChild.nextSibling.textContent='Передати ракету';CH.salvo.firstChild.nextSibling.textContent='Усі три';CH.fire.style.display=CH.salvo.style.display='';CH.rel.firstChild.nextSibling.textContent='Повернути ракети';CH.rel.style.display='';CH.up.style.display=CH.dn.style.display='none';}
  else{CH.up.style.display=CH.dn.style.display=((RIG.cfg.launcher&&!RIG.cfg.launcher.fixed)||RIG.cfg.cannon)?'':'none';}
  if(RIG.cfg.noAimRow)$('#rowL').parentElement.style.display='none';else $('#rowL').parentElement.style.display='';
  updateChips();}
function doFire(){
  if(RIG.cfg.cannon){if(S.phase===3&&S.lift>.9&&S.burst<=0){S.burst=1.4;cannon.t=0;}return;}
  if(RIG.cfg.kub){kubTransfer(1);return;}
  if(canFire())fireOne();}
function doSalvo(){
  if(RIG.cfg.cannon){if(S.phase===3&&S.lift>.9){S.burst=4.2;cannon.t=0;}return;}
  if(RIG.cfg.kub){kubTransfer(3);return;}
  if(canFire()){S.queue=S.ammo;S.fireT=0;}}
function startReload(){if(!RIG)return;
  if(RIG.cfg.kub){kubReset();return;}
  if(S.reload||S.ammo>=RIG.tubes.length||S.wait)return;
  if(S.phase!==3)setPhase(3);S.queue=0;S.reload=1;S.reloadT=0;S.liftT=0;updateChips();}
function setPhase(i){if(S.reload)return;if(i===2&&RIG&&RIG.cfg.noMarch)return;S.phase=i;PH[i].on();S.queue=0;
  if(i===3){S.mastT=0;S.mastWait=true;}
  updateChips();}
function updateChips(){if(!RIG)return;for(let i=1;i<PH.length;i++)if(CH['p'+i])CH['p'+i].classList.toggle('on',S.phase===i);
  const pos=aimOK();CH.up.classList.toggle('lock',!pos);CH.dn.classList.toggle('lock',!pos);CH.lf.classList.toggle('lock',!pos);CH.rt.classList.toggle('lock',!pos);
  const cf=RIG.cfg.cannon?(S.phase===3&&S.lift>.9&&S.burst<=0):canFire();
  CH.fire.classList.toggle('lock',RIG.cfg.kub?(S.phase!==3||S.lift<.97||S.kubBusy):!cf);CH.salvo.classList.toggle('lock',RIG.cfg.kub?(S.phase!==3||S.lift<.97||S.kubBusy):(!cf||(RIG.tubes.length<2&&!RIG.cfg.cannon)));
  CH.rel.classList.toggle('lock',RIG.cfg.kub?false:(S.ammo>=RIG.tubes.length||!!S.reload));CH.rel.classList.toggle('on',!!S.reload);
  CH.radar.classList.toggle('on',S.radar);
  Object.keys(SPECS).forEach(k=>{if(CH['v'+k])CH['v'+k].classList.toggle('on',V&&V.key===k);});}
addEventListener('keydown',e=>{if(e.target.tagName==='INPUT')return;const k=e.key,c=e.code;if(!RIG)return;
  if(c==='Digit1')setPhase(1);else if(c==='Digit2')setPhase(2);else if(c==='Digit3')setPhase(3);else if(c==='Digit4')setPhase(4);
  else if(k==='ArrowUp'||k==='ArrowDown'||k==='ArrowLeft'||k==='ArrowRight'){e.preventDefault();if(aimOK())HOLD[{ArrowUp:'up',ArrowDown:'dn',ArrowLeft:'lf',ArrowRight:'rt'}[k]]=1;}
  else if(c==='KeyX')CH.fire.click();else if(c==='KeyZ')CH.salvo.click();else if(c==='KeyH')CH.rel.click();else if(c==='KeyC')CH.follow.click();else if(c==='KeyG')CH.radar.click();});
addEventListener('keyup',e=>{const m={ArrowUp:'up',ArrowDown:'dn',ArrowLeft:'lf',ArrowRight:'rt'}[e.key];if(m)HOLD[m]=0;});
addEventListener('blur',()=>{HOLD.up=HOLD.dn=HOLD.lf=HOLD.rt=0;});

/* ---------- frame ---------- */
function resize(){const w=stage.clientWidth,h=stage.clientHeight;R.setSize(w,h,false);cam.aspect=w/h;cam.updateProjectionMatrix();}
new ResizeObserver(resize).observe(stage);resize();
const clock=makeClock();const st=$('#status');
function loop(){if(!window.__paused)requestAnimationFrame(loop);frame(Math.min(.05,clock.getDelta()));}
const RL_T=6;
function frame(dt,nr){
  const stowed0=!RIG||(S.lift<.02&&S.jack<.02&&S.mast<.02);
  S.speed=ease(S.speed,(S.tSpeed>0&&!stowed0)?0:S.tSpeed,S.tSpeed>S.speed?.6:1.2,dt);const v=S.speed;
  S.dist+=v*dt;LAND.u-=v*dt;placeTiles();
  if(RIG){
    const cfg=RIG.cfg,dr=cfg.drive;
    if(dr){
      S.steer=ease(S.steer,v>2?Math.sin(S.dist*.08)*6:0,2,dt);
      const K=cfg.scale||1,AF=dr.axF*K,AR=dr.axR*K,TR=dr.tr*K;
      const hfl=hAt(AF,TR),hfr=hAt(AF,-TR),hrl=hAt(AR,TR),hrr=hAt(AR,-TR),hf=(hfl+hfr)/2,hr=(hrl+hrr)/2,hy=((hf+hr)/2*.5+Math.min(hfl,hfr,hrl,hrr)*.5)+(dr.dy!==undefined?dr.dy:-.07),pitch=Math.atan2(hf-hr,AF-AR),roll=Math.atan(((hfr+hrr)-(hfl+hrl))/2/(2*TR));
      S.bounce=v>1?Math.sin(S.dist*1.7)*.016+Math.sin(S.dist*4.3)*.006:S.bounce*.9;
      truck.position.y=ease(truck.position.y,hy+S.bounce,6,dt);truck.rotation.z=ease(truck.rotation.z,pitch*.9,6,dt);
      truck.rotation.x=ease(truck.rotation.x,roll*.9+(v>1?Math.sin(S.dist*1.1)*.006:0),4,dt);
    }else{
      const h=hAt(0,0);truck.position.y=ease(truck.position.y,h,6,dt);truck.rotation.z=ease(truck.rotation.z,0,6,dt);truck.rotation.x=ease(truck.rotation.x,0,6,dt);}
    // deploy order: jacks, then launcher, then masts; stowing runs backwards
    const dep=S.phase===3||S.reload;
    if(dep){if(S.jackT>0)S.jack+=clamp(1-S.jack,-dt/2.2,dt/2.2);}
    else if(S.lift<.02&&S.mast<.02)S.jack+=clamp(0-S.jack,-dt/2.2,dt/2.2);
    const canLift=S.jack>.97||S.liftT===0;
    const lt=cfg.launcher?cfg.launcher.time:(cfg.liftTime||4);
    if(canLift)S.lift+=clamp(S.liftT-S.lift,-dt/lt,dt/lt);
    // masts follow the launcher: extend once it is up, retract before it goes down
    if(S.phase===3&&!S.reload){S.mastT=(S.lift>.6)?1:0;}
    else if(S.reload)S.mastT=0;
    if(S.phase!==3)S.mastT=0;
    const mt=cfg.mastTime||4;S.mast+=clamp(S.mastT-S.mast,-dt/mt,dt/mt);
    if(cfg.mastBlocksLift&&S.mast>.02&&S.liftT===0){/* lift waits for the mast to retract */}
    // aiming
    if(!aimOK())HOLD.up=HOLD.dn=HOLD.lf=HOLD.rt=0;
    const lc=cfg.launcher;
    if(lc){const dE=HOLD.up-HOLD.dn;if(dE){S.elev=clamp(S.elev+dE*dt*16,lc.psiMin,lc.psiMax);}
      const dT=cfg.yaw?HOLD.lf-HOLD.rt:0;if(dT){S.trav=clamp(S.trav+dT*dt*22,-cfg.yaw.max,cfg.yaw.max);}}
    S.recoil=Math.max(0,S.recoil-dt*3);
    // reload (simplified): launcher down, pause, up again
    if(S.reload===1&&S.lift<.02){S.reload=2;S.reloadT=0;}
    else if(S.reload===2){S.reloadT+=dt;if(S.reloadT>RL_T){S.reload=3;S.ammo=RIG.tubes.length;S.liftT=1;applyAmmo();S.toast='Контейнери замінено · '+S.ammo+' ракет';S.toastT=2.5;}}
    else if(S.reload===3&&S.lift>.97){S.reload=0;updateChips();}
    if(RIG.cfg.shilka)shilkaPose(dt);
    if(RIG.cfg.kub)kubPose(dt);
    poseRig(dt);
    if(S.queue>0){S.fireT-=dt;if(S.fireT<=0){if(fireOne())S.fireT=.6;S.queue--;if(S.ammo<=0)S.queue=0;}}
    cannonStep(dt);
    stepFX(dt);
  }
  const tgt=FX.rk.length&&S.follow?FX.rk[0].m.position:null;
  if(tgt){_w.copy(tgt).sub(ctl.target).multiplyScalar(1-Math.exp(-4*dt));ctl.target.add(_w);cam.position.add(_w);}
  else if(S.follow&&RIG&&ctl.target.distanceTo(new T.Vector3(...V.cfg.cam.t))>.5){_w.set(...V.cfg.cam.t).sub(ctl.target).multiplyScalar(1-Math.exp(-2*dt));ctl.target.add(_w);cam.position.add(_w);}
  S.toastT-=dt;const ph=PH[S.phase];let text=S.toastT>0?S.toast:ph.st.replace('{v}',Math.round(S.speed*3.6));
  if(RIG&&S.toastT<=0){const cfg=RIG.cfg,l=S.lift;
    if(S.reload===1)text='Перезарядження · пускова опускається';else if(S.reload===2)text='Перезарядження · контейнери замінюються';else if(S.reload===3)text='Перезарядження · пускова піднімається';
    else if(S.phase===3){if(S.jack<.97&&cfg.jacks&&cfg.jacks.length)text='Бойова позиція · опори опускаються';else if(l<.97)text='Бойова позиція · '+cfg.liftText;else if(S.mast<.97&&(RIG.masts.length||RIG.radar))text='Бойова позиція · '+cfg.mastText;
      else text=cfg.cannon?('Бойова позиція · РЛС '+(S.radar?'працює':'вимкнена')+(S.burst>0?' · вогонь':'')):('Бойова позиція · готовність'+(RIG.tubes.length?' · ракет '+S.ammo:''));}
    else if(S.phase!==3&&(S.lift>.02||S.jack>.02||S.mast>.02))text='Згортання · '+(S.mast>.02?cfg.mastText2:(S.lift>.02?cfg.liftText2:'опори піднімаються'));}
  if(st.textContent!==text)st.textContent=text;st.classList.toggle('toast',S.toastT>0&&!S.reload);
  if(RIG&&((S._p!==S.phase)||(S._a!==S.ammo)||(S._e!==(S.lift>.97))||(S._r!==S.reload)||(S._b!==(S.burst>0)))){S._p=S.phase;S._a=S.ammo;S._e=S.lift>.97;S._r=S.reload;S._b=S.burst>0;updateChips();applyAmmo();}
  ctl.update();if(!nr)R.render(scene,cam);
}
/* ---------- model specific poses ---------- */
function shilkaPose(dt){
  const rig=RIG,cfg=rig.cfg,ls=smooth(S.lift);
  // turret and guns
  if(!rig.turF){return;}
  const dT=HOLD.lf-HOLD.rt;if(dT)S.aimYaw=clamp(S.aimYaw+dT*dt*40*D2R,-PI,PI);
  const dE=HOLD.up-HOLD.dn;if(dE)S.aimPitch=clamp(S.aimPitch+dE*dt*30*D2R,-4*D2R,85*D2R);
  if(S.phase!==3){S.aimYaw=ease(S.aimYaw,0,2,dt);S.aimPitch=ease(S.aimPitch,0,2,dt);}
  rig.turF.g.rotation.y=S.aimYaw;rig.gunF.g.rotation.z=S.aimPitch;
  rig.gunF.g.position.x=rig.gunF.p.x-S.recoil*.05*(S.burst>0?1:0);
  // antenna folds back when stowed and scans when raised
  if(rig.antF){const a=cfg.antenna;rig.antF.g.rotation.z=a.foldDeg*D2R*(1-ls);if(rig.antF.spin)rig.antF.spin.g.rotation.y+=dt*a.rps*ls*(S.radar?1:0);}
}
const KUB={car:null,placed:[],t:0,active:false,q:0,slot:0,T:8};
function kubClear(){KUB.placed.forEach(m=>efx.remove(m));KUB.placed=[];KUB.slot=0;KUB.car=null;KUB.active=false;KUB.q=0;S.kubBusy=false;}
function kubStart(){KUB.active=true;KUB.t=0;S.kubBusy=true;KUB.car=makeMissile(RIG.cfg.missile);RIG.root.add(KUB.car);}
function kubTransfer(n){if(!RIG||!RIG.cfg.kub||S.phase!==3||S.lift<.97||KUB.active||S.ammo<=0)return;KUB.q=Math.min(n,S.ammo);kubStart();updateChips();}
function kubReset(){if(!RIG||KUB.active)return;const had=KUB.placed.length;kubClear();S.ammo=RIG.cfg.ammo||3;applyAmmo();if(had){S.toast='Ракети повернуто на пакет';S.toastT=2;}}
function kubPose(dt){const rig=RIG,cf=rig.craneF;if(!cf)return;const c=rig.cfg.crane;
  if(S.speed>1&&KUB.placed.length&&!KUB.active)kubReset();
  if(!KUB.active){cf.g.rotation.y=ease(cf.g.rotation.y,0,3,dt);return;}
  KUB.t+=dt;const u=KUB.t/KUB.T;
  const sw=smooth(Math.min(1,u/.38))*(1-smooth(clamp((u-.74)/.26,0,1)));
  cf.g.rotation.y=sw*c.swing*D2R;cf.g.updateMatrixWorld(true);
  const tip=V3(c.tip);cf.inner.localToWorld(tip);rig.root.worldToLocal(tip);
  const car=KUB.car;
  if(car){const low=smooth(clamp((u-.38)/.3,0,1));
    car.position.set(tip.x+c.mx,tip.y-c.my+(c.gy-(tip.y-c.my))*low,tip.z+KUB.slot*c.dz*smooth(clamp((u-.3)/.3,0,1)));
    if(u>=.7){ // released on the ground
      rig.root.updateWorldMatrix(true,false);const w=car.position.clone();rig.root.localToWorld(w);w.y=hAt(w.x,w.z)+.3;
      rig.root.remove(car);car.position.copy(w);car.quaternion.identity();efx.add(car);KUB.placed.push(car);KUB.car=null;
      S.ammo--;KUB.slot++;applyAmmo();S.toast='Ракету передано · на пакеті '+S.ammo;S.toastT=1.8;}}
  if(u>=1){KUB.active=false;S.kubBusy=false;if(KUB.q>1&&S.ammo>0){KUB.q--;kubStart();}else{KUB.q=0;updateChips();}}}

/* ---------- boot ---------- */
window.RIGX=RIGX;
window.__tick=(n,dt)=>{for(let i=0;i<n;i++)frame(dt||1/30,i<n-1);};window.__snap=()=>{frame(0);return cv.toDataURL('image/png');};
window.__S=S;window.__setPhase=setPhase;window.__fire=()=>CH.fire.click();window.__reload=startReload;window.__sel=selectVehicle;window.__cam3=(p,t)=>{cam.position.set(...p);ctl.target.set(...t);ctl.update();};
window.__ready=()=>!!RIG&&LAND.ready&&!switching;window.__RIG=()=>RIG;window.__FX=FX;window.__LAND=LAND;window.__HOLD=HOLD;window.__M=()=>M;
const first=new URLSearchParams(location.search).get('m')||Object.keys(SPECS)[0];
selectVehicle(window.__first||first);
setTimeout(loadLand,600);
loop();

