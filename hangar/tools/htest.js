const p=require('puppeteer-core');
(async()=>{const b=await p.launch({executablePath:'/usr/bin/google-chrome',headless:'new',protocolTimeout:600000,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const pg=await b.newPage();await pg.setViewport({width:1280,height:900});const errs=[];
pg.on('console',m=>{const t=m.text();if(m.type()==='error'||/rror/.test(t))errs.push(m.type()+': '+t.slice(0,300));});
pg.on('pageerror',e=>errs.push('PAGEERR '+e.message));
pg.on('requestfailed',r=>errs.push('REQFAIL '+r.url().slice(0,120)));
pg.on('response',r=>{if(r.status()>=400)errs.push('HTTP '+r.status()+' '+r.url().slice(0,120));});
await pg.goto('http://localhost:8799/EasyWAR_hangar.html',{timeout:180000});
const list=(process.argv[2]||'mig:KeyQ').split(',');
for(const it of list){const [n,k]=it.split(':');await pg.keyboard.press(k);await new Promise(r=>setTimeout(r,1500));
  await pg.waitForFunction(()=>document.getElementById('load').hidden,{timeout:180000}).catch(()=>errs.push('timeout '+n));
  await new Promise(r=>setTimeout(r,+(process.env.W||4000)));const el=await pg.$('#aFig');await el.screenshot({path:`/workspace/hangar2/shots/a_${n}.png`});console.log('shot',n);}
console.log(errs.join('\n'));await b.close();})();
