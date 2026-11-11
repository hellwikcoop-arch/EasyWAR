/* ---------- керування ---------- */
const VKEYS=['Q','W','E','R','T','Y','U','I','O','P','[',']'],VCODES=['KeyQ','KeyW','KeyE','KeyR','KeyT','KeyY','KeyU','KeyI','KeyO','KeyP','BracketLeft','BracketRight'];
const MODES=[['park','Стоянка'],['orbit','Огляд'],['engine','Запуск двигуна'],['drive','Виїзд'],['combat','Бойове положення'],['reload','Заряджання']];
function chip(k,label){const b=document.createElement('button');b.type='button';b.className='chip';b.innerHTML=`<kbd>${k}</kbd><span>${label}</span>`;return b;}
function buildChips(){const rv=$('#gRowV'),rm=$('#gRowM');rv.innerHTML=rm.innerHTML='';{const oc=$('#gCats');if(oc)oc.remove();}G.vChips={};G.mChips={};
  GV_ORDER.forEach((id,i)=>{const b=chip(VKEYS[i]||String(i+1),flagSVG(GV[id].origin)+GV[id].n);b.onclick=()=>setVehicle(id);rv.append(b);G.vChips[id]=b;});
  {const cb=document.createElement('div');cb.className='g-cats';cb.id='gCats';GV_CATS.forEach(([k,l])=>{const b=document.createElement('button');b.type='button';b.dataset.cat=k;const n=k==='all'?GV_ORDER.length:GV_ORDER.filter(i=>GV[i].cat===k).length;b.innerHTML=`${l}<i>${n}</i>`;b.disabled=!n;b.onclick=()=>setCat(k);cb.append(b);});rv.before(cb);setCat('all',true);}
  MODES.forEach(([m,l],i)=>{const b=chip(i+1,l);b.onclick=()=>setMode(m);rm.append(b);G.mChips[m]=b;});}
function modeOk(m){const D=GV[G.cur];if(m==='combat')return !!D.combat;if(m==='reload')return !!D.reload;return true;}
function syncChips(){for(const id in G.vChips)G.vChips[id].classList.toggle('on',id===G.cur);
  for(const m in G.mChips){const ok=modeOk(m);G.mChips[m].classList.toggle('on',m===G.mode);G.mChips[m].disabled=!ok;G.mChips[m].style.opacity=ok?'':.35;G.mChips[m].title=ok?'':'Недоступно для цієї машини';}}
const MLABEL={park:'Стоянка',orbit:'Огляд · автообертання',engine:'Двигун запущено',drive:'Виїзд з боксу заднім ходом',combat:'Бойове положення',reload:'Заряджання'};
function setMode(m){if(!G.cur||!modeOk(m)){toast('Режим недоступний для цієї машини');return;}const S=G.models[G.cur];
  if(G.mode==='drive'&&m!=='drive'){G.drive.phase=0;}
  G.mode=m;G.engOn=(m==='engine'||m==='drive');G.combatWant=(m==='combat'||m==='reload')?1:0;
  if(m==='drive'){G.drive={x:S?S.veh.position.x:0,v:0,phase:1,t:0};}
  if(m==='reload'&&S&&S.act){const D=GV[G.cur];if(D.combat==='clip'){G.combat=1;applyCombat(S,1);}else{G.combat=G.combatWant=0;applyCombat(S,0);S.act.reset();S.act.play();}S.act.paused=false;S.act.time=0;S.act.timeScale=1;G.reload={t:0,dur:S.clip.duration};}
  else if(G.reload){G.reload=null;cap('');if(S&&S.D.combat==='hand')restRig(S);else if(S&&S.act){S.act.paused=true;applyCombat(S,G.combat);}}
  if(m!=='drive'&&S){S.veh.position.x=0;}
  status(MLABEL[m]);syncChips();}
async function setVehicle(id){if(!GV[id])return;G.want=id;$('#gLoad').hidden=false;G.ready=false;let S;
  try{S=await getModel(id);}catch(e){console.error('garage load',id,e);$('#gLoad').hidden=true;toast('Не вдалося завантажити модель');return;}
  if(G.want!==id)return;for(const k in G.models)if(G.models[k]!==S&&G.models[k].veh.parent)G.root.remove(G.models[k].veh);G.cur=id;G.root.add(S.veh);S.veh.position.x=0;
  resetState(S);hudSet(id);$('#gLoad').hidden=true;if(!modeOk(G.mode)||G.mode==='drive'||G.mode==='reload')G.mode='park';setMode(G.mode);
  G.camD=null;G.yaw=S.L>12?-(PI-.32):-(PI-.52);G.el=.07;placeLamps(S);G.ready=true;}
function restRig(S){if(!S.rest)return;S.act.stop();S.rest.forEach(([o,p,q,sc])=>{o.position.copy(p);o.quaternion.copy(q);o.scale.copy(sc);});}
function resetState(S){if(S.D.combat==='hand')restRig(S);else if(S.act){S.act.paused=true;S.act.time=S.park;S.mixer.update(0);}G.combat=G.combatWant=0;G.reload=null;cap('');applyCombat(S,0);S.wheels.forEach(w=>w.g.rotation.z=0);G.drive={x:0,v:0,phase:0,t:0};}
function applyCombat(S,k){const D=S.D;const e=k<.5?2*k*k:1-Math.pow(-2*k+2,2)/2;
  if(D.combat==='clip'&&S.act&&!G.reload){S.act.time=D.clip.raise[0]+(D.clip.raise[1]-D.clip.raise[0])*e;S.mixer.update(0);}
  if(S.tel){const a=S.tel.elev*e,q=new T.Quaternion().setFromAxisAngle(new T.Vector3(0,0,1),a);S.tel.n.quaternion.copy(q).multiply(S.tel.q);
    const d=S.tel.p.clone().sub(S.tel.pv).applyQuaternion(q).add(S.tel.pv);S.tel.n.position.copy(d);}}
function placeLamps(S){if(!G.hl){G.hl=[-1,1].map(s=>{const l=new T.SpotLight(0xfff0d0,0,40,.45,.5,1.2);G.root.add(l,l.target);return l;});
    G.hlGlow=new T.Points(new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute([0,0,0,0,0,0],3)),new T.PointsMaterial({map:G.glowTex,size:1.6,transparent:true,depthWrite:false,blending:T.AdditiveBlending,color:0xfff2cc,opacity:0}));G.root.add(G.hlGlow);}}
function input(){const cvs=renderer.domElement;let px=0,py=0;
  cvs.addEventListener('pointerdown',e=>{G.drag=true;px=e.clientX;py=e.clientY;cvs.setPointerCapture(e.pointerId);cvs.classList.add('drag');});
  cvs.addEventListener('pointermove',e=>{if(!G.drag)return;const dx=e.clientX-px,dy=e.clientY-py;px=e.clientX;py=e.clientY;G.yaw+=dx*.006;G.el=clamp(G.el+dy*.004,-.02,.95);G.yawV=dx*.006;if(G.mode==='orbit'){}});
  const up=()=>{G.drag=false;cvs.classList.remove('drag');};cvs.addEventListener('pointerup',up);cvs.addEventListener('pointercancel',up);
  cvs.addEventListener('wheel',e=>{e.preventDefault();G.zoom=clamp(G.zoom*(1+Math.sign(e.deltaY)*.08),.55,1.6);},{passive:false});
  const rel=d=>{const L=gvList(),i=L.indexOf(G.cur),n=L.length;if(!n)return;setVehicle(L[(i<0?(d>0?-1:0):i+d+n)%n]);};
  $('#gL').onclick=$('#gPrev').onclick=$('#gkL').onclick=()=>rel(-1);$('#gR').onclick=$('#gNext').onclick=$('#gkR').onclick=()=>rel(1);
  const holo=()=>{G.holo=!G.holo;$('#gkHolo').classList.toggle('on',G.holo);toast(G.holo?'ТТХ: показано':'ТТХ: приховано');};
  const lamp=()=>{G.lamps=!G.lamps;$('#gkLamp').classList.toggle('on',G.lamps);toast(G.lamps?'Фари: увімкнено':'Фари: вимкнено');};
  $('#gkHolo').onclick=holo;$('#gkLamp').onclick=lamp;
  addEventListener('keydown',e=>{if(!G.on||e.ctrlKey||e.metaKey||e.altKey||/INPUT|TEXTAREA/.test(document.activeElement&&document.activeElement.tagName))return;
    const vi=VCODES.indexOf(e.code);if(vi>=0&&GV_ORDER[vi]){setVehicle(GV_ORDER[vi]);e.preventDefault();return;}
    const mi=/^Digit([1-6])$/.exec(e.code);if(mi){setMode(MODES[+mi[1]-1][0]);e.preventDefault();return;}
    if(e.code==='ArrowLeft'){rel(-1);e.preventDefault();}else if(e.code==='ArrowRight'){rel(1);e.preventDefault();}else if(e.code==='Period'){holo();}else if(e.code==='KeyL'){lamp();}});
  buildChips();}
/* ---------- цикл ---------- */
const tgt=new T.Vector3(),cpos=new T.Vector3(),ex=new T.Vector3();let last=0,raf=0;
function step(dt){G.t+=dt;const S=G.models[G.cur];
  if(toastT>0){toastT-=dt;if(toastT<=0){$('#gStatus').classList.remove('toast');status(MLABEL[G.mode]);}}
  if(G.shafts)G.shafts.forEach(m=>m.material.uniforms.uT.value=G.t);
  if(G.dust){G.dust.rotation.y=Math.sin(G.t*.05)*.02;G.dust.position.y=Math.sin(G.t*.2)*.15;}
  if(G.hook)G.hook.position.y=-3.0+Math.sin(G.t*.4)*.04;
  updPuffs(dt);
  if(!S){return;}
  if(S.mixer&&G.reload){G.reload.t+=dt;S.mixer.update(dt);const L=GV_RELOAD[G.cur]||[];let c='';for(const [t,s] of L)if(G.reload.t>=t)c=s;
    cap(c?`Заряджання · ${c} · ${Math.min(100,Math.round(G.reload.t/G.reload.dur*100))}%`:'');if(G.reload.t>=G.reload.dur){G.reload=null;cap('');if(S.D.combat==='hand')restRig(S);G.mode=S.D.combat==='clip'?'combat':'park';G.combatWant=G.mode==='combat'?1:0;status('Заряджено');syncChips();}}
  else{const k=ease(G.combat,G.combatWant,1.4,dt);if(Math.abs(k-G.combat)>1e-4){G.combat=k;applyCombat(S,k);}}
  // рух
  let v=0;if(G.mode==='drive'){const d=G.drive;d.t+=dt;const xOut=HL+6-S.L*.5+S.L;
    if(d.phase===1){if(d.t>1.6){d.phase=2;d.t=0;}}else if(d.phase===2){d.v=Math.min(6,d.v+dt*2.2);d.x+=d.v*dt;if(d.x>xOut){d.phase=3;d.t=0;}}
    else if(d.phase===3){d.v=Math.max(0,d.v-dt*5);d.x+=d.v*dt;if(d.t>2.6){d.phase=4;d.t=0;}}
    else if(d.phase===4){const rem=d.x;d.v=-Math.min(3.2,Math.max(.4,rem*.7));d.x=Math.max(0,d.x+d.v*dt);if(d.x<=0){d.phase=5;d.t=0;d.v=0;}}
    else if(d.phase===5&&d.t>1){G.mode='park';G.engOn=false;status('Заїхала в бокс · стоянка');syncChips();}
    v=(d.phase===2||d.phase===3||d.phase===4)?d.v:0;S.veh.position.x=d.x;}
  S.wheels.forEach(w=>{w.g.rotation.z+=v*dt/w.r;});
  // двигун
  G.eng=ease(G.eng,G.engOn?1:0,2,dt);
  S.seat.position.y=-S.box.min.y+(G.eng>.05?Math.sin(G.t*61)*.004*G.eng+Math.sin(G.t*23)*.003*G.eng:0);
  if(G.eng>.1&&S.D.exh){const e=S.D.exh;ex.set(e[0],e[1],e[2]);S.seat.localToWorld(ex);
    if(Math.random()<dt*(18+Math.abs(v)*8)*G.eng)puff(ex,new T.Vector3(rnd(-.2,.2)-v*.3,rnd(.6,1.1),e[2]<0?-rnd(.2,.5):rnd(.2,.5)),.7*G.eng,.35,rnd(1.8,3),rnd(1.6,2.6),G.engOn&&G.eng<.6?0x2a2a28:0x8a8c8e);}
  // фари
  const hlOn=(G.lamps||G.engOn)?1:0;if(S.kit){S.kit.hlM.emissiveIntensity=ease(S.kit.hlM.emissiveIntensity,.15+hlOn*3.2,6,dt);S.kit.tlM.emissiveIntensity=.35+hlOn*1.6;}if(G.hl){const kh=S.kit&&S.kit.hl.length===2?S.kit.hl:null;const fx=(kh?kh[0][0]:S.wbox.min.x+.1)+S.veh.position.x,hy=kh?kh[0][1]:Math.min(1.4,S.H*.4);
    G.hl.forEach((l,i)=>{const s=i?1:-1;l.intensity=ease(l.intensity,hlOn*2.2,6,dt);l.position.set(fx,hy,kh?kh[i][2]:s*S.W*.32);l.target.position.set(fx-12,0,s*S.W*.4);});
    const p=G.hlGlow.geometry.attributes.position;p.setXYZ(0,fx-.05,hy,kh?kh[0][2]:-S.W*.32);p.setXYZ(1,fx-.05,hy,kh?kh[1][2]:S.W*.32);p.needsUpdate=true;G.hlGlow.material.opacity=G.hl[0].intensity/2.2*.9;}
  // камера
  if(G.mode==='orbit'&&!G.drag)G.yaw+=dt*.12;else if(!G.drag){G.yaw+=G.yawV;G.yawV*=Math.pow(.02,dt);}
  const hfv=2*Math.atan(Math.tan(camera.fov*PI/360)*camera.aspect),Rr=.5*Math.hypot(S.L,S.W);const R3=.5*Math.hypot(S.L,S.W,S.H),fit=R3/Math.sin(Math.min(hfv,camera.fov*PI/180)/2)*1.08;const base0=S.L>12?Rr/Math.tan(hfv/2)*1.38+Rr*.5:Math.max(S.L*1.05,S.H*2.2,7)+4.5;const base=(S.D.kb||S.H>3.2||S.L>9)?Math.max(base0,fit):base0;const tl=(S.D.tel||S.D.zoomC)?G.combat:0;G.camD=ease(G.camD||base*G.zoom,base*G.zoom*(1+.28*tl),4,dt);
  const vx=S.veh.position.x;const bc=vx+(S.cOff||0)-S.L*.12,bz=S.cZ||0;tgt.set(ease(tgt.x,bc,3,dt),S.H*.42+tl*2.2,ease(tgt.z,bz,3,dt));
  const d=G.camD;cpos.set(tgt.x+d*Math.cos(G.el)*Math.cos(G.yaw),tgt.y+d*Math.sin(G.el)+.8,tgt.z+d*Math.cos(G.el)*Math.sin(G.yaw));
  cpos.x=clamp(cpos.x,-HL+1.5,HL+20);cpos.z=clamp(cpos.z,-HW+1.2,HW-1.2);cpos.y=clamp(cpos.y,.5,WH-1.5);
  camera.position.copy(cpos);camera.lookAt(tgt);
  {const sc=vx+(S.cOff||0),R2=Math.max(S.L,S.W)*1.0+3;if(G.spot){G.spot.position.x=S.cOff||0;G.spot.scale.set(R2,R2,1);}if(G.top){G.top.position.set(sc,11.5,0);G.top.target.position.set(sc,0,0);G.top.angle=Math.min(.95,Math.atan((R2*.5)/11.5)*1.15);}}G.key.target.position.set(vx,.6,0);G.key2.target.position.set(vx,.6,0);G.key.position.set(vx-5,10,-6.5);G.key2.position.set(vx+4.5,10,6.5);
  hudFrame(dt);}
function loop(t){if(!G.on){raf=0;return;}raf=requestAnimationFrame(loop);const dt=Math.min(.05,(t-(last||t))/1000);last=t;step(dt);renderer.render(scene,camera);}
G.show=()=>{$('#gFig').hidden=false;if(!G.built)build();try{enLight();}catch(e){}G.on=true;resize();last=0;if(!raf)raf=requestAnimationFrame(loop);if(!G.cur&&!G.want)setVehicle(GV_ORDER[0]);};
G.hide=()=>{G.on=false;$('#gFig').hidden=true;};
G.set=setVehicle;G.setMode=setMode;G.step=(n=30,dt=1/30)=>{for(let i=0;i<n;i++)step(dt);renderer.render(scene,camera);};
function gvList(){return GV_ORDER.filter(i=>!G.cat||G.cat==='all'||GV[i].cat===G.cat);}
function setCat(k,quiet){G.cat=k;document.querySelectorAll('#gCats button').forEach(b=>b.classList.toggle('on',b.dataset.cat===k));
  for(const id in G.vChips){const c=G.vChips[id];c.hidden=!(k==='all'||GV[id].cat===k);}
  if(!quiet){const L=gvList();if(L.length&&!L.includes(G.cur))setVehicle(L[0]);toast('Категорія: '+(GV_CATS.find(c=>c[0]===k)||[,''])[1]);}}
G.setCat=setCat;
G.side='ua';
function setSide(sd){if(G.side===sd)return;G.side=sd;GV_ORDER=sd==='en'?EN_ORDER:UA_ORDER;GV_CATS=sd==='en'?EN_CATS:UA_CATS;document.body.classList.toggle('enemy',sd==='en');
  if(G.built){enLight();buildChips();syncChips();setVehicle(GV_ORDER[0]);}else{G.cur=null;}}
G.setSide=setSide;
function enLight(){const T=THREE;if(!G.scene)return;if(!G.enL){G.enL=new T.PointLight(0xff2a24,0,34,2);G.enL.position.set(-6,5.5,-7);G.scene.add(G.enL);G.enL2=new T.PointLight(0xff3a30,0,26,2);G.enL2.position.set(8,3,6);G.scene.add(G.enL2);}
  const on=G.side==='en';G.enL.intensity=on?1.4:0;G.enL2.intensity=on?.5:0;if(G.key){G.key.color.setHex(on?0xffd2c4:0xffe4c2);}}
})();
