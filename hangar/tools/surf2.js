const p=require('puppeteer-core');
(async()=>{const b=await p.launch({executablePath:'/usr/bin/google-chrome',headless:'new',protocolTimeout:600000,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const pg=await b.newPage();await pg.setViewport({width:1400,height:1000});pg.on('pageerror',e=>console.log('PAGEERR '+e.message));
await pg.goto('http://localhost:8799/EasyWAR_hangar.html',{timeout:180000});
await pg.waitForFunction(()=>document.getElementById('load').hidden,{timeout:180000});
const id=process.argv[2];await pg.keyboard.press(process.argv[3]);await pg.waitForFunction(k=>window.__ST[k]&&window.__ST[k].ready,{timeout:120000},id);
await pg.keyboard.press('Period');await pg.evaluate(()=>__CAM(-2.3,.75,.62));await new Promise(r=>setTimeout(r,1500));
const r=await pg.evaluate(()=>{const c=[...document.querySelectorAll('#rowS .chip')];const t=c.map(x=>x.textContent.trim()+(x.classList.contains('lock')?'[L]':''));const k=c.find(x=>/рул/i.test(x.textContent));if(k)k.click();return t;});console.log(r);
for(const [i,ms] of [[0,1100],[1,1700],[2,1700]]){await new Promise(r=>setTimeout(r,ms));await (await pg.$('#stage')).screenshot({path:`/tmp/s2_${id}_${i}.png`});}
await b.close();})();
