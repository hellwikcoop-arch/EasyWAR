/* EasyWAR «Редактор модуля» (public/module-editor.js): доступ до довідників і перехоплення ключів озброєння. */
(function () {
  const pick = f => { try { return f(); } catch (e) { return undefined; } };
  const hooks = window.__EW_EDITOR_HOOKS__ = { munKey: null, carrierKey: null, origMunKey: munKey, origCarrierKey: carrierKey, unitKey };
  const baseMunKey = munKey, baseCarrierKey = carrierKey;
  munKey = function (m) { const k = hooks.munKey && hooks.munKey(m); return k || baseMunKey(m); };
  carrierKey = function (a) { const k = hooks.carrierKey && hooks.carrierKey(a); return k || baseCarrierKey(a); };
  hooks.maps = { EMB, EMBK, IMG, IMG2, MUN_IMG, MUN_W, MUN_INFO, WEAPONS, CARRIERS, AC_IMG,
    MUN_SPEC: pick(() => MUN_SPEC), MUN_BANNER: pick(() => MUN_BANNER), ROCKET_PLATFORM_MEDIA: pick(() => ROCKET_PLATFORM_MEDIA), REF24_MEDIA: pick(() => REF24_MEDIA) };
  hooks.images = { KPI_REF_BLUE: pick(() => KPI_REF_BLUE), KPI_REF_AMBER: pick(() => KPI_REF_AMBER), ROCKET_KPI_M142: pick(() => ROCKET_KPI_M142), ROCKET_KPI_M30: pick(() => ROCKET_KPI_M30),
    PLAT_BANNER_M142: pick(() => PLAT_BANNER_M142), MUN_BAN_M30A2: pick(() => MUN_BAN_M30A2), M30_VISUAL: pick(() => M30_VISUAL), M31_VISUAL: pick(() => M31_VISUAL), M26_VISUAL: pick(() => M26_VISUAL) };
  hooks.rows = () => ROWS;
  hooks.rerender = () => { if (AV.S.wb) renderAll(); };
})();
