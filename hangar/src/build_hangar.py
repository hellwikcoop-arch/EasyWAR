# Builds the hangar part (src/hangar_index.html) from the EasyWAR aircraft-viewer.html + our hangar restyle.
import re
B='/workspace/hangar2/'
S=B+'src/'
src=open(B+'base_repo.html').read()
def rep(s,a,b,count=1):
    n=s.count(a)
    assert n>=1,('not found',a[:90])
    if count==1: assert n==1,('multiple',a[:90],n)
    return s.replace(a,b)
s=src
s=rep(s,'<title>Довідник: літак</title>','<title>EasyWAR · Ангар і гараж техніки</title>')
css=open(S+'hud.css').read()
s=rep(s,'html.embed .ov.bl{display:none}\n</style>','html.embed .ov.bl{display:none}\n'+css+'\n/*__GARAGE_CSS__*/\n</style>\n<style>/*__FONTS__*/</style>')
stage_old=s[s.index('    <div class="ov tl">Fig 1</div>'):s.index('    <div class="card" id="card" hidden>')]
stage_new='''    <div class="hx-head"><div class="bar"><b>Вибір літака</b><small>PLANE SELECT</small><span class="code">ПС-ЗСУ · 05</span></div>
      <div class="hx-leg"><span class="n" id="hxNew"><i>!</i>Новий</span><span class="r" id="hxRec"><i>✓</i>Рекомендовано</span></div></div>
    <div class="hx-stats">
      <span>Повітря – повітря</span><div class="hx-stars" id="hxA2A"></div>
      <span>Повітря – земля</span><div class="hx-stars" id="hxA2G"></div>
      <div class="gap"></div>
      <span>Швидкість</span><div class="hx-barw"><b id="hxSpd"></b></div>
      <span>Захищеність</span><div class="hx-barw"><b id="hxArm"></b></div>
      <span>Маневреність</span><div class="hx-barw"><b id="hxHnd"></b></div>
      <span class="dims" id="dims" hidden>L 17,32 м · S 11,36 м · H 4,73 м</span>
    </div>
    <div id="holo"><svg></svg></div>
    <div class="hx-band"><span class="nm" id="hxName">МІГ-29МУ1 <small id="ttl">МіГ-29МУ1 · борт 05</small></span></div>
    <div class="hx-car"><div class="hx-ruler a"></div><div class="hx-ruler c"></div><div class="hx-ruler b"></div>
      <span class="hx-nb l" id="hxPrev"></span><button type="button" class="hx-arr l" id="hxL" aria-label="Попередній літак"></button>
      <div class="hx-frame"><svg id="hxIcon" viewBox="0 0 100 100"></svg></div>
      <button type="button" class="hx-arr r" id="hxR" aria-label="Наступний літак"></button><span class="hx-nb r" id="hxNext"></span></div>
    <div class="ov bl hx-keys"><span id="hkEsc"><kbd>Esc</kbd>Закрити</span><span id="hkL"><kbd>←</kbd>Попередній</span><span id="hkR"><kbd>→</kbd>Наступний</span><span><kbd>ЛКМ</kbd>Камера</span><span><kbd>Колесо</kbd>Масштаб</span><span id="hkHolo" class="on"><kbd>.</kbd>ТТХ</span><span id="hkIns"><kbd>I</kbd>Огляд</span></div>
    <div class="ov br" id="status">Стоянка</div>
'''
s=s.replace(stage_old,stage_new)
# libraries: inline marker (bundler fills)
s=rep(s,'<script src="aircraft-3d/three.r128.min.js"></script>','<!--__LIBS__-->')
s=rep(s,'<script src="aircraft-3d/GLTFLoader.r128.js"></script>','')
s=rep(s,'<script src="aircraft-3d/meshopt_decoder.js"></script>','')
# JS patches from the original hangar restyle
s=rep(s,'renderer.setClearColor(0x111214);','renderer.setClearColor(0x0a1519);')
s=rep(s,'scene.add(new T.HemisphereLight(0xa9b8cc,0x0c0c0d,0.6));','const hemi=new T.HemisphereLight(0xa9b8cc,0x0c0c0d,0.6);scene.add(hemi);')
s=rep(s,"Object.values(TEX).forEach(t=>t.needsUpdate=true);","Object.values(TEX).forEach(t=>t.needsUpdate=true);\n"+open(S+'apron.js').read())
s=rep(s,"function noise(x,base){x.fillStyle=base;x.fillRect(0,0,2048,2048);","function noise(x,base){x.globalAlpha=.6;x.fillStyle=base;x.fillRect(0,0,2048,2048);x.globalAlpha=1;")
s=rep(s,"/* =========================================================\n   LANDSCAPE",open(S+'hangar.js').read()+"\n/* =========================================================\n   LANDSCAPE")
s=rep(s,"let yaw=.5, el=.6, zoom=1, yawV=0;","let yaw=-1.0, el=.07, zoom=.72, yawV=0;")
s=rep(s,"el=clamp(el+dy*.004,.12,1.35)","el=clamp(el+dy*.004,.02,1.35)")
s=rep(s,"""  const f=CODES[e.code];if(f){f();e.preventDefault();}});\n""","""  const f=CODES[e.code];if(f){f();e.preventDefault();}});\n"""+open(S+'co.js').read()+'\n'+open(S+'mk.js').read()+'\n'+open(S+'hud.js').read()+'\n'+open(S+'hud_en.js').read())
s=rep(s,"renderer.setSize(W,H,false);camera.aspect=W/H;","renderer.setSize(W,H,false);HX.resize(W,H);camera.aspect=W/H;")
s=rep(s,"  if(S.insp)placeLabels(W,H);\n  renderer.render(scene,camera);","  updHangar(dt);hudFrame(dt);\n  if(S.insp)placeLabels(W,H);\n  renderer.render(scene,camera);")
s=rep(s,"const sk=shake;shake*=Math.exp(-4*dt);camera.position.set(rnd(-sk,sk),ty+Math.sin(el)*dist+rnd(-sk,sk),Math.cos(el)*dist);camera.lookAt(0,ty,0);",
 "const sk=shake;shake*=Math.exp(-4*dt);camera.position.set(rnd(-sk,sk),Math.max(.6,ty*.55+Math.sin(el)*dist)+rnd(-sk,sk),Math.cos(el)*dist);camera.lookAt(0,ty,0);")
# ---- chips for Су-25 / Gripen (static-model path)
s=rep(s,"gripen:{file:'aircraft-3d/gripen.glb',name:'JAS 39 Gripen',len:14.1,nose:'-z',cock:[2.4,1.9],top:[-2,1.9]}};",
 "gripen:{file:'aircraft-3d/gripen.glb',name:'JAS 39 Gripen',len:14.1,nose:'-z',cock:[2.4,1.9],top:[-2,1.9]}};")
s=rep(s,"gripen:{root:null,canopy:null,mats:[],pick:[],ready:false,loading:false}};","gripen:{root:null,canopy:null,mats:[],pick:[],ready:false,loading:false}};")
s=rep(s,"['9','m2k','Mirage 2000-5F']].forEach(","['9','m2k','Mirage 2000-5F'],['-','su25','Су-25М1'],['=','gripen','JAS 39 Gripen']].forEach(")
s=rep(s,"CODES.Digit9=()=>setAircraft('m2k');","CODES.Digit9=()=>setAircraft('m2k');CODES.Minus=()=>setAircraft('su25');CODES.Equal=()=>setAircraft('gripen');")
s=rep(s,"window.addEventListener('keydown',e=>{if(e.metaKey||e.ctrlKey||e.altKey)return;","window.addEventListener('keydown',e=>{if(window.__GAR)return;if(e.metaKey||e.ctrlKey||e.altKey)return;")
s=rep(s,"function frame(now){\n","function frame(now){\n  if(window.__GAR){last=now;requestAnimationFrame(frame);return;}\n")
# model files -> bundled blobs
s=re.sub(r"sc\.src='aircraft-3d/([\w]+\.js)'",r"sc.src=__MDL('\1')",s)
s=rep(s,'let yaw=-1.0, el=.07, zoom=.72, yawV=0;','let yaw=-1.0, el=.07, zoom=.72, yawV=0;window.__CAM=(y,e,z)=>{if(y!=null)yaw=y;if(e!=null)el=e;if(z!=null)zoom=z;yawV=0;return [yaw,el,zoom];};')
GEAR_SU25="gear:{lift:.82,legs:[{x:3.55,z:-.18,r:.33,w:.22,sr:.06,st:.42,top:.55,fork:1,doors:[[1.1,.62,-.1,.24,0]]},{x:-1.15,z:-1.45,r:.42,w:.3,sr:.08,st:.5,side:1,top:.6,doors:[[1.4,.7,0,-.22,0]],brace:[.35,1.0,.5]},{x:-1.15,z:1.45,r:.42,w:.3,sr:.08,st:.5,side:-1,top:.6,doors:[[1.4,.7,0,.22,0]],brace:[.35,1.0,.5]}]}"
GEAR_GRIPEN="gear:{lift:1.02,legs:[{x:3.7,r:.23,w:.16,sr:.055,st:.38,top:.5,twin:1,doors:[[.9,.55,-.15,.2,0],[.9,.55,-.15,-.2,0]]},{x:-1.55,z:-1.2,r:.3,w:.2,sr:.065,st:.45,side:1,top:.55,doors:[[1.0,.62,0,.18,0]],brace:[.3,.9,.45]},{x:-1.55,z:1.2,r:.3,w:.2,sr:.065,st:.45,side:-1,top:.55,doors:[[1.0,.62,0,-.18,0]],brace:[.3,.9,.45]}]}"
s=s.replace("name:'Су-25',len:15.5,nose:'+z',","name:'Су-25',len:15.5,nose:'+z',surf:[['ailR','down',[-1.72,2.0,4.6],[-1.72,2.0,6.5],{ax:'z',d:.75,b:[1.5,2.4]}],['ailL','down',[-1.72,2.0,-4.6],[-1.72,2.0,-6.5],{ax:'z',d:.75,b:[1.5,2.4]}],['stabR','up',[-6.05,2.55,.6],[-6.05,2.55,2.8],{ax:'z',d:.9,b:[2.2,2.95]}],['stabL','up',[-6.05,2.55,-.6],[-6.05,2.55,-2.8],{ax:'z',d:.9,b:[2.2,2.95]}],['rud','side',[-5.5,3.3,0],[-5.7,4.9,0],{ax:'y',d:.9,b:[-.35,.35]}]],pitot:[[-.7,.12,.22,.75,.028],[-.7,.12,-.22,.75,.028]],"+GEAR_SU25.replace('"','')+",")
s=s.replace("name:'JAS 39 Gripen',len:14.1,nose:'-z',","name:'JAS 39 Gripen',len:14.1,nose:'-z',surf:[['stabR','up',[-3.95,1.75,1.15],[-3.95,1.75,2.1],{ax:'z',d:.7,b:[1.3,2.1]}],['stabL','up',[-3.95,1.75,-1.15],[-3.95,1.75,-2.1],{ax:'z',d:.7,b:[1.3,2.1]}],['ailR','down',[-3.85,1.75,2.1],[-3.85,1.75,3.2],{ax:'z',d:.7,b:[1.4,2.1]}],['ailL','down',[-3.85,1.75,-2.1],[-3.85,1.75,-3.2],{ax:'z',d:.7,b:[1.4,2.1]}],['rud','side',[-5.5,3.1,0],[-5.7,4.3,0],{ax:'y',d:.8,b:[-.3,.3]}]],pitot:[[-.25,0,0,.8,.03]],"+GEAR_GRIPEN+",")
s=rep(s,'const ST={};','\n'+open(S+'hangar_en.js').read()+'\nconst ST={};window.__ST=ST;')
s=rep(s,'tmp.remove(sc);O.m.rotation.y=th;O.m.scale.setScalar(s);O.m.position.set(-s*c.x,-s*b.min.y,-s*c.z);O.m.add(sc);','tmp.remove(sc);O.m.rotation.y=th;O.m.scale.setScalar(s);O.m.position.set(-s*c.x,-s*b.min.y,-s*c.z);O.m.add(sc);if(D.gear)stGear(O,D,F);')
s=rep(s,'function updSt(dt){\n  if(!isSt())return;const O=ST[AIR.cur];if(!O.ready||!O.pv.visible)return;','function updSt(dt){\n  if(!isSt())return;const O=ST[AIR.cur];if(!O.ready||!O.pv.visible)return;if(O.gearG){const gk=C.gear;O.gearG.visible=gk>.02;O.gearG.scale.y=Math.max(.02,gk);O.m.position.y=O.baseY+ST_DEF[AIR.cur].gear.lift*gk;}')
s=rep(s,'function initSt(k,sc){','function initSt(k,sc){/*gear*/'+(open(S+'st_gear.js').read()+'\n'+open(S+'st_surf.js').read()).replace('function stGear','\n;var _sg=0;function _unused(){}\nfunction stGear').replace('O.m.position.y+=G0.lift;','O.baseY=O.m.position.y;O.m.position.y+=G0.lift;')+'\n')
s=rep(s,'  O.ready=true;}\nfunction loadSt(','  if(D.surf){try{stSurf(k,O,D,F);}catch(e){console.warn(\'surf\',k,e);}}\n  O.ready=true;}\nfunction loadSt(')
s=rep(s,"['gear','canopy','cut','flap','ctrl','brake','insp','doors','chute','view'].forEach(k=>{chipsS[k].classList.add('lock');chipsS[k].classList.remove('on');setSub(chipsS[k],'');});","['gear','canopy','cut','flap','ctrl','brake','insp','doors','chute','view'].forEach(k=>{chipsS[k].classList.add('lock');chipsS[k].classList.remove('on');setSub(chipsS[k],'');});if(RIG[AIR.cur]&&RIG[AIR.cur].length)chipsS.ctrl.classList.remove('lock');")
s=rep(s,"const RIG={mig:[],f16:[],su:[],mi8:[],mi24:[],il:[],su24:[],m2k:[],su25:[],gripen:[],ka52:[]};","const RIG={mig:[],f16:[],su:[],mi8:[],mi24:[],il:[],su24:[],m2k:[],su25:[],gripen:[],ka52:[]};window.__RIG=RIG;")
s=rep(s,"if(isSt()&&id!=='eng'){toast(id==='gear'?'У моделі '+ST_DEF[AIR.cur].name+' шасі прибране':","if(isSt()&&id!=='eng'&&!(id==='ctrl'&&RIG[AIR.cur].length)){toast(id==='gear'?'Шасі обтиснуте — прибирання заблоковано':")
s=rep(s,"; текстуру стиснуто, шасі відокремлено. Sketchfab.","; текстуру стиснуто, шасі відокремлено. Су-25М1 — <a href=\"https://sketchfab.com/3d-models/ukrainian-su-25m-pixel-c96f73960f124ab7a22184008c33ea7c\">«Ukrainian Su-25M (pixel)»</a>, 42manako, CC BY 4.0; JAS 39 Gripen — <a href=\"https://sketchfab.com/3d-models/ukrainian-jas-39-gripen-f2e45df51c4043f99c41403959e589f3\">«Ukrainian JAS 39 Gripen»</a>, 42manako, CC BY 4.0; у Су-25М1 і Gripen шасі, ППД і рухомі рулі додано процедурно, текстуру Су-25 стиснуто. Sketchfab.")
open(S+'hangar_index.html','w').write(s)
print('ok',len(s), s.count("__MDL("))

# «Ворог»: підпис для ворожих статичних моделей
_h=open(S+'hangar_index.html').read()
_a="st?ST_DEF[AIR.cur].name+' · ПС ЗСУ'"
assert _h.count(_a)==1,'ttl'
_h=_h.replace(_a,"st?ST_DEF[AIR.cur].name+(ST_DEF[AIR.cur].en?' · ПКС РФ':' · ПС ЗСУ')")
open(S+'hangar_index.html','w').write(_h)
_h=open(S+'hangar_index.html').read()
_a="const dist=(IM?50:SM?47:MM?40:XM?36:44)*zoom*Math.pow(aspectK,.85);\n  const ty=(HM?3.0:IM?3.4:SM?1.9:XM?1.6:1.4)+C.lift*.55;"
assert _h.count(_a)==1,'cam'
_h=_h.replace(_a,"const _sd=ST_DEF[AIR.cur],_k=_sd&&_sd.en?Math.max(1,_sd.len/18):1;const dist=(IM?50:SM?47:MM?40:XM?36:44)*zoom*Math.pow(aspectK,.85)*_k;\n  const ty=(HM?3.0:IM?3.4:SM?1.9:XM?1.6:1.4)*(_k>1?Math.pow(_k,1.1):1)+C.lift*.55;")
open(S+'hangar_index.html','w').write(_h)
