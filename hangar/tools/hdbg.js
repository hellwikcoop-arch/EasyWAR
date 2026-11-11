const p=require('puppeteer-core');
(async()=>{const b=await p.launch({executablePath:'/usr/bin/google-chrome',headless:'new',protocolTimeout:600000,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const pg=await b.newPage();await pg.setViewport({width:1400,height:1000});pg.on('console',m=>{if(/anc|rror|warn/i.test(m.text()))console.log('C',m.text().slice(0,300))});pg.on('pageerror',e=>console.log('PE',e.message));
await pg.goto('http://localhost:8799/EasyWAR_hangar.html',{timeout:180000});
await pg.waitForFunction(()=>document.getElementById('load').hidden,{timeout:180000});
const idx=+(process.argv[2]||2);await pg.evaluate(i=>document.querySelectorAll('#aFig .ui-car .chip')[i].click(),idx);
await pg.waitForFunction(()=>document.getElementById('load').hidden,{timeout:180000});await new Promise(r=>setTimeout(r,4000));
console.log(await pg.evaluate(()=>{const h=window.__HUD.h;const f=v=>v.toArray().map(x=>x.toFixed(2)).join(',');return JSON.stringify({cur:h.cur,age:h.age,n:h.ancN,anc:!!h.anc,box:[f(h.box.min),f(h.box.max)],holo:document.getElementById('holo').className,els:Object.entries(h.el).map(([k,o])=>k+':'+o.empty+':'+o.d.style.opacity+':'+o.d.style.transform)});}));
await b.close();})();
