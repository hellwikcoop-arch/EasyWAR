const p=require('puppeteer-core');
(async()=>{const b=await p.launch({executablePath:'/usr/bin/google-chrome',headless:'new',protocolTimeout:600000,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const pg=await b.newPage();await pg.setViewport({width:1280,height:900});
pg.on('console',m=>console.log('C:',m.text().slice(0,300)));pg.on('pageerror',e=>console.log('PAGEERR '+e.message));
await pg.goto('http://localhost:8799/EasyWAR_hangar.html#garage',{timeout:180000});
await pg.waitForFunction(()=>GAR.ready,{timeout:120000});
const tests=JSON.parse(process.argv[2]);let i=0;
for(const t of tests){const r=await pg.evaluate(t);console.log('R',i,JSON.stringify(r).slice(0,1500));await pg.evaluate(()=>GAR.step(2));
 const el=await pg.$('#gStage');await el.screenshot({path:`/tmp/dbg_${i}.png`});i++;}
await b.close();})();
