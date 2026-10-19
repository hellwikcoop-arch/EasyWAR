// Показ «Презентація» в довіднику авіації: гелікоптер стоїть у темному ангарі під чохлом, користувач стягує чохол
// мишею за ручку, потім розкручуються гвинти, вмикаються вогні й машина злітає, а камера її проводжає.
// Тут — сцена, світло, камера й події миші; фізика чохла, карта корпусу й профіль зльоту — у reveal-core.js.
// Усе процедурне: жодних додаткових файлів і мережі.
import * as THREE from 'three';
import {Reflector} from 'three/addons/objects/Reflector.js';
import {
  makeHull, rasterTriangle, finishHull, hullAt, footprint,
  makeCloth, stepCloth, overFootprint, revealProgress, clothMeanY, handleIndex,
  liftPose, TIMING, PULL_DONE,
} from './reveal-core.js';

const PI=Math.PI;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smooth=x=>{x=clamp(x,0,1);return x*x*(3-2*x);};
const SUB=1/120; // крок фізики чохла

const glowTex=(()=>{let t=null;return ()=>{if(t)return t;const c=document.createElement('canvas');c.width=c.height=64;const x=c.getContext('2d');
  const g=x.createRadialGradient(32,32,0,32,32,32);g.addColorStop(0,'rgba(255,255,255,1)');g.addColorStop(.25,'rgba(255,255,255,.7)');g.addColorStop(1,'rgba(255,255,255,0)');
  x.fillStyle=g;x.fillRect(0,0,64,64);t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;};})();
const softTex=(()=>{let t=null;return ()=>{if(t)return t;const c=document.createElement('canvas');c.width=c.height=128;const x=c.getContext('2d');
  const g=x.createRadialGradient(64,64,0,64,64,64);g.addColorStop(0,'rgba(0,0,0,.7)');g.addColorStop(.5,'rgba(0,0,0,.35)');g.addColorStop(1,'rgba(0,0,0,0)');
  x.fillStyle=g;x.fillRect(0,0,128,128);t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;};})();

// Карта висот корпусу з трикутників частин моделі (світові координати). rotor — частини гвинтів: їх беремо лише
// в радіусі rotorR від втулки (чохол накриває втулку й корені лопатей, а самі лопаті стирчать з-під нього).
function buildHull(meshes,box,rotor,rotorR,hub){
  const pad=.4,cell=.05;
  const nx=Math.min(240,Math.ceil((box.max.x-box.min.x+2*pad)/cell)),nz=Math.min(160,Math.ceil((box.max.z-box.min.z+2*pad)/cell));
  const hull=makeHull(box.min.x-pad,box.max.x+pad,box.min.z-pad,box.max.z+pad,nx,nz,0);
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
  meshes.forEach(me=>{
    const isRotor=rotor&&rotor.has(me);
    if(isRotor&&!(rotorR>0))return;
    const g=me.geometry,pa=g.attributes.position,ix=g.index,m=me.matrixWorld;if(!pa)return;
    const n=ix?ix.count:pa.count,r2=rotorR*rotorR;
    for(let i=0;i<n;i+=3){
      const i0=ix?ix.getX(i):i,i1=ix?ix.getX(i+1):i+1,i2=ix?ix.getX(i+2):i+2;
      a.fromBufferAttribute(pa,i0).applyMatrix4(m);b.fromBufferAttribute(pa,i1).applyMatrix4(m);c.fromBufferAttribute(pa,i2).applyMatrix4(m);
      if(isRotor){const cx=(a.x+b.x+c.x)/3-hub.x,cz=(a.z+b.z+c.z)/3-hub.z;if(cx*cx+cz*cz>r2)continue;}
      rasterTriangle(hull,a.x,a.y,a.z,b.x,b.y,b.z,c.x,c.y,c.z);
    }
  });
  return finishHull(hull,{dilate:1,blur:1});
}

export function createReveal({scene,cam,ctl,holder,stage,cv,lights,floor,AN,onEnd}){
  const RV={on:false,phase:'',t:0,M:null,g:null,cloth:null,clothMesh:null,hull:null,fp:null,progress:0,
    drag:{on:false,target:new THREE.Vector3(),plane:new THREE.Plane(new THREE.Vector3(0,1,0),0)},
    handle:null,hint:null,fade:null,saved:null,dropT:0,fadeT:-1,spoolT:0,liftT:0,outT:0,pullDir:[1,0],lamps:[],dust:null,
    hub:new THREE.Vector3(),shadow:null,landing:null,camPos:new THREE.Vector3(),camTgt:new THREE.Vector3(),camFrom:null,camT:0,hintPulse:0};
  const ray=new THREE.Raycaster(),ndc=new THREE.Vector2(),tmp=new THREE.Vector3();

  const fade=document.createElement('div');fade.className='rv-fade';stage.append(fade);RV.fade=fade;
  const hint=document.createElement('div');hint.className='rv-hint';hint.hidden=true;hint.textContent='Тягніть, щоб зняти чохол';stage.append(hint);RV.hint=hint;
  const ovS=stage.querySelector('#ovS');
  const say=s=>{if(ovS&&ovS.textContent!==s)ovS.textContent=s;};

  function start(M){
    if(RV.on)stop();
    RV.M=M;RV.on=true;RV.t=0;RV.phase='cover';RV.progress=0;RV.fadeT=-1;RV.dropT=0;RV.spoolT=0;RV.liftT=0;RV.outT=0;RV.camT=0;RV.hintPulse=0;
    RV.saved={bg:scene.background,fog:scene.fog,envI:scene.environmentIntensity,lights:lights.map(l=>l.intensity),floor:floor.visible,
      ctl:{auto:ctl.autoRotate,enabled:ctl.enabled,minD:ctl.minDistance,maxD:ctl.maxDistance,maxP:ctl.maxPolarAngle,minP:ctl.minPolarAngle},
      an:AN.on,fov:cam.fov,near:cam.near,far:cam.far};
    holder.position.set(0,0,0);holder.rotation.set(0,0,0);holder.scale.setScalar(1);holder.updateMatrixWorld(true);
    // гвинти стоять: чохол лежить на нерухомих лопатях
    AN.on=false;AN.k=0;
    scene.background=new THREE.Color(0x050607);scene.fog=new THREE.Fog(0x050607,15,46);scene.environmentIntensity=.3;
    lights.forEach((l,i)=>{l.intensity=RV.saved.lights[i]*(i===0?.3:.25);});
    floor.visible=false;
    ctl.autoRotate=false;ctl.enabled=true;ctl.minDistance=3.5;ctl.maxDistance=22;ctl.maxPolarAngle=PI*.49;ctl.minPolarAngle=PI*.12;
    cam.near=.05;cam.far=500;cam.fov=32;cam.updateProjectionMatrix();

    // карта корпусу: окремо без гвинтів (щоб знати слід фюзеляжу), потім із гвинтами (на них лягає чохол)
    const rotor=new Set();if(M.rig)M.rig.spins.forEach(sp=>sp.fr.inner.children.forEach(ch=>rotor.add(ch)));
    if(M.rig&&M.rig.spins.length)RV.hub.copy(M.rig.spins[0].fr.p);else RV.hub.set((M.box.min.x+M.box.max.x)/2,M.box.max.y,0);
    const body=buildHull(M.meshes,M.box,rotor,0,RV.hub);
    const all=buildHull(M.meshes,M.box,rotor,1.1,RV.hub);
    RV.hull=all;RV.fp=footprint(body,.28)||{minX:M.box.min.x,maxX:M.box.max.x,minZ:-1,maxZ:1};
    const fp=RV.fp,L=fp.maxX-fp.minX,Wh=Math.max(-fp.minZ,fp.maxZ);

    buildHangar(body,fp,L,Wh);
    buildCloth(all,fp,L,Wh);

    // камера: низький ракурс з боку носа, легкий наїзд
    RV.camTgt.set(fp.minX+L*.52,body.max*.45,0);
    const dist=Math.max(11,L*1.75);
    RV.camPos.copy(RV.camTgt).add(new THREE.Vector3(.72,.26,.64).normalize().multiplyScalar(dist));
    RV.camFrom=RV.camTgt.clone().add(new THREE.Vector3(.6,.34,.74).normalize().multiplyScalar(dist*1.22));
    cam.position.copy(RV.camFrom);ctl.target.copy(RV.camTgt);ctl.update();
    hint.hidden=false;say('Потягніть ручку чохла, щоб відкрити');
  }

  function buildHangar(body,fp,L,Wh){
    const g=new THREE.Group();g.name='reveal';RV.g=g;scene.add(g);
    // підлога: дзеркало знизу, приглушене освітленою напівпрозорою плитою зверху (на неї лягають світло й тінь)
    const mirror=new Reflector(new THREE.PlaneGeometry(90,90),{clipBias:.003,textureWidth:512,textureHeight:512,color:0x5c6065});
    mirror.rotation.x=-PI/2;mirror.position.y=-.004;g.add(mirror);
    const lit=new THREE.Mesh(new THREE.PlaneGeometry(90,90),new THREE.MeshStandardMaterial({color:0x0f1216,roughness:.5,metalness:.1,transparent:true,opacity:.7}));
    lit.rotation.x=-PI/2;lit.renderOrder=1;g.add(lit);
    const sh=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({map:softTex(),transparent:true,depthWrite:false,fog:false}));
    sh.rotation.x=-PI/2;sh.position.set((fp.minX+fp.maxX)/2,.012,0);sh.scale.set(L*1.3,(Wh*2+1.2)*1.6,1);sh.renderOrder=2;g.add(sh);RV.shadow=sh;
    // лампи-трубки під стелею (світяться самі й освітлюють сцену)
    const tubeMat=new THREE.MeshBasicMaterial({color:0xe6eeff,fog:false});
    [[9,6.2,.35,.12,-1,-2],[7,5.6,-.9,-.2,2.2,1.6],[8,6.8,1.9,.25,.4,2.6],[6,5.1,.9,-.3,-3.2,2.1],[7.5,7.1,-.3,.3,3.1,-2.6]].forEach(([len,y,yaw,pitch,x,z])=>{
      const t=new THREE.Mesh(new THREE.BoxGeometry(len,.07,.07),tubeMat);t.position.set(x,y,z);t.rotation.set(0,yaw,pitch);g.add(t);
      const l=new THREE.PointLight(0xdbe6ff,26,28,2);l.position.set(x,y-.1,z);g.add(l);
    });
    const spot=new THREE.SpotLight(0xfff0dc,110,46,.6,.6,1.4);spot.position.set(fp.maxX+6,7,6);spot.target.position.set(fp.minX+L*.5,.8,0);g.add(spot,spot.target);
    const back=new THREE.PointLight(0x9fb4ff,18,20,2);back.position.set(fp.minX-4,3,-4);g.add(back);
    // пил від гвинта: кільце м'яких плям на підлозі, росте з обертами
    const dm=new THREE.SpriteMaterial({map:glowTex(),color:0x5d6368,transparent:true,opacity:0,depthWrite:false,fog:true});
    const dust=new THREE.Group();dust.renderOrder=3;
    for(let i=0;i<40;i+=1){const s=new THREE.Sprite(dm.clone());s.userData.a=i/40*PI*2;s.userData.r=.6+Math.random()*.5;s.userData.s=1.4+Math.random()*1.2;s.scale.setScalar(s.userData.s);dust.add(s);}
    g.add(dust);RV.dust=dust;
    // вогні: червоний і зелений бортові, білий хвостовий, червоний маяк над кабіною; усі летять разом із гелікоптером
    const lampAt=(col,x,y,z,kind)=>{const s=new THREE.Sprite(new THREE.SpriteMaterial({map:glowTex(),color:col,transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending,fog:false}));
      s.position.set(x,y,z);s.scale.setScalar(.22);s.renderOrder=4;s.userData.kind=kind;s.userData.col=col;holder.add(s);RV.lamps.push(s);return s;};
    const nx=fp.minX+L*.62,ez=Wh*.92;
    lampAt(0xff3b2e,nx,hullAt(body,nx,-ez*.9)+.04,-ez,'nav');
    lampAt(0x35ff6a,nx,hullAt(body,nx,ez*.9)+.04,ez,'nav');
    lampAt(0xffffff,fp.minX+.05,hullAt(body,fp.minX+.15,0)+.03,0,'strobe');
    lampAt(0xff2a1e,RV.hub.x-.9,hullAt(body,RV.hub.x-.9,0)+.06,0,'beacon');
    // посадкова фара: конус світла на підлогу перед носом
    const land=new THREE.SpotLight(0xfff6e0,0,16,.42,.7,1.2);land.position.set(fp.maxX-.35,body.max*.3,0);land.target.position.set(fp.maxX+7,0,0);holder.add(land,land.target);RV.landing=land;
  }

  function buildCloth(hull,fp,L,Wh){
    const cloth=makeCloth({cols:46,rows:28,x0:fp.minX-.25,x1:fp.maxX+.35,z0:-(Wh+1.1),z1:Wh+1.1,y:hull.max+.25});
    for(let i=0;i<Math.round(TIMING.settleS/SUB);i+=1)stepCloth(cloth,{dt:SUB,hull,floorY:0});
    cloth.over0=overFootprint(cloth,fp);
    RV.cloth=cloth;
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.BufferAttribute(cloth.pos,3));
    const idx=[];for(let r=0;r<cloth.rows-1;r+=1)for(let c=0;c<cloth.cols-1;c+=1){const i=r*cloth.cols+c;idx.push(i,i+cloth.cols,i+1,i+1,i+cloth.cols,i+cloth.cols+1);}
    geo.setIndex(idx);geo.computeVertexNormals();
    const mat=new THREE.MeshStandardMaterial({color:0x9a9d98,roughness:.95,metalness:0,side:THREE.DoubleSide});
    const mesh=new THREE.Mesh(geo,mat);mesh.frustumCulled=false;RV.g.add(mesh);RV.clothMesh=mesh;
    // ручка: куля на краю чохла з боку носа
    const h=new THREE.Group();
    h.add(new THREE.Mesh(new THREE.SphereGeometry(.085,24,16),new THREE.MeshBasicMaterial({color:0xffffff,fog:false})));
    const halo=new THREE.Sprite(new THREE.SpriteMaterial({map:glowTex(),color:0xffffff,transparent:true,opacity:.55,depthWrite:false,blending:THREE.AdditiveBlending,fog:false}));
    halo.scale.setScalar(.6);halo.renderOrder=4;h.add(halo);h.userData.halo=halo;
    RV.g.add(h);RV.handle=h;placeHandle();
  }
  function placeHandle(){const k=handleIndex(RV.cloth)*3,p=RV.cloth.pos;RV.handle.position.set(p[k]+.06,p[k+1]+.02,p[k+2]);}

  function stop(){
    if(!RV.on)return;
    RV.on=false;RV.phase='';
    const s=RV.saved;
    if(RV.g){
      const gone=[];RV.g.traverse(o=>gone.push(o));
      gone.forEach(o=>{
        if(typeof o.getRenderTarget==='function'){o.dispose();return;} // дзеркало підлоги тримає власний буфер
        if(o.isMesh&&o.geometry)o.geometry.dispose(); // геометрія спрайтів спільна, її не чіпаємо
        if((o.isMesh||o.isSprite)&&o.material&&o.material.dispose)o.material.dispose();
      });
      scene.remove(RV.g);RV.g=null;}
    RV.lamps.forEach(l=>{holder.remove(l);l.material.dispose();});RV.lamps=[];
    if(RV.landing){holder.remove(RV.landing,RV.landing.target);RV.landing=null;}
    RV.cloth=null;RV.clothMesh=null;RV.handle=null;RV.hull=null;RV.drag.on=false;
    holder.position.set(0,0,0);holder.rotation.set(0,0,0);holder.scale.setScalar(1);
    scene.background=s.bg;scene.fog=s.fog;scene.environmentIntensity=s.envI;lights.forEach((l,i)=>{l.intensity=s.lights[i];});
    floor.visible=s.floor;
    ctl.autoRotate=s.ctl.auto;ctl.enabled=s.ctl.enabled;ctl.minDistance=s.ctl.minD;ctl.maxDistance=s.ctl.maxD;ctl.maxPolarAngle=s.ctl.maxP;ctl.minPolarAngle=s.ctl.minP;
    cam.fov=s.fov;cam.near=s.near;cam.far=s.far;cam.updateProjectionMatrix();
    AN.on=s.an;
    hint.hidden=true;say('');
    fade.classList.remove('is-in');
    if(onEnd)onEnd();
  }

  /* ---------- миша: ручка чохла ---------- */
  function handleScreen(){tmp.copy(RV.handle.position).project(cam);return [(tmp.x*.5+.5)*cv.clientWidth,(-tmp.y*.5+.5)*cv.clientHeight];}
  function pointerPlane(ev,out){
    const r=cv.getBoundingClientRect();ndc.set(((ev.clientX-r.left)/r.width)*2-1,-((ev.clientY-r.top)/r.height)*2+1);
    ray.setFromCamera(ndc,cam);return ray.ray.intersectPlane(RV.drag.plane,out);
  }
  cv.addEventListener('pointerdown',ev=>{
    if(!RV.on||RV.phase!=='cover'||!RV.handle)return;
    const [hx,hy]=handleScreen(),r=cv.getBoundingClientRect(),dx=ev.clientX-r.left-hx,dy=ev.clientY-r.top-hy;
    const lim=ev.pointerType==='touch'?46:34;
    if(dx*dx+dy*dy>lim*lim)return;
    ev.stopImmediatePropagation();ev.preventDefault();
    ctl.enabled=false;RV.drag.on=true;hint.hidden=true;
    const k=handleIndex(RV.cloth)*3,p=RV.cloth.pos;
    RV.cloth.pin=[p[k],p[k+1],p[k+2]];RV.cloth.pinned=handleIndex(RV.cloth);
    RV.drag.plane.constant=-Math.max(.25,p[k+1]);RV.drag.target.set(p[k],p[k+1],p[k+2]);
    try{cv.setPointerCapture(ev.pointerId);}catch(e){/* без захоплення теж працює */}
  },true);
  cv.addEventListener('pointermove',ev=>{
    if(!RV.drag.on)return;
    if(pointerPlane(ev,tmp)){RV.drag.target.set(clamp(tmp.x,-14,14),-RV.drag.plane.constant,clamp(tmp.z,-14,14));}
  });
  const release=()=>{if(!RV.drag.on)return;RV.drag.on=false;if(RV.cloth)RV.cloth.pinned=-1;if(RV.on&&RV.phase==='cover'){ctl.enabled=true;hint.hidden=false;}};
  cv.addEventListener('pointerup',release);cv.addEventListener('pointercancel',release);cv.addEventListener('lostpointercapture',release);

  /* ---------- крок ---------- */
  function clothStep(dt){
    const cloth=RV.cloth;if(!cloth)return;
    const n=clamp(Math.round(dt/SUB),1,4);
    let pull=null;
    if(RV.phase==='drop'){pull={dir:RV.pullDir,strength:9,c0:cloth.cols-12,c1:cloth.cols-1};}
    for(let i=0;i<n;i+=1){
      if(cloth.pinned>=0){
        // ручка йде за вказівником, але не швидше за 11 од./с: інакше тканина рветься на вигляд
        const p=cloth.pin,t=RV.drag.target,dx=t.x-p[0],dz=t.z-p[2],d=Math.hypot(dx,dz),m=Math.min(d,.09);
        if(d>1e-4){p[0]+=dx/d*m;p[2]+=dz/d*m;}p[1]=t.y;
      }
      stepCloth(cloth,{dt:SUB,hull:RV.phase==='cover'||RV.phase==='drop'?RV.hull:null,floorY:0,pull});
    }
    RV.clothMesh.geometry.attributes.position.needsUpdate=true;
    RV.clothMesh.geometry.computeVertexNormals();
  }

  function lampsStep(t,on){
    RV.lamps.forEach(s=>{
      const k=s.userData.kind;let o=0;
      if(on){
        if(k==='nav')o=.9;
        else if(k==='beacon')o=(t%1)<.12?1:0;
        else if(k==='strobe'){const u=t%1.5;o=(u<.06||(u>.2&&u<.26))?1:0;}
      }
      s.material.opacity=o;
    });
  }

  function step(dt){
    if(!RV.on)return;
    RV.t+=dt;
    // наїзд камери на початку
    if(RV.camFrom&&RV.camT<1&&!RV.drag.on&&RV.phase==='cover'){RV.camT=Math.min(1,RV.camT+dt/2.2);const e=smooth(RV.camT);cam.position.lerpVectors(RV.camFrom,RV.camPos,e);if(RV.camT>=1)RV.camFrom=null;}
    const ph=RV.phase;
    if(ph==='cover'){
      clothStep(dt);placeHandle();
      RV.hintPulse+=dt;const halo=RV.handle.userData.halo;halo.material.opacity=.35+.3*(.5+.5*Math.sin(RV.hintPulse*3));
      if(!hint.hidden){const [hx,hy]=handleScreen(),w=hint.offsetWidth||180,W=cv.clientWidth;const left=hx+16+w>W-8?hx-16-w:hx+16;hint.style.transform=`translate(${Math.round(clamp(left,8,W-w-8))}px,${Math.round(clamp(hy-10,8,cv.clientHeight-40))}px)`;}
      RV.progress=revealProgress(RV.cloth,RV.fp);
      if(RV.progress>=PULL_DONE){
        RV.phase='drop';RV.dropT=0;release();RV.handle.visible=false;hint.hidden=true;ctl.enabled=true;
        const cx=(RV.fp.minX+RV.fp.maxX)/2,k=handleIndex(RV.cloth)*3,p=RV.cloth.pos,dx=p[k]-cx,dz=p[k+2],d=Math.hypot(dx,dz)||1;
        RV.pullDir=[dx/d,dz/d];say('Чохол знято');
      }
    }else if(ph==='drop'){
      RV.dropT+=dt;clothStep(dt);
      if(RV.fadeT<0&&(RV.dropT>TIMING.dropS||(clothMeanY(RV.cloth)<.12&&RV.dropT>1.2))){RV.fadeT=0;const m=RV.clothMesh.material;m.transparent=true;}
      if(RV.fadeT>=0){RV.fadeT+=dt;const m=RV.clothMesh.material;m.opacity=1-smooth(RV.fadeT/TIMING.fadeS);
        if(RV.fadeT>=TIMING.fadeS){RV.g.remove(RV.clothMesh);RV.clothMesh.geometry.dispose();m.dispose();RV.clothMesh=null;RV.cloth=null;
          RV.phase='spool';RV.spoolT=0;AN.on=true;say('Запуск двигунів');}}
    }else if(ph==='spool'){
      RV.spoolT+=dt;
      if(RV.spoolT>=TIMING.spoolS+TIMING.holdS){RV.phase='lift';RV.liftT=0;ctl.enabled=false;ctl.maxDistance=400;ctl.maxPolarAngle=PI;ctl.minPolarAngle=0;say('Зліт');
        RV.camPos.set(RV.fp.maxX+5.5,1.15,7.5);cam.position.copy(RV.camPos);}
    }else if(ph==='lift'){
      RV.liftT+=dt;
      const p=liftPose(RV.liftT);
      holder.position.set(p.x,p.y,0);holder.rotation.set(p.bank,0,p.pitch);
      tmp.set(p.x+.3,p.y+.55,0);const k=1-Math.exp(-4*dt);ctl.target.lerp(tmp,k);
      const dist=cam.position.distanceTo(ctl.target);const fov=clamp(2*Math.atan(5/dist)*180/PI,19,32);if(Math.abs(fov-cam.fov)>.05){cam.fov=fov;cam.updateProjectionMatrix();}
      if(p.done&&RV.outT===0){RV.phase='out';RV.outT=0;fade.classList.add('is-in');}
    }else if(ph==='out'){
      RV.outT+=dt;
      if(RV.outT>=TIMING.outS){stop();return;}
    }
    // спільне для фаз після чохла: оберти, вогні, фара, пил, тінь
    const spin=smooth(AN.k),lit=ph==='spool'||ph==='lift'||ph==='out';
    lampsStep(RV.t,lit);
    if(RV.landing)RV.landing.intensity=lit?140*smooth(RV.spoolT/1.2):0;
    if(RV.dust){const hy=holder.position.y,fall=clamp(1-hy/2.6,0,1);RV.dust.rotation.y+=dt*.35;
      RV.dust.children.forEach(s=>{const r=1.1+3.4*spin*s.userData.r;s.position.set(RV.hub.x+holder.position.x+Math.cos(s.userData.a)*r,.1+.05*Math.sin(RV.t*2+s.userData.a*5),Math.sin(s.userData.a)*r);
        s.material.opacity=.2*spin*fall;s.scale.setScalar(s.userData.s*(.6+spin*.7));});}
    if(RV.shadow){const hy=holder.position.y;RV.shadow.position.x=(RV.fp.minX+RV.fp.maxX)/2+holder.position.x;RV.shadow.material.opacity=clamp(1-hy/3.2,0,1)*.9;RV.shadow.visible=hy<3.2;}
  }

  return {get on(){return RV.on;},get phase(){return RV.phase;},get progress(){return RV.progress;},start,stop,step,
    // для перевірок: тягнути ручку з коду
    __pull(x,z){if(!RV.cloth||RV.phase!=='cover')return;const k=handleIndex(RV.cloth)*3,p=RV.cloth.pos;if(RV.cloth.pinned<0){RV.cloth.pin=[p[k],p[k+1],p[k+2]];RV.cloth.pinned=handleIndex(RV.cloth);RV.drag.plane.constant=-Math.max(.25,p[k+1]);}RV.drag.on=true;RV.drag.target.set(x,-RV.drag.plane.constant,z);},
    __release(){release();},
    __handle(){return RV.handle?handleScreen():null;},
  };
}
