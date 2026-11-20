const p=require('puppeteer-core');
(async()=>{const b=await p.launch({executablePath:'/usr/bin/google-chrome',headless:'new',protocolTimeout:600000,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const pg=await b.newPage();await pg.setViewport({width:1280,height:900});
await pg.goto('http://localhost:8799/EasyWAR_hangar.html#garage',{timeout:180000});
for(const id of (process.argv[2]||'himars').split(',')){await pg.evaluate(i=>GAR.set(i),id);await pg.waitForFunction(i=>GAR.ready&&GAR.cur===i,{timeout:120000},id);await pg.evaluate(()=>GAR.step(80));
console.log(await pg.evaluate(()=>{const S=GAR.models[GAR.cur];const f=v=>v.toArray().map(x=>x.toFixed(2)).join(',');return JSON.stringify({gw:window.__GW,ab:S.abox?[f(S.abox.min),f(S.abox.max)]:0,wb:[f(S.wbox.min),f(S.wbox.max)],vx:S.veh.position.x,rot:S.veh.rotation.y});}));}
await b.close();})();
