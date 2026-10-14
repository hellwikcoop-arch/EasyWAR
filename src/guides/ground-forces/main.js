// Довідник Сухопутних військ EasyWAR: броньована й автомобільна техніка та набір танків.
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
import {SPECS, META} from './specs.js';

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
const rubberMat=new T.MeshStandardMaterial({color:0x1b1c1a,metalness:.1,roughness:.9});
const hoseMat=new T.MeshStandardMaterial({color:0x1d201c,metalness:.1,roughness:.85});
const brassMat=new T.MeshStandardMaterial({color:0xb08d57,metalness:.7,roughness:.35});
const V3=a=>new T.Vector3(a[0],a[1],a[2]);

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
const san=x=>String(x).replace(/\s/g,'_').replace(/[\[\]\.:\/]/g,'');

/* ---------- model loading and surgery ---------- */
const cache={};
function bakeMesh(o,F){
  o.updateWorldMatrix(true,false);const m=new T.Matrix4().multiplyMatrices(F,o.matrixWorld);
  const g=o.geometry,pa=g.attributes.position,na=g.attributes.normal,ua=g.attributes.uv,ub=g.attributes.uv1,n=pa.count;
  const pos=new Float32Array(n*3),nor=new Float32Array(n*3),uv=new Float32Array(n*2),uv1=ub?new Float32Array(n*2):null,v=new T.Vector3(),nm=new T.Matrix3().getNormalMatrix(m);
  for(let i=0;i<n;i++){v.fromBufferAttribute(pa,i).applyMatrix4(m);pos[i*3]=v.x;pos[i*3+1]=v.y;pos[i*3+2]=v.z;
    if(na){v.fromBufferAttribute(na,i).applyMatrix3(nm).normalize();nor[i*3]=v.x;nor[i*3+1]=v.y;nor[i*3+2]=v.z;}
    if(ua){uv[i*2]=ua.getX(i);uv[i*2+1]=ua.getY(i);}
    if(ub){uv1[i*2]=ub.getX(i);uv1[i*2+1]=ub.getY(i);}}
  let ix;if(g.index){ix=new Uint32Array(g.index.array);}else{ix=new Uint32Array(n);for(let i=0;i<n;i++)ix[i]=i;}
  if(m.determinant()<0)for(let t=0;t<ix.length;t+=3){const a=ix[t+1];ix[t+1]=ix[t+2];ix[t+2]=a;}
  const geo=new T.BufferGeometry();geo.setAttribute('position',new T.BufferAttribute(pos,3));if(na)geo.setAttribute('normal',new T.BufferAttribute(nor,3));if(ua)geo.setAttribute('uv',new T.BufferAttribute(uv,2));if(ub)geo.setAttribute('uv1',new T.BufferAttribute(uv1,2));
  return {pos,ix,geo,mat:Array.isArray(o.material)?o.material[0]:o.material,name:o.name};
}
function subMesh(src,tris,mat){
  const out=new Uint32Array(tris.length*3);for(let i=0;i<tris.length;i++){const t=tris[i];out[i*3]=src.ix[t*3];out[i*3+1]=src.ix[t*3+1];out[i*3+2]=src.ix[t*3+2];}
  const g=new T.BufferGeometry();for(const k in src.geo.attributes)g.setAttribute(k,src.geo.attributes[k]);g.setIndex(new T.BufferAttribute(out,1));
  return new T.Mesh(g,mat||src.mat);
}
function fixMatrix(tf){const R3=tf.R,s=tf.s,t=tf.t;return new T.Matrix4().set(R3[0][0]*s,R3[0][1]*s,R3[0][2]*s,t[0],R3[1][0]*s,R3[1][1]*s,R3[1][2]*s,t[1],R3[2][0]*s,R3[2][1]*s,R3[2][2]*s,t[2],0,0,0,1);}
const nodeNames=(o,root)=>{const a=[];for(let p=o;p&&p!==root;p=p.parent){if(p.userData&&p.userData.name!==undefined)a.push(san(p.userData.name));}return a.reverse();};

async function buildModel(sp){
  if(cache[sp.key])return cache[sp.key];
  const gl=await parseGLB(await fetchBuffer(MODEL_URLS[sp.model]));
  const sc=gl.scene;sc.updateMatrixWorld(true);
  const F=fixMatrix(sp.tf),srcs=[];
  sc.traverse(o=>{if(o.isMesh&&o.geometry){const s=bakeMesh(o,F);const nn=nodeNames(o,sc);s.path=nn.join('/');s.node=nn.length?nn[nn.length-1]:san(o.name);srcs.push(s);}});
  const mats=new Set();srcs.forEach(s=>mats.add(s.mat));
  const cfg=sp.cfg,br=cfg.bright||1,ei=cfg.env||1;
  // GLB з alphaMode BLEND ставить depthWrite=false; матеріали тут примусово непрозорі, тож глибину вони мають писати,
  // інакше результат залежить від порядку малювання (за id матеріалу) і ландшафт, створений пізніше, перемальовує гусениці та дрібні деталі.
  mats.forEach(m=>{if(m.color&&br!==1)m.color.multiplyScalar(br);m.envMap=scene.environment;m.envMapIntensity=ei;m.transparent=false;m.depthWrite=true;m.opacity=1;if(m.alphaMap)m.alphaMap=null;m.side=T.FrontSide;m.specularIntensityMap=null;m.specularColorMap=null;m.vertexColors=false;if(cfg.tint&&!m.map){m.color.set(/window/i.test(m.name)?0x1d2527:cfg.tint);if(/window/i.test(m.name)){m.metalness=.6;m.roughness=.2;}else{m.metalness=.2;m.roughness=.75;}}m.needsUpdate=true;if(m.map){m.map.anisotropy=4;}});
  const rules=sp.rules.map(r=>({name:r[0],fn:compileRule(r[1]),lv:r[2]==='t'?'t':'c'}));
  const parts={};
  const add=(name,s,t)=>{(parts[name]=parts[name]||[]).push([s,t]);};
  srcs.forEach(s=>{
    const {face,bb}=compsOf(s.pos,s.ix);
    const nt=face.length,base=sp.byNode?s.node:'body',cc=rules.map(()=>new Int8Array(bb.length));
    const lists={},P=s.pos,I=s.ix;
    for(let t=0;t<nt;t++){
      let k=base,env=null;const ci=face[t];let cbb=null;
      for(let ri=0;ri<rules.length;ri++){const r=rules[ri];
        if(r.lv==='c'){let v=cc[ri][ci];
          if(!v){const b=bb[ci];const mnx=b.mn[0],mny=b.mn[1],mnz=b.mn[2],mxx=b.mx[0],mxy=b.mx[1],mxz=b.mx[2];
            const ok=r.fn(mnx,mny,mnz,mxx,mxy,mxz,b.n,(mnx+mxx)/2,(mny+mxy)/2,(mnz+mxz)/2,mxx-mnx,mxy-mny,mxz-mnz,s.node,s.node,s.path,b.n,mnx,mny,mnz,mxx,mxy,mxz,sw,has,Math.abs,Math.min,Math.max,Math.sqrt,Math.hypot);
            v=cc[ri][ci]=ok?1:-1;}
          if(v>0){k=r.name;break;}}
        else{
          if(!env){const a=I[t*3]*3,b=I[t*3+1]*3,c=I[t*3+2]*3;cbb=bb[ci];
            const x0=P[a],x1=P[b],x2=P[c],y0=P[a+1],y1=P[b+1],y2=P[c+1],z0=P[a+2],z1=P[b+2],z2=P[c+2];
            env=[Math.min(x0,x1,x2),Math.min(y0,y1,y2),Math.min(z0,z1,z2),Math.max(x0,x1,x2),Math.max(y0,y1,y2),Math.max(z0,z1,z2),1,(x0+x1+x2)/3,(y0+y1+y2)/3,(z0+z1+z2)/3];}
          const ok=r.fn(env[0],env[1],env[2],env[3],env[4],env[5],1,env[7],env[8],env[9],env[3]-env[0],env[4]-env[1],env[5]-env[2],s.node,s.node,s.path,cbb.n,cbb.mn[0],cbb.mn[1],cbb.mn[2],cbb.mx[0],cbb.mx[1],cbb.mx[2],sw,has,Math.abs,Math.min,Math.max,Math.sqrt,Math.hypot);
          if(ok){k=r.name;break;}}
      }
      (lists[k]=lists[k]||[]).push(t);
    }
    for(const k in lists)add(k,s,lists[k]);
  });
  const m={sp,cfg,srcs,parts};
  cache[sp.key]=m;return m;
}
const paintCache=new Map();
function partMeshes(m,names,paint){
  const out=[];names=[].concat(names);
  names.forEach(n=>{(m.parts[n]||[]).forEach(([s,t])=>{
    let mat=s.mat;let pc=null;
    if(paint){pc=/^w\d+[lr]$/.test(n)?0x2a2c2a:(n==='gun'?Math.max(0,paint-0x0a0a08):paint);}
    if(pc!==null){const key=(s.name||'')+'#'+pc;mat=paintCache.get(key);if(!mat){mat=s.mat.clone();mat.map=null;mat.color=new T.Color(pc);mat.metalness=.15;mat.roughness=.72;mat.envMapIntensity=.9;paintCache.set(key,mat);}}
    const me=subMesh(s,t,mat);me.userData.part=n;out.push(me);});});
  return out;
}
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
  const fl=Math.max(r*3.2,L*.11),fh=r*1.8;
  for(let i=0;i<4;i++){const fin=new T.Mesh(new T.BoxGeometry(fl,r*.12+.004,fh),dark);const h=new T.Group();h.rotation.x=i*PI/2+PI/4;fin.position.set(-L/2+fl*.5+.02,0,r+fh*.38);h.add(fin);g.add(h);}
  return g;}
const FX={rk:[],puffs:[],flashes:[],dust:[],tr:[]};
const efx=new T.Group();world.add(efx);
const _v=new T.Vector3(),_w=new T.Vector3();
function dust(at,n,big,spread){for(let i=0;i<n;i++){const s=sprite(puffTex,0xb9ad8f,(big?2:1.2)+Math.random()*2.2);s.position.copy(at).add(new T.Vector3((Math.random()-.5)*spread,Math.random()*.6,(Math.random()-.5)*spread));efx.add(s);FX.dust.push({s,t:0,vy:.5+Math.random(),vx:(Math.random()-.5)*3,vz:(Math.random()-.5)*3,life:2.8+Math.random()*1.6});}}
function impact(p,big){const gy=hAt(p.x,p.z);const fl=sprite(glowTex,0xffd08a,big?9:3,T.AdditiveBlending);fl.position.set(p.x,gy+.8,p.z);efx.add(fl);FX.flashes.push({s:fl,t:0,life:.45});
  for(let i=0;i<(big?9:4);i++){const s=sprite(puffTex,0x6b6558,(big?2.5:1.2)+Math.random()*(big?3:1.5));s.position.set(p.x+(Math.random()-.5)*(big?3:1.2),gy+.4,p.z+(Math.random()-.5)*(big?3:1.2));efx.add(s);FX.dust.push({s,t:0,vy:1.2+Math.random()*2,vx:(Math.random()-.5)*3,vz:(Math.random()-.5)*3,life:3});}}
function stepFX(dt){
  FX.rk.forEach(k=>{k.t+=dt;k.life+=dt;const boost=k.t<k.sp.boost;
    if(boost){k.v+=(k.t<.3?k.sp.acc*.3:k.sp.acc)*dt;}else{k.flame.visible=false;k.v=Math.max(k.sp.vmin||60,k.v-dt*6);}
    if(k.t>(k.sp.turnAt||.7)){const f=Math.min(1,dt*(k.sp.turn||.9));k.d.lerp(k.tgt,f).normalize();}
    k.m.position.addScaledVector(k.d,k.v*dt);k.m.quaternion.setFromUnitVectors(_v.set(1,0,0),k.d);
    if(k.flame.visible)k.flame.scale.setScalar(k.fs*(.8+Math.random()*.4));
    if(FX.puffs.length<260&&Math.random()<.9){const s=sprite(puffTex,0xe3e0d6,k.psz*(.9+Math.random()*.7));s.position.copy(k.m.position).addScaledVector(k.d,-k.sp.L/2-.3);efx.add(s);FX.puffs.push({s,t:0,life:1.8+Math.random()*1.6,vy:.25,grow:.8});}
    const gy=hAt(k.m.position.x,k.m.position.z);
    if(k.m.position.y<gy+.2||k.life>12||k.m.position.length()>(k.sp.range||240)){
      if(k.m.position.y<gy+1.2&&k.life<12)impact(k.m.position,true);
      efx.remove(k.m);k.dead=true;}});
  FX.rk=FX.rk.filter(k=>!k.dead);
  FX.tr.forEach(o=>{o.t+=dt;o.v.y-=(o.g||1.8)*dt;o.m.position.addScaledVector(o.v,dt);o.m.quaternion.setFromUnitVectors(_v.set(0,0,1),_w.copy(o.v).normalize());
    if(o.t>o.life||o.m.position.y<hAt(o.m.position.x,o.m.position.z)){if(o.t<=o.life)impact(o.m.position,!!o.big);efx.remove(o.m);o.dead=true;}});
  FX.tr=FX.tr.filter(o=>!o.dead);
  const age=(arr,fn)=>{arr.forEach(o=>{o.t+=dt;fn(o);if(o.t>o.life){efx.remove(o.s);o.dead=true;}});return arr.filter(o=>!o.dead);};
  FX.puffs=age(FX.puffs,o=>{const f=o.t/o.life;o.s.position.y+=o.vy*dt;if(o.vx){o.s.position.x+=o.vx*dt;o.s.position.z+=(o.vz||0)*dt;}o.s.scale.setScalar(o.s.scale.x+dt*(o.grow||1.2));o.s.material.opacity=(o.a||.55)*(1-f);});
  FX.dust=age(FX.dust,o=>{const f=o.t/o.life;o.s.position.x+=o.vx*dt;o.s.position.z+=o.vz*dt;o.s.position.y+=o.vy*dt;o.vy*=.96;o.s.scale.setScalar(o.s.scale.x+dt*2.5);o.s.material.opacity=.7*(1-f);});
  FX.flashes=age(FX.flashes,o=>{const f=o.t/o.life;o.s.material.opacity=1-f;o.s.scale.setScalar(o.s.scale.x*(1+dt*6));});
}
function clearFX(){[...FX.rk.map(k=>k.m),...FX.tr.map(o=>o.m),...FX.puffs.map(o=>o.s),...FX.dust.map(o=>o.s),...FX.flashes.map(o=>o.s)].forEach(o=>efx.remove(o));FX.rk=[];FX.puffs=[];FX.flashes=[];FX.dust=[];FX.tr=[];}
const tracerGeo=new T.BoxGeometry(.05,.05,1.1),tracerMat=new T.MeshBasicMaterial({color:0xffc66a,fog:false});
const shellGeo=new T.BoxGeometry(.12,.12,2.6),shellMat=new T.MeshBasicMaterial({color:0xffe0a0,fog:false});

/* ---------- state ---------- */
let V=null,M=null,RIG=null;
const S={phase:1,speed:0,tSpeed:0,steer:0,dist:0,bounce:0,toast:'',toastT:0,yaw:0,elev:0,follow:false,ammo:0,
  cool:{},burst:{},bt:{},rcT:9,rcB:0,kick:0,hg:{},hgT:{},sub:{},subT:{},atgmQ:0,atgmHold:0,reloadT:0,boom:0,slew:0,winch:0.2,hose:0,hoseT:0,tog:{}};
const PH=[null,
 {n:'Стоянка',k:'1',on:()=>{S.tSpeed=0;},st:'Стоянка · двигун вимкнено'},
 {n:'Марш',k:'2',on:()=>{S.tSpeed=RIG&&RIG.cfg.speed?RIG.cfg.speed:10;},st:'Марш · {v} км/год'}];

/* ---------- tracks ---------- */
function makeCleatTrack(L,parent){
  const g=new T.Group();parent.add(g);const out={g,sides:[]};
  const r=(L.y1-L.y0)/2,yc=(L.y0+L.y1)/2,x0=L.x0+r,x1=L.x1-r,Lc=x1-x0,per=2*Lc+2*PI*r,N=Math.max(8,Math.round(per/(L.pitch||.17)));
  const geo=new T.BoxGeometry((L.pitch||.17)*.74,.06,L.w+.05);
  [-1,1].forEach(sg=>{const im=new T.InstancedMesh(geo,rubberMat,N);im.frustumCulled=false;g.add(im);out.sides.push({im,sg});});
  const d=new T.Object3D();
  out.update=(s)=>{
    for(let i=0;i<N;i++){let u=((i/N)*per+s)%per;if(u<0)u+=per;let x,y,a;
      if(u<Lc){x=x0+u;y=yc-r;a=0;}
      else if(u<Lc+PI*r){const t=(u-Lc)/r;x=x1+Math.sin(t)*r;y=yc-Math.cos(t)*r;a=t;}
      else if(u<2*Lc+PI*r){x=x1-(u-Lc-PI*r);y=yc+r;a=PI;}
      else{const t=(u-2*Lc-PI*r)/r;x=x0-Math.sin(t)*r;y=yc+Math.cos(t)*r;a=PI+t;}
      d.position.set(x,y,0);d.rotation.set(0,0,a);d.updateMatrix();
      out.sides.forEach(sd=>{const mm=d.matrix.clone();mm.elements[14]=sd.sg*L.zc;sd.im.setMatrixAt(i,mm);});}
    out.sides.forEach(sd=>sd.im.instanceMatrix.needsUpdate=true);};
  out.update(0);return out;
}
// real track links: the whole band is carried along the stadium path by a vertex shader, one link pitch at a time
function patchShiftMat(mat,L){
  const m=mat.clone();const U={tkS:{value:0}},LV=new T.Vector4(L.x0+(L.y1-L.y0)/2,L.x1-(L.y1-L.y0)/2,(L.y0+L.y1)/2,(L.y1-L.y0)/2);
  m.onBeforeCompile=sh=>{sh.uniforms.tkS=U.tkS;sh.uniforms.tkL={value:LV};
    sh.vertexShader=sh.vertexShader.replace('#include <common>',`#include <common>
uniform float tkS;uniform vec4 tkL;
const float PI_=3.14159265;
float tkArc(vec2 p){float Lc=tkL.y-tkL.x,r=tkL.w;
  if(p.x<tkL.x){float t=clamp(atan(-(p.x-tkL.x),p.y-tkL.z),0.,PI_);return 2.*Lc+PI_*r+t*r;}
  if(p.x>tkL.y){float t=clamp(atan(p.x-tkL.y,-(p.y-tkL.z)),0.,PI_);return Lc+t*r;}
  if(p.y<tkL.z)return p.x-tkL.x;
  return Lc+PI_*r+(tkL.y-p.x);}
vec2 tkPos(float u,out float a){float Lc=tkL.y-tkL.x,r=tkL.w,per=2.*Lc+2.*PI_*r;u=mod(u,per);
  if(u<Lc){a=0.;return vec2(tkL.x+u,tkL.z-r);}
  if(u<Lc+PI_*r){float t=(u-Lc)/r;a=t;return vec2(tkL.y+sin(t)*r,tkL.z-cos(t)*r);}
  if(u<2.*Lc+PI_*r){a=PI_;return vec2(tkL.y-(u-Lc-PI_*r),tkL.z+r);}
  float t=(u-2.*Lc-PI_*r)/r;a=PI_+t;return vec2(tkL.x-sin(t)*r,tkL.z+cos(t)*r);}`);
    sh.vertexShader=sh.vertexShader.replace('#include <beginnormal_vertex>',`#include <beginnormal_vertex>
float tkA0,tkA1;float tkU=tkArc(position.xy);vec2 tkP0=tkPos(tkU,tkA0);vec2 tkP1=tkPos(tkU+tkS,tkA1);float tkD=tkA1-tkA0;
mat2 tkR=mat2(cos(tkD),sin(tkD),-sin(tkD),cos(tkD));
vec2 tkQ=tkP1+tkR*(position.xy-tkP0);
objectNormal.xy=tkR*objectNormal.xy;`);
    sh.vertexShader=sh.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
transformed.xy=tkQ;`);};
  m.customProgramCacheKey=()=>'tkshift';
  return {mat:m,U};
}
function buildTrack(m,tc,parent,claim,paint){
  const out={mode:tc.mode,update(){}};
  if(tc.mode==='uv'){const texs=[];
    tc.parts.forEach(nm=>{claim(nm);partMeshes(m,nm,null).forEach(me=>{const mat=me.material.clone();
      ['map','normalMap','roughnessMap','metalnessMap','aoMap','emissiveMap'].forEach(k=>{if(mat[k]){mat[k]=mat[k].clone();mat[k].wrapS=mat[k].wrapT=T.RepeatWrapping;mat[k].needsUpdate=true;texs.push(mat[k]);}});
      me.material=mat;parent.add(me);});});
    out.update=d=>{const o=((tc.uvK*d)%1);texs.forEach(t=>{t.offset.y=o;});};out.texs=texs;}
  else if(tc.mode==='shift'){let U=null;
    tc.parts.forEach(nm=>{claim(nm);partMeshes(m,nm,null).forEach(me=>{const p=patchShiftMat(me.material,tc.loop);me.material=p.mat;U=U||p.U;me.frustumCulled=false;parent.add(me);});});
    out.update=d=>{if(U)U.tkS.value=-(((d%tc.pitch)+tc.pitch)%tc.pitch);};out.U=U;}
  else if(tc.mode==='cleat'){const ct=makeCleatTrack(tc.loop,parent);out.update=d=>ct.update(-d);out.ct=ct;}
  return out;
}

/* ---------- rig construction ---------- */
function buildRig(m){
  const cfg=m.cfg,root=new T.Group();
  const rig={m,cfg,root,spin:[],steer:[],track:null,paint:cfg.paint||null,subs:{},hinges:[],frames:{}};
  const paint=rig.paint;
  const used=new Set(),claim=names=>{[].concat(names).forEach(n=>used.add(n));};
  const body=mkFrame(root,[0,0,0]);rig.body=body;rig.frames.body=body;
  // wheels and rolling parts (w{n}{l|r})
  Object.keys(m.parts).filter(n=>/^w\d+[lr]$/.test(n)).forEach(nm=>{
    claim(nm);const box=partBox(m,nm),cc=box.getCenter(new T.Vector3()),idx=parseInt(nm.slice(1));
    const wc=cfg.wheels||{};const Rr=wc.R||Math.max(.1,(box.max.y-box.min.y)/2);
    const isSteer=wc.steer&&wc.steer.includes(idx);
    let parent=body.inner;
    if(isSteer){const st=mkFrame(body.inner,[cc.x,cc.y,cc.z]);rig.steer.push({g:st.g,k:wc.steerK?wc.steerK[wc.steer.indexOf(idx)]:1});parent=st.inner;}
    const sp=mkFrame(parent,[cc.x,cc.y,cc.z]);partMeshes(m,nm,paint).forEach(me=>sp.inner.add(me));rig.spin.push({g:sp.g,R:Rr});});
  if(cfg.track){rig.track=buildTrack(m,cfg.track,body.inner,claim,paint);}
  // turret -> gun -> recoiling barrel
  if(cfg.turret){const tc=cfg.turret;const tu=mkFrame(body.inner,[tc.pivot[0],0,tc.pivot[1]]);rig.turF=tu;rig.frames.turret=tu;
    tc.parts.forEach(n=>{claim(n);partMeshes(m,n,paint).forEach(me=>tu.inner.add(me));});
    if(cfg.gun){const gc=cfg.gun;const gf=mkFrame(tu.inner,gc.pivot);rig.gunF=gf;rig.frames.gun=gf;
      gc.parts.forEach(n=>{claim(n);partMeshes(m,n,paint).forEach(me=>gf.inner.add(me));});
      if(gc.recoilParts){const rf=mkFrame(gf.inner,[0,0,0]);rig.recF=rf;gc.recoilParts.forEach(n=>{claim(n);partMeshes(m,n,paint).forEach(me=>rf.inner.add(me));});}}
    Object.keys(cfg.subs||{}).forEach(id=>{const sc=cfg.subs[id];const par=sc.parent==='body'?body.inner:tu.inner;const f=mkFrame(par,sc.pivot);sc.parts.forEach(n=>{claim(n);partMeshes(m,n,paint).forEach(me=>f.inner.add(me));});rig.subs[id]=f;rig.frames[id]=f;S.sub[id]=0;S.subT[id]=0;});}
  // hinged parts (blade, ramp)
  (cfg.hinges||[]).forEach(h=>{const f=mkFrame(body.inner,h.pivot);h.parts.forEach(n=>{claim(n);partMeshes(m,n,paint).forEach(me=>f.inner.add(me));});rig.hinges.push({f,h});S.hg[h.id]=0;S.hgT[h.id]=0;});
  // crane: slewing platform -> boom -> hooks that hang vertically
  if(cfg.crane){const c=cfg.crane;const cf=mkFrame(body.inner,[c.pivot[0],0,c.pivot[1]]);rig.craneF=cf;
    c.parts.forEach(n=>{claim(n);partMeshes(m,n,paint).forEach(me=>cf.inner.add(me));});
    const bf=mkFrame(cf.inner,[c.boomPivot[0],c.boomPivot[1],0]);rig.boomF=bf;c.boomParts.forEach(n=>{claim(n);partMeshes(m,n,paint).forEach(me=>bf.inner.add(me));});
    // hook group: placed at the boom tip, rotated with the slew only
    const hg=mkFrame(body.inner,[c.tip[0],c.tip[1],0]);rig.hookG=hg;
    const cab=mkFrame(hg.inner,[c.tip[0],c.cableTop,0]);rig.cableF=cab;c.cableParts.forEach(n=>{claim(n);partMeshes(m,n,paint).forEach(me=>cab.inner.add(me));});
    const hk=mkFrame(hg.inner,[0,0,0]);rig.hookF=hk;c.hookParts.forEach(n=>{claim(n);partMeshes(m,n,paint).forEach(me=>hk.inner.add(me));});
    rig.cableLen=c.cableTop-c.hookTopY;}
  // procedural fuel hose
  if(cfg.hose){rig.hoseMesh=new T.Mesh(new T.BufferGeometry(),hoseMat);rig.hoseMesh.frustumCulled=false;body.inner.add(rig.hoseMesh);
    rig.nozzle=new T.Mesh(new T.CylinderGeometry(.06,.045,.28,12),brassMat);body.inner.add(rig.nozzle);rig.hoseMesh.visible=rig.nozzle.visible=false;}
  rig.rest=Object.keys(m.parts).filter(n=>!used.has(n));
  return rig;
}
function finishRig(rig){rig.rest.forEach(n=>partMeshes(rig.m,n,rig.paint).forEach(me=>rig.body.inner.add(me)));}

/* ---------- vehicle switch ---------- */
let switching=false;
const CH={};
const lastPack={k:META.pack[0]};
async function selectVehicle(key){
  if(switching||(V&&V.key===key))return;switching=true;const sp=SPECS[key];$('#load').hidden=false;$('#load').textContent='Завантаження моделі';
  try{
    const m=await buildModel(sp);
    if(RIG){truck.remove(RIG.root);}
    clearFX();M=m;V=sp;
    RIG=buildRig(m);truck.add(RIG.root);window.__RIGOBJ=RIG;finishRig(RIG);
    const c=sp.cfg;
    Object.assign(S,{toastT:0,phase:1,speed:0,tSpeed:0,yaw:0,elev:0,cool:{},burst:{},bt:{},rcT:9,rcB:0,kick:0,hg:{},hgT:{},sub:{},subT:{},atgmQ:0,atgmHold:0,reloadT:0,boom:0,slew:0,winch:.2,hose:0,hoseT:0,tog:{},steer:0});
    Object.keys(RIG.subs).forEach(id=>{S.sub[id]=0;S.subT[id]=0;});(c.hinges||[]).forEach(h=>{S.hg[h.id]=0;S.hgT[h.id]=0;});
    S.ammo=(c.weapons&&c.weapons.V)?c.weapons.V.ammo:0;
    if(sp.group==='pack')lastPack.k=key;
    $('#title').textContent=c.name;$('#dims').textContent=c.dims;$('#cv').setAttribute('aria-label','Тривимірна модель: '+c.name);
    fillInfo(sp);
    cam.position.set(...c.cam.p);ctl.target.set(...c.cam.t);
    buildChips();setPhase(1);applyAmmo();$('#load').hidden=true;
  }catch(e){console.error(e);$('#load').textContent='Не вдалося завантажити модель';window.__err=String(e&&e.stack||e);}
  switching=false;}
function fillInfo(sp){const c=sp.cfg;
  $('#i-name').textContent=c.name;$('#i-role').textContent=c.role;
  $('#i-desc').innerHTML=c.desc.map(p=>'<p>'+p+'</p>').join('');
  $('#i-facts').innerHTML=c.facts.map(f=>'<div><dt>'+f[0]+'</dt><dd>'+f[1]+'</dd></div>').join('');
  $('#i-anim').innerHTML=c.anim.map(a=>'<li>'+a+'</li>').join('');
  $('#i-cred').innerHTML=creditHtml('ground-forces/'+sp.model);
}

/* ---------- poses ---------- */
const HOLD={up:0,dn:0,lf:0,rt:0,wu:0,wd:0};
const frameOf=name=>RIG.frames[name]||RIG.frames.body;
function poseRig(dt){
  const rig=RIG,cfg=rig.cfg;
  rig.spin.forEach(w=>{w.g.rotation.z=-S.dist/w.R;});
  rig.steer.forEach(s=>s.g.rotation.y=S.steer*D2R*s.k);
  if(rig.track)rig.track.update(S.dist);
  // turret and gun
  const gc=cfg.gun;
  if(rig.turF){
    const dT=HOLD.lf-HOLD.rt;if(dT)S.yaw=S.yaw+dT*dt*38*D2R;
    if(S.yaw>PI)S.yaw-=2*PI;if(S.yaw<-PI)S.yaw+=2*PI;
    rig.turF.g.rotation.y=S.yaw;
    if(rig.gunF&&gc){const dE=HOLD.up-HOLD.dn;if(dE)S.elev=clamp(S.elev+dE*dt*14,gc.elev[0],gc.elev[1]);rig.gunF.g.rotation.z=S.elev*D2R;}
  }
  // recoil: a sharp pull-back and a slow return for shells, short jolts for bursts
  S.rcT+=dt;S.rcB=Math.max(0,S.rcB-dt*14);
  if(rig.recF&&gc){const w=cfg.weapons&&cfg.weapons.X;
    const shellR=(w&&w.kind==='shell')?(S.rcT<.07?S.rcT/.07:Math.max(0,1-(S.rcT-.07)/.9))*gc.recoil:0;
    const burstR=S.rcB*(w&&w.recoilShot||0);
    rig.recF.g.position.x=-Math.max(shellR,burstR);}
  S.kick=Math.max(0,S.kick-dt*2.2);
  rig.body.g.rotation.z=-.016*S.kick*Math.sin(S.kick*5);
  // missile launchers: rise before launch
  Object.keys(rig.subs).forEach(id=>{const sc=cfg.subs[id];const tgt=(S.atgmQ>0||S.atgmHold>0)?1:0;S.sub[id]+=clamp(tgt-S.sub[id],-dt*sc.speed/sc.rise,dt*sc.speed/sc.rise);rig.subs[id].g.rotation.z=sc.rise*D2R*smooth(S.sub[id]);});
  // hinges
  rig.hinges.forEach(hh=>{const h=hh.h,tgt=S.hgT[h.id];S.hg[h.id]+=clamp(tgt-S.hg[h.id],-dt*h.rate,dt*h.rate);hh.f.g.rotation[h.axis]=S.hg[h.id]*D2R;});
  // crane
  if(rig.craneF)craneStep(dt);
  // hose
  if(rig.hoseMesh)hoseStep(dt);
}
function craneStep(dt){const rig=RIG,c=rig.cfg.crane,ok=S.speed<.4;
  if(ok){const ds=HOLD.lf-HOLD.rt,db=HOLD.up-HOLD.dn,dw=HOLD.wd-HOLD.wu;
    if(ds)S.slew=clamp(S.slew+ds*dt*14,-c.slewMax,c.slewMax);
    if(db)S.boom=clamp(S.boom+db*dt*7,c.boomRange[0],c.boomRange[1]);
    if(dw)S.winch=clamp(S.winch+dw*dt*.45,0,1);}
  rig.craneF.g.rotation.y=S.slew*D2R;rig.boomF.g.rotation.z=S.boom*D2R;
  rig.craneF.g.updateMatrixWorld(true);
  // boom tip in model coordinates
  const tip=new T.Vector3(c.tip[0],c.tip[1],0);rig.boomF.inner.localToWorld(tip);rig.body.inner.worldToLocal(tip);
  rig.hookG.g.position.set(tip.x,tip.y,tip.z);rig.hookG.g.rotation.y=S.slew*D2R;
  const dropMax=Math.max(.2,c.hookTopY-.55+(tip.y-c.tip[1]));const drop=S.winch*Math.min(c.winchMax,dropMax)-.25;
  const L=rig.cableLen;rig.cableF.g.scale.y=Math.max(.15,(L+drop)/L);rig.hookF.g.position.y=-drop;
}
function hoseStep(dt){const rig=RIG,hc=rig.cfg.hose;
  S.hose+=clamp(S.hoseT-S.hose,-dt*.35,dt*.35);const e=smooth(S.hose);
  rig.hoseMesh.visible=rig.nozzle.visible=e>.01;if(e<=.01)return;
  const f=hc.from_,len=hc.len*e;
  const pts=[V3(f),new T.Vector3(f[0]-.35,f[1]-.45*Math.min(1,e*3),f[2]+.1*e),new T.Vector3(f[0]-.9-.2*e,.12+.1*(1-Math.min(1,e*2)),f[2]+.25*e)];
  const n=6;for(let i=1;i<=n;i++){const u=i/n;pts.push(new T.Vector3(f[0]-.9-.2*e-(len-1.1)*u,.07+(i%2?.02:0),f[2]+.25*e+.7*Math.sin(u*PI*.8)*e));}
  const curve=new T.CatmullRomCurve3(pts);rig.hoseMesh.geometry.dispose();rig.hoseMesh.geometry=new T.TubeGeometry(curve,40,hc.r,7,false);
  const end=pts[pts.length-1],pre=pts[pts.length-2];rig.nozzle.position.copy(end);rig.nozzle.rotation.set(0,0,0);rig.nozzle.rotation.z=PI/2;
  rig.nozzle.rotation.y=Math.atan2(-(end.z-pre.z),-(end.x-pre.x));}

/* ---------- firing ---------- */
const _d=new T.Vector3(),_p=new T.Vector3();
function muzzleOf(w){const f=frameOf(w.frame);f.inner.updateWorldMatrix(true,false);const p=V3(w.muzzle);f.inner.localToWorld(p);const d=_d.set(1,0,0).transformDirection(f.inner.matrixWorld).normalize().clone();return {p,d};}
function smokePuffs(p,d,n,col,sz,vy){for(let i=0;i<n;i++){const s=sprite(puffTex,col,sz*(.7+Math.random()*.8));s.position.copy(p).addScaledVector(d,.3+Math.random()*1.4).add(new T.Vector3((Math.random()-.5)*.5,(Math.random()-.5)*.5,(Math.random()-.5)*.5));efx.add(s);FX.puffs.push({s,t:0,life:1.6+Math.random()*1.6,vy:vy||.5,grow:1.8,vx:d.x*(1+Math.random()*2),vz:d.z*(1+Math.random()*2),a:.5});}}
function fireShell(w){const {p,d}=muzzleOf(w);
  const fl=sprite(glowTex,0xffe1a6,(w.flash||3)*2.4,T.AdditiveBlending);fl.position.copy(p).addScaledVector(d,.5);efx.add(fl);FX.flashes.push({s:fl,t:0,life:.16});
  smokePuffs(p,d,w.smoke||5,0xdad6cb,1.6,.45);
  const m=new T.Mesh(shellGeo,shellMat);m.position.copy(p);efx.add(m);FX.tr.push({m,v:d.clone().multiplyScalar(w.v||480),t:0,life:2.2,g:2.5,big:true});
  const base=new T.Vector3();RIG.body.g.getWorldPosition(base);base.y=hAt(base.x,base.z)+.3;dust(base,(w.kick?6:3),true,7);
  S.rcT=0;S.kick=1;S.toast='Постріл · '+RIG.cfg.short;S.toastT=1.4;}
function burstStep(dt){const rig=RIG,W=rig.cfg.weapons||{};
  Object.keys(W).forEach(key=>{const w=W[key];if(w.kind!=='burst'||!(S.burst[key]>0))return;
    S.burst[key]-=dt;S.bt[key]=(S.bt[key]||0)-dt;
    while(S.bt[key]<=0){S.bt[key]+=1/w.rate;const {p,d}=muzzleOf(w);
      const m=new T.Mesh(tracerGeo,tracerMat);m.position.copy(p);efx.add(m);
      const sp=new T.Vector3().copy(d).add(new T.Vector3((Math.random()-.5)*.014,(Math.random()-.5)*.014,(Math.random()-.5)*.014)).normalize().multiplyScalar(w.v||400);
      FX.tr.push({m,v:sp,t:0,life:1.2});
      const fl=sprite(glowTex,0xffcf8a,(w.flash||.7)*1.3,T.AdditiveBlending);fl.position.copy(p).addScaledVector(d,.2);efx.add(fl);FX.flashes.push({s:fl,t:0,life:.06});
      if(Math.random()<.4)smokePuffs(p,d,1,0xcfcabd,.5,.25);
      if(w.frame==='gun'){S.rcB=1;}}
    if(S.burst[key]<=0){S.toast='Черга завершена';S.toastT=1;updateChips();}});
}
function launchATGM(){const rig=RIG,w=rig.cfg.weapons.V,sp=w.missile,idx=w.tubes.length-((S.ammo-1)%w.tubes.length)-1;
  const f=frameOf(w.frame);f.inner.updateWorldMatrix(true,false);const p=V3(w.tubes[idx%w.tubes.length]);f.inner.localToWorld(p);
  const d=new T.Vector3(1,0,0).transformDirection(f.inner.matrixWorld).normalize();
  S.ammo--;applyAmmo();
  const r=makeMissile(sp);r.position.copy(p).addScaledVector(d,.1);r.quaternion.setFromUnitVectors(new T.Vector3(1,0,0),d);
  const flame=sprite(glowTex,0xffc477,sp.flame*2.2,T.AdditiveBlending);flame.position.x=-sp.L/2-sp.flame*.3;r.add(flame);efx.add(r);
  const az=new T.Vector3(d.x,0,d.z).normalize();const gy=hAt(p.x+az.x*120,p.z+az.z*120);
  const tgt=az.clone().multiplyScalar(130).add(new T.Vector3(0,gy-p.y-.2,0)).normalize();
  FX.rk.push({m:r,d:d.clone(),tgt,v:22,t:0,flame,life:0,sp:{L:sp.L,boost:1.8,acc:55,vmin:sp.v,turnAt:.25,turn:4,range:sp.range},fs:sp.flame*2.2,psz:sp.smoke});
  const fl=sprite(glowTex,0xffe3b0,2.8,T.AdditiveBlending);fl.position.copy(p).addScaledVector(d,.3);efx.add(fl);FX.flashes.push({s:fl,t:0,life:.25});
  smokePuffs(p,d.clone().multiplyScalar(-1),6,0xe3ddd0,1.0,.6);
  S.toast='Пуск ракети · лишилось '+S.ammo;S.toastT=1.8;S.atgmHold=2.2;}

/* ---------- chips ---------- */
function chip(row,label,key,on){const b=document.createElement('button');b.className='chip';b.type='button';b.innerHTML=(key?`<kbd>${key}</kbd>`:'')+`<span>${label}</span>`;b.onclick=on;$(row).appendChild(b);return b;}
function holdChip(row,label,key,hk){const b=chip(row,label,key,()=>{});b.onclick=null;
  let t0=0;const on=e=>{if(e)e.preventDefault();HOLD[hk]=1;t0=performance.now();};
  const off=()=>{const d=260-(performance.now()-t0);if(HOLD[hk]&&d>0)setTimeout(()=>{HOLD[hk]=0;},d);else HOLD[hk]=0;};
  b.addEventListener('pointerdown',on);['pointerup','pointercancel','pointerleave','blur'].forEach(ev=>b.addEventListener(ev,off));
  b.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' ')on(e);});b.addEventListener('keyup',off);
  b.style.touchAction='none';return b;}
function applyAmmo(){const a=$('#ammo');a.innerHTML='';const w=RIG&&RIG.cfg.weapons&&RIG.cfg.weapons.V;const n=w?w.ammo:0;a.style.display=n?'flex':'none';
  for(let i=0;i<n;i++){const d=document.createElement('i');d.className=(i<S.ammo?'on':'');a.appendChild(d);}updateChips();}
const doFire=key=>{if(!RIG)return;const w=RIG.cfg.weapons&&RIG.cfg.weapons[key];if(!w)return;
  if(w.kind==='shell'){if((S.cool[key]||0)>0)return;fireShell(w);S.cool[key]=w.cool||2.5;}
  else if(w.kind==='burst'){if(S.burst[key]>0)return;S.burst[key]=w.dur||1.6;S.bt[key]=0;}
  else if(w.kind==='atgm'){if(S.ammo<=0||S.atgmQ>0||S.atgmHold>0)return;S.atgmQ=1;}
  updateChips();};
function buildChips(){
  ['#rowP','#rowL','#rowW','#rowH','#rowK'].forEach(r=>$(r).innerHTML='');
  ['lf','rt','up','dn','fwd','wu','wd','rel','follow'].forEach(k=>{CH[k]=null;}); // chips of the previous vehicle: drop stale refs (a leftover CH.rel crashed updateChips on vehicles without missiles)
  const cfg=RIG.cfg;
  const rv=$('#rowV');if(!rv.children.length){CH.v={};META.order.forEach(k=>{CH.v[k]=chip('#rowV',SPECS[k].cfg.short,'',()=>selectVehicle(k));});
    CH.v.pack=chip('#rowV','Танки (набір)','',()=>selectVehicle(lastPack.k));}
  CH.pk={};if(V.group==='pack'){META.pack.forEach(k=>{CH.pk[k]=chip('#rowK',SPECS[k].cfg.short,'',()=>selectVehicle(k));});}
  $('#rowK').parentElement.style.display=V.group==='pack'?'':'none';
  PH.forEach((p,i)=>{if(!p)return;CH['p'+i]=chip('#rowP',p.n,p.k,()=>setPhase(i));});
  // aiming / crane holds
  if(cfg.turret){CH.lf=holdChip('#rowL','Башта вліво','←','lf');CH.rt=holdChip('#rowL','Башта вправо','→','rt');CH.up=holdChip('#rowL','Ствол вгору','↑','up');CH.dn=holdChip('#rowL','Ствол вниз','↓','dn');
    CH.fwd=chip('#rowL','Вперед','R',()=>{S.yaw=0;S.elev=0;});}
  else if(cfg.crane){CH.up=holdChip('#rowL','Стріла вгору','↑','up');CH.dn=holdChip('#rowL','Стріла вниз','↓','dn');CH.lf=holdChip('#rowL','Поворот вліво','←','lf');CH.rt=holdChip('#rowL','Поворот вправо','→','rt');
    CH.wu=holdChip('#rowL','Гак вгору','W','wu');CH.wd=holdChip('#rowL','Гак вниз','S','wd');CH.fwd=chip('#rowL','Згорнути','R',()=>{S.slew=0;S.boom=0;S.winch=.2;});}
  $('#rowL').parentElement.style.display=(cfg.turret||cfg.crane)?'':'none';
  // mechanisms
  CH.hg={};(cfg.hinges||[]).forEach(h=>{h.states.forEach(([nm,a],i)=>{const b=chip('#rowH',h.label+': '+nm.toLowerCase(),'',()=>{S.hgT[h.id]=a;updateChips();});b.dataset.h=h.id;b.dataset.a=a;CH.hg[h.id+i]=b;});});
  CH.tog={};(cfg.toggles||[]).forEach(t=>{const b=chip('#rowH',t.on,t.key,()=>{if(t.id==='hose'){S.hoseT=S.hoseT>.5?0:1;b.querySelector('span').textContent=S.hoseT>.5?t.off:t.on;S.tog.hose=S.hoseT;updateChips();}});CH.tog[t.id]=b;});
  $('#rowH').parentElement.style.display=((cfg.hinges&&cfg.hinges.length)||(cfg.toggles&&cfg.toggles.length))?'':'none';
  // weapons
  CH.w={};const W=cfg.weapons||{};Object.keys(W).forEach(k=>{const w=W[k];CH.w[k]=chip('#rowW',w.label,k,()=>doFire(k));});
  if(W.V){CH.rel=chip('#rowW','Перезарядити ракети','H',()=>{if(S.ammo<W.V.ammo&&!S.reloadT){S.reloadT=3;S.toast='Перезарядження ракет';S.toastT=2.6;updateChips();}});
    CH.follow=chip('#rowW','Стежити за ракетою','C',()=>{S.follow=!S.follow;CH.follow.classList.toggle('on',S.follow);});}
  $('#rowW').parentElement.style.display=Object.keys(W).length?'':'none';
  updateChips();}
function setPhase(i){S.phase=i;PH[i].on();updateChips();}
function updateChips(){if(!RIG)return;for(let i=1;i<PH.length;i++)if(CH['p'+i])CH['p'+i].classList.toggle('on',S.phase===i);
  const cfg=RIG.cfg;
  if(CH.v){META.order.forEach(k=>CH.v[k].classList.toggle('on',V&&V.key===k));CH.v.pack.classList.toggle('on',V&&V.group==='pack');}
  Object.keys(CH.pk||{}).forEach(k=>CH.pk[k].classList.toggle('on',V&&V.key===k));
  const W=cfg.weapons||{};
  Object.keys(CH.w||{}).forEach(k=>{const w=W[k];let lock=false;
    if(w.kind==='shell')lock=(S.cool[k]||0)>0;else if(w.kind==='burst')lock=S.burst[k]>0;else lock=S.ammo<=0||S.atgmQ>0||S.atgmHold>0;
    CH.w[k].classList.toggle('lock',lock);CH.w[k].classList.toggle('on',w.kind==='burst'&&S.burst[k]>0);});
  if(CH.rel){CH.rel.classList.toggle('lock',S.ammo>=W.V.ammo||!!S.reloadT);CH.rel.classList.toggle('on',!!S.reloadT);}
  (cfg.hinges||[]).forEach(h=>h.states.forEach(([nm,a],i)=>{const b=CH.hg[h.id+i];if(b)b.classList.toggle('on',S.hgT[h.id]===a);}));
  if(cfg.crane){const ok=S.speed<.4;['up','dn','lf','rt','wu','wd'].forEach(k=>CH[k]&&CH[k].classList.toggle('lock',!ok));}
}
addEventListener('keydown',e=>{if(e.target.tagName==='INPUT')return;const k=e.key,c=e.code;if(!RIG)return;
  if(c==='Digit1')setPhase(1);else if(c==='Digit2')setPhase(2);
  else if(k==='ArrowUp'||k==='ArrowDown'||k==='ArrowLeft'||k==='ArrowRight'){e.preventDefault();HOLD[{ArrowUp:'up',ArrowDown:'dn',ArrowLeft:'lf',ArrowRight:'rt'}[k]]=1;}
  else if(c==='KeyW')HOLD.wu=1;else if(c==='KeyS')HOLD.wd=1;
  else if(c==='KeyX')doFire('X');else if(c==='KeyZ')doFire('Z');else if(c==='KeyV')doFire('V');
  else if(c==='KeyR'&&CH.fwd)CH.fwd.click();else if(c==='KeyH'){if(CH.rel)CH.rel.click();else if(CH.tog&&CH.tog.hose)CH.tog.hose.click();}
  else if(c==='KeyC'&&CH.follow)CH.follow.click();});
addEventListener('keyup',e=>{const m={ArrowUp:'up',ArrowDown:'dn',ArrowLeft:'lf',ArrowRight:'rt'}[e.key];if(m)HOLD[m]=0;if(e.code==='KeyW')HOLD.wu=0;if(e.code==='KeyS')HOLD.wd=0;});
addEventListener('blur',()=>{HOLD.up=HOLD.dn=HOLD.lf=HOLD.rt=HOLD.wu=HOLD.wd=0;});

/* ---------- frame ---------- */
function resize(){const w=stage.clientWidth,h=stage.clientHeight;R.setSize(w,h,false);cam.aspect=w/h;cam.updateProjectionMatrix();}
new ResizeObserver(resize).observe(stage);resize();
const clock=makeClock();const st=$('#status');
function loop(){if(!window.__paused)requestAnimationFrame(loop);frame(Math.min(.05,clock.getDelta()));}
function frame(dt,nr){
  S.speed=ease(S.speed,S.tSpeed,S.tSpeed>S.speed?.8:1.4,dt);const v=S.speed;
  S.dist+=v*dt;LAND.u-=v*dt;placeTiles();
  if(RIG){
    const cfg=RIG.cfg,dr=cfg.drive;
    S.steer=ease(S.steer,(cfg.wheels&&v>2)?Math.sin(S.dist*.08)*6:0,2,dt);
    if(dr){
      const AF=dr.axF,AR=dr.axR,TR=dr.tr;
      const hfl=hAt(AF,TR),hfr=hAt(AF,-TR),hrl=hAt(AR,TR),hrr=hAt(AR,-TR),hf=(hfl+hfr)/2,hr=(hrl+hrr)/2,hy=((hf+hr)/2*.5+Math.min(hfl,hfr,hrl,hrr)*.5)+(dr.dy!==undefined?dr.dy:-.07),pitch=Math.atan2(hf-hr,AF-AR),roll=Math.atan(((hfr+hrr)-(hfl+hrl))/2/(2*TR));
      S.bounce=v>1?Math.sin(S.dist*1.7)*.016+Math.sin(S.dist*4.3)*.006:S.bounce*.9;
      truck.position.y=ease(truck.position.y,hy+S.bounce,6,dt);truck.rotation.z=ease(truck.rotation.z,pitch*.9,6,dt);
      truck.rotation.x=ease(truck.rotation.x,roll*.9+(v>1?Math.sin(S.dist*1.1)*.006:0),4,dt);
    }
    for(const k in S.cool)if(S.cool[k]>0){S.cool[k]=Math.max(0,S.cool[k]-dt);if(S.cool[k]===0)updateChips();}
    if(S.atgmQ>0&&Object.keys(RIG.subs).every(id=>S.sub[id]>.97)&&cfg.weapons&&cfg.weapons.V){S.atgmQ=0;launchATGM();}
    else if(S.atgmHold>0&&!S.atgmQ){S.atgmHold-=dt;if(S.atgmHold<=0)updateChips();}
    if(S.reloadT>0){S.reloadT-=dt;if(S.reloadT<=0){S.reloadT=0;S.ammo=cfg.weapons.V.ammo;S.toast='Ракети на місці · '+S.ammo;S.toastT=2;applyAmmo();}}
    poseRig(dt);
    burstStep(dt);
    stepFX(dt);
  }
  const tgt=FX.rk.length&&S.follow?FX.rk[0].m.position:null;
  if(tgt){_w.copy(tgt).sub(ctl.target).multiplyScalar(1-Math.exp(-4*dt));ctl.target.add(_w);cam.position.add(_w);}
  else if(S.follow&&RIG&&ctl.target.distanceTo(new T.Vector3(...V.cfg.cam.t))>.5){_w.set(...V.cfg.cam.t).sub(ctl.target).multiplyScalar(1-Math.exp(-2*dt));ctl.target.add(_w);cam.position.add(_w);}
  S.toastT-=dt;const ph=PH[S.phase];let text=S.toastT>0?S.toast:ph.st.replace('{v}',Math.round(S.speed*3.6));
  if(RIG&&S.toastT<=0){const cfg=RIG.cfg;
    if(cfg.crane&&S.speed<.4)text+=' · кран: стріла '+Math.round(S.boom)+'°, поворот '+Math.round(S.slew)+'°';
    else if(cfg.turret&&(S.yaw!==0||S.elev!==0))text+=' · башта '+Math.round(S.yaw/D2R)+'°, ствол '+Math.round(S.elev)+'°';}
  if(st.textContent!==text)st.textContent=text;st.classList.toggle('toast',S.toastT>0);
  if(RIG&&(S._a!==S.ammo||S._p!==S.phase)){S._a=S.ammo;S._p=S.phase;updateChips();applyAmmo();}
  ctl.update();if(!nr)R.render(scene,cam);
}

/* ---------- boot ---------- */
window.__tick=(n,dt)=>{for(let i=0;i<n;i++)frame(dt||1/30,i<n-1);};window.__snap=()=>{frame(0);return cv.toDataURL('image/png');};
window.__S=S;window.__setPhase=setPhase;window.__fire=doFire;window.__sel=selectVehicle;window.__cam3=(p,t)=>{cam.position.set(...p);ctl.target.set(...t);ctl.update();};
window.__ready=()=>!!RIG&&LAND.ready&&!switching;window.__RIG=()=>RIG;window.__FX=FX;window.__LAND=LAND;window.__HOLD=HOLD;window.__M=()=>M;window.__truck=truck;
window.__parts=()=>{const o={};for(const k in M.parts)o[k]=M.parts[k].reduce((a,[s,t])=>a+t.length,0);return o;};
const first=new URLSearchParams(location.search).get('m')||META.order[0];
selectVehicle(window.__first||first);
setTimeout(loadLand,600);
loop();
