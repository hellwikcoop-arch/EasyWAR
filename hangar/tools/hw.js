const p=require('puppeteer-core');
(async()=>{const b=await p.launch({executablePath:'/usr/bin/google-chrome',headless:'new',protocolTimeout:600000,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const pg=await b.newPage();await pg.setViewport({width:1400,height:1000});pg.on('pageerror',e=>console.log('PAGEERR '+e.message));
await pg.goto('http://localhost:8799/EasyWAR_hangar.html',{timeout:180000});
await pg.waitForFunction(()=>document.getElementById('load').hidden,{timeout:180000});
await pg.keyboard.press('Period');
const V=JSON.parse(process.argv[2]);let i=0;for(const v of V){await pg.evaluate(v=>__CAM(...v),v);await new Promise(r=>setTimeout(r,2500));await (await pg.$('#stage')).screenshot({path:`/tmp/hw_${i++}.png`});}
await b.close();})();
