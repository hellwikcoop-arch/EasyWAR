const p=require('puppeteer-core');
(async()=>{const b=await p.launch({executablePath:'/usr/bin/google-chrome',headless:'new',args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const pg=await b.newPage();await pg.setViewport({width:1280,height:900});await pg.goto('http://localhost:8799/EasyWAR_hangar.html#garage',{timeout:180000});
for(const id of process.argv[2].split(',')){await pg.evaluate(i=>GAR.set(i),id);await pg.waitForFunction(i=>GAR.ready&&GAR.cur===i,{timeout:120000},id);await pg.evaluate(()=>GAR.step(60));await new Promise(r=>setTimeout(r,500));
console.log(id,JSON.stringify(await pg.evaluate(()=>[window.__GW,(GAR.models[GAR.cur].anc.arm||[]).map(a=>a&&a.length)])).slice(0,900));}
await b.close();})();
