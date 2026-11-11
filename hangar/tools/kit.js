const p=require('puppeteer-core');
(async()=>{const b=await p.launch({executablePath:'/usr/bin/google-chrome',headless:'new',protocolTimeout:600000,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const pg=await b.newPage();await pg.setViewport({width:1280,height:900});const errs=[];
pg.on('console',m=>{const t=m.text();if((m.type()==='error'||m.type()==='warning')&&!/404/.test(t))errs.push(t.slice(0,300));});pg.on('pageerror',e=>errs.push('PAGEERR '+e.message));
await pg.goto('http://localhost:8799/EasyWAR_hangar.html#garage',{timeout:180000});
const ids=process.argv[2].split(',');
for(const id of ids){await pg.evaluate(i=>GAR.set(i),id);await pg.waitForFunction(i=>GAR.ready&&GAR.cur===i,{timeout:120000},id);
  await pg.evaluate(()=>{GAR.holo=false;GAR.lamps=true;});await pg.evaluate(()=>GAR.step(80));
  await pg.evaluate(()=>{GAR.zoom=.72;GAR.yaw=-(Math.PI-.95);GAR.el=.1;GAR.step(90);});
  await (await pg.$('#gStage')).screenshot({path:`/workspace/hangar2/shots/k_${id}_front.png`});
  await pg.evaluate(()=>{GAR.yaw=-.75;GAR.el=.14;GAR.step(90);});
  await (await pg.$('#gStage')).screenshot({path:`/workspace/hangar2/shots/k_${id}_rear.png`});console.log('shot',id);}
console.log('ERR',errs.join(' | '));await b.close();})();
