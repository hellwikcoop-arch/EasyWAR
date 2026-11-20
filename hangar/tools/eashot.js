// node tools/eashot.js outdir id1,id2 ; ворожа авіація (#enemy-air); views t (top 3/4), s (side), r (rear 3/4)
const p=require('/workspace/hangar2/tools/node_modules/puppeteer-core');
(async()=>{const b=await p.launch({executablePath:'/usr/bin/google-chrome',headless:'new',protocolTimeout:900000,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--allow-file-access-from-files']});
const pg=await b.newPage();await pg.setViewport({width:1280,height:900});const errs=[];pg.on('pageerror',e=>errs.push('PE '+e.message));pg.on('console',m=>{if((m.type()==='error'||m.type()==='warning')&&!/404|favicon/.test(m.text()))errs.push(m.text().slice(0,300));});
await pg.goto((process.env.BASE||'http://localhost:8799/EasyWAR_hangar.html')+'#enemy-air',{timeout:180000});await pg.waitForFunction(()=>window.HSIDE&&document.getElementById('load').hidden,{timeout:180000});
const out=process.argv[2];require('fs').mkdirSync(out,{recursive:true});const ids=process.argv[3].split(',');const V=(process.env.VIEWS||'t:-1.0:1.25:.8;s:0:.1:.75;r:2.3:.3:.8').split(';').map(x=>x.split(':'));
for(const id of ids){await pg.evaluate(i=>__setAircraft(i),id);await pg.waitForFunction(i=>__AIR.cur===i&&document.getElementById('load').hidden,{timeout:240000},id).catch(e=>errs.push('timeout '+id));await new Promise(r=>setTimeout(r,3500));
 for(const [n,y,e,z] of V){await pg.evaluate((y,e,z,H)=>{__CAM(+y,+e,+z);if(!H)document.getElementById('holo')&&(document.getElementById('holo').style.display='none');},y,e,z,!!process.env.HOLO);await new Promise(r=>setTimeout(r,1800));
  const bb=await (await pg.$('#stage')).boundingBox();await pg.screenshot({path:`${out}/${id}_${n}.png`,clip:bb,captureBeyondViewport:false});}
 console.log(id,await pg.evaluate(()=>String(window.__AMK)+' '+window.__AMKD));}
if(process.env.FULL){await pg.screenshot({path:out+'/_full.png'});}
console.log('ERR',errs.join('|'));await b.close();})();
