/* =========================================================
   ГАРАЖ · бокс парку бойових машин (окрема сцена, той самий HUD)
   Вісь x — уздовж машини (ніс у +x, до воріт), y — вгору, z — поперек. 1 од. = 1 м.
   ========================================================= */
(()=>{
const T=THREE,PI=Math.PI,$=s=>document.querySelector(s);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),ease=(c,t,k,dt)=>c+(t-c)*(1-Math.exp(-k*dt)),rnd=(a,b)=>a+Math.random()*(b-a);
const stage=$('#gStage');
const G={built:false,on:false,cur:null,models:{},mode:'park',lamps:false,holo:true,t:0,yaw:-.78,el:.07,zoom:1,yawV:0,drag:false,
  drive:{x:0,v:0,phase:0,t:0},eng:0,engOn:false,combat:0,combatWant:0,reload:null};
window.GAR=G;
let renderer,scene,camera,W=1,H=1;
function cv(w,h,fn){const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d');fn(x,w,h);return c;}
function tex(c,rep,srgb=true){const t=new T.CanvasTexture(c);t.anisotropy=8;if(srgb)t.encoding=T.sRGBEncoding;if(rep){t.wrapS=t.wrapT=T.RepeatWrapping;t.repeat.set(rep[0],rep[1]);}return t;}
function speck(x,w,h,n,a,c0,c1,s0=1,s1=3){for(let i=0;i<n;i++){const v=c0+Math.random()*(c1-c0)|0;x.fillStyle=`rgba(${v},${v},${v},${a})`;const s=s0+Math.random()*(s1-s0);x.fillRect(Math.random()*w,Math.random()*h,s,s);}}
function blot(x,w,h,n,col,r0,r1){for(let i=0;i<n;i++){const cx=Math.random()*w,cy=Math.random()*h,r=r0+Math.random()*(r1-r0);const g=x.createRadialGradient(cx,cy,0,cx,cy,r);g.addColorStop(0,col);g.addColorStop(1,'rgba(0,0,0,0)');x.fillStyle=g;x.fillRect(cx-r,cy-r,r*2,r*2);}}
const FONT='"Exo 2","IBM Plex Sans",sans-serif';
function stencil(x,txt,px,py,size,col,align='left',w=700){x.font=`${w} ${size}px ${FONT}`;x.textAlign=align;x.fillStyle=col;x.fillText(txt,px,py);}
function hazard(x,X,Y,w,h,step=40,ang=-1){x.save();x.beginPath();x.rect(X,Y,w,h);x.clip();x.fillStyle='#16140f';x.fillRect(X,Y,w,h);x.fillStyle='#d8a51c';
  for(let i=-h*2;i<w+h*2;i+=step*2){x.beginPath();x.moveTo(X+i,Y+h);x.lineTo(X+i+step,Y+h);x.lineTo(X+i+step-ang*h,Y);x.lineTo(X+i-ang*h,Y);x.closePath();x.fill();}
  x.restore();}
function wear(x,w,h,n=400){x.globalCompositeOperation='destination-out';for(let i=0;i<n;i++){x.fillStyle=`rgba(0,0,0,${rnd(.2,.9)})`;const s=rnd(1,7);x.fillRect(Math.random()*w,Math.random()*h,s,s*rnd(.3,1));}x.globalCompositeOperation='source-over';}
const HW=17,HL=40,WH=12.6;
const mats={};
function M(g,m,cast=true,recv=true){const o=new T.Mesh(g,m);o.castShadow=cast;o.receiveShadow=recv;return o;}
function std(o){return new T.MeshStandardMaterial(o);}
function add(o,p,r){if(p)o.position.set(...p);if(r)o.rotation.set(...r);G.root.add(o);return o;}
function build(){
  renderer=new T.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.75));renderer.outputEncoding=T.sRGBEncoding;
  renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=.86;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
  stage.prepend(renderer.domElement);
  scene=new T.Scene();scene.background=new T.Color(0x07090a);scene.fog=new T.FogExp2(0x090c0d,.021);
  camera=new T.PerspectiveCamera(36,16/9,.1,400);
  G.root=new T.Group();scene.add(G.root);G.scene=scene;G.renderer=renderer;G.camera=camera;
  buildHall();buildProps();buildLights();
  const pm=new T.PMREMGenerator(renderer);const rt=pm.fromScene(envScene(),.03);scene.environment=rt.texture;pm.dispose();
  buildFx();
  G.aoTex=tex(cv(256,256,(x,w,h)=>{const g=x.createRadialGradient(w/2,h/2,0,w/2,h/2,w/2);g.addColorStop(0,'rgba(0,0,0,.85)');g.addColorStop(.55,'rgba(0,0,0,.5)');g.addColorStop(1,'rgba(0,0,0,0)');x.fillStyle=g;x.fillRect(0,0,w,h);}),null,false);
  new ResizeObserver(resize).observe(stage);resize();
  input();G.built=true;}
function envScene(){const e=new T.Scene();const room=new T.Mesh(new T.BoxGeometry(80,14,34),new T.MeshBasicMaterial({color:0x15181a,side:T.BackSide}));room.position.y=6;e.add(room);
  const fl=new T.Mesh(new T.PlaneGeometry(80,34),new T.MeshBasicMaterial({color:0x2a2b29}));fl.rotation.x=-PI/2;fl.position.y=-.9;e.add(fl);
  const lm=new T.MeshBasicMaterial({color:new T.Color(1.6,1.45,1.25)});for(let x=-32;x<=32;x+=8)[-6.5,6.5].forEach(z=>{const b=new T.Mesh(new T.CircleGeometry(.8,16),lm);b.rotation.x=PI/2;b.position.set(x,12.5,z);e.add(b);});
  const sk=new T.MeshBasicMaterial({color:new T.Color(.55,.62,.68)});[-1,1].forEach(s=>{const w=new T.Mesh(new T.PlaneGeometry(76,1.6),sk);w.position.set(0,11.2,s*16.9);w.rotation.y=s>0?PI:0;e.add(w);});
  const gt=new T.Mesh(new T.PlaneGeometry(30,9),new T.MeshBasicMaterial({color:new T.Color(1.3,1.4,1.5)}));gt.position.set(39.9,4.5,0);gt.rotation.y=-PI/2;e.add(gt);return e;}
function resize(){if(!renderer)return;const r=stage.getBoundingClientRect();W=Math.max(1,r.width);H=Math.max(1,r.height);renderer.setSize(W,H,false);camera.aspect=W/H;camera.setViewOffset(W,H,0,H*.13,W,H);camera.updateProjectionMatrix();}
