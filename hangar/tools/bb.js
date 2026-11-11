const p=require('puppeteer-core');
(async()=>{const b=await p.launch({executablePath:'/usr/bin/google-chrome',headless:'new',protocolTimeout:600000,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const pg=await b.newPage();pg.on('console',m=>{if(m.type()!=='log')console.log('C',m.text().slice(0,200))});
await pg.goto('http://localhost:8799/EasyWAR_hangar.html#garage',{timeout:180000});
for(const id of process.argv[2].split(',')){await pg.evaluate(i=>GAR.set(i),id);await pg.waitForFunction(i=>GAR.ready&&GAR.cur===i,{timeout:120000},id);
console.log(id,await pg.evaluate(i=>{const S=GAR.models[i];return [S.L,S.H,S.W].map(x=>x.toFixed(2)).join(' ')+' wheels '+S.wheels.length+' marks '+(S.marks||[]).length;},id));}
await b.close();})();
