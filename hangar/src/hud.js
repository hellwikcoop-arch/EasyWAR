/* =========================================================
   HUD «ВИБІР ЛІТАКА» + голографічні виноски ТТХ
   ========================================================= */
const ORDER=['mig','f16','su','su25','su24','m2k','gripen','mi8','mi24','il'];
// Відкриті довідкові значення. Що не певне — пропущено.
const SPEC={
 mig:{origin:'SU',n:'МіГ-29МУ1',L:'17,32',S:'11,36',H:'4,73',mach:'2,25',vAlt:'2 400',vLow:'1 500',eng:'2 × РД-33',arm:'ГШ-301 30 мм · Р-27 · Р-73 · GBU-62 · GBU-39',ceil:'18 000',r:[4,2.5,.84,.55,.86],ic:'jet',tag:'r'},
 f16:{origin:'US',n:'F-16AM',L:'15,06',S:'9,96',H:'4,88',mach:'2,05',vAlt:'2 120',vLow:'1 470',eng:'F100-PW-220',arm:'M61A1 20 мм · AIM-120 · AIM-9 · GBU-62 · GBU-39',ceil:'15 240',r:[4,4,.8,.5,.92],ic:'f16',tag:'n'},
 su:{origin:'SU',n:'Су-27П1М',L:'21,94',S:'14,7',H:'5,93',mach:'2,35',vAlt:'2 500',vLow:'1 400',eng:'2 × АЛ-31Ф',arm:'ГШ-30-1 30 мм · Р-27 · Р-73',ceil:'19 000',r:[4.5,2,.9,.62,.82],ic:'jet',tag:'r'},
 mi8:{origin:'SU',n:'Мі-8',R:'21,29',vMax:'250',arm:'НАР С-8 · 4 × Б-8В20',r:[.5,2,.14,.5,.4],ic:'heli'},
 mi24:{origin:'SU',n:'Мі-24П',L:'17,5',R:'17,3',H:'6,5',vMax:'335',eng:'2 × ТВ3-117',arm:'ГШ-30К 30 мм · НАР С-8 · ПТКР «Штурм»',r:[1,4.5,.24,.86,.46],ic:'heli'},
 il:{origin:'SU',n:'Іл-76МД',L:'46,59',S:'50,5',H:'14,76',pay:'47',eng:'4 × Д-30КП-2',r:[0,0,.3,.62,.2],ic:'cargo'},
 su24:{origin:'SU',n:'Су-24М',L:'22,67',S:'17,64 / 10,37',H:'6,19',mach:'1,35',vLow:'1 315',eng:'2 × АЛ-21Ф-3',arm:'ГШ-6-23 23 мм · бомби · Storm Shadow',ceil:'11 000',r:[1.5,4.5,.74,.7,.5],ic:'swing'},
 su25:{origin:'SU',n:'Су-25М1',L:'15,5',S:'14,4',H:'4,8',vLow:'975',eng:'2 × Р-195',arm:'ГШ-30-2 30 мм · НАР С-8 / С-13 · бомби до 4 400 кг',ceil:'7 000',r:[1,4.5,.42,.92,.55],ic:'attack',tag:'r'},
 gripen:{origin:'SE',n:'JAS 39 Gripen',L:'14,1',S:'8,4',H:'4,5',mach:'2,0',eng:'Volvo RM12',arm:'BK-27 27 мм · AIM-120 · IRIS-T · Meteor',ceil:'15 240',r:[4.5,3.5,.82,.5,.95],ic:'canard',tag:'n',note:'Очікується в ПС ЗСУ'},
 m2k:{origin:'FR',n:'Mirage 2000-5F',L:'14,36',S:'9,13',H:'5,20',mach:'2,2',vAlt:'2 336',vLow:'1 110',eng:'SNECMA M53-P2',arm:'2 × DEFA 554 30 мм · MICA',ceil:'17 060',r:[4,3,.84,.5,.86],ic:'delta',tag:'n'}};
const ICON={
 jet:'M50 6 L54 22 L56 40 L88 60 L88 66 L57 60 L56 76 L68 86 L68 91 L52 88 L50 94 L48 88 L32 91 L32 86 L44 76 L43 60 L12 66 L12 60 L44 40 L46 22 Z',
 f16:'M50 4 L53 24 L54 44 L90 64 L90 70 L55 64 L55 78 L68 88 L68 92 L51 90 L50 96 L49 90 L32 92 L32 88 L45 78 L45 64 L10 70 L10 64 L46 44 L47 24 Z',
 delta:'M50 4 L54 24 L56 40 L88 82 L88 88 L56 84 L54 92 L50 96 L46 92 L44 84 L12 88 L12 82 L44 40 L46 24 Z',
 swing:'M50 4 L53 22 L54 38 L84 52 L84 57 L55 55 L56 76 L70 88 L70 92 L52 89 L50 96 L48 89 L30 92 L30 88 L44 76 L45 55 L16 57 L16 52 L46 38 L47 22 Z',
 cargo:'M50 4 L54 14 L54 34 L94 46 L94 52 L54 50 L53 80 L70 86 L70 91 L51 90 L50 96 L49 90 L30 91 L30 86 L47 80 L46 50 L6 52 L6 46 L46 34 L46 14 Z',
 attack:'M50 5 L53 18 L54 38 L56 42 L94 50 L94 56 L56 56 L55 76 L70 84 L70 89 L52 88 L50 95 L48 88 L30 89 L30 84 L45 76 L44 56 L6 56 L6 50 L44 42 L46 38 L47 18 Z',
 canard:'M50 4 L53 18 L54 26 L66 32 L66 35 L54 33 L55 44 L86 78 L86 84 L55 82 L53 92 L50 96 L47 92 L45 82 L14 84 L14 78 L45 44 L46 33 L34 35 L34 32 L46 26 L47 18 Z',
 mriya:'M50 3 L53 10 L53 36 L96 50 L96 54 L53 50 L52 82 L72 86 L72 92 L28 92 L28 86 L48 82 L47 50 L4 54 L4 50 L47 36 L47 10 Z M27 86 l0 -5 l3 0 l0 5 Z M70 86 l0 -5 l3 0 l0 5 Z',
 heli:'M47 18 L53 18 L56 30 L56 54 L52 62 L51 92 L58 92 L58 96 L42 96 L42 92 L49 92 L48 62 L44 54 L44 30 Z M50 40 m-44 -8 l88 16 l-1 3 l-88 -16 Z M50 40 m44 -8 l-88 16 l1 3 l88 -16 Z'};
window.__HUD={ICON,SPEC,ORDER};
const stg=$('#stage');
const hud={cur:null,holo:true,box:new T.Box3(),bb:new T.Box3(),tmp:new T.Box3(),m4:new T.Matrix4(),inv:new T.Matrix4(),bt:0,anch:{},el:{}};
const holo=$('#holo'),svgNS='http://www.w3.org/2000/svg',hsvg=holo.querySelector('svg');
['dim','mach','spd','eng','arm','ceil'].forEach(k=>{const d=document.createElement('div');d.className='hc hc-'+(k==='arm'?'eng hc-arm':k);holo.append(d);
  const pl=document.createElementNS(svgNS,'polyline');const c=document.createElementNS(svgNS,'circle');c.setAttribute('r','3');hsvg.append(pl,c);hud.el[k]={d,pl,c,x:null,y:null};});hud.dimG=coDimG(hsvg);window.__HUD.h=hud;
function stars(v){let h='';for(let i=1;i<=5;i++)h+=`<i class="${v>=i?'f':v>=i-.5?'h':''}">★</i>`;return h;}
function hudSet(a){const P=SPEC[a];if(!P)return;hud.cur=a;
  $('#hxName').firstChild.textContent=P.n.toUpperCase()+' ';
  {const nm=$('#hxName');let f=$('#hxFlag');if(!f){f=document.createElement('span');f.id='hxFlag';f.className='nflag';nm.parentNode.insertBefore(f,nm);}f.innerHTML=flagSVG(P.origin);}
  if(!hud.flg&&typeof chipsA!=='undefined'){hud.flg=1;for(const k in chipsA){const sp=chipsA[k].querySelector('span')||chipsA[k];if(SPEC[k]&&!sp.querySelector('.oflag'))sp.insertAdjacentHTML('afterbegin',flagSVG(SPEC[k].origin));}}
  $('#hxA2A').innerHTML=stars(P.r[0]);$('#hxA2G').innerHTML=stars(P.r[1]);
  ['#hxSpd','#hxArm','#hxHnd'].forEach((s,i)=>$(s).style.width=Math.round(P.r[2+i]*100)+'%');
  $('#hxIcon').innerHTML=`<path d="${ICON[P.ic]}" fill="#7dff8a" fill-opacity=".85" stroke="#d9ffe0" stroke-width="1"/>`;
  const i=ORDER.indexOf(a),pv=ORDER[(i+ORDER.length-1)%ORDER.length],nx=ORDER[(i+1)%ORDER.length];
  $('#hxPrev').innerHTML=flagSVG(SPEC[pv].origin)+SPEC[pv].n;$('#hxNext').innerHTML=flagSVG(SPEC[nx].origin)+SPEC[nx].n;
  $('#hxNew').classList.toggle('off',P.tag!=='n');$('#hxRec').classList.toggle('off',P.tag!=='r');
  const E=hud.el,row=(k,v,u)=>v?`<span class="k">${k}</span><b>${v}</b><i>${u}</i>`:'';
  E.dim.d.innerHTML=row('Довжина',P.L,'м')+row(P.R?'Діаметр гвинта':'',P.R,'м')+row('Розмах',P.S,'м')+row('Висота',P.H,'м');
  E.mach.d.innerHTML=P.mach?`<span class="v">МАХ</span><div><b>${P.mach}</b>${P.vAlt?`<small>${P.vAlt} км/год на висоті</small>`:''}</div>`:P.pay?`<div><span class="k o">Макс. вантаж</span><b>${P.pay}<i class="u">т</i></b></div>`:'';
  const vs=P.vLow||P.vMax;E.spd.d.innerHTML=vs?`<div class="t">${P.vLow?'<span>Макс. швидкість</span><span>біля землі</span>':(P.pay?'<span>Крейсерська</span><span>швидкість</span>':'<span>Макс.</span><span>швидкість</span>')}</div><b>${vs}<i>км/год</i></b>`:'';
  E.ceil.d.innerHTML=(P.ceil?`<small>Практ. стеля, м</small>${P.ceil}`:'')+(P.note?`<small style="color:var(--hx-y);font-size:11px;margin-top:4px">${P.note}</small>`:'');
  E.eng.d.innerHTML=(P.eng?`<div class="box"><span class="k">${/^\d|×/.test(P.eng)?'Двигуни':'Двигун'}</span><b>${P.eng}</b></div>`:'');E.arm.d.innerHTML=(P.arm?`<div class="arm"><span class="k">Озброєння</span>${P.arm}</div>`:'');
  Object.values(E).forEach(o=>{o.empty=!o.d.innerHTML;o.d.style.display=o.empty?'none':'';o.pl.style.display=o.c.style.display=o.empty?'none':'';});
  hud.bt=0;hud.anc=null;hud.occ={};hud.ancN=0;hud.t0=performance.now();}
function goRel(d){const i=ORDER.indexOf(AIR.cur);setAircraft(ORDER[(i+d+ORDER.length)%ORDER.length]);}
$('#hxL').onclick=()=>goRel(-1);$('#hxR').onclick=()=>goRel(1);$('#hxPrev').onclick=()=>goRel(-1);$('#hxNext').onclick=()=>goRel(1);
CODES.ArrowLeft=()=>goRel(-1);CODES.ArrowRight=()=>goRel(1);
const toggleHolo=()=>{hud.holo=!hud.holo;$('#hkHolo').classList.toggle('on',hud.holo);toast(hud.holo?'ТТХ: показано':'ТТХ: приховано');};
CODES.Period=toggleHolo;$('#hkHolo').onclick=toggleHolo;
$('#hkEsc').onclick=()=>select(null);$('#hkIns').onclick=()=>doSys('insp');
$('#hkL').onclick=()=>goRel(-1);$('#hkR').onclick=()=>goRel(1);
// габарити видимого літака в осях world (без факелів, променів, частинок)
function aircraftBox(){const B=hud.bb.makeEmpty();hud.inv.copy(world.matrixWorld).invert();
  liftG.updateMatrixWorld(true);
  (function walk(o){if(!o.visible)return;if(o.isMesh&&o.geometry&&!o.isInstancedMesh){const m=o.material,mm=Array.isArray(m)?m[0]:m;
      if(mm&&!mm.isShaderMaterial&&mm.blending!==T.AdditiveBlending&&!(mm.isMeshBasicMaterial&&mm.transparent)){
        if(!o.geometry.boundingBox){o.geometry.computeBoundingBox();const pa=o.geometry.attributes.position;if(pa&&pa.normalized){const a=pa.array,dv=a instanceof Int16Array?32767:a instanceof Uint16Array?65535:a instanceof Int8Array?127:a instanceof Uint8Array?255:1;o.geometry.boundingBox.min.divideScalar(dv);o.geometry.boundingBox.max.divideScalar(dv);}}hud.m4.multiplyMatrices(hud.inv,o.matrixWorld);hud.tmp.copy(o.geometry.boundingBox).applyMatrix4(hud.m4);if(isFinite(hud.tmp.min.x))B.union(hud.tmp);}}
    for(const c of o.children)walk(c);})(liftG);
  return B;}
const hv=new T.Vector3(),hc=new T.Vector3();
function proj(v,out){hv.copy(v);world.localToWorld(hv);hv.project(camera);out.x=(hv.x*.5+.5)*W;out.y=(-hv.y*.5+.5)*H;out.z=hv.z;return out;}
// якорі ТТХ для кожного ЛА: [u — частка довжини від носа, v — частка висоти, z — частка напівширини, режим: s бік / t згори / b знизу]
const ANC_JET={spd:[[.015,.45,0,'t'],[.06,.45,0,'t']],mach:[[.3,.38,.5,'s'],[.25,.6,0,'t'],[.4,.45,.3,'t']],eng:[[.985,.42,.12,'s'],[.95,.45,.15,'t'],[.9,.4,.3,'s'],[.75,.4,.2,'t'],[.35,.3,.3,'s']],arm:[[.5,.2,.42,'b'],[.5,.2,.6,'b'],[.45,.2,.25,'b'],[.55,.3,.5,'t'],[.6,.3,.7,'t'],[.5,.15,.45,'s']],ceil:[[.9,.97,0,'t'],[.85,.97,.3,'t']]};
const ANC_HEL={spd:[[.03,.45,0,'t'],[.08,.5,0,'t']],mach:[[.4,.35,.5,'s'],[.5,.4,.4,'s']],eng:[[.36,.8,.3,'s'],[.4,.8,0,'t']],arm:[[.46,.3,.7,'b'],[.46,.3,.5,'b'],[.5,.4,.6,'s']],ceil:[[.36,1,0,'t']]};
const ANC_OVA={mig:{ceil:[.9,.97,.32,'t']},su:{ceil:[.9,.97,.25,'t']},su24:{arm:[.45,.15,.3,'b']},su25:{arm:[[.55,.25,.45,'b'],[.52,.3,.35,'s'],[.58,.5,.45,'t']],eng:[[.72,.62,.2,'t'],[.68,.58,.2,'s'],[.9,.45,.2,'s']],spd:[[.0,.45,0,'t'],[.03,.4,.1,'s'],[.08,.5,0,'t']]},
  il:{eng:[[.42,.35,.35,'b'],[.45,.35,.6,'b'],[.42,.6,.35,'t']],mach:[[.55,.4,.5,'s'],[.25,.5,.5,'s'],[.6,.9,0,'t']],ceil:[[.95,.97,0,'t']]},mi8:{arm:[.5,.35,.7,'b']},m2k:{mach:[.32,.4,.5,'s']}};
function hudAnc(){try{coDeq(liftG);}catch(e){console.warn('deq',e);}const B=hud.box,mn=B.min,mx=B.max,Lx=mx.x-mn.x,Hy=mx.y-mn.y;const sp=Object.assign({},isH()?ANC_HEL:ANC_JET,ANC_OVA[AIR.cur]||{});world.updateMatrixWorld(true);const M=world.matrixWorld;hud.anc={};
  for(const k in sp){const cs=Array.isArray(sp[k][0])?sp[k]:[sp[k]];hud.anc[k]=[1,-1].map(sd=>{const r=cs.map(q=>coSnap(liftG,mx.x-q[0]*Lx,mn.y+q[1]*Hy,sd,B,null,q[2],M,q[3])).filter(Boolean);return r.length?r:null;});}}
function hudFrame(dt){
  if(hud.cur!==AIR.cur)hudSet(AIR.cur);
  const loading=!$('#load').hidden;
  const on=hud.holo&&!S.insp&&!loading;holo.classList.toggle('off',!on);
  hud.bt-=dt;if(hud.bt<=0){hud.bt=.25;const B=aircraftBox();if(!B.isEmpty())hud.box.copy(B);}
  if(hud.mkFor!==AIR.cur)liftG.traverse(o=>{if(o.name&&o.name.startsWith('mk_'))o.visible=o.userData.air===AIR.cur;});
  if(!loading&&!hud.box.isEmpty()&&hud.mkFor!==AIR.cur&&(performance.now()-(hud.t0||0))>900){hud.mkFor=AIR.cur;try{window.__AMK=airMarks();}catch(e){console.warn('airMarks',e);}}
  if(!on||hud.box.isEmpty())return;
  hud.age=(performance.now()-(hud.t0||0))/1000;if((!hud.ancN&&hud.age>.6)||(hud.ancN===1&&hud.age>2.2)){hud.ancN=(hud.ancN||0)+1;try{hudAnc();}catch(e){console.warn('hudAnc',e);}}
  const E=hud.el;if(!hud.anc){for(const k in E){E[k].d.style.opacity=0;E[k].pl.style.opacity=E[k].c.style.opacity=0;}hud.dimG.style.opacity=0;return;}
  const B=hud.box,mn=B.min,mx=B.max;camW.copy(camera.position);world.worldToLocal(camW);const sz=camW.z>=(mn.z+mx.z)/2?1:-1,si=sz>0?0:1;
  const pj=v=>proj(v,{});const c0=pj(new T.Vector3((mn.x+mx.x)/2,(mn.y+mx.y)/2,(mn.z+mx.z)/2));const P0=SPEC[AIR.cur]||{};
  const num=v=>{const m=v==null?null:String(v).match(/^[≈~]?\s*[\d.,–-]+/);return m?m[0].replace(/\s/g,''):'';};
  const dm=coDims(hud.dimG,pj,B,sz,-1,[num(P0.L),num(P0.S||P0.R),num(P0.H)],c0.x,c0.y,true);
  hud.ot=(hud.ot||0)-dt;const doOcc=hud.ot<=0;if(doOcc)hud.ot=.2;hud.occ=hud.occ||{};
  const cd=$('#card');let CR=null;if(!cd.hidden){const a=cd.getBoundingClientRect(),b=stg.getBoundingClientRect();CR={x:a.left-b.left,y:a.top-b.top,w:a.width,h:a.height};}
  const items=[];const rc=new T.Raycaster();rc.camera=camera;
  for(const k of ['eng','arm','mach','spd','ceil','dim']){const o=E[k];if(o.empty){o.d.style.opacity=0;o.pl.style.opacity=o.c.style.opacity=0;continue;}
    let P,vis=true;if(k==='dim')P=dm;else{const cs=hud.anc[k]&&hud.anc[k][si];if(!cs){o.d.style.opacity=0;o.pl.style.opacity=o.c.style.opacity=0;continue;}const st=hud.occ[k+si]=hud.occ[k+si]||{i:0,h:false};
      if(doOcc){st.h=true;for(let i=0;i<cs.length;i++){const w=coW(cs[i]),d=w.clone().sub(camera.position),dl=d.length();rc.set(camera.position,d.normalize());rc.far=dl;const hh=rc.intersectObject(liftG,true).filter(coVis);if(!(hh.length&&hh[0].distance<dl-.3)){st.i=i;st.h=false;break;}}}
      if(st.i>=cs.length)st.i=0;const w=coW(cs[st.i]);vis=!st.h;hv.copy(w).project(camera);P={x:(hv.x*.5+.5)*W,y:(-hv.y*.5+.5)*H,z:hv.z};}
    vis=vis&&P.z<1&&P.x>0&&P.x<W&&P.y>0&&P.y<H;items.push({k,o,P,vis,fix:k==='dim'?'L':null});}
  let rx=72;const tl=stg.querySelector('.ui-tools');if(tl&&tl.offsetParent){const a=tl.getBoundingClientRect(),b=stg.getBoundingClientRect();if(a.width)rx=Math.max(rx,b.right-a.left+14);}
  coLayout(items,{W,H,cx:c0.x,top:150,bot:H*.64,lx:22,rx,dt});
  if(CR)for(const it of items){const o=it.o;if(o.x==null)continue;const bw=o.d.offsetWidth,bh=o.d.offsetHeight;if(o.x<CR.x+CR.w+8&&o.x+bw>CR.x-8&&o.y<CR.y+CR.h+8&&o.y+bh>CR.y-8){o.d.style.opacity=0;o.pl.style.opacity=o.c.style.opacity=0;}}
}

/* розпізнавальні знаки ПС ЗСУ: тризуб-кокарди на крилах і фюзеляжі, жовто-блакитний прапорець на кілі (лише там, де їх ще немає в текстурі) */
const AMK={mig:{w:1,f:1,fin:0},f16:{w:1,f:1,fin:1,wz:.45},su:{w:0,f:1,fin:1},mi8:{w:0,f:0,fin:1,fw:.7},mi24:{w:0,f:0,fin:1,fw:.6},il:{w:0,f:1,fin:1},su24:{w:0,f:1,fin:1,fv:.7},m2k:{w:0,f:1,fin:1,fv:.62},su25:{w:0,f:1,fin:1},gripen:{w:0,f:1,fin:1}};
function airMarks(){const cfg=Object.assign({w:1,f:1,fin:1},AMK[AIR.cur]||{},(typeof AIR_ENEMY!=='undefined'&&AIR_ENEMY[AIR.cur])||{});try{coDeq(liftG);}catch(e){}
  let done=false;liftG.traverse(o=>{if(o.name&&o.name.startsWith('mk_')){o.visible=o.userData.air===AIR.cur;if(o.visible)done=true;}});if(done)return 'skip';
  world.updateMatrixWorld(true);const M=world.matrixWorld,B=hud.box.clone(),mn=B.min,mx=B.max,Lx=mx.x-mn.x,Hy=mx.y-mn.y,cz=(mn.z+mx.z)/2,hw=(mx.z-mn.z)/2;
  const W=v=>v.clone().applyMatrix4(M),Dd=v=>v.clone().transformDirection(M);const rc=new T.Raycaster();
  const hit=(o,d)=>{rc.set(W(o),Dd(d));rc.far=200;rc.camera=camera;const h=rc.intersectObject(liftG,true).filter(x=>coVis(x)&&!(x.object.name||'').startsWith('mk_'));if(!h.length)return null;const lp=h[0].point.clone().applyMatrix4(new T.Matrix4().copy(M).invert());return {p:lp,o:h[0].object,n:h[0].face?h[0].face.normal.clone().transformDirection(h[0].object.matrixWorld).transformDirection(new T.Matrix4().copy(M).invert()):null};};
  const top=o=>{let x=o;while(x.parent&&x.parent.parent&&x.parent.parent!==liftG)x=x.parent;return x.parent&&x.parent.parent===liftG?x:liftG;};
  const place=(o,d,kind,w,h,up,dep)=>{const m=mkPlace(liftG,top,W(o),Dd(d),kind,w,h,Dd(up||new T.Vector3(0,1,0)),null,dep);if(m)m.userData.air=AIR.cur;return m;};
  const en=cfg.enemy,RK=en?'redstar':'roundel',FK=en?'redstar':'fin';const isH=()=>window.isHeliAny?window.isHeliAny():false;let n=0;
  if(cfg.w)[1,-1].forEach(sd=>{const z=cz+sd*hw*(cfg.wz||.6);const run=[];for(let i=0;i<=40;i++){const u=.15+i*.0175;const x=mx.x-u*Lx;const r=hit(new T.Vector3(x,mx.y+3,z),new T.Vector3(0,-1,0));run.push(r&&r.p.y<mn.y+Hy*.6&&(!r.n||Math.abs(r.n.y)>.5)?r:null);}
    let best=[0,-1],cs=-1;run.forEach((r,i)=>{if(r){if(cs<0)cs=i;if(i-cs>best[1]-best[0])best=[cs,i];}else cs=-1;});if(best[1]<0)return;
    const im=(best[0]+best[1])>>1,ch=(best[1]-best[0]+1)*.0175*Lx,sz=Math.min(1.9,Math.max(.5,ch*.5)),r=run[im];if(place(new T.Vector3(r.p.x,mx.y+3,z),new T.Vector3(0,-1,0),RK,sz,sz,new T.Vector3(1,0,0),.22))n++;
    // знизу
    if(place(new T.Vector3(r.p.x,mn.y-3,z),new T.Vector3(0,1,0),RK,sz,sz,new T.Vector3(1,0,0),.22))n++;});
  const dbg=[];
  if(cfg.f){const us=cfg.fu?[cfg.fu]:isH()?[.45,.4,.5,.35]:[.66,.6,.72,.55,.5];[1,-1].forEach(sd=>{let ok=false;for(const u of us){if(ok)break;const x=mx.x-u*Lx;for(const v of [.5,.42,.58,.35,.65,.3]){const y=mn.y+v*Hy;const r=hit(new T.Vector3(x,y,cz+sd*(hw+3)),new T.Vector3(0,0,-sd));
    if(r&&Math.abs(r.p.z-cz)<Math.max(1.1,hw*.25)&&(!r.n||Math.abs(r.n.z)>.5)){const sz=cfg.fs||Math.min(1.1,Math.max(.45,Hy*.14));if(place(new T.Vector3(x,r.p.y,cz+sd*(hw+3)),new T.Vector3(0,0,-sd),RK,sz,sz,null,.4)){n++;ok=true;dbg.push('f'+u+'/'+v);break;}}}}});}
  if(cfg.fin&&FK){[1,-1].forEach(sd=>{const vs=cfg.fv?[cfg.fv]:isH()?[.5,.47,.53,.44]:[.8,.72,.86,.65,.58];const u0=isH()?.72:.7,us=isH()?.14:.3;
    for(const v of vs){const y=mn.y+v*Hy;let a=-1,b=-1;for(let i=0;i<=30;i++){const u=u0+i*us/30;const r=hit(new T.Vector3(mx.x-u*Lx,y,cz+sd*(hw+3)),new T.Vector3(0,0,-sd));if(r&&Math.abs(r.p.z-cz)<Math.max(1.6,hw*.3)){if(a<0)a=u;b=u;}}
      if(a<0||b-a<.02)continue;const u=(a+b)/2,len=(b-a)*Lx,w=cfg.fw||Math.min(1.2,Math.max(.45,len*.45)),h=FK==='redstar'?w:w*2/3;if(place(new T.Vector3(mx.x-u*Lx,y,cz+sd*(hw+3)),new T.Vector3(0,0,-sd),FK,w,h,null,isH()?.25:.06)){n++;dbg.push('fin'+v);break;}}});}
  window.__AMKD=dbg.join(' ');
  return n;}
window.__airMarks=airMarks;window.__mkDbg=(f)=>eval(f);
