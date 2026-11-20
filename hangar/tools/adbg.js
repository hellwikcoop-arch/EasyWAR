const p=require('puppeteer-core');
(async()=>{const b=await p.launch({executablePath:'/usr/bin/google-chrome',headless:'new',protocolTimeout:600000,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const pg=await b.newPage();await pg.setViewport({width:1280,height:900});pg.on('console',m=>console.log('C',m.text().slice(0,300)));
await pg.goto('http://localhost:8799/EasyWAR_hangar.html',{timeout:180000});await pg.waitForFunction(()=>document.getElementById('load').hidden,{timeout:180000});await new Promise(r=>setTimeout(r,2500));
console.log(await pg.evaluate(s=>window.__mkDbg(s),process.argv[2]));await b.close();})();
