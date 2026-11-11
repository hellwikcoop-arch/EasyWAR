const p=require('puppeteer-core');
(async()=>{const b=await p.launch({executablePath:'/usr/bin/google-chrome',headless:'new',protocolTimeout:600000,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const pg=await b.newPage();await pg.setViewport({width:1280,height:900});const errs=[];pg.on('pageerror',e=>errs.push(e.message));pg.on('console',m=>{if((m.type()==='error'||m.type()==='warning')&&!/404/.test(m.text()))errs.push(m.text().slice(0,300));});
await pg.goto('http://localhost:8799/EasyWAR_hangar.html',{timeout:180000});await pg.waitForFunction(()=>document.getElementById('load').hidden,{timeout:180000});
const out=process.env.OUT||'/tmp/am';require('fs').mkdirSync(out,{recursive:true});const ALL='mig,f16,su,mi8,mi24,il,su24,m2k,su25,gripen'.split(',');const ids=(process.argv[2]||ALL.join(',')).split(',');
for(const id of ids){await pg.evaluate(i=>document.querySelectorAll('#aFig .ui-car .chip')[i].click(),ALL.indexOf(id));await pg.waitForFunction(()=>document.getElementById('load').hidden,{timeout:180000});await new Promise(r=>setTimeout(r,3000));
 for(const [n,y,e,z] of [['t',-1.0,1.25,.8],['s',0,.1,.75],['r',2.3,.3,.8]]){await pg.evaluate((y,e,z,H)=>{__CAM(y,e,z);if(!H)document.getElementById('holo')&&(document.getElementById('holo').style.display='none');},y,e,z,!!process.env.HOLO);await new Promise(r=>setTimeout(r,1800));
  const bb=await (await pg.$('#stage')).boundingBox();await pg.screenshot({path:`${out}/${id}_${n}.png`,clip:bb,captureBeyondViewport:false});}
 console.log(id,await pg.evaluate(()=>String(window.__AMK)+' '+window.__AMKD));}
console.log('ERR',errs.join('|'));await b.close();})();
