const p=require('puppeteer-core');
(async()=>{const b=await p.launch({executablePath:'/usr/bin/google-chrome',headless:'new',protocolTimeout:600000,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const pg=await b.newPage();await pg.setViewport({width:1280,height:900});const errs=[];
pg.on('pageerror',e=>errs.push(e.message));pg.on('console',m=>{if(m.type()==='error'&&!/404/.test(m.text()))errs.push(m.text())});
await pg.goto('http://localhost:8799/EasyWAR_hangar.html#garage',{timeout:180000});await pg.waitForFunction(()=>GAR.ready,{timeout:120000});
const H=[['abrams','park',-Math.PI+.75,.1,1,true],['himars','combat',-Math.PI+.6,.06,1.1,false],['m270','combat',-Math.PI/2-.35,.12,1,true],['berge','engine',-Math.PI+.9,.08,1,true],['vilkha','combat',-Math.PI/2-.5,.1,1.05,true],['bradley','park',-Math.PI+.55,.05,1,false]];
for(const [id,m,yaw,el,z,holoOff] of H){await pg.evaluate(i=>GAR.set(i),id);await pg.waitForFunction(i=>GAR.ready&&GAR.cur===i,{timeout:120000},id);
 await pg.evaluate((m,yaw,el,z,h)=>{GAR.setMode(m);GAR.yaw=yaw;GAR.el=el;GAR.zoom=z;GAR.holo=!h;GAR.step(150);GAR.yaw=yaw;GAR.step(2);},m,yaw,el,z,holoOff);
 const e=await pg.$('#gStage');await e.screenshot({path:`/workspace/hangar2/shots/best_${id}_${m}.png`});console.log('ok',id);}
console.log('ERR',errs.join('|'));await b.close();})();
