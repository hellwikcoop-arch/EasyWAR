# Збирає один офлайн-файл /workspace/hangar2/EasyWAR_hangar.html: ангар (hangar_index.html) + гараж (garage.*) + бібліотеки + моделі.
import base64,os,re,subprocess
B='/workspace/hangar2/';S=B+'src/';R='/workspace/sec/ew2/src/public/aircraft-3d/'
subprocess.run(['python3',S+'build_hangar.py'],check=True)
parts=['co.js','mk.js','garage_data.js','garage_en.js','garage_a.js','garage_b.js','garage_c.js','garage_d.js','garage_e.js','garage_g.js','garage_kb.js','garage_f.js']
gjs=''.join(open(S+p).read() for p in parts);open(S+'garage.js','w').write(gjs)
h=open(S+'hangar_index.html').read()
def rep(s,a,b):
    assert s.count(a)==1,('marker',a[:60],s.count(a));return s.replace(a,b)
h=rep(h,'/*__GARAGE_CSS__*/',open(S+'garage.css').read()+'\n'+open(S+'ui.css').read())
h=rep(h,'<style>/*__FONTS__*/</style>','<style>'+open(B+'lib/fonts_inline.css').read()+'</style>')
toggle='''<div class="hx-mode" id="hxMode"><span>EasyWAR</span><div class="seg" role="tablist">
<button type="button" id="mAir" class="on" role="tab">Ангар <kbd>`</kbd></button><button type="button" id="mGar" role="tab">Гараж <kbd>`</kbd></button><button type="button" id="mEn" role="tab">Ворог</button></div>
<div class="seg en-sub" id="enSub"><button type="button" id="eG">Наземна</button><button type="button" id="eA">Авіація</button></div>
<span id="mHint">літальні апарати ПС ЗСУ</span></div>
<div class="fig" id="aFig">'''
assert h.count('<div class="fig">')==1
h=h.replace('<div class="fig">',toggle,1)
foot_i=h.index('<p class="foot">')
gar=open(S+'garage.html').read()
gfoot='''<p class="foot" id="gFoot" hidden>Гараж: Q W E R T Y U I O P [ ] — техніка (M142 HIMARS, M270 MLRS, «Вільха», «Сапсан», M984A2, M1084A1P2, пакетовоз HEMTT, Bergepanzer 2, M2A3 Bradley, Marder 1A3, M1 Abrams, Patriot); 1–6 — режими (стоянка, огляд, запуск двигуна, виїзд, бойове положення, заряджання); ← → — гортати; L — фари; «.» — ТТХ; ` — ангар/гараж. Перелік техніки — з довідника EasyWAR (docs/reference/AIR_REFERENCE.md, модуль «Повітряні сили» + наземні війська й ППО), ТТХ — округлені відкриті дані; де даних немає у відкритому доступі, стоїть «н/д».<br>
Моделі: HIMARS, M270, «Вільха», M1084A1P2, M984A2, Bergepanzer 2, пакетовоз HEMTT — процедурні моделі EasyWAR; «Сапсан» і Patriot — власна робота автора проєкту EasyWAR; M2A3 Bradley, Marder 1A3 — 42manako / Arrafi (Sketchfab, CC BY 4.0); M1 Abrams — Jeyhun1985 (Sketchfab, ліцензію в джерелі не вказано); Су-25 і JAS 39 Gripen — Sketchfab (див. CREDITS.md EasyWAR). Бокс, освітлення й реквізит гаража — процедурні, власної роботи; текстури намальовано кодом.</p>
'''
h=h[:foot_i]+gar+'\n'+h[foot_i:]
# після першого .foot вставити футер гаража
fe=h.index('</p>',h.index('<p class="foot">'))+4
h=h[:fe]+'\n'+gfoot+h[fe:]
# дані моделей
data=[]
def b64(p):return base64.b64encode(open(p,'rb').read()).decode()
for f in sorted(os.listdir(R)):
    if f.endswith('.js') and f not in('three.r128.min.js','GLTFLoader.r128.js','meshopt_decoder.js'):
        t=open(R+f).read();assert '</script' not in t.lower()
        data.append(f'<script type="text/plain" id="mdl-{f[:-3]}">{t}</script>')
air={'su25':B+'glb/su25_2k.glb','gripen':R+'gripen.glb'}  # Ан-225 вилучено на прохання користувача  # Ка-52 (ворожа техніка) не вбудовується
for k,p in air.items():data.append(f'<script type="text/plain" id="glb-a_{k}">{b64(p)}</script>')
veh=re.search(r"GV_ORDER=\[(.*?)\]",gjs).group(1).replace("'",'').split(',')
files=set(re.findall(r"file:'(\w+)'",open(S+'garage_data.js').read()+open(S+'garage_en.js').read()))
files|=set(re.findall(r"aircraft-3d/'\+file|A\('(\w+)'",open(S+'hangar_en.js').read()))-{''}
files.add('ka52')
os.makedirs(B+'models',exist_ok=True)
for x in os.listdir(B+'models'):
    if x.startswith('g_'):os.remove(B+'models/'+x)
for f in sorted(files):open(B+'models/g_'+f+'.js','w').write('(window.__GLBD=window.__GLBD||{})["g_'+f+'"]="'+b64(B+"glb/"+f+".glb")+'";')  # ліниве завантаження: models/g_*.js
shim='''<script>
(()=>{const el=id=>document.getElementById(id);const urls={};
window.__MDL=n=>{if(urls[n])return urls[n];const e=el('mdl-'+n.replace(/\\.js$/,''));if(!e)return 'aircraft-3d/'+n;return urls[n]=URL.createObjectURL(new Blob([e.textContent],{type:'text/javascript'}));};
window.__GLB=new Proxy({},{get:(t,k)=>{const e=typeof k==='string'&&el('glb-'+k.replace(':','_'));return e?e.textContent:undefined;}});
const b2a=b=>{const s=atob(b),u=new Uint8Array(s.length);for(let i=0;i<s.length;i++)u[i]=s.charCodeAt(i);return u.buffer;};
const of=window.fetch&&window.fetch.bind(window);
window.fetch=(u,o)=>{const m=typeof u==='string'&&/aircraft-3d\\/(\\w+)\\.glb$/.exec(u);if(m){const e=el('glb-a_'+m[1]);if(e)return Promise.resolve(new Response(b2a(e.textContent),{status:200,headers:{'Content-Type':'model/gltf-binary'}}));}
  if(m){const key='g_'+m[1],G=()=>(window.__GLBD||{})[key];const resp=()=>{const t=G();delete window.__GLBD[key];return new Response(b2a(t),{status:200,headers:{'Content-Type':'model/gltf-binary'}});};
    if(G())return Promise.resolve(resp());
    return new Promise((res,rej)=>{const sc=document.createElement('script');sc.src='models/'+key+'.js';sc.onload=()=>G()?res(resp()):rej(new Error('model '+key));sc.onerror=()=>{of?of(u,o).then(res,rej):rej(new Error('offline'));};document.head.append(sc);});}
  return of?of(u,o):Promise.reject(new Error('offline'));};})();
</script>'''
libs=''.join(f'<script>{open(B+"lib/"+n).read()}</script>\n' for n in ['three.r128.min.js','GLTFLoader.r128.js','meshopt_decoder.js','Reflector.js'])
h=rep(h,'<!--__LIBS__-->','\n'.join(data)+'\n'+shim+'\n'+libs)
mode='''<script>
(()=>{const $=s=>document.querySelector(s);const a=$('#aFig'),g=$('#gFig');
function set(gar,en,air){en=!!en;air=!!(en&&air);if(en&&!air)gar=true;if(air)gar=false;window.__GAR=gar;a.hidden=gar;
  $('#mAir').classList.toggle('on',!gar&&!en);$('#mGar').classList.toggle('on',gar&&!en);$('#mEn').classList.toggle('on',en);
  $('#eG').classList.toggle('on',en&&!air);$('#eA').classList.toggle('on',air);
  document.body.classList.toggle('enemy',en);
  $('#mHint').textContent=air?'авіація ворога · ПКС РФ · довідник розпізнавання':en?'техніка ворога · ЗС РФ · довідник розпізнавання':gar?'наземна техніка · парк бойових машин':'літальні апарати ПС ЗСУ';
  document.querySelectorAll('.foot').forEach(f=>f.hidden=(f.id==='gFoot')!==gar);
  try{window.HSIDE&&window.HSIDE(air?'en':'ua');}catch(e){console.warn(e);}
  if(gar){GAR.setSide(en?'en':'ua');GAR.show();}else{GAR.hide();window.dispatchEvent(new Event('resize'));}
  try{history.replaceState(null,'',air?'#enemy-air':en?'#enemy':gar?'#garage':'#hangar');}catch(e){}}
$('#mAir').onclick=()=>set(false);$('#mGar').onclick=()=>set(true);$('#mEn').onclick=()=>set(true,true,false);
$('#eG').onclick=()=>set(true,true,false);$('#eA').onclick=()=>set(false,true,true);
addEventListener('keydown',e=>{if(e.code==='Backquote'&&!e.ctrlKey&&!e.metaKey){set(!window.__GAR);e.preventDefault();}});
window.__setMode=set;const hs=location.hash;if(hs==='#garage')set(true);else if(hs==='#enemy')set(true,true);else if(hs==='#enemy-air')set(false,true,true);})();
</script>'''
i=h.rindex('</body>') if '</body>' in h else len(h)
h=h[:i]+'<script>'+gjs+'</script>\n'+mode+'\n<script>'+open(S+'ui.js').read()+'</script>\n'+h[i:]
import re as _re
h=_re.sub(r'<p class="foot"[^>]*>.*?</p>','',h,flags=_re.S)
open(B+'EasyWAR_hangar.html','w').write(h)
print('bundle',round(len(h)/1e6,1),'MB')
