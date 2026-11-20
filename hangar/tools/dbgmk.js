const p=require('puppeteer-core');
(async()=>{const b=await p.launch({executablePath:'/usr/bin/google-chrome',headless:'new',protocolTimeout:600000,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const pg=await b.newPage();await pg.setViewport({width:1280,height:900});pg.on('console',m=>console.log('C',m.text().slice(0,300)));
await pg.goto('http://localhost:8799/EasyWAR_hangar.html#garage',{timeout:180000});const id=process.argv[2];
await pg.evaluate(i=>GAR.set(i),id);await pg.waitForFunction(i=>GAR.ready&&GAR.cur===i,{timeout:120000},id);
console.log(await pg.evaluate(new Function(process.argv[3])));await b.close();})();
