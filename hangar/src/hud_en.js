/* ---------- «Ворог» · авіація: ТТХ (округлені відкриті дані), перемикання сторони, картки вибору ---------- */
window.isHeliAny=()=>AIR.cur==='mi8'||AIR.cur==='mi24'||AIR.cur==='ka52'||!!(ST_DEF[AIR.cur]&&ST_DEF[AIR.cur].heli);
const UA_AORDER=ORDER.slice();
const EN_AIR=['esu25','esu34','esu35','esu30','esu27','emig31','etu22','etu95','etu160','ea50','eil76','ka52','emi28','emi8','emi35'];
Object.assign(SPEC,{
 esu25:{origin:'SU',n:'Су-25СМ3',L:'15,53',S:'14,36',H:'4,8',vLow:'950',eng:'2 × Р-195',arm:'ГШ-30-2 30 мм · НАР С-8 / С-13 · ОФАБ / КАБ',ceil:'7 000',r:[1,4.5,.42,.92,.55],ic:'attack',en:1,cls:'Штурмовик'},
 esu34:{origin:'RU',n:'Су-34',L:'23,34',S:'14,7',H:'6,09',mach:'1,8',vAlt:'1 900',vLow:'1 400',eng:'2 × АЛ-31Ф-М1',arm:'ГШ-30-1 30 мм · КАБ-500 / 1500 · ФАБ з УМПК · Х-29 / Х-59',ceil:'17 000',r:[2.5,5,.78,.8,.6],ic:'jet',en:1,cls:'Фронтовий бомбардувальник'},
 esu35:{origin:'RU',n:'Су-35С',L:'21,9',S:'15,3',H:'5,9',mach:'2,25',vAlt:'2 400',vLow:'1 400',eng:'2 × АЛ-41Ф1С',arm:'ГШ-30-1 30 мм · Р-77-1 · Р-73 · Р-37М · Х-31 / Х-59',ceil:'18 000',r:[5,3.5,.9,.6,.95],ic:'jet',en:1,cls:'Багатоцільовий винищувач'},
 esu30:{origin:'RU',n:'Су-30СМ',L:'21,94',S:'14,7',H:'6,36',mach:'2,0',vAlt:'2 125',vLow:'1 350',eng:'2 × АЛ-31ФП',arm:'ГШ-30-1 30 мм · Р-77 · Р-73 · Х-31 · Х-59 · КАБ',ceil:'17 300',r:[4.5,4,.86,.62,.95],ic:'jet',en:1,cls:'Багатоцільовий винищувач'},
 esu27:{origin:'SU',n:'Су-27',L:'21,94',S:'14,7',H:'5,93',mach:'2,35',vAlt:'2 500',vLow:'1 400',eng:'2 × АЛ-31Ф',arm:'ГШ-30-1 30 мм · Р-27 · Р-73',ceil:'18 500',r:[4.5,2,.9,.62,.85],ic:'jet',en:1,cls:'Винищувач'},
 emig31:{origin:'SU',n:'МіГ-31К',L:'22,69',S:'13,46',H:'6,15',mach:'2,83',vAlt:'3 000',vLow:'1 500',eng:'2 × Д-30Ф6',arm:'ГШ-6-23 23 мм · Х-47М2 «Кинджал»',ceil:'20 600',r:[3,4,1,.55,.4],ic:'jet',en:1,cls:'Носій «Кинджала»'},
 etu22:{origin:'SU',n:'Ту-22М3',L:'42,46',S:'34,28 / 23,3',H:'11,05',mach:'1,88',vAlt:'2 300',eng:'2 × НК-25',arm:'Х-22 / Х-32 · ФАБ · ГШ-23 23 мм',ceil:'13 300',r:[.5,5,.75,.5,.3],ic:'swing',en:1,cls:'Дальній бомбардувальник'},
 etu95:{origin:'SU',n:'Ту-95МС',L:'49,13',S:'50,04',H:'13,3',vMax:'830',eng:'4 × НК-12МП (ТВД)',arm:'Крилаті ракети Х-101 / Х-555 · ГШ-23 23 мм',ceil:'12 000',r:[0,4.5,.4,.5,.15],ic:'cargo',en:1,cls:'Стратегічний бомбардувальник'},
 etu160:{origin:'SU',n:'Ту-160',L:'54,1',S:'55,7 / 35,6',H:'13,1',mach:'2,05',vAlt:'2 200',eng:'4 × НК-32',arm:'До 12 крилатих ракет Х-101 / Х-555 у двох відсіках',ceil:'15 000',r:[0,5,.85,.5,.25],ic:'swing',en:1,cls:'Стратегічний бомбардувальник'},
 ea50:{origin:'SU',n:'А-50У',L:'46,59',S:'50,5',H:'14,76',vMax:'800',eng:'4 × Д-30КП',arm:'РЛК «Шмель-М» у дископодібному обтічнику',ceil:'10 000',r:[0,0,.3,.4,.15],ic:'cargo',en:1,cls:'Літак ДРЛВ'},
 eil76:{origin:'SU',n:'Іл-76МД',L:'46,59',S:'50,5',H:'14,76',pay:'47',eng:'4 × Д-30КП-2',r:[0,0,.3,.62,.2],ic:'cargo',en:1,cls:'Військово-транспортний'},
 ka52:{origin:'RU',n:'Ка-52',L:'16,0',R:'14,5',H:'4,9',vMax:'300',eng:'2 × ВК-2500',arm:'2А42 30 мм · ПТКР «Вихор» / «Атака» · НАР С-8 / С-13',r:[.5,4.5,.26,.82,.6],ic:'heli',en:1,cls:'Бойовий вертоліт'},
 emi28:{origin:'RU',n:'Мі-28Н',L:'17,01',R:'17,2',H:'3,82',vMax:'300',eng:'2 × ТВ3-117ВМА',arm:'2А42 30 мм · ПТКР «Атака» / «Штурм» · НАР С-8 / С-13',r:[.5,4.5,.25,.8,.5],ic:'heli',en:1,cls:'Бойовий вертоліт'},
 emi8:{origin:'RU',n:'Мі-8АМТШ',L:'18,4',R:'21,29',H:'5,65',vMax:'250',eng:'2 × ТВ3-117ВМ',arm:'НАР С-8 · ПТКР «Штурм-В» / «Атака» · кулемети',r:[0,3,.14,.5,.4],ic:'heli',en:1,cls:'Транспортно-бойовий вертоліт'},
 emi35:{origin:'RU',n:'Мі-35М',L:'18,57',R:'17,2',H:'3,9',vMax:'300',eng:'2 × ВК-2500',arm:'ГШ-23В 23 мм · ПТКР «Атака» · НАР С-8',r:[.5,4,.24,.86,.46],ic:'heli',en:1,cls:'Бойовий вертоліт'}});
const AIR_ENEMY={};EN_AIR.forEach(k=>AIR_ENEMY[k]={enemy:1});
// моделі, де червоні зірки вже є в текстурі
['esu25','ea50'].forEach(k=>Object.assign(AIR_ENEMY[k],{w:0,f:0,fin:0}));
window.__AIRSIDE='ua';
(function enChips(){const row=$('#rowA');if(!row)return;
  EN_AIR.forEach(k=>{const P=SPEC[k];const b=document.createElement('button');b.type='button';b.className='chip';b.dataset.side='en';b.dataset.card=1;
    b.innerHTML=`<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet"><path d="${ICON[P.ic]}" fill="#9fb4ba" fill-opacity=".85" stroke="#dfe9ec" stroke-width=".8" fill-rule="evenodd"/></svg><span>${P.n}</span><small></small><div class="meta">${P.cls}</div>`;
    b.onclick=()=>setAircraft(k);row.append(b);chipsA[k]=b;});})();
window.HSIDE=function(sd){window.__AIRSIDE=sd;const en=sd==='en';ORDER.length=0;ORDER.push(...(en?EN_AIR:UA_AORDER));document.body.classList.toggle('enemyA',en);
  const t=$('#rowA').closest('.row').querySelector('.ttl');if(t)t.textContent=en?'Авіація ворога · ПКС РФ':'Літальні апарати ПС ЗСУ';
  const c=document.querySelector('.hx-head .code');if(c)c.textContent=en?'ПКС-РФ · ВОРОГ':'ПС-ЗСУ · 05';
  if(!ORDER.includes(AIR.cur))setAircraft(ORDER[0]);else{hud.cur=null;}};
window.__setAircraft=setAircraft;window.__AIR=AIR;
