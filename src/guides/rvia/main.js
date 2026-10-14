// Довідник РВіА EasyWAR: ракетні комплекси, РСЗВ, САУ й гаубиці з фазами стоянка — марш — вогнева позиція — згортання,
// підйомом пускової, пострілом і перезаряджанням. Код перенесено з опублікованого інтерактивного довідника; змінено лише завантаження:
// моделі читаються з локальних файлів `models/*.glb`, three береться з npm (без CDN), шрифти — локальні (../fonts).
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {RoomEnvironment} from '../room-env.js';
import {toCreasedNormals} from 'three/addons/utils/BufferGeometryUtils.js';
import {fetchBuffer, makeClock} from '../guide-kit.js';
import {creditHtml} from '../credits.js';
import {MODEL_URLS, LAND_URL} from './models.js';
import {META} from './meta.js';

const $=s=>document.querySelector(s);
const T=THREE,PI=Math.PI,D2R=PI/180;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const ease=(c,t,k,dt)=>c+(t-c)*(1-Math.exp(-k*dt));
const smooth=x=>{x=clamp(x,0,1);return x*x*(3-2*x);};
const lerp=(a,b,t)=>a+(b-a)*t;
const stage=$('#stage'),cv=$('#cv');

/* ---------- renderer / scene ---------- */
const R=new T.WebGLRenderer({canvas:cv,antialias:true});
R.setPixelRatio(Math.min(devicePixelRatio,2));R.toneMapping=T.ACESFilmicToneMapping;R.toneMappingExposure=1;R.outputColorSpace=T.SRGBColorSpace;
R.setClearColor(0x111214);
const scene=new T.Scene();scene.fog=new T.Fog(0x111214,55,125);
scene.environment=new T.PMREMGenerator(R).fromScene(new RoomEnvironment(),0.04).texture;
const sun=new T.DirectionalLight(0xfff1dc,1.6);sun.position.set(18,26,12);scene.add(sun);
scene.add(new T.HemisphereLight(0xcfd6c8,0x1a1c18,.5));
const cam=new T.PerspectiveCamera(32,1,.1,500);
const ctl=new OrbitControls(cam,cv);ctl.enableDamping=true;ctl.dampingFactor=.08;ctl.minDistance=3;ctl.maxDistance=70;ctl.maxPolarAngle=PI*.49;ctl.enablePan=false;
cam.position.set(15,5.6,12.5);ctl.target.set(-.5,2.2,0);
cv.addEventListener('pointerdown',()=>cv.classList.add('drag'));addEventListener('pointerup',()=>cv.classList.remove('drag'));

const world=new T.Group();scene.add(world);
const truck=new T.Group();world.add(truck);
const GY=0;
const X3=new T.Vector3(1,0,0),Y3=new T.Vector3(0,1,0);

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
const lidMat=new T.MeshStandardMaterial({color:0x56603f,metalness:.2,roughness:.75});
const padMat=new T.MeshStandardMaterial({color:0x2c2f33,metalness:.3,roughness:.7});
const oliveMat=new T.MeshStandardMaterial({color:0x4d5540,metalness:.15,roughness:.8});
const tyreMat=new T.MeshStandardMaterial({color:0x17181a,metalness:.1,roughness:.9});
const glassMat=new T.MeshStandardMaterial({color:0x20282c,metalness:.6,roughness:.2});

/* ---------- catalog ---------- */
// Model-space coordinates: +X forward (travel), +Y up, Z across. 'type': tel (rocket TEL), mlrs (tube pack), spg (self-propelled gun), towed (trailed gun).
const PH_SELF=['Стоянка','Марш','Вогнева позиція','Згортання'],PH_TOW=['Похідне','Буксирування','Бойове положення','Згортання'];
const VEH={
 sapsan:{cat:0,type:'tel',label:'Сапсан',name:'Сапсан · ОТРК',
   pivot:[-5.3,1.45],sgn:1,E0:0,Et:0,elev:80,elevMin:60,elevMax:88,travMax:0,liftTime:7,
   jack:{x:-4.95,z:1.45,y:1.2},lifts:{anchor:[-3.4,1.05],att:[3.6,-.24],z:.9},
   tubes:[{p:[2.245,2.39,-.92],d:[1,0,0]},{p:[2.245,2.39,.92],d:[1,0,0]}],lids:{r:.5},
   rocket:{L:7,r:.42,kind:'otrk',boost:4.6,acc:30,fs:5.5},march:16,tint:0xb4bc98,
   desc:'Український оперативно-тактичний ракетний комплекс на п\'ятивісному колісному шасі. У цій моделі на пусковій два транспортно-пускові контейнери поруч. У похідному положенні вони лежать, на позиції піднімаються майже вертикально, круглі люки в носі відкриваються перед пуском.',
   how:'Спершу опускаються задні опори, потім пускова піднімається; кришки відкриваються перед першим пуском. Пуск — по одній ракеті з кожного контейнера.'},
 tochka:{cat:0,type:'tel',label:'Точка-У',name:'Точка-У · ОТРК',
   pivot:[-5.175,2.794],sgn:1,E0:90,Et:0,elev:88,elevMin:72,elevMax:90,travMax:0,liftTime:7,jackModel:true,
   rocket:{kind:'clone',boost:4.2,acc:30,fs:5},march:14,
   desc:'Радянський оперативно-тактичний ракетний комплекс 9К79-1 на плаваючому колісному шасі 6×6. За відкритими даними, наближено, дальність пуску — до 120 км. Ракета лежить на підйомній балці й у похідному положенні спрямована вперед.',
   how:'Чотири опори опускаються, балка з ракетою піднімається до вертикалі, ракета стартує з димом і вогнем. У моделі ракета — окремий об\'єкт, тож летить саме вона.'},
 vilkha:{cat:1,type:'mlrs',label:'Вільха',name:'Вільха · Р-624',
   pivot:[-5.3,1.3],sgn:1,E0:0,Et:0,elev:45,elevMin:15,elevMax:65,travMax:30,liftTime:4.5,
   jack:{x:-5.3,z:1.55,y:1.3},lifts:{anchor:[-.8,1.2],att:[5.6,-.02],z:.62},procedural:true,
   rocket:{L:7.4,r:.14,kind:'mlrs',boost:3.0,acc:34,fs:3},march:16,
   desc:'Українська реактивна система залпового вогню калібру 300 мм на колісному шасі 8×8, дванадцять труб у три ряди. Це процедурна модель EasyWAR, а не скан чи чужий ресурс.',
   how:'Опори опускаються, пакет піднімається й повертається в обидва боки; у кожної труби є червона кришка, яку ракета зриває.'},
 uragan:{cat:1,type:'mlrs',label:'Ураган',name:'Ураган · БМ-27',
   pivot:[2.2,2.3],yawX:1.0,sgn:-1,E0:-3.8,Et:-3.8,elev:45,elevMin:10,elevMax:55,travMax:30,liftTime:5,
   jack:{x:-3.1,z:1.25,y:1.0},
   rocket:{L:5.2,r:.12,kind:'mlrs',boost:2.6,acc:34,fs:3},march:16,
   desc:'Радянська 220-мм РСЗВ 9К57 «Ураган» (БМ-27) на колісному шасі 8×8 із шістнадцятьма трубами пакета. За відкритими даними, наближено, дальність — до 35 км. Труби дивляться назад: пакет піднімається за кормою, а шарнір — спереду.',
   how:'Задні опори опускаються, пакет піднімається й повертається в обидва боки; пускові труби відкриті, ракети виходять із задніх торців.'},
 bastion:{cat:1,type:'mlrs',label:'Бастіон-01',name:'Бастіон-01 · РСЗВ',
   pivot:[-.45,2.65],yawX:-1.6,sgn:-1,E0:-13,Et:-13,elev:45,elevMin:10,elevMax:55,travMax:30,liftTime:5,
   jack:{x:-3.0,z:1.2,y:1.0},
   rocket:{L:2.9,r:.061,kind:'mlrs',boost:2.0,acc:30,fs:2},march:16,
   desc:'Українська РСЗВ під 122-мм ракети типу «Град»: сорок напрямних у чотири ряди по десять. За відкритими даними, наближено. Напрямні пакета лежать під невеликим нахилом дульним зрізом назад.',
   how:'Спершу опори, потім підйом пакета. Залп іде по одній напрямній із перемішуванням, щоб не навантажувати одну сторону.'},
 caesar:{cat:2,type:'spg',label:'CAESAR',name:'CAESAR · 155-мм САУ',
   E0:10,Et:10,elev:38,elevMin:3,elevMax:66,travMax:18,liftTime:4,turnTime:4,rounds:6,
   spade:{h:[-2.9,1.3],up:-.95,down:.35},muzzle:[4.822,3.445,0],yaw:[-3.0,0],trun:[-1.5],recoil:.4,
   shell:{v:105},march:15,paint:'caesar',
   desc:'Французька 155-мм колісна самохідна гармата на шасі 6×6. За відкритими даними, наближено, довжина ствола — 52 калібри. Ствол у поході дивиться вперед, а до стрільби гармата розвертається й б\'є назад.',
   how:'Спочатку опускається сошник, потім гарматна установка розвертається на 180°, і лише тоді ствол піднімається. Постріл: спалах, дим, відкат ствола, снаряд.'},
 bogdana:{cat:2,type:'spg',label:'Богдана',name:'Богдана · 2С22',
   E0:6.5,Et:6.5,elev:40,elevMin:5,elevMax:65,travMax:18,liftTime:4,turnTime:4,rounds:6,
   spade:{h:[-4.45,1.35],up:0,down:.9},muzzle:[2.884,3.707,0],yaw:[-4.1,0],trun:[-3.7],recoil:.45,
   shell:{v:105},march:15,paint:'bogdana',
   desc:'Українська 155-мм колісна самохідна гармата 2С22 «Богдана» на шасі 6×6. За відкритими даними, наближено, калібр — 155 мм. Башта розвертається назад, сошник упирається в ґрунт.',
   how:'Спочатку опускається сошник, потім башта розвертається на 180°, і лише тоді ствол піднімається. Постріл: спалах, дим, відкат ствола, снаряд.'},
 m10:{cat:3,type:'towed',label:'М-10',name:'М-10 · 152-мм гаубиця',
   elev:35,elevMin:3,elevMax:60,travMax:8,liftTime:3.5,rounds:6,recoil:.4,Et:2,
   shell:{v:95},march:7,tractor:true,
   desc:'Радянська 152-мм гаубиця зразка 1938 року. Дві станини розсуваються в бойовому положенні, в похідному зводяться докупи під гак тягача.',
   how:'Тягач відчіплюється й від\'їжджає, станини розсуваються, ствол піднімається. Буксирування — з умовним тягачем, який показано спрощеним силуетом.'},
 giatsint:{cat:3,type:'towed',label:'Гіацинт-Б',name:'Гіацинт-Б · 2А36',
   elev:30,elevMin:0,elevMax:45,travMax:8,liftTime:3.5,rounds:6,recoil:.55,Et:2,
   shell:{v:120},march:7,tractor:true,
   desc:'Радянська 152-мм далекобійна буксирувана гармата 2А36 «Гіацинт-Б». За відкритими даними, наближено, довжина — понад 12 м у похідному положенні. Станини розсуваються в обидва боки, ствол довгий.',
   how:'Тягач відчіплюється й від\'їжджає, станини розсуваються, ствол піднімається. Буксирування — з умовним тягачем, який показано спрощеним силуетом.'},
 d30:{cat:3,type:'towed',label:'Д-30',name:'Д-30 · 122-мм гаубиця',
   elev:45,elevMin:-3,elevMax:70,travMax:8,liftTime:3.5,rounds:6,recoil:.22,Et:0,
   shell:{v:95},march:7,tractor:true,paint:'olive',
   desc:'Радянська 122-мм гаубиця 2А18 (Д-30). У моделі є дві станини; в бойовому положенні гармата опускається на опорну плиту, а колеса піднімаються.',
   how:'Тягач відчіплюється й від\'їжджає, станини розсуваються, колеса піднімаються, ствол піднімається. Буксирування — з умовним тягачем, який показано спрощеним силуетом.'},
 fh70:{cat:3,type:'towed',label:'FH-70',name:'FH-70 · 155-мм гаубиця',
   elev:40,elevMin:0,elevMax:70,travMax:8,liftTime:3.5,rounds:6,recoil:.5,Et:2,
   shell:{v:105},march:7,tractor:true,
   desc:'Буксирувана 155-мм гаубиця FH-70 британсько-німецько-італійської розробки. За відкритими даними, наближено, довжина в похідному положенні — близько 9,8 м. Станини розсуваються, гармата опускається на опори.',
   how:'Тягач відчіплюється й від\'їжджає, станини розсуваються, ствол піднімається. Буксирування — з умовним тягачем, який показано спрощеним силуетом.'},
 m198:{cat:3,type:'towed',label:'M198',name:'M198 · 155-мм гаубиця',
   elev:40,elevMin:0,elevMax:72,travMax:8,liftTime:3.5,rounds:6,recoil:.55,Et:2,
   shell:{v:105},march:7,tractor:true,
   desc:'Американська буксирувана 155-мм гаубиця M198. За відкритими даними, наближено, довжина в похідному положенні — близько 12 м. Дві довгі станини розсуваються в бойовому положенні.',
   how:'Тягач відчіплюється й від\'їжджає, станини розсуваються, ствол піднімається. Буксирування — з умовним тягачем, який показано спрощеним силуетом.'}
};
const VK=Object.keys(VEH);
let V=null,M=null;
const cache={};

/* ---------- mesh surgery (from the Sapsan page) ---------- */
const _p=new T.Vector3();
function compsOf(geo){ // connected components of triangles, welding vertices by position
  const pa=geo.attributes.position,n=pa.count,map=new Map(),rep=new Int32Array(n),par=[];
  const find=a=>{while(par[a]!==a){par[a]=par[par[a]];a=par[a];}return a;};
  for(let i=0;i<n;i++){const k=Math.round(pa.getX(i)*1e3)+','+Math.round(pa.getY(i)*1e3)+','+Math.round(pa.getZ(i)*1e3);let r=map.get(k);if(r===undefined){r=par.length;par.push(r);map.set(k,r);}rep[i]=r;}
  const ix=geo.index.array,nt=ix.length/3;
  for(let t=0;t<nt;t++){const a=find(rep[ix[t*3]]),b=find(rep[ix[t*3+1]]),c=find(rep[ix[t*3+2]]);if(a!==b)par[b]=a;if(find(c)!==find(a))par[find(c)]=find(a);}
  const ids=new Map(),face=new Int32Array(nt),bb=[];
  for(let t=0;t<nt;t++){const r=find(rep[ix[t*3]]);let id=ids.get(r);if(id===undefined){id=bb.length;ids.set(r,id);bb.push(new T.Box3());}face[t]=id;
    for(let k=0;k<3;k++)bb[id].expandByPoint(_p.fromBufferAttribute(pa,ix[t*3+k]));}
  return {face,bb};
}
function subMesh(src,tris,mat){
  const ix=src.geometry.index.array,out=new Uint32Array(tris.length*3);tris.forEach((t,i)=>{out[i*3]=ix[t*3];out[i*3+1]=ix[t*3+1];out[i*3+2]=ix[t*3+2];});
  const g=new T.BufferGeometry();for(const k in src.geometry.attributes)g.setAttribute(k,src.geometry.attributes[k]);g.setIndex(new T.BufferAttribute(out,1));
  const m=new T.Mesh(g,mat||src.material);m.name=src.name+'_part';return m;
}
function triCentroids(geo){const pa=geo.attributes.position,ix=geo.index.array,nt=ix.length/3,c=new Float32Array(nt*3);
  for(let t=0;t<nt;t++){let x=0,y=0,z=0;for(let k=0;k<3;k++){const i=ix[t*3+k];x+=pa.getX(i);y+=pa.getY(i);z+=pa.getZ(i);}c[t*3]=x/3;c[t*3+1]=y/3;c[t*3+2]=z/3;}return c;}

/* ---------- loading: bake node transforms into the geometry so everything is in model space ---------- */
function bakeGeo(o){
  const src=o.geometry,g=new T.BufferGeometry();
  for(const name of ['position','normal','uv']){const at=src.attributes[name];if(!at)continue;const n=at.itemSize,f=new Float32Array(at.count*n);
    for(let i=0;i<at.count;i++){f[i*n]=at.getX(i);if(n>1)f[i*n+1]=at.getY(i);if(n>2)f[i*n+2]=at.getZ(i);}
    g.setAttribute(name,new T.BufferAttribute(f,n));}
  if(src.index)g.setIndex(new T.BufferAttribute(new Uint32Array(src.index.array),1));
  g.applyMatrix4(o.matrixWorld);
  return g;
}
const matFix=new Map();
function fixMat(mat){
  let r=matFix.get(mat.uuid);if(r)return r;
  // GLB з alphaMode BLEND ставить depthWrite=false: після переходу на alphaTest матеріал має писати глибину,
  // інакше порядок малювання (за id матеріалу) вирішує, чи ландшафт перекриє деталь.
  r=mat.clone();if(r.transparent){r.transparent=false;r.alphaTest=.5;}r.depthWrite=true;
  r.flatShading=false;r.side=T.FrontSide;if(r.map){r.map.colorSpace=T.SRGBColorSpace;r.map.anisotropy=4;}
  r.metalness=Math.min(r.metalness,.3);if(r.roughness<.5)r.roughness=.6;r.needsUpdate=true;matFix.set(mat.uuid,r);return r;
}
async function loadMeshes(m){
  const gl=await parseGLB(await fetchBuffer(MODEL_URLS[m.key]));
  const sc=gl.scene;sc.updateMatrixWorld(true);
  const list=[];sc.traverse(o=>{if(o.isMesh)list.push(o);});
  for(const o of list){
    let g=bakeGeo(o);const hadN=!!g.attributes.normal;
    const tris=(g.index?g.index.count:g.attributes.position.count)/3;
    if(!hadN&&!m.cfg.procedural&&tris<160000)g=toCreasedNormals(g,.8);
    let mat=fixMat(o.material);if(m.cfg.tint&&mat.map){mat=mat.clone();mat.color.setHex(m.cfg.tint);}
    const mesh=new T.Mesh(g,mat);
    mesh.name=o.name.replace(/__\d+$/,'');mesh.userData.tris=tris;
    (m.by[mesh.name]=m.by[mesh.name]||[]).push(mesh);m.all.push(mesh);
  }
}
function paintAll(m){
  const p=m.cfg.paint;if(!p)return;
  const paint=(me,hex)=>{const mt=me.material.clone();mt.map=null;mt.color.setHex(hex);mt.metalness=.1;mt.roughness=.8;me.material=mt;};
  m.all.forEach(me=>{const wheel=/^w\d?[LR]$/.test(me.name);
    if(p==='caesar'||p==='olive'){paint(me,wheel?0x1d1e1c:0x666b4c);}
    else if(p==='bogdana'){const c=me.material.color;
      if(wheel)paint(me,0x1d1e1c);
      else if(me.material.map)paint(me,me.name==='spade'?0x4f5540:0x626848);
      else if((c.r+c.g+c.b)/3>.6)paint(me,0x5a6044);}
  });
}

/* ---------- hierarchy helpers ---------- */
// hinge(parent,[x,y,z]): g sits at the pivot (given in the parent's model-space frame); c is a model-space frame again.
function hinge(parent,p){const g=new T.Group();g.position.set(p[0],p[1],p[2]||0);parent.add(g);const c=new T.Group();c.position.set(-p[0],-p[1],-(p[2]||0));g.add(c);return {g,c};}
function take(m,names){const out=[];names.forEach(n=>(m.by[n]||[]).forEach(me=>{if(!me.userData.used){me.userData.used=1;out.push(me);}}));return out;}
function put(m,parent,names){take(m,names).forEach(me=>parent.add(me));}
function bbOf(meshes){const b=new T.Box3();meshes.forEach(me=>{me.geometry.computeBoundingBox();b.union(me.geometry.boundingBox);});return b;}

function wheelsFromMeta(m,meta){
  let sr=0,sz=0;
  for(const w of meta.wheels){
    const g=new T.Group();g.position.set(w.c[0],w.c[1],w.c[2]);m.root.add(g);
    const sp=new T.Group();g.add(sp);
    for(const me of (m.by[w.n]||[])){me.userData.used=1;
      if(me.userData.tris<20){m.root.add(me);continue;} // thin slivers stay with the body
      me.position.set(-w.c[0],-w.c[1],-w.c[2]);sp.add(me);}
    m.wheels.push(sp);if(meta.steer&&meta.steer.includes(w.n))m.front.push(g);
    sr+=w.r;sz+=Math.abs(w.c[2]);
  }
  const xs=meta.wheels.map(w=>w.c[0]);m.axF=Math.max(...xs);m.axR=Math.min(...xs);
  m.WR=sr/meta.wheels.length;m.wz=sz/meta.wheels.length;
}
function vilkhaWheels(m){ // procedural model: tyres, rims and bolts are three meshes, split per wheel by triangle position
  const tyres=m.by.tyres[0],rims=m.by.rims[0],bolts=m.by.wheel_bolts[0];[tyres,rims,bolts].forEach(x=>x.userData.used=1);
  const rc=triCentroids(rims.geometry),xs=[];for(let t=0;t<rc.length/3;t++)xs.push(rc[t*3]);xs.sort((a,b)=>a-b);
  const axles=[];xs.forEach(x=>{const l=axles[axles.length-1];if(!l||x-l.s/l.n>.7)axles.push({s:x,n:1});else{l.s+=x;l.n++;}});
  const AX=axles.map(a=>a.s/a.n);rims.geometry.computeBoundingBox();const bbR=rims.geometry.boundingBox,wy=(bbR.min.y+bbR.max.y)/2;
  tyres.geometry.computeBoundingBox();const bt=tyres.geometry.boundingBox,WR=(bt.max.y-bt.min.y)/2,wz=1.19;
  const parts=[tyres,rims,bolts],pc=parts.map(p=>triCentroids(p.geometry)),wheelG=[];
  for(let a=0;a<AX.length;a++)for(let s=0;s<2;s++){const g=new T.Group();g.position.set(AX[a],wy,s?wz:-wz);m.root.add(g);const spin=new T.Group();g.add(spin);wheelG.push({g,spin,a,s,tris:[[],[],[]]});}
  parts.forEach((p,pi)=>{const c=pc[pi],nt=c.length/3;
    for(let t=0;t<nt;t++){const cx=c[t*3];let best=0,bd=1e9;for(let a=0;a<AX.length;a++){const d=Math.abs(cx-AX[a]);if(d<bd){bd=d;best=a;}}
      const s=c[t*3+2]>0?1:0;wheelG[best*2+s].tris[pi].push(t);}});
  wheelG.forEach(w=>{parts.forEach((p,pi)=>{if(!w.tris[pi].length)return;const mesh=subMesh(p,w.tris[pi]);mesh.position.set(-w.g.position.x,-w.g.position.y,-w.g.position.z);w.spin.add(mesh);});
    m.wheels.push(w.spin);if(w.a>=AX.length-2)m.front.push(w.g);});
  m.axF=AX[AX.length-1];m.axR=AX[0];m.WR=WR;m.wz=wz;
}

/* ---------- builders ---------- */
function procJacks(m,j){
  const Lfull=j.y-.1,Lmin=Math.max(.25,Lfull*.38);
  m.jacks=[-1,1].map(s=>{const g=new T.Group();g.position.set(j.x,j.y,s*j.z);m.root.add(g);
    const body=new T.Mesh(new T.CylinderGeometry(.13,.13,.7,16),steelMat);body.position.y=-.2;g.add(body);
    const rod=new T.Mesh(new T.CylinderGeometry(.08,.08,1,14),rodMat);g.add(rod);
    const pad=new T.Mesh(new T.CylinderGeometry(.3,.34,.1,20),padMat);g.add(pad);return {g,rod,pad,Lmin,Lfull};});
}
function procLifts(m,l){
  m.lifts=[-1,1].map(s=>{const g=new T.Group();m.root.add(g);
    const body=new T.Mesh(new T.CylinderGeometry(.13,.13,1,16),steelMat);body.position.y=.5;g.add(body);
    const rod=new T.Mesh(new T.CylinderGeometry(.085,.085,1,14),rodMat);g.add(rod);return {g,body,rod,z:s*l.z};});
}
function buildLauncher(m){
  const cfg=m.cfg,meta=m.meta;
  if(cfg.procedural)vilkhaWheels(m);else wheelsFromMeta(m,meta);
  const [px,py]=cfg.pivot,yx=cfg.yawX!==undefined?cfg.yawX:px;
  m.yaw=hinge(m.root,[yx,0,0]);m.pitch=hinge(m.yaw.c,[px,py,0]);m.frame=m.pitch.c;
  m.tubes=[];
  if(m.key==='sapsan'){
    put(m,m.frame,['cont']);
    cfg.tubes.forEach(t=>m.tubes.push({p:new T.Vector3(...t.p),d:new T.Vector3(...t.d)}));
    m.lids=cfg.tubes.map(t=>{const fx=t.p[0],fy=t.p[1],fz=t.p[2];
      const hole=new T.Mesh(new T.CircleGeometry(cfg.lids.r-.02,40),darkMat);hole.rotation.y=PI/2;hole.position.set(fx+.004,fy,fz);m.frame.add(hole);
      const h=new T.Group();h.position.set(fx+.012,fy+cfg.lids.r,fz);m.frame.add(h);
      const lid=new T.Mesh(new T.CylinderGeometry(cfg.lids.r+.04,cfg.lids.r+.04,.07,40),lidMat);lid.rotation.z=PI/2;lid.position.set(.035,-cfg.lids.r,0);h.add(lid);
      const ring=new T.Mesh(new T.TorusGeometry(cfg.lids.r+.02,.03,8,40),steelMat);ring.rotation.y=PI/2;ring.position.set(.07,-cfg.lids.r,0);h.add(ring);return h;});
  }else if(m.key==='tochka'){
    m.missileG=new T.Group();m.frame.add(m.missileG);put(m,m.missileG,['missile']);put(m,m.frame,['erector']);
    const ms=meta.missile;m.tubes.push({p:new T.Vector3(ms.base[0],ms.base[1]+ms.len,0),d:new T.Vector3(0,1,0)});
    cfg.rocket.L=ms.len;cfg.rocket.r=ms.r;m.missileCtr=new T.Vector3(ms.base[0],ms.base[1]+ms.len/2,0);
    m.jackG=[];meta.jacks.forEach(j=>{const g=new T.Group();m.root.add(g);put(m,g,[j.n]);m.jackG.push({g,dy:j.dy});});
  }else if(cfg.procedural){
    const launch=m.by.housing[0];launch.userData.used=1;put(m,m.root,['chassis','cab']);
    const {face,bb}=compsOf(launch.geometry),nt=face.length,capTris=new Map();
    bb.forEach((b,id)=>{if(b.min.x>3.45&&b.max.x-b.min.x<.2)capTris.set(id,[]);});
    const rest=[];for(let t=0;t<nt;t++){const l=capTris.get(face[t]);if(l)l.push(t);else rest.push(t);}
    const pack=subMesh(launch,rest);m.frame.add(pack);
    const TUB=[];for(let r=0;r<3;r++)for(let c=0;c<4;c++)TUB.push({y:2.72-r*.3,z:.45-c*.3});
    TUB.forEach(tb=>m.tubes.push({p:new T.Vector3(3.56,tb.y,tb.z),d:new T.Vector3(1,0,0)}));
    capTris.forEach((tris,id)=>{const b=bb[id],cz=(b.min.z+b.max.z)/2,cy=(b.min.y+b.max.y)/2;let k=0,bd=9;TUB.forEach((tb,i)=>{const d=Math.hypot(tb.z-cz,tb.y-cy);if(d<bd){bd=d;k=i;}});
      const cap=subMesh(launch,tris);const g=new T.Group();g.position.set((b.min.x+b.max.x)/2,cy,cz);cap.position.set(-g.position.x,-g.position.y,-g.position.z);g.add(cap);m.frame.add(g);m.caps[k]=g;});
    TUB.forEach(tb=>{const h=new T.Mesh(new T.CircleGeometry(.125,24),darkMat);h.rotation.y=PI/2;h.position.set(3.455,tb.y,tb.z);m.frame.add(h);});
  }else{ // uragan, bastion
    put(m,m.frame,['pack']);
    meta.tubes.forEach(t=>m.tubes.push({p:new T.Vector3(...t.p),d:new T.Vector3(...t.d).normalize()}));
  }
  if(cfg.jack)procJacks(m,cfg.jack);
  if(cfg.lifts)procLifts(m,cfg.lifts);
  m.stages=[{k:'jack',T:2.2},{k:'lift',T:cfg.liftTime}];
  m.ammo=m.tubes.length;
  m.len=meta?meta.len:11.6;
}
function buildGun(m){
  const cfg=m.cfg,meta=m.meta;wheelsFromMeta(m,meta);
  const isSpg=cfg.type==='spg';
  let mz,ax,tx,yaw;
  if(isSpg){mz=cfg.muzzle;ax=[Math.cos(cfg.E0*D2R),Math.sin(cfg.E0*D2R)];tx=cfg.trun[0];yaw=[cfg.yaw[0],cfg.yaw[1]];cfg.E0n=cfg.E0;}
  else{mz=meta.muzzle;const a=meta.axisDir,l=Math.hypot(a[0],a[1]);ax=[a[0]/l,a[1]/l];tx=meta.trun[0];yaw=[tx,0];cfg.E0=Math.atan2(ax[1],-ax[0])/D2R;cfg.sgn=-1;}
  if(isSpg)cfg.sgn=1;
  const ty=mz[1]+(tx-mz[0])*ax[1]/ax[0];
  m.yawH=hinge(m.root,[yaw[0],0,yaw[1]]);m.pitchH=hinge(m.yawH.c,[tx,ty,0]);
  m.axis=new T.Vector3(ax[0],ax[1],0);m.tip=new T.Vector3(mz[0],mz[1],mz[2]||0);
  m.rec=new T.Group();m.pitchH.c.add(m.rec);
  put(m,m.rec,['barrel']);put(m,m.pitchH.c,['cradle']);
  if(isSpg){
    put(m,m.yawH.c,['gun','turret']);
    const sp=hinge(m.root,[cfg.spade.h[0],cfg.spade.h[1],0]);m.spadeH=sp;put(m,sp.c,['spade']);
    m.stages=[{k:'jack',T:2.2},{k:'turn',T:cfg.turnTime},{k:'lift',T:cfg.liftTime}];
    m.axF=m.axF;m.len=meta.len;
  }else{
    m.trails=[];
    ['L','R'].forEach(s=>{const t=meta['trail'+s];const h=hinge(m.root,[t.p[0],0,t.p[1]]);put(m,h.c,['trail'+s]);m.trails.push({h,close:t.close});});
    m.stages=[{k:'hitch',T:6.5},{k:'jack',T:3},{k:'lift',T:cfg.liftTime}];
    m.axF=m.axF+3;m.axR=m.axR-1;
    m.lift=meta.wheelBottom-meta.groundY;m.wb=meta.wheelBottom;m.gy=meta.groundY;
    m.len=meta.len;
    // hitch point: tip of the trails closed together
    const tb=bbOf(m.by.trailL||[]);const t=meta.trailL;const cl=Math.cos(t.close);
    m.hookX=t.p[0]+(Math.max(tb.max.x,t.p[0]+1)-t.p[0])*cl;
    m.tractor=buildTractor();
  }
  m.ammo=cfg.rounds;
}
function buildTractor(){
  const g=new T.Group(),body=oliveMat;
  const box=(x,y,z,w,h,d,mat)=>{const b=new T.Mesh(new T.BoxGeometry(w,h,d),mat||body);b.position.set(x,y,z);g.add(b);return b;};
  box(3.1,1.0,0,6.2,.34,1.5,steelMat);          // frame
  box(2.3,1.9,0,4.2,1.5,2.35);                 // cargo body
  box(2.3,2.7,0,4.2,.1,2.1,lidMat);            // tilt
  box(5.55,1.75,0,1.7,1.4,2.3);                // cab
  box(6.35,1.95,0,.08,.75,1.9,glassMat);       // windscreen
  box(6.25,1.0,0,.4,.5,2.2,steelMat);          // bumper
  const wheels=[];
  [1.1,2.5,4.9].forEach(x=>[-1,1].forEach(s=>{const w=new T.Group();w.position.set(x,.58,s*1.05);g.add(w);const sp=new T.Group();w.add(sp);
    const ty=new T.Mesh(new T.CylinderGeometry(.58,.58,.42,24),tyreMat);ty.rotation.x=PI/2;sp.add(ty);
    const hub=new T.Mesh(new T.CylinderGeometry(.28,.28,.44,16),steelMat);hub.rotation.x=PI/2;sp.add(hub);
    const lug=new T.Mesh(new T.BoxGeometry(.18,.9,.46),steelMat);sp.add(lug);wheels.push(sp);}));
  const bar=new T.Mesh(new T.BoxGeometry(1.1,.12,.12),darkMat);bar.position.set(-.5,.9,0);g.add(bar);
  return {g,wheels,bar};
}
async function build(key){
  if(cache[key])return cache[key];
  const cfg=VEH[key];
  const m={key,cfg,meta:null,root:new T.Group(),by:{},all:[],wheels:[],front:[],tubes:[],caps:[],lids:[],jacks:[],lifts:[],stages:[]};
  await loadMeshes(m);
  m.meta=META[key]||null;
  paintAll(m);
  if(cfg.type==='tel'||cfg.type==='mlrs')buildLauncher(m);else buildGun(m);
  Object.values(m.by).flat().forEach(me=>{if(!me.userData.used){me.userData.used=1;m.root.add(me);}});
  m.terr={AF:m.axF,AR:m.axR,TR:m.wz};
  m.root.updateMatrixWorld(true);
  const bb=new T.Box3().setFromObject(m.root);m.bb=bb;
  cache[key]=m;return m;
}

/* ---------- landscape (photogrammetry tiles scroll under the vehicle) ---------- */
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

/* ---------- state ---------- */
const S={phase:1,speed:0,tSpeed:0,steer:0,dist:0,jack:0,turn:0,lift:0,hitch:0,elev:45,trav:0,ammo:1,queue:0,fireT:0,
  lid:0,lidT:0,wait:0,reload:0,reloadT:0,bounce:0,toast:'',toastT:0,rec:0,recoil:0,cool:0,follow:false,tdist:0};
const isGun=()=>M&&(M.cfg.type==='spg'||M.cfg.type==='towed');

/* ---------- missiles / shells / effects ---------- */
const rkBody=new T.MeshStandardMaterial({color:0x8a8f84,metalness:.35,roughness:.5});
const rkDark=new T.MeshStandardMaterial({color:0x2d3128,metalness:.3,roughness:.6});
const rkNose=new T.MeshStandardMaterial({color:0x4e5744,metalness:.25,roughness:.6});
function makeRocket(sp){ // along +X, centred; nose at +L/2
  const L=sp.L,r=sp.r,g=new T.Group(),big=sp.kind==='otrk';
  const noseL=big?Math.min(1.7,L*.25):Math.min(1.1,L*.2),pts=[];
  const body=new T.Mesh(new T.CylinderGeometry(r,r,L-noseL-.2,28),rkBody);body.rotation.z=-PI/2;body.position.x=-L/2+.2+(L-noseL-.2)/2;g.add(body);
  for(let i=0;i<=14;i++){const f=i/14;pts.push(new T.Vector2(Math.max(.002,r*Math.sqrt(1-f*f*(big?.96:.9))*(1-f*.2)),f*noseL));}
  const nose=new T.Mesh(new T.LatheGeometry(pts,28),rkNose);nose.rotation.z=-PI/2;nose.position.x=L/2-noseL;g.add(nose);
  const tail=new T.Mesh(new T.CylinderGeometry(r*.78,r,.5,24),rkDark);tail.rotation.z=-PI/2;tail.position.x=-L/2+.1;g.add(tail);
  const band=new T.Mesh(new T.CylinderGeometry(r*1.005,r*1.005,.35,28),rkDark);band.rotation.z=-PI/2;band.position.x=L/2-noseL-.5;g.add(band);
  const fl=Math.min(big?1.1:.7,L*.15);
  for(let i=0;i<4;i++){const fin=new T.Mesh(new T.BoxGeometry(fl,r*.06+.01,r*(big?1.35:1.15)),rkDark);const h=new T.Group();h.rotation.x=i*PI/2+PI/4;fin.position.set(-L/2+.45,0,r*(big?.95:.8));h.add(fin);g.add(h);}
  return g;}
const FX={rk:[],sh:[],puffs:[],flashes:[],dust:[],deb:[]};
const efx=new T.Group();world.add(efx);
const _v=new T.Vector3(),_w=new T.Vector3(),_q=new T.Quaternion();
function muzzleW(k){const tb=M.tubes[k],p=tb.p.clone(),d=tb.d.clone();M.frame.updateWorldMatrix(true,false);M.frame.localToWorld(p);d.transformDirection(M.frame.matrixWorld).normalize();return {p,d};}
function gunMuzzleW(){const c=M.pitchH.c;c.updateWorldMatrix(true,false);const p=M.tip.clone();c.localToWorld(p);const d=M.axis.clone().transformDirection(c.matrixWorld).normalize();return {p,d};}
function hingeW(){const p=new T.Vector3(M.cfg.pivot?M.cfg.pivot[0]:0,.3,0);M.root.updateWorldMatrix(true,false);M.root.localToWorld(p);return p;}
function dust(at,n,big,spread){for(let i=0;i<n;i++){const s=sprite(puffTex,0xb9ad8f,(big?2:1.2)+Math.random()*2.2);s.position.copy(at).add(new T.Vector3((Math.random()-.5)*spread,Math.random()*.6,(Math.random()-.5)*spread));efx.add(s);FX.dust.push({s,t:0,vy:.5+Math.random(),vx:(Math.random()-.5)*3,vz:(Math.random()-.5)*3,life:2.8+Math.random()*1.6});}}
function puff(at,size,life,color,vy,grow){const s=sprite(puffTex,color||0xe3ddd0,size);s.position.copy(at);efx.add(s);FX.puffs.push({s,t:0,life,vy:vy||.6,grow:grow||1.8});}
function flash(at,size,color,life){const fl=sprite(glowTex,color||0xffe3b0,size,T.AdditiveBlending);fl.position.copy(at);efx.add(fl);FX.flashes.push({s:fl,t:0,life:life||.3});}
const canFire=()=>M&&S.phase===3&&!S.reload&&S.lift>.97&&S.ammo>0&&!S.wait&&S.cool<=0;
function ordFor(n){if(n<=2)return [...Array(n).keys()];if(n===12)return [0,3,1,2,4,7,5,6,8,11,9,10];const st=[7,5,3].find(s=>{let a=n,b=s;while(b){[a,b]=[b,a%b];}return a===1;});return [...Array(n).keys()].map(i=>(i*st)%n);}
function fireOne(){
  if(!canFire())return false;
  if(isGun())return fireGun();
  if(M.lids.length&&S.lid<.99){S.lidT=1;S.wait=1;S.toast='Кришки контейнерів відкриваються';S.toastT=1.2;return true;}
  return launch();}
function launch(){
  const sp=M.cfg.rocket,max=M.ammo,idx=max-S.ammo,k=M.ord[idx];S.ammo--;applyAmmo();
  const {p,d}=muzzleW(k),big=sp.kind!=='mlrs';
  let r,axis;
  if(sp.kind==='clone'){r=new T.Group();const cl=M.missileG.clone();cl.visible=true;cl.position.copy(M.missileCtr).negate();r.add(cl);M.missileG.visible=false;
    const c=M.missileCtr.clone();M.frame.localToWorld(c);r.position.copy(c);M.frame.getWorldQuaternion(_q);r.quaternion.copy(_q);axis=Y3;}
  else{r=makeRocket(sp);r.position.copy(p).addScaledVector(d,-(sp.L/2+.12));r.quaternion.setFromUnitVectors(X3,d);axis=X3;}
  const flame=sprite(glowTex,0xffc477,sp.fs,T.AdditiveBlending);flame.position.copy(axis).multiplyScalar(-(sp.L/2+(big?2.2:1.6)));r.add(flame);
  efx.add(r);
  const az=new T.Vector3(d.x,0,d.z);if(az.lengthSq()<1e-4)az.set(1,0,0);az.normalize();
  FX.rk.push({m:r,d:d.clone(),d0:d.clone(),q0:r.quaternion.clone(),az,v:.5,t:0,flame,life:0,big,sp,fs:sp.fs});
  S.recoil=1;S.toast='Пуск · '+M.cfg.label+(max>1?' · напрямна '+(k+1)+' з '+max:'');S.toastT=1.6;
  if(M.caps[k]&&M.caps[k].visible){const c=M.caps[k];c.visible=false;const cl=c.clone();cl.visible=true;const wp=new T.Vector3();c.getWorldPosition(wp);cl.position.copy(wp);cl.quaternion.setFromRotationMatrix(c.matrixWorld);cl.scale.set(1,1,1);efx.add(cl);
    FX.deb.push({m:cl,v:d.clone().multiplyScalar(14+Math.random()*6).add(new T.Vector3((Math.random()-.5)*4,2+Math.random()*3,(Math.random()-.5)*4)),w:new T.Vector3(Math.random()*8,Math.random()*8,Math.random()*8),t:0});}
  flash(p.clone().addScaledVector(d,.4),big?6:Math.max(3,sp.fs*1.4),0xffe3b0,.3);
  const hw=hingeW();const gr=hw.clone();gr.y=hAt(hw.x,hw.z)+.5;
  dust(gr,big?26:9,big,big?9:5);
  for(let i=0;i<(big?10:4);i++)puff(p.clone().add(new T.Vector3((Math.random()-.5)*2,(Math.random()-.5)*1.5,(Math.random()-.5)*2)),2+Math.random()*2,2.4+Math.random()*1.5);
  return true;}
const shellG=new T.CylinderGeometry(.075,.075,.5,10),shellM=new T.MeshStandardMaterial({color:0x9a8650,metalness:.6,roughness:.4});
function fireGun(){
  const {p,d}=gunMuzzleW();S.ammo--;applyAmmo();S.cool=1.1;S.rec=1;
  const sh=new T.Group();const body=new T.Mesh(shellG,shellM);body.rotation.z=-PI/2;sh.add(body);
  const tr=sprite(glowTex,0xffcf8a,.9,T.AdditiveBlending);sh.add(tr);
  sh.position.copy(p).addScaledVector(d,1.2);efx.add(sh);
  FX.sh.push({m:sh,vel:d.clone().multiplyScalar(M.cfg.shell.v),t:0,tr});
  flash(p.clone().addScaledVector(d,.6),M.cfg.type==='spg'?5.5:6.5,0xffe0a8,.14);flash(p.clone().addScaledVector(d,2),2.2,0xfff2d0,.09);
  for(let i=0;i<5;i++)puff(p.clone().addScaledVector(d,.5+i*.7).add(new T.Vector3((Math.random()-.5)*.8,(Math.random()-.5)*.8,(Math.random()-.5)*.8)),1.4+Math.random()*1.4,2.2+Math.random(),0xd6d0c4,.5,1.5);
  const gr=p.clone();gr.y=hAt(p.x,p.z)+.4;dust(gr,6,false,4);
  S.toast='Постріл · '+M.cfg.label+' · снарядів лишилось '+S.ammo;S.toastT=1.6;
  return true;}
function stepFX(dt){
  const g=9.8;
  FX.rk.forEach(k=>{k.t+=dt;k.life+=dt;const boost=k.t<k.sp.boost;
    if(boost){k.v+=(k.t<.5?k.sp.acc*.35:k.sp.acc)*dt;}else{k.flame.visible=false;}
    if(boost&&k.big&&k.t>1.6){const f=Math.min(1,(k.t-1.6)/3)*dt*.2;k.d.addScaledVector(k.az,f*k.v/18);k.d.normalize();}
    if(!boost){k.d.y-=g*dt/Math.max(20,k.v)*.9;k.d.normalize();}
    k.m.position.addScaledVector(k.d,k.v*dt);_q.setFromUnitVectors(k.d0,k.d);k.m.quaternion.copy(_q).multiply(k.q0);
    if(k.flame.visible)k.flame.scale.setScalar(k.fs*(.8+Math.random()*.4));
    if(boost&&FX.puffs.length<220&&Math.random()<.7){const s=sprite(puffTex,0xd9d4c8,(k.big?1.8:.9)+Math.random()*.9);s.position.copy(k.m.position).addScaledVector(k.d,-k.sp.L/2-1.2);efx.add(s);FX.puffs.push({s,t:0,life:2.4+Math.random()*2,vy:.35,grow:1.2});}
    const gy=hAt(k.m.position.x,k.m.position.z);
    if(k.m.position.y<gy||k.life>16||k.m.position.length()>(k.big?330:210)){
      if(k.m.position.y<gy+1&&k.life<16){flash(new T.Vector3(k.m.position.x,gy+1,k.m.position.z),k.big?30:14,0xffd08a,.5);
        for(let i=0;i<14;i++){const s=sprite(puffTex,0x6b6558,3+Math.random()*4);s.position.copy(k.m.position).add(new T.Vector3((Math.random()-.5)*4,0,(Math.random()-.5)*4));s.position.y=gy+.5;efx.add(s);FX.dust.push({s,t:0,vy:1.5+Math.random()*2,vx:(Math.random()-.5)*3,vz:(Math.random()-.5)*3,life:4});}
        S.toast='Розрив на дистанції '+Math.round(k.m.position.length())+' м (масштаб сцени)';S.toastT=2.5;}
      efx.remove(k.m);k.dead=true;}});
  FX.rk=FX.rk.filter(k=>!k.dead);
  FX.sh.forEach(k=>{k.t+=dt;k.vel.y-=g*dt*.5;k.m.position.addScaledVector(k.vel,dt);_v.copy(k.vel).normalize();k.m.quaternion.setFromUnitVectors(X3,_v);
    if(FX.puffs.length<220&&Math.random()<.5){const s=sprite(puffTex,0xe6e2d8,.7+Math.random()*.5);s.position.copy(k.m.position);efx.add(s);FX.puffs.push({s,t:0,life:1.6,vy:.2,grow:.9});}
    const gy=hAt(k.m.position.x,k.m.position.z);
    if(k.m.position.y<gy||k.m.position.length()>260){if(k.m.position.y<gy+1){flash(new T.Vector3(k.m.position.x,gy+.8,k.m.position.z),9,0xffd08a,.4);dust(new T.Vector3(k.m.position.x,gy+.4,k.m.position.z),8,true,6);}
      else{S.toast='Снаряд вийшов за межі сцени';S.toastT=2;}
      efx.remove(k.m);k.dead=true;}});
  FX.sh=FX.sh.filter(k=>!k.dead);
  FX.deb.forEach(o=>{o.t+=dt;o.v.y-=g*dt;o.m.position.addScaledVector(o.v,dt);o.m.rotation.x+=o.w.x*dt;o.m.rotation.y+=o.w.y*dt;o.m.rotation.z+=o.w.z*dt;
    if(o.t>2.5||o.m.position.y<hAt(o.m.position.x,o.m.position.z)){efx.remove(o.m);o.dead=true;}});
  FX.deb=FX.deb.filter(o=>!o.dead);
  const age=(arr,fn)=>{arr.forEach(o=>{o.t+=dt;fn(o);if(o.t>o.life){efx.remove(o.s);o.dead=true;}});return arr.filter(o=>!o.dead);};
  FX.puffs=age(FX.puffs,o=>{const f=o.t/o.life;o.s.position.y+=o.vy*dt;o.s.scale.setScalar(o.s.scale.x+dt*(o.grow||1.2));o.s.material.opacity=.55*(1-f);});
  FX.dust=age(FX.dust,o=>{const f=o.t/o.life;o.s.position.x+=o.vx*dt;o.s.position.z+=o.vz*dt;o.s.position.y+=o.vy*dt;o.vy*=.96;o.s.scale.setScalar(o.s.scale.x+dt*2.5);o.s.material.opacity=.7*(1-f);});
  FX.flashes=age(FX.flashes,o=>{const f=o.t/o.life;o.s.material.opacity=1-f;o.s.scale.setScalar(o.s.scale.x*(1+dt*6));});
}
function clearFX(){[...FX.rk.map(k=>k.m),...FX.sh.map(k=>k.m),...FX.deb.map(o=>o.m),...FX.puffs.map(o=>o.s),...FX.dust.map(o=>o.s),...FX.flashes.map(o=>o.s)].forEach(o=>efx.remove(o));FX.rk=[];FX.sh=[];FX.puffs=[];FX.flashes=[];FX.dust=[];FX.deb=[];}

/* ---------- pose ---------- */
const _qa=new T.Vector3(),_qb=new T.Vector3();
function poseModel(dt){
  const c=M.cfg,sj=smooth(S.jack),sl=smooth(S.lift),st=smooth(S.turn);
  M.jacks.forEach(j=>{const L=j.Lmin+(j.Lfull-j.Lmin)*sj;j.rod.scale.y=L;j.rod.position.y=-.1-L/2;j.pad.position.y=-.1-L;});
  const Eeff=c.Et+(S.elev-c.Et)*sl;
  if(!isGun()){
    M.pitch.g.rotation.z=c.sgn*(Eeff-c.E0)*D2R-c.sgn*(S.recoil*Math.sin(S.recoil*22)*.006);
    M.yaw.g.rotation.y=S.trav*D2R*sl;
    if(M.jackG)M.jackG.forEach(j=>{j.g.position.y=j.dy*(1-sj);});
    if(M.lifts.length){M.root.updateMatrixWorld(true);const L=c.lifts;
      M.lifts.forEach(l=>{const a=_qa.set(L.anchor[0],L.anchor[1],l.z);
        const b=_qb.set(L.att[0],L.att[1],l.z); // hinge-relative, in the pitch frame
        const pb=b.clone().applyEuler(new T.Euler(0,0,M.pitch.g.rotation.z));const yawA=M.yaw.g.rotation.y;
        const bx=c.pivot[0]+pb.x*Math.cos(yawA)+pb.z*Math.sin(yawA),by=c.pivot[1]+pb.y,bz=-pb.x*Math.sin(yawA)+pb.z*Math.cos(yawA);
        const dx=bx-a.x,dy=by-a.y,dz=bz-a.z,len=Math.hypot(dx,dy,dz);
        l.g.position.copy(a);l.g.quaternion.setFromUnitVectors(Y3,new T.Vector3(dx,dy,dz).normalize());
        const bl=Math.min(len,1.4);l.body.scale.y=bl;l.body.position.y=bl/2;
        const rl=Math.max(.01,len-bl*.85);l.rod.scale.y=rl;l.rod.position.y=bl*.85+rl/2;});}
    if(M.lids.length){S.lid=ease(S.lid,S.lidT,5,dt);if(Math.abs(S.lid-S.lidT)<.01)S.lid=S.lidT;M.lids.forEach(h=>{h.rotation.z=S.lid*1.75;});}
  }else{
    M.pitchH.g.rotation.z=c.sgn*(Eeff-c.E0)*D2R;
    M.yawH.g.rotation.y=(c.type==='spg'?PI*st:0)+S.trav*D2R*sl;
    const r=S.rec,k=r>.8?(1-r)/.2:r/.8;M.rec.position.copy(M.axis).multiplyScalar(-c.recoil*Math.max(0,k));
    if(M.spadeH)M.spadeH.g.rotation.z=lerp(c.spade.up,c.spade.down,sj);
    if(M.trails)M.trails.forEach(t=>{t.h.g.rotation.y=t.close*(1-sj);});
  }
}
function poseTractor(){
  const tr=M.tractor;if(!tr)return;
  const e=smooth(S.hitch),x=M.hookX+1.0+e*85;
  tr.g.visible=S.hitch<.995;tr.bar.visible=S.hitch<.02;
  const yf=hAt(x+5.5,0),yr=hAt(x+1.1,0);
  tr.g.position.set(x,(yf+yr)/2,0);tr.g.rotation.z=Math.atan2(yf-yr,4.4);
  const sp=-(S.dist+e*85)/.58;tr.wheels.forEach(w=>{w.rotation.z=sp;});
}

/* ---------- ammo / chips ---------- */
function applyAmmo(){const max=M?M.ammo:1;const a=$('#ammo');a.innerHTML='';
  for(let i=0;i<max;i++){const d=document.createElement('i');d.className=(i<S.ammo?'on':'')+(max<=2?' big':max>20?' sm':'');a.appendChild(d);}
  updateChips();}
function chip(row,label,key,on){const b=document.createElement('button');b.className='chip'+(key?'':' nk');b.type='button';b.innerHTML=(key?`<kbd>${key}</kbd>`:'')+`<span>${label}</span>`;b.onclick=on;$(row).appendChild(b);return b;}
const CH={};
const PHK=['1','2','3','4'];
[0,1,2,3].forEach(i=>{CH['p'+i]=chip('#rowP',PH_SELF[i],PHK[i],()=>setPhase(i+1));});
const aim=()=>S.phase===3&&!S.reload&&S.lift>.5;
const HOLD={up:0,dn:0,lf:0,rt:0};
function holdChip(label,key,hk){const b=chip('#rowL',label,key,()=>{});b.onclick=null;
  let t0=0;const on=e=>{if(e)e.preventDefault();if(!aim())return;HOLD[hk]=1;t0=performance.now();};
  const off=()=>{const d=260-(performance.now()-t0);if(HOLD[hk]&&d>0)setTimeout(()=>{HOLD[hk]=0;},d);else HOLD[hk]=0;};
  b.addEventListener('pointerdown',on);['pointerup','pointercancel','pointerleave','blur'].forEach(ev=>b.addEventListener(ev,off));
  b.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' ')on(e);});b.addEventListener('keyup',off);
  b.style.touchAction='none';return b;}
CH.up=holdChip('Підняти','↑','up');CH.dn=holdChip('Опустити','↓','dn');CH.lf=holdChip('Вліво','←','lf');CH.rt=holdChip('Вправо','→','rt');
CH.fire=chip('#rowW','Пуск','X',()=>{if(canFire())fireOne();});
CH.salvo=chip('#rowW','Усе, що є','Z',()=>{if(canFire()){S.queue=S.ammo;S.fireT=0;}});
CH.rel=chip('#rowW','Перезарядити','H',()=>startReload());
CH.follow=chip('#rowW','Стежити за ракетою','C',()=>{S.follow=!S.follow;CH.follow.classList.toggle('on',S.follow);});
VK.forEach(k=>{VEH[k].key=k;CH['v'+k]=chip('#rowC'+VEH[k].cat,VEH[k].label,null,()=>selectVehicle(k));});
const setLabel=(b,t)=>{b.querySelector('span').textContent=t;};
function startReload(){if(!M||S.reload||S.ammo>=M.ammo||S.wait)return;
  if(S.phase!==3)setPhase(3);S.queue=0;S.reloadT=0;
  if(isGun()){S.reload=2;}else{S.reload=1;}
  updateChips();}
function setPhase(i){if(S.reload)return;S.phase=i;S.tSpeed=i===2&&M?M.cfg.march:0;S.queue=0;updateChips();}
function updateChips(){for(let i=1;i<=4;i++)CH['p'+(i-1)].classList.toggle('on',S.phase===i);
  const pos=aim();CH.up.classList.toggle('lock',!pos);CH.dn.classList.toggle('lock',!pos);
  const tv=pos&&M&&M.cfg.travMax>0;CH.lf.classList.toggle('lock',!tv);CH.rt.classList.toggle('lock',!tv);
  CH.fire.classList.toggle('lock',!canFire());CH.salvo.classList.toggle('lock',!canFire()||(M&&M.ammo===1));
  CH.rel.classList.toggle('lock',!M||S.ammo>=M.ammo||!!S.reload);CH.rel.classList.toggle('on',!!S.reload);
  VK.forEach(k=>CH['v'+k].classList.toggle('on',!!M&&M.key===k));}
addEventListener('keydown',e=>{if(e.target.tagName==='INPUT')return;const k=e.key,c=e.code;
  if(c==='Digit1')setPhase(1);else if(c==='Digit2')setPhase(2);else if(c==='Digit3')setPhase(3);else if(c==='Digit4')setPhase(4);
  else if(k==='['||k===']'){const i=VK.indexOf(M?M.key:VK[0]);selectVehicle(VK[(i+(k==='['?VK.length-1:1))%VK.length]);}
  else if(k==='ArrowUp'||k==='ArrowDown'||k==='ArrowLeft'||k==='ArrowRight'){e.preventDefault();if(aim())HOLD[{ArrowUp:'up',ArrowDown:'dn',ArrowLeft:'lf',ArrowRight:'rt'}[k]]=1;}
  else if(c==='KeyX')CH.fire.click();else if(c==='KeyZ')CH.salvo.click();else if(c==='KeyH')CH.rel.click();else if(c==='KeyC')CH.follow.click();});
addEventListener('keyup',e=>{const m={ArrowUp:'up',ArrowDown:'dn',ArrowLeft:'lf',ArrowRight:'rt'}[e.key];if(m)HOLD[m]=0;});
addEventListener('blur',()=>{HOLD.up=HOLD.dn=HOLD.lf=HOLD.rt=0;});

/* ---------- vehicle switch ---------- */
let switching=false;
const fmt=x=>String(Math.round(x*10)/10).replace('.',',');
function homeCam(m){const bb=m.bb,sz=bb.getSize(new T.Vector3());
  const tow=m.cfg.type==='towed',x1=tow?m.hookX+7.5:bb.max.x,cx=(bb.min.x+x1)/2,Rr=Math.max(x1-bb.min.x,6);
  const tall=m.cfg.type==='tel'||m.cfg.type==='mlrs';
  const k=(cam.aspect<1.2?1.35:1)*(m.cfg.type==='tel'?(Rr<11?1.2:1.65):tall?1.6:m.cfg.type==='spg'?1.3:tow?.95:1);
  return {p:[cx+Rr*1.0*k,Rr*.4*k+.8,Rr*.9*k],t:[cx-.5,tall?(m.cfg.type==='tel'?3.4:2.6):Math.max(1.2,Rr*.12),0]};}
async function selectVehicle(k){if(switching||(M&&M.key===k))return;switching=true;const cfg=VEH[k];$('#load').hidden=false;$('#load').textContent='Завантаження моделі';
  try{const m=await build(k);
    if(M){truck.remove(M.root);if(M.tractor)world.remove(M.tractor.g);}
    clearFX();M=m;truck.add(m.root);if(m.tractor)world.add(m.tractor.g);
    m.ord=ordFor(m.ammo);
    Object.assign(S,{phase:1,speed:0,tSpeed:0,jack:0,turn:0,lift:0,hitch:0,elev:cfg.elev,trav:0,ammo:m.ammo,queue:0,wait:0,reload:0,lid:0,lidT:0,recoil:0,rec:0,cool:0,tdist:0});
    m.caps.forEach(c=>{c.visible=true;});if(m.missileG)m.missileG.visible=true;
    const tow=cfg.type==='towed';PH_SELF.forEach((n,i)=>setLabel(CH['p'+i],(tow?PH_TOW:PH_SELF)[i]));
    const gun=cfg.type==='spg'||tow;
    setLabel(CH.fire,gun?'Постріл':'Пуск');setLabel(CH.rel,gun?'Підвезти снаряди':'Перезарядити');setLabel(CH.follow,gun?'Стежити за снарядом':'Стежити за ракетою');
    $('#title').textContent=cfg.name;$('#credit').innerHTML=creditHtml('rvia/'+k);$('#dims').textContent='довжина за моделлю ≈ '+fmt(m.len)+' м';$('#cv').setAttribute('aria-label','Тривимірна модель: '+cfg.name);
    $('#desc').textContent=cfg.desc;$('#how').textContent=cfg.how+' Фази йдуть одна за одною; кут регулюється кнопками або клавішами ↑ ↓, поворот — ← → (тримайте, поки рухається). X — один постріл чи пуск, Z — усе, що лишилося, з інтервалом, C — камера стежить за снарядом чи ракетою, [ ] — попередня й наступна модель.';
    const hc=homeCam(m);cfg.cam=hc;cam.position.set(...hc.p);ctl.target.set(...hc.t);
    setPhase(1);applyAmmo();$('#load').hidden=true;
  }catch(e){console.error(e);$('#load').textContent='Не вдалося завантажити модель';$('#load').hidden=false;}
  switching=false;}

/* ---------- frame ---------- */
function resize(){const w=stage.clientWidth,h=stage.clientHeight;R.setSize(w,h,false);cam.aspect=w/h;cam.updateProjectionMatrix();}
new ResizeObserver(resize).observe(stage);resize();
const clock=makeClock();const st=$('#status');
function loop(){if(!window.__paused)requestAnimationFrame(loop);frame(Math.min(.05,clock.getDelta()));}
const RL_T=7;let SKIP=false;
const stowedNow=()=>!M||M.stages.every(s=>S[s.k]<.02);
function phaseText(){
  const c=M.cfg,tow=c.type==='towed',gun=c.type==='spg'||tow,n=(tow?PH_TOW:PH_SELF);
  if(S.phase===1)return n[0]+(tow?' · тягач під\'єднано':' · двигун вимкнено');
  if(S.phase===2)return n[1]+' · '+Math.round(S.speed*3.6)+' км/год';
  const dep=S.phase===3;
  if(dep){
    if(tow&&S.hitch<.97)return n[2]+' · тягач відчіплюється й від\'їжджає';
    if(S.jack<.97)return n[2]+' · '+(tow?'станини розсуваються':c.type==='spg'?'сошник опускається':'опори опускаються');
    if(c.type==='spg'&&S.turn<.97)return n[2]+' · установка розвертається';
    if(S.lift<.97)return n[2]+' · '+(gun?'ствол піднімається':'пускова піднімається');
    const a=Math.round(lerp(c.Et,S.elev,smooth(S.lift)));
    return n[2]+' · кут '+a+'°'+(c.travMax?' · поворот '+Math.round(S.trav*smooth(S.lift))+'°':'')+' · '+S.ammo+(gun?' сн.':S.ammo===1?' ракета':S.ammo>1&&S.ammo<5?' ракети':' ракет');
  }
  if(S.lift>.02)return n[3]+' · '+(gun?'ствол опускається':'пускова опускається');
  if(S.turn>.02)return n[3]+' · установка розвертається у похідне';
  if(S.jack>.02)return n[3]+' · '+(tow?'станини зводяться':c.type==='spg'?'сошник піднімається':'опори піднімаються');
  if(S.hitch>.02)return n[3]+' · тягач повертається';
  return n[3]+' · готово до маршу';
}
function frame(dt){
  if(M){
    const cfg=M.cfg;
    S.speed=ease(S.speed,(S.tSpeed>0&&!stowedNow())?0:S.tSpeed,S.tSpeed>S.speed?.6:1.2,dt);
  }else S.speed=ease(S.speed,0,1.2,dt);
  const v=S.speed;
  S.dist+=v*dt;LAND.u-=v*dt;placeTiles();
  if(M){
    const cfg=M.cfg;
    M.wheels.forEach(h=>h.rotation.z=-S.dist/M.WR);
    S.steer=ease(S.steer,v>2?Math.sin(S.dist*.08)*6:0,2,dt);M.front.forEach(p=>p.rotation.y=S.steer*D2R);
    const {AF,AR,TR}=M.terr;
    const hfl=hAt(AF,TR),hfr=hAt(AF,-TR),hrl=hAt(AR,TR),hrr=hAt(AR,-TR),hf=(hfl+hfr)/2,hr=(hrl+hrr)/2,hy=((hf+hr)/2*.65+Math.max(hfl,hfr,hrl,hrr)*.35)+.04,pitch=Math.atan2(hf-hr,AF-AR),roll=Math.atan(((hfr+hrr)-(hfl+hrl))/2/(2*TR));
    S.bounce=v>1?Math.sin(S.dist*1.7)*.018+Math.sin(S.dist*4.3)*.008:S.bounce*.9;
    let yoff=0,tilt=0;
    if(cfg.type==='towed'){const sj=smooth(S.jack);yoff=lerp(-M.wb,-M.gy,sj);
      const d=M.wb-M.gy,Lt=Math.max(2,M.hookX-(M.axR+1));tilt=Math.atan(Math.max(0,d)/Lt)*(1-sj);}
    truck.position.y=ease(truck.position.y,hy+S.bounce+yoff,6,dt);truck.rotation.z=ease(truck.rotation.z,pitch*.9+tilt,6,dt);
    truck.rotation.x=ease(truck.rotation.x,roll*.9+(v>1?Math.sin(S.dist*1.1)*.007:0),4,dt);
    // staged deploy: each stage waits for the previous; stowing is the reverse
    const want=(S.phase===3||S.reload)?1:0,tg={};M.stages.forEach(s=>tg[s.k]=want);
    if(S.reload===1||S.reload===2)tg.lift=0;else if(S.reload===3)tg.lift=1;
    if(isGun()&&S.reload)tg.lift=1;
    M.stages.forEach((s,i)=>{const t=tg[s.k],cur=S[s.k];if(t===cur)return;let ok=true;
      if(t>cur){if(S.speed>.5)ok=false;for(let j=0;j<i;j++)if(S[M.stages[j].k]<.97)ok=false;}
      else{for(let j=i+1;j<M.stages.length;j++)if(S[M.stages[j].k]>.02)ok=false;}
      if(ok)S[s.k]+=clamp(t-cur,-dt/s.T,dt/s.T);});
    if(!aim())HOLD.up=HOLD.dn=HOLD.lf=HOLD.rt=0;
    const dE=HOLD.up-HOLD.dn,dT=cfg.travMax?HOLD.lf-HOLD.rt:0;
    if(dE)S.elev=clamp(S.elev+dE*dt*18,cfg.elevMin,cfg.elevMax);
    if(dT)S.trav=clamp(S.trav+dT*dt*20,-cfg.travMax,cfg.travMax);
    S.recoil=Math.max(0,S.recoil-dt*3);S.rec=Math.max(0,S.rec-dt*1.6);S.cool=Math.max(0,S.cool-dt);
    // reload: launchers lower the pack, replace what was spent and raise it again; guns just wait for the shells
    if(S.reload===1&&S.lift<.02){S.reload=2;S.reloadT=0;S.lidT=0;}
    else if(S.reload===2){S.reloadT+=dt;
      if(M.caps.length){const n=Math.floor(S.reloadT/RL_T*12*1.15);for(let i=0;i<Math.min(12,n);i++)M.caps[M.ord[i]].visible=true;}
      if(M.missileG&&S.reloadT>RL_T*.5)M.missileG.visible=true;
      const dur=isGun()?2.5:RL_T;
      if(S.reloadT>dur){S.ammo=M.ammo;applyAmmo();if(isGun()){S.reload=0;S.toast='Снаряди підвезено · '+S.ammo;}else{S.reload=3;S.toast='Боєкомплект поповнено · '+S.ammo;}S.toastT=2.5;}}
    else if(S.reload===3&&S.lift>.97){S.reload=0;updateChips();}
    if(S.wait&&S.lid>=.99){S.wait=0;launch();}
    poseModel(dt);poseTractor();
    if(S.queue>0&&!S.wait){S.fireT-=dt;if(S.fireT<=0&&(!isGun()||S.cool<=0)){if(fireOne())S.fireT=Math.max(.12,Math.min(.55,6/Math.max(1,M.ammo)));S.queue--;if(S.ammo<=0)S.queue=0;}}
    stepFX(dt);
  }
  // camera follows a rocket or a shell in flight
  const fl=FX.rk.length?FX.rk[0].m.position:FX.sh.length?FX.sh[0].m.position:null,tgt=S.follow?fl:null;
  if(tgt){_w.copy(tgt).sub(ctl.target).multiplyScalar(1-Math.exp(-4*dt));ctl.target.add(_w);cam.position.add(_w);}
  else if(S.follow&&M&&M.cfg.cam&&ctl.target.distanceTo(_v.set(...M.cfg.cam.t))>.5){_w.set(...M.cfg.cam.t).sub(ctl.target).multiplyScalar(1-Math.exp(-2*dt));ctl.target.add(_w);cam.position.add(_w);}
  S.toastT-=dt;let text=S.toastT>0?S.toast:(M?phaseText():'Завантаження');
  if(M&&S.toastT<=0){
    if(S.reload===1)text='Перезарядження · пускова опускається';
    else if(S.reload===2)text=isGun()?'Підвезення снарядів':'Перезарядження · '+(M.caps.length?'встановлюються кришки труб':'боєприпас замінюється');
    else if(S.reload===3)text='Перезарядження · пускова піднімається';}
  if(st.textContent!==text)st.textContent=text;st.classList.toggle('toast',S.toastT>0&&!S.reload);
  if((S._p!==S.phase)||(S._a!==S.ammo)||(S._e!==(S.lift>.97))||(S._r!==S.reload)||(S._w!==S.wait)||(S._c!==(S.cool>0))){S._p=S.phase;S._a=S.ammo;S._e=S.lift>.97;S._r=S.reload;S._w=S.wait;S._c=S.cool>0;updateChips();}
  ctl.update();if(!SKIP)R.render(scene,cam);
}
const qsel=new URLSearchParams(location.search).get('m');
selectVehicle(VEH[qsel]?qsel:'sapsan');
setTimeout(loadLand,600);
loop();
window.__tick=(n,dt)=>{SKIP=true;for(let i=0;i<n;i++){if(i===n-1)SKIP=false;frame(dt||1/30);}SKIP=false;};window.__snap=()=>{frame(0);return cv.toDataURL('image/png');};
window.__S=S;window.__setPhase=setPhase;window.__fire=()=>CH.fire.click();window.__reload=startReload;window.__sel=selectVehicle;window.__cam3=(p,t)=>{cam.position.set(...p);ctl.target.set(...t);ctl.update();};
window.__ready=()=>!!M&&LAND.ready&&!switching;window.__M=()=>M;window.__FX=FX;window.__LAND=LAND;window.__HOLD=HOLD;window.__T=T;window.__truck=truck;

