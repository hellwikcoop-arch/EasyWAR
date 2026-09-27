/* EasyWAR · «Ракетні Війська і Артилерія» — оформлення за макетами (вересень 2026).
   Фото типів цілей, банери M30A1 / M31A1 / ATACMS / M26, єдиний вигляд карток показників і банерів боєприпасів.
   Файл згенеровано script/rocket-refs/build.py; зображення вирізано з макетів. Код модуля v3.1 не змінюється.
   Будь-яке з цих зображень можна замінити через «Оформлення → Зображення». */
(function () {
  'use strict';
  if (window.__EASYWAR_MODULE__ !== 'rocket' || window.__EW_ROCKET_REFS__) return;
  window.__EW_ROCKET_REFS__ = true;
  const IMG = __IMAGES__;
  const hk = window.__EW_EDITOR_HOOKS__, maps = hk && hk.maps || {};

  /* Фото типів цілей: на рівні ключа модуля (IMG2.ttp) і точніше — за назвою типу. */
  const TT_BY_KEY = { drone: 'tt_drone', crowd: 'tt_crowd_shg', gun: 'tt_gun', vehicle: 'tt_vehicle', bunker: 'tt_bunker', cp: 'tt_cp', post: 'tt_post', comms: 'tt_comms', depot: 'tt_depot', bridge: 'tt_bridge' };
  const TT_BY_NAME = { 'інше': 'tt_other', 'накопиченняос': 'tt_crowd', 'рлсзрк': 'tt_radar', 'рлс': 'tt_radar', 'зрк': 'tt_radar' };
  if (maps.IMG2 && maps.IMG2.ttp) for (const [k, id] of Object.entries(TT_BY_KEY)) maps.IMG2.ttp[k] = IMG[id];
  /* Банери: ATACMS і M26 — для всіх назв цього типу; M30A1 / M31A1 — лише для точних назв (M30A2 / M31A2 лишаються як були). */
  if (maps.MUN_BANNER) { maps.MUN_BANNER.atacms = IMG.ban_atacms; maps.MUN_BANNER.m26 = IMG.ban_m26; }
  const BAN_BY_NAME = { 'M30A1': 'ban_m30a1', 'M31A1': 'ban_m31a1' };

  const norm = s => String(s || '').toLowerCase().replace(/[\s\/\\.,·\-–—_()«»"']+/g, '');
  const munName = s => String(s || '').toUpperCase().replace(/\s+|—.*$/g, '').replace(/[^A-Z0-9-]/g, '');
  const KPI_SUB = [
    [/^пуски/i, 'Кількість здійснених пусків'], [/^використано/i, 'Кількість використаних боєприпасів'],
    [/^знищено/i, 'Кількість знищених цілей'], [/^пошкоджено/i, 'Кількість пошкоджених цілей'], [/^не\s*уражено/i, 'Кількість цілей, які не були уражені'],
  ];
  const CHIP = sub => /^GMLRS/i.test(sub) ? 'GMLRS' : /MGM-?140/i.test(sub) ? 'MGM-140' : /^ATACMS/i.test(sub) ? 'ATACMS' : /^M26/i.test(sub) ? 'M26' : (sub || '').split(/\s+/)[0];

  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function setSrc(img, src) { if (img && src && img.getAttribute('src') !== src && img.dataset.ewrSrc !== src) { img.dataset.ewrSrc = src; img.setAttribute('src', src); } }

  function decorateTypeRow(row) {
    const name = row.querySelector('.tt-tx b'); if (!name) return;
    const id = TT_BY_NAME[norm(name.textContent)];
    let img = row.querySelector('img.tt-photo');
    if (id) {
      if (!img) { img = el('img', 'tt-photo'); img.alt = ''; img.draggable = false; row.prepend(img); }
      setSrc(img, IMG[id]);
    }
    row.classList.add('ewr-tt');
  }
  function decorateBanner(img) {
    const id = BAN_BY_NAME[munName(img.getAttribute('alt'))]; if (id) setSrc(img, IMG[id]);
    const row = img.closest('.mh-row.mh-ban'); if (!row || row.querySelector('.ewr-chip')) return;
    const left = row.querySelector('.mh-l'); if (!left) return;
    const subs = left.querySelectorAll('.mh-sub'), first = subs[0] ? subs[0].textContent.trim() : '';
    const chip = el('span', 'ewr-chip', CHIP(first)); left.prepend(chip);
    if (subs.length > 1 && subs[0]) subs[0].classList.add('ewr-series');
    const tri = el('div', 'ewr-tri'); ['Точність', 'Дальність', 'Результат'].forEach(t => tri.append(el('span', '', t))); left.append(tri);
    row.classList.add('ewr-ban');
  }
  function decorateKpi(card) {
    const label = card.querySelector('.kc-top .k-l'); if (!label) return;
    if (!card.querySelector('.ewr-ksub')) {
      const text = (KPI_SUB.find(([re]) => re.test(label.textContent.trim())) || [])[1];
      if (text) card.querySelector('.kc-top').after(el('div', 'ewr-ksub', text));
    }
    const chart = card.querySelector(':scope > .kc-chart');
    if (chart && !card.querySelector(':scope > .kc-axis')) {
      const dates = [...chart.querySelectorAll('.kc-x span')].map(s => s.textContent);
      const ax = el('div', 'kc-axis ewr-axis'); ax.setAttribute('aria-hidden', 'true');
      const line = el('div', 'kc-axl'); for (let i = 0; i < 25; i++) line.append(el('i', i % 8 === 0 ? 'mj' : ''));
      const txt = el('div', 'kc-axt'); dates.forEach(d => txt.append(el('span', '', d)));
      ax.append(line, txt); chart.replaceWith(ax);
    }
    if (/^пошкоджено/i.test(label.textContent.trim()) && maps.REF24_MEDIA && maps.REF24_MEDIA.damaged) setSrc(card.querySelector('.kc-photo'), maps.REF24_MEDIA.damaged);
    card.classList.toggle('ewr-damaged', /^пошкоджено/i.test(label.textContent.trim()));
    card.classList.add('ewr-kc');
  }
  /* Смуга вибраної групи під таблицею: «Боєприпас: …» — мініатюра, плашки й характеристики; «Тип цілі: …» — фото типу. */
  const SPEC_IC = {
    rng: '<path d="M14 4c3-1.5 5.5-1 6-1 0 .5.5 3-1 6l-6.5 6.5-5-5z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M7.5 10.5L4 11l3-3.5h3M13.5 16.5L13 20l3.5-3v-3M6 18l-2 2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
    gd: '<circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
    wh: '<path d="M12 3c1 3 4 4.5 4 8.5a4 4 0 0 1-8 0C8 8 11 7 12 3z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M5 20h14" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  };
  const svg = markup => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = markup; return s; };
  function munKeyOf(name) { try { return (hk.munKey && hk.munKey(name)) || (hk.origMunKey && hk.origMunKey(name)) || ''; } catch (e) { return ''; } }
  function munChips(key, info) {
    const series = info && info.sub && info.sub[0] ? CHIP(info.sub[0]) : key === 'atacms' ? 'ATACMS' : key === 'm26' ? 'M26' : '';
    const kind = key === 'atacms' ? 'Балістична ракета' : key === 'm26' ? 'Некерована ракета' : /^m3[01]$/.test(key) ? 'Керована ракета' : '';
    const cal = /^(m30|m31|m26)$/.test(key) ? '227 мм' : key === 'atacms' ? 'MGM-140' : '';
    return [series, cal, kind].filter((v, i, a) => v && a.indexOf(v) === i);
  }
  function decorateStrip(sel) {
    if (sel.classList.contains('ewr-ds')) return;
    const title = sel.querySelector('.ds-l b'); if (!title) return;
    const m = /^(Боєприпас|Тип цілі):\s*(.+)$/.exec(title.textContent.trim()); if (!m) return;
    sel.classList.add('ewr-ds');
    const left = sel.querySelector('.ds-l');
    if (m[1] === 'Тип цілі') {
      const key = TT_BY_NAME[norm(m[2])], src = key ? IMG[key] : null;
      const ttKey = src ? null : [...document.querySelectorAll('.tt-row .tt-tx b')].find(b => b.textContent.trim() === m[2]);
      const photo = src || (ttKey && ttKey.closest('.tt-row').querySelector('img.tt-photo') || {}).src;
      if (photo) { const img = el('img', 'ewr-ds-photo'); img.alt = ''; img.draggable = false; img.src = photo; left.after(img); sel.classList.add('ewr-ds-type'); }
      return;
    }
    const name = m[2], key = munKeyOf(name), info = maps.MUN_INFO && maps.MUN_INFO[key], spec = maps.MUN_SPEC && maps.MUN_SPEC[key];
    const ic = left.querySelector('.ds-ic'), thumbSrc = IMG[BAN_BY_NAME[munName(name)]] || (maps.MUN_BANNER && maps.MUN_BANNER[key]) || (info && info.src);
    if (ic && thumbSrc && !ic.querySelector('img')) { const t = el('img', 'ewr-ds-thumb'); t.alt = ''; t.draggable = false; t.src = thumbSrc; ic.append(t); ic.classList.add('ewr-has-thumb'); }
    const chips = munChips(key, info);
    if (chips.length) { const row = el('div', 'ewr-ds-chips'); chips.forEach((c, i) => row.append(el('span', i === 0 ? 'on' : '', c))); left.querySelector('div').append(row); }
    if (spec) {
      const specs = el('div', 'ewr-ds-specs');
      for (const [k, label] of [['rng', 'Дальність'], ['gd', 'Система наведення'], ['wh', 'Тип БЧ']]) {
        const v = spec[k]; if (!v) continue;
        const cell = el('div', 'ewr-ds-spec'); cell.append(svg(SPEC_IC[k]), el('span', '', label), el('b', '', v)); specs.append(cell);
      }
      if (specs.childElementCount) left.after(specs);
    }
  }
  function scan(root) {
    if (!root || !root.querySelectorAll) return;
    const each = (sel, fn) => { if (root.matches && root.matches(sel)) fn(root); root.querySelectorAll(sel).forEach(fn); };
    each('.tt-row', decorateTypeRow);
    each('img.mh-banimg', decorateBanner);
    each('.mx-ban img', img => { const id = BAN_BY_NAME[munName(img.getAttribute('alt'))]; if (id) setSrc(img, IMG[id]); });
    each('#p-kpis .kc', decorateKpi);
    each('.dsel', decorateStrip);
  }
  new MutationObserver(recs => { for (const r of recs) r.addedNodes.forEach(n => { if (n.nodeType === 1) scan(n); }); })
    .observe(document.documentElement, { childList: true, subtree: true });
  const start = () => scan(document.body);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();

  const css = document.createElement('style'); css.id = 'ewr-rocket-refs';
  css.textContent = `
/* --- Тип цілі: фото праворуч, іконка в рамці з кутиками (макет 2) --- */
html.rocket-ref24 .tt-row.ewr-tt{position:relative;overflow:hidden;min-height:74px;border:1px solid rgba(214,196,120,.22)!important;border-radius:10px!important;background:linear-gradient(90deg,#11150b 0,#11150b 38%,rgba(17,21,11,.2) 70%)!important}
html.rocket-ref24 .tt-row.ewr-tt .tt-photo{display:block!important;position:absolute!important;inset:0 0 0 auto!important;width:66%!important;height:100%!important;object-fit:cover!important;opacity:.95!important;z-index:0;pointer-events:none;-webkit-mask-image:linear-gradient(90deg,transparent 0,#000 38%)!important;mask-image:linear-gradient(90deg,transparent 0,#000 38%)!important}
html.rocket-ref24 .tt-row.ewr-tt>*:not(.tt-photo){position:relative;z-index:1}
html.rocket-ref24 .tt-row.ewr-tt .tt-tx b{text-shadow:0 2px 6px #000}
html.rocket-ref24 .tt-row.ewr-tt .tt-tx small{color:#e4e1cc!important;text-shadow:0 1px 4px #000}
html.rocket-ref24 .tt-row.ewr-tt .tt-n{background:rgba(8,10,5,.62);border-radius:8px;padding:4px 8px;backdrop-filter:blur(2px)}
html.rocket-ref24 .tt-row.ewr-tt:first-of-type,html.rocket-ref24 .tt-row.ewr-tt:hover,html.rocket-ref24 .tt-row.ewr-tt:focus-visible{border-color:#e8c33a!important;box-shadow:0 0 0 1px rgba(232,195,58,.55),0 0 18px rgba(232,195,58,.18)!important}
/* --- Банери боєприпасів: плашка серії, підпис великими, «Точність · Дальність · Результат» (макети 4–5) --- */
.mh-row.ewr-ban .ewr-chip{display:inline-block;align-self:flex-start;margin-bottom:6px;padding:3px 10px;border-radius:3px;background:rgba(214,178,52,.22);border:1px solid rgba(232,195,58,.5);color:#f0cf4a;font:800 12px/1.2 var(--display);letter-spacing:.24em}
.mh-row.ewr-ban .mh-sub.ewr-series{display:none!important}
.mh-row.ewr-ban{aspect-ratio:2130/380!important}
.mh-row.ewr-ban .mh-sub{text-transform:uppercase;letter-spacing:.09em;font-size:clamp(12px,1vw,15px)!important;line-height:1.35;font-weight:600!important;color:#d9d6c3!important}
.mh-row.ewr-ban .ewr-tri{display:grid;gap:1px;margin-top:10px;font:600 10.5px/1.35 var(--display);letter-spacing:.18em;text-transform:uppercase;color:#a9a795}
.mh-row.ewr-ban .mh-l{display:flex;flex-direction:column;justify-content:center}
/* --- Картки показників: однакова будова для всіх п'яти (макет 1) --- */
#p-kpis .kc.ewr-kc .ewr-ksub{position:relative;z-index:2;margin:0 0 4px;font:600 11.5px/1.3 var(--display);letter-spacing:.06em;text-transform:uppercase;color:#d2cfbb;text-shadow:0 1px 4px #000;max-width:78%}
#p-kpis .kc.ewr-kc .kc-axis{position:relative;z-index:2;margin:10px 0 10px!important}
#p-kpis .kc.ewr-kc .kc-axt{justify-content:space-between}
#p-kpis .kc.ewr-kc.ewr-damaged .kc-photo{object-position:72% 50%}
/* --- Смуга вибраної групи --- */
.dsel.ewr-ds:has(.ewr-ds-specs){grid-template-columns:minmax(230px,1.1fr) auto minmax(120px,.6fr) auto minmax(150px,.8fr)!important;gap:14px!important}
.dsel.ewr-ds-type{grid-template-columns:minmax(210px,1fr) minmax(160px,.9fr) minmax(130px,.6fr) auto minmax(150px,.8fr)!important;gap:14px!important}
@media (max-width:1100px){.dsel.ewr-ds:has(.ewr-ds-specs),.dsel.ewr-ds-type{grid-template-columns:1fr 1fr!important}}
.dsel.ewr-ds .ds-ic.ewr-has-thumb{position:relative;overflow:hidden;background:#1a2010!important;border:1px solid rgba(232,195,58,.6)!important}
.dsel.ewr-ds .ds-ic.ewr-has-thumb>img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:62% 50%}
.dsel.ewr-ds .ewr-ds-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.dsel.ewr-ds .ewr-ds-chips span{padding:2px 8px;border-radius:6px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.05);font:600 11.5px/1.4 var(--display);color:#d9d6c3;white-space:nowrap}
.dsel.ewr-ds .ewr-ds-chips span.on{border-color:rgba(232,195,58,.6);background:rgba(214,178,52,.18);color:#f0cf4a}
.dsel.ewr-ds .ewr-ds-specs{display:flex;align-items:center;gap:0;align-self:stretch}
.dsel.ewr-ds .ewr-ds-spec{display:grid;grid-template-columns:auto 1fr;grid-template-rows:auto auto;column-gap:8px;align-items:center;padding:0 12px;border-left:1px solid rgba(255,255,255,.12)}
.dsel.ewr-ds .ewr-ds-spec svg{grid-row:1/3;width:30px;height:30px;color:#e8c33a}
.dsel.ewr-ds .ewr-ds-spec span{font:700 10.5px/1.3 var(--display);letter-spacing:.08em;text-transform:uppercase;color:#b9b6a2}
.dsel.ewr-ds .ewr-ds-spec b{font:700 14px/1.25 var(--display);color:#f4f2e6}
.dsel.ewr-ds-type .ewr-ds-photo{align-self:stretch;width:100%;min-height:64px;max-height:96px;object-fit:cover;border-radius:8px;-webkit-mask-image:linear-gradient(90deg,transparent 0,#000 30%,#000 80%,transparent);mask-image:linear-gradient(90deg,transparent 0,#000 30%,#000 80%,transparent)}
html.rocket-ref24 #p-kpis .kpi-grid > .kc.ewr-kc:nth-child(n+3):nth-child(-n+6) .kc-top{padding:0!important;min-height:26px!important;border:0!important;background:none!important;box-shadow:none!important}
/* --- «Тип РСЗВ»: розміри від ширини картки, а не вікна; на вузькій картці — стовпчиком --- */
.achero{container-type:inline-size}
.achero .ah-name{font-size:clamp(56px,14cqi,128px)}
.achero .ah-role{font-size:clamp(11px,2.1cqi,19px)}
.achero .ah-motto{font-size:clamp(12px,2.3cqi,21px)}
.achero .ah-r b{font-size:clamp(52px,12cqi,108px)}
.achero .ah-r span{font-size:clamp(15px,2.9cqi,24px)}
.achero .ah-foot em{overflow:hidden;text-overflow:ellipsis}
@container (max-width:700px){
  .achero .ah-h{flex-wrap:wrap;min-height:0;padding-left:16px}
  .achero .ah-h h2{flex:1 1 auto;min-height:52px;font-size:clamp(20px,6.4cqi,30px);white-space:nowrap}
  .achero .ah-i{width:24px;height:24px;font-size:13px}
  .achero .ah-more{min-width:0;padding:0 16px;font-size:11px;letter-spacing:.08em;gap:8px}
  .achero .ah-sel{display:flex;order:3;flex:1 0 100%;margin:0;padding:8px 16px;border-top:1px solid color-mix(in srgb,var(--accent) 24%,var(--line))}
  .achero .ah-b{aspect-ratio:auto;display:flex;flex-direction:column;padding:22px 18px 18px}
  .achero .ah-photo{object-position:62% 40%;opacity:.62}
  .achero .ah-b::before{background:linear-gradient(180deg,rgba(3,10,7,.62) 0%,rgba(3,10,7,.78) 42%,rgba(3,10,7,.94) 100%)}
  .achero .ah-b::after{display:none}
  .achero .ah-l{display:contents}
  .achero .ah-l>*{position:relative;z-index:2}
  .achero .ah-name{order:1}.achero .ah-role{order:2}.achero .ah-motto{order:3}.achero .ah-r{order:4}.achero .ah-foot{order:5}
  .achero .ah-name{font-size:clamp(44px,19cqi,96px);line-height:.9}
  .achero .ah-role{font-size:clamp(10px,3.1cqi,14px);letter-spacing:.14em;margin-top:10px;max-width:none}
  .achero .ah-role::after{width:56px;height:2px;margin-top:12px}
  .achero .ah-motto{display:flex;flex-wrap:wrap;gap:0 .45em;margin-top:12px;font-size:clamp(12px,3.6cqi,15px)}
  .achero .ah-mapmark{display:none}
  .achero .ah-foot{width:auto;margin-top:18px;padding-top:14px;flex-wrap:wrap;gap:6px 10px;white-space:normal;font-size:10px;letter-spacing:.1em;border-top:1px solid rgba(255,255,255,.14)}
  .achero .ah-foot .ah-tr{width:18px;height:25px}
  .achero .ah-foot i{display:none}
  .achero .ah-foot em{letter-spacing:.1em}
  .achero .ah-r{position:relative;inset:auto;z-index:2;width:auto;margin-top:20px;padding:4px 0 4px 16px;border-left:2px solid var(--accent);display:grid;grid-template-columns:auto 1fr;column-gap:14px;align-items:center}
  .achero .ah-r b{grid-row:1/3;font-size:clamp(44px,17cqi,84px);line-height:.9}
  .achero .ah-r span{font-size:clamp(14px,4.4cqi,20px);overflow-wrap:anywhere}
  .achero .ah-r small{margin-top:2px;font-size:12px;line-height:1.35}
}
@container (max-width:320px){
  .achero .ah-more{flex:1 0 100%;min-height:38px;justify-content:flex-end;border-left:0;border-top:1px solid color-mix(in srgb,var(--accent) 24%,var(--line))}
}
`;
  document.head.append(css);
})();
