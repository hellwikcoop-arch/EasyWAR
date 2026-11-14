// Стилі ознайомлення одним рядком: і сторінки Vite, і ангар (його HTML не проходить через бандлер CSS).

export const ONBOARDING_CSS = `
.ew-onb-help{position:fixed;right:16px;bottom:16px;z-index:10040;font:14px/1.4 "Segoe UI",system-ui,sans-serif;color:#e7eef6}
.ew-onb-help > button,.ew-onb-menu button,.ew-onb-check button,.ew-onb-resume button,.ew-onb-tip button,.ew-onb-modal button,.ew-demo-board button{font:inherit;cursor:pointer}
.ew-onb-help > button{border:1px solid rgba(242,194,48,.55);background:#121a14;color:#f2c230;border-radius:999px;padding:8px 14px;box-shadow:0 10px 28px rgba(0,0,0,.35)}
.ew-onb-help > button:hover,.ew-onb-help > button:focus-visible{background:#1c2918}
.ew-onb-menu{position:absolute;right:0;bottom:46px;width:260px;display:flex;flex-direction:column;gap:4px;padding:8px;border-radius:14px;background:#101820;border:1px solid rgba(255,255,255,.12);box-shadow:0 18px 40px rgba(0,0,0,.45)}
.ew-onb-menu[hidden]{display:none}
.ew-onb-menu button{text-align:left;border:0;background:transparent;color:#e7eef6;border-radius:8px;padding:8px 10px}
.ew-onb-menu button:hover,.ew-onb-menu button:focus-visible{background:rgba(255,255,255,.06)}
.ew-onb-modal{position:fixed;inset:0;z-index:10060;display:grid;place-items:center;padding:24px;background:rgba(6,10,16,.72);font:15px/1.45 "Segoe UI",system-ui,sans-serif;color:#e7eef6}
.ew-onb-card{width:min(480px,100%);background:linear-gradient(180deg,#162433,#0e1722);border:1px solid rgba(255,255,255,.12);border-radius:18px;padding:22px 22px 18px;box-shadow:0 24px 60px rgba(0,0,0,.45)}
.ew-onb-kicker{margin:0 0 6px;color:#f2c230;font-size:12px;letter-spacing:.08em;text-transform:uppercase}
.ew-onb-card h2,.ew-onb-tip h2{margin:0 0 8px;font-size:22px;line-height:1.2}
.ew-onb-card p,.ew-onb-tip p{margin:0 0 12px}
.ew-onb-field{display:flex;flex-direction:column;gap:6px;margin:0 0 12px;color:#b7c6d6;font-size:13px}
.ew-onb-field input{font:inherit;color:#e7eef6;background:#0c141d;border:1px solid rgba(255,255,255,.16);border-radius:10px;padding:10px 12px}
.ew-onb-roles{display:flex;gap:8px;margin:0 0 8px}
.ew-onb-roles button{flex:1;border-radius:10px;border:1px solid rgba(255,255,255,.16);background:#0c141d;color:#e7eef6;padding:10px 8px}
.ew-onb-roles button[aria-pressed="true"]{border-color:#f2c230;color:#f2c230}
.ew-onb-error{min-height:1.2em;color:#ff8d7a;font-size:13px}
.ew-onb-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.ew-onb-primary{border:0;border-radius:10px;background:#f2c230;color:#1a1506;font-weight:700;padding:10px 14px}
.ew-onb-quiet{border:0;background:transparent;color:#b7c6d6;padding:10px 8px}
.ew-onb-spot{position:fixed;inset:0;z-index:10050;pointer-events:none}
.ew-onb-ring{position:fixed;border:2px solid #f2c230;border-radius:14px;box-shadow:0 0 0 9999px rgba(5,10,16,.62);pointer-events:none}
.ew-onb-tip{position:fixed;pointer-events:auto;width:min(360px,calc(100vw - 24px));background:#101820;color:#e7eef6;border:1px solid rgba(242,194,48,.45);border-radius:16px;padding:14px 14px 12px;box-shadow:0 18px 40px rgba(0,0,0,.45);font:14px/1.45 "Segoe UI",system-ui,sans-serif}
.ew-onb-tip h2{font-size:18px}
.ew-onb-step{color:#f2c230;font-size:12px;letter-spacing:.06em;text-transform:uppercase;margin:0 0 6px}
.ew-check{position:fixed;left:16px;bottom:16px;z-index:10040;width:min(320px,calc(100vw - 32px));font:14px/1.4 "Segoe UI",system-ui,sans-serif;color:#e7eef6}
.ew-check-panel{background:#101820;border:1px solid rgba(255,255,255,.12);border-radius:16px;box-shadow:0 18px 40px rgba(0,0,0,.4);overflow:hidden}
.ew-check-head{width:100%;display:flex;justify-content:space-between;gap:12px;border:0;background:transparent;color:inherit;padding:12px 14px;font:inherit;cursor:pointer}
.ew-check-head b{color:#f2c230}
.ew-check ol{list-style:none;margin:0;padding:0 8px 8px}
.ew-check li + li{margin-top:2px}
.ew-check li button{width:100%;display:flex;gap:8px;text-align:left;border:0;border-radius:8px;background:transparent;color:#d5e0ea;padding:7px 8px}
.ew-check li button:hover,.ew-check li button:focus-visible{background:rgba(255,255,255,.05)}
.ew-check li.is-done button{color:#8ea0b3}
.ew-check i{font-style:normal;width:1.2em;color:#f2c230}
.ew-onb-resume{position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:10045;display:flex;gap:12px;align-items:center;width:min(460px,calc(100vw - 24px));padding:12px 14px;border-radius:14px;background:#101820;color:#e7eef6;border:1px solid rgba(242,194,48,.45);box-shadow:0 16px 36px rgba(0,0,0,.4);font:14px/1.4 "Segoe UI",system-ui,sans-serif}
.ew-onb-resume strong{display:block}
.ew-onb-resume p{margin:2px 0 0;color:#b7c6d6}
.ew-demo-board{position:fixed;left:50%;bottom:72px;z-index:10030;transform:translateX(-50%);width:min(720px,calc(100% - 140px));background:#101820;color:#e7eef6;border:1px solid rgba(242,194,48,.55);border-radius:16px;padding:12px 14px;box-shadow:0 18px 40px rgba(0,0,0,.4);font:14px/1.4 "Segoe UI",system-ui,sans-serif}
.ew-demo-head{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.ew-demo-badge{background:#f2c230;color:#1a1506;font-weight:800;font-size:12px;letter-spacing:.08em;border-radius:999px;padding:3px 8px}
.ew-demo-head strong{flex:1}
.ew-demo-head button,.ew-onb-resume .ew-onb-primary{margin-left:auto}
.ew-demo-note{margin:8px 0;color:#b7c6d6;font-size:13px}
.ew-demo-kpis{display:flex;gap:8px;margin:0 0 8px}
.ew-demo-kpis div{flex:1;background:#0c141d;border-radius:10px;padding:8px 10px}
.ew-demo-kpis b{display:block;font-size:20px}
.ew-demo-kpis span{color:#8ea0b3;font-size:12px}
.ew-demo-board ul{margin:0;padding:0;list-style:none}
.ew-demo-board li{padding:6px 0;border-top:1px solid rgba(255,255,255,.08)}
@media (max-width:720px){.ew-onb-roles{flex-direction:column}.ew-demo-kpis{flex-direction:column}}
@media (prefers-reduced-motion: reduce){.ew-onb-ring,.ew-onb-tip,.ew-onb-modal,.ew-onb-resume{transition:none}}
`;
