const p=require('puppeteer-core');
(async()=>{const b=await p.launch({executablePath:'/usr/bin/google-chrome',headless:'new',protocolTimeout:600000,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const pg=await b.newPage();await pg.setViewport({width:1280,height:900});
await pg.goto('http://localhost:8799/EasyWAR_hangar.html',{timeout:180000});await pg.waitForFunction(()=>document.getElementById('load').hidden,{timeout:180000});
const ALL='mig,f16,su,mi8,mi24,il,su24,m2k,su25,gripen'.split(',');
await pg.evaluate(i=>document.querySelectorAll('#aFig .ui-car .chip')[i].click(),ALL.indexOf(process.argv[2]));await pg.waitForFunction(()=>document.getElementById('load').hidden,{timeout:180000});await new Promise(r=>setTimeout(r,3000));
console.log(await pg.evaluate(s=>window.__mkDbg(s),process.argv[3]));await b.close();})();
