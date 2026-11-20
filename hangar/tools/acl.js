// аудит літаків: 3/4 і низький крупний план шасі
const p=require('puppeteer-core');
(async()=>{const b=await p.launch({executablePath:'/usr/bin/google-chrome',headless:'new',protocolTimeout:600000,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const pg=await b.newPage();await pg.setViewport({width:1280,height:900});const errs=[];
pg.on('pageerror',e=>errs.push(e.message));pg.on('console',m=>{if(m.type()==='error'&&!/404/.test(m.text()))errs.push(m.text().slice(0,200))});
await pg.goto('http://localhost:8799/EasyWAR_hangar.html',{timeout:180000});
const tag=process.env.TAG||'';
const list=(process.argv[2]||'mig:KeyQ').split(',');
for(const it of list){const [n,k]=it.split(':');await pg.keyboard.press(k);await new Promise(r=>setTimeout(r,1200));
  await pg.waitForFunction(()=>document.getElementById('load').hidden,{timeout:180000}).catch(()=>errs.push('timeout '+n));
  await pg.keyboard.press('Period');// ТТХ off
  for(const [v,y,e,z] of [['34',-1.0,.12,.72],['gear',-1.35,.02,.42]]){await pg.evaluate((y,e,z)=>__CAM(y,e,z),y,e,z);await new Promise(r=>setTimeout(r,2500));
    const el=await pg.$('#stage');await el.screenshot({path:`/workspace/hangar2/shots/audit/a_${n}_${v}${tag}.png`});}
  await pg.keyboard.press('Period');console.log('shot',n);}
console.log('ERR',errs.join('|'));await b.close();})();
