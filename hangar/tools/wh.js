const p=require('puppeteer-core');
(async()=>{const b=await p.launch({executablePath:'/usr/bin/google-chrome',headless:'new',protocolTimeout:600000,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const pg=await b.newPage();await pg.setViewport({width:1280,height:900});pg.on('console',m=>{const t=m.text();if(m.type()!=='log'&&!/404/.test(t))console.log('C',m.type(),t.slice(0,300));});pg.on('pageerror',e=>console.log('PE',e.message));
await pg.evaluateOnNewDocument(()=>{window.__WDBG=1;});await pg.goto('http://localhost:8799/EasyWAR_hangar.html#garage',{timeout:180000});
for(const id of process.argv[2].split(',')){await pg.evaluate(i=>GAR.set(i),id);await pg.waitForFunction(i=>GAR.ready&&GAR.cur===i,{timeout:120000},id).catch(()=>console.log('timeout',id));
 console.log(id,JSON.stringify(await pg.evaluate(i=>{const D=GV[i];return [D.__wh,D.__isl];},id)));}
await b.close();})();
