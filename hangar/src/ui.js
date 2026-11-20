/* UI 2: перебудовує нижню панель ангара й гаража в картки + степер + бічні інструменти. Кнопки ті самі (обробники й гарячі клавіші не змінено). */
(()=>{const $=s=>document.querySelector(s);document.body.classList.add('ui2');
const GLY={'Ліхтар':'◠','Розріз':'◧','Механізація':'⫽','Перевірка рулів':'⇅','Шасі':'⊥','Двигуни':'◎','Двигун':'◎','Заслінки':'▤','Гальмівні щитки':'⊓','Парашут':'☂','Огляд':'⌕','Вигляд':'◐','Схема':'◐','Крило':'⋀',
 'АНО':'✦','Маяк':'✺','Посадкові фари':'☼','Рульожна фара':'◉','Кабіна':'▣','Обслуговування':'⚒','Фари':'☼','ТТХ':'ⓘ','Гвинт':'✣','Підвіска':'⚒'};
const AIRT={Q:['mig','Винищувач'],W:['f16','Багатоцільовий винищувач'],S:['su','Винищувач-перехоплювач'],A:['mi8','Транспортний вертоліт'],J:['mi24','Бойовий вертоліт'],O:['il','Військово-транспортний'],
 '0':['su24','Фронтовий бомбардувальник'],'9':['m2k','Винищувач'],'-':['su25','Штурмовик'],'=':['gripen','Винищувач']};
const lab=c=>(c.querySelector('span')||c).textContent.trim();
function glyph(c){const l=lab(c);if(c.querySelector('.gl'))return;const g=document.createElement('b');g.className='gl';const k=Object.keys(GLY).find(k=>l.startsWith(k));
  if(k)g.textContent=GLY[k];else{g.textContent=l.replace(/\s.*/,'').slice(0,6);g.classList.add('t');}c.prepend(g);c.dataset.tip=l+((c.querySelector('kbd')||{}).textContent?' · '+c.querySelector('kbd').textContent:'');}
function wrapRow(idEl,cls,title){const ch=$(idEl);if(!ch)return null;const row=ch.closest('.row');if(row.classList.contains(cls))return row;row.classList.add(cls);const t=document.createElement('div');t.className='ttl';t.innerHTML=title;row.prepend(t);return row;}
function card(c,icon,vb,meta){if(c.dataset.card)return;c.dataset.card=1;const sv=`<svg viewBox="${vb}" preserveAspectRatio="xMidYMid meet"><defs><linearGradient id="cg${Math.random().toString(36).slice(2,7)}"></linearGradient></defs><path d="${icon}" fill="#9fb4ba" fill-opacity=".85" stroke="#dfe9ec" stroke-width=".8" fill-rule="evenodd"/></svg>`;
  c.insertAdjacentHTML('afterbegin',sv);c.insertAdjacentHTML('beforeend',`<div class="meta">${meta}</div>`);}
function stepProg(row){const cs=[...row.querySelectorAll('.chip')].filter(c=>!c.classList.contains('lock')&&!c.disabled);const i=cs.findIndex(c=>c.classList.contains('on'));
  cs.forEach((c,j)=>c.classList.toggle('done',i>=0&&j<i));const ch=row.querySelector('.chips');ch.style.setProperty('--prog',cs.length>1&&i>=0?i/(cs.length-1):0);
  const t=row.querySelector('.ttl i');if(t)t.textContent=i>=0?lab(cs[i]):'—';}
function helpBtn(stage,fig,extra){if(stage.querySelector('.ui-help'))return;const b=document.createElement('button');b.type='button';b.className='ui-help';b.textContent='?';b.title='Гарячі клавіші';
  const ov=document.createElement('div');ov.className='ui-hov';ov.hidden=true;stage.append(b,ov);
  b.onclick=e=>{e.stopPropagation();if(ov.hidden){const rows=[...fig.querySelectorAll('.rows .row')];let h=`<h4>Керування</h4><div>${extra.map(([k,t])=>`<kbd>${k}</kbd><span>${t}</span>`).join('')}</div>`;
      rows.forEach(r=>{const cs=[...r.querySelectorAll('.chip')].filter(c=>!c.classList.contains('lock')&&!c.disabled&&c.querySelector('kbd'));if(!cs.length)return;
        const t=(r.querySelector('.ttl')||r.querySelector('b')||{}).textContent||'';h+=`<h4>${t.replace(/[:·].*$/,'')}</h4><div>${cs.map(c=>`<kbd>${c.querySelector('kbd').textContent}</kbd><span>${lab(c)}</span>`).join('')}</div>`;});
      ov.innerHTML=h;}ov.hidden=!ov.hidden;b.classList.toggle('on',!ov.hidden);};
  addEventListener('keydown',e=>{if(e.key==='?'||(e.code==='Slash'&&e.shiftKey)){if(fig.offsetParent)b.click();}});}
function toolBar(stage,groups){let tb=stage.querySelector('.ui-tools');if(!tb){tb=document.createElement('div');tb.className='ui-tools';stage.append(tb);}
  groups.forEach(([name,el])=>{if(!el||el.closest('.ui-tools'))return;const g=document.createElement('div');g.className='grp';g.innerHTML=`<i>${name}</i>`;g.append(el);tb.append(g);});
  tb.querySelectorAll('.chip').forEach(glyph);
  tb.querySelectorAll('.grp').forEach(g=>{const vis=[...g.querySelectorAll('.chip,.tb')].some(c=>!c.classList.contains('lock')&&!c.disabled&&getComputedStyle(c).display!=='none');g.classList.toggle('empty',!vis);});}
function proxy(src,label,gl){const b=document.createElement('button');b.type='button';b.className='tb';b.dataset.tip=label;b.innerHTML=`<b class="gl">${gl}</b>`;b.onclick=()=>src.click();b._src=src;return b;}
function hangar(){if(!$('#rowA')||!$('#rowA').children.length)return;const fig=$('#aFig'),stage=$('#stage');
  const ra=wrapRow('#rowA','ui-car','Літальні апарати ПС ЗСУ');{const tt=ra&&ra.querySelector('.ttl');const w=document.body.classList.contains('enemyA')?'Авіація ворога · ПКС РФ':'Літальні апарати ПС ЗСУ';if(tt&&tt.textContent!==w)tt.textContent=w;}const rp=wrapRow('#rowP','ui-step','Фази польоту <i></i>');
  if(ra&&rp&&rp.nextElementSibling!==ra)ra.before(rp);
  const IC=(window.__HUD||{}).ICON||{},SP=(window.__HUD||{}).SPEC||{};
  [...$('#rowA').children].forEach(c=>{const k=(c.querySelector('kbd')||{}).textContent;const m=AIRT[k];if(!m)return;card(c,IC[(SP[m[0]]||{}).ic]||'',`0 0 100 100`,m[1]);});
  const view=document.createElement('div');view.className='chips';if(!$('#uiViewA')){view.id='uiViewA';
    view.append(proxy($('#hkHolo'),'ТТХ · .','ⓘ'),proxy($('#hkIns'),'Огляд · I','⌕'),proxy($('#hkEsc'),'Закрити картку · Esc','✕'));}
  toolBar(stage,[['Вид',$('#uiViewA')?null:view],['Системи',$('#rowS')],['Вогні',$('#rowL')],['Зброя',$('#rowW')]]);
  stepProg(rp);$('#uiViewA').querySelectorAll('.tb').forEach(b=>b.classList.toggle('on',b._src.classList.contains('on')));
  helpBtn(stage,fig,[['← →','Попередній / наступний'],['ЛКМ','Обертати камеру'],['Колесо','Масштаб'],['.','ТТХ'],['I','Огляд'],['Esc','Закрити картку'],['`','Ангар / гараж'],['?','Ця довідка']]);}
function garage(){if(!$('#gRowV')||!$('#gRowV').children.length)return;const fig=$('#gFig'),stage=$('#gStage');
  const rv=wrapRow('#gRowV','ui-car','Техніка ЗСУ · парк');{const tt=rv&&rv.querySelector('.ttl');const w=document.body.classList.contains('enemy')?'Техніка ворога · ЗС РФ':'Техніка ЗСУ · парк';if(tt&&tt.textContent!==w)tt.textContent=w;}const rm=wrapRow('#gRowM','ui-step','Режим <i></i>');if(rv&&rm&&rm.nextElementSibling!==rv)rv.before(rm);
  const byName={};try{GV_ORDER.forEach(id=>byName[GV[id].n]=id);}catch(e){}
  [...$('#gRowV').children].forEach(c=>{const id=byName[lab(c)];if(!id)return;const D=GV[id];card(c,GV_ICON[D.ic],'0 0 100 60',D.cls.split('·')[0].trim()+' · '+D.org);});
  if(!$('#uiViewG')){const v=document.createElement('div');v.className='chips';v.id='uiViewG';v.append(proxy($('#gkHolo'),'ТТХ · .','ⓘ'),proxy($('#gkLamp'),'Фари · L','☼'));toolBar(stage,[['Вид',v]]);}
  $('#uiViewG').querySelectorAll('.tb').forEach(b=>b.classList.toggle('on',b._src.classList.contains('on')));
  stepProg(rm);helpBtn(stage,fig,[['← →','Попередня / наступна'],['Q … ]','Вибір техніки'],['1 – 6','Режими'],['ЛКМ','Обертати камеру'],['Колесо','Масштаб'],['.','ТТХ'],['L','Фари'],['`','Ангар / гараж'],['?','Ця довідка']]);}
function tick(){try{hangar();}catch(e){console.warn('ui hangar',e);}try{garage();}catch(e){console.warn('ui garage',e);}
  const a=$('#aFig .ui-tools');if(a)toolBar($('#stage'),[]);
  document.querySelectorAll('.ui-car .chip.on').forEach(c=>{if(c.dataset.sc!=='1'){c.dataset.sc='1';const sc=c.parentElement;if(sc&&sc.scrollWidth>sc.clientWidth){const l=c.offsetLeft-sc.offsetLeft;sc.scrollTo({left:Math.max(0,l-sc.clientWidth/2+c.offsetWidth/2),behavior:'smooth'});}}});
  document.querySelectorAll('.ui-car .chip:not(.on)').forEach(c=>c.dataset.sc='');}
setInterval(tick,300);tick();})();
