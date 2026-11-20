const p=require('puppeteer-core');
(async()=>{const b=await p.launch({executablePath:'/usr/bin/google-chrome',headless:'new',protocolTimeout:600000,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const pg=await b.newPage();await pg.setViewport({width:1400,height:1000});pg.on('pageerror',e=>console.log('PAGEERR '+e.message));pg.on('console',m=>{if(/surf|rror|warn/i.test(m.text()))console.log('C:',m.text().slice(0,300));});
await pg.goto('http://localhost:8799/EasyWAR_hangar.html',{timeout:180000});
await pg.waitForFunction(()=>document.getElementById('load').hidden,{timeout:180000});
const id=process.argv[2];await pg.keyboard.press(process.argv[3]);await pg.waitForFunction(k=>window.__ST[k]&&window.__ST[k].ready,{timeout:120000},id);
await pg.keyboard.press('Period');await new Promise(r=>setTimeout(r,1500));
const info=await pg.evaluate(k=>__ST[k].surfInfo,id);console.log(info);
const V=JSON.parse(process.argv[4]);let i=0;
for(const v of V){await pg.evaluate((k,a)=>{window.__surfA=a;const q=new THREE.Quaternion(),X=new THREE.Vector3(1,0,0);__RIG[k].forEach(r=>{const s=/R$/.test(r.name)?1:/L$/.test(r.name)?-1:1;r.pv.quaternion.copy(r.q0).multiply(q.setFromAxisAngle(X,r.sign*a*(r.name.startsWith('ail')?s:1)));});},id,v[3]);
  await pg.evaluate(v=>__CAM(v[0],v[1],v[2]),v);await new Promise(r=>setTimeout(r,1200));
  await pg.evaluate((k,a)=>{const q=new THREE.Quaternion(),X=new THREE.Vector3(1,0,0);__RIG[k].forEach(r=>{const s=/R$/.test(r.name)?1:/L$/.test(r.name)?-1:1;r.pv.quaternion.copy(r.q0).multiply(q.setFromAxisAngle(X,r.sign*a*(r.name.startsWith('ail')?s:1)));});},id,v[3]);
  await (await pg.$('#stage')).screenshot({path:`/tmp/surf_${id}_${i++}.png`});}
await b.close();})();
