const p=require('puppeteer-core');
(async()=>{const b=await p.launch({executablePath:'/usr/bin/google-chrome',headless:'new',protocolTimeout:600000,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--allow-file-access-from-files']});
const pg=await b.newPage();await pg.setViewport({width:1400,height:1000});const errs=[];pg.on('pageerror',e=>errs.push(e.message));pg.on('console',m=>{if(m.type()==='error'&&!/404/.test(m.text()))errs.push(m.text().slice(0,200));});
await pg.goto(process.argv[2]||'http://localhost:8799/EasyWAR_hangar.html',{timeout:180000});
await pg.waitForFunction(()=>document.getElementById('load').hidden,{timeout:180000});await new Promise(r=>setTimeout(r,1500));
const n=await pg.evaluate(()=>document.querySelectorAll('#aFig .ui-car .chip').length);
for(let i=0;i<n;i++){await pg.evaluate(i=>document.querySelectorAll('#aFig .ui-car .chip')[i].click(),i);
  await pg.waitForFunction(()=>document.getElementById('load').hidden,{timeout:180000});await new Promise(r=>setTimeout(r,3500));
  {const bb=await (await pg.$('#stage')).boundingBox();await pg.screenshot({path:`/workspace/hangar2/shots/c_${i}.png`,clip:bb,captureBeyondViewport:false});}}
console.log('n',n,'ERR',errs.join('|'));await b.close();})();
