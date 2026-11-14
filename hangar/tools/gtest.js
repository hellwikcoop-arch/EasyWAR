const p=require('puppeteer-core');
(async()=>{const b=await p.launch({executablePath:'/usr/bin/google-chrome',headless:'new',protocolTimeout:600000,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const pg=await b.newPage();await pg.setViewport({width:1280,height:900});const errs=[];
pg.on('console',m=>{const t=m.text();if(m.type()==='error'||m.type()==='warning'||/rror/.test(t))errs.push(m.type()+': '+t.slice(0,300));});
pg.on('pageerror',e=>errs.push('PAGEERR '+e.message));
await pg.goto('http://localhost:8799/EasyWAR_hangar.html#garage',{timeout:180000});
const ids=(process.argv[2]||'himars').split(',');const mode=process.argv[3]||'';
for(const id of ids){await pg.evaluate(i=>GAR.set(i),id);
  await pg.waitForFunction(i=>GAR.ready&&GAR.cur===i,{timeout:120000},id).catch(e=>errs.push('timeout '+id));
  if(mode)await pg.evaluate(m=>GAR.setMode(m),mode);
  await pg.evaluate(n=>GAR.step(n),+(process.env.N||60));
  await new Promise(r=>setTimeout(r,500));
  const bb=await (await pg.$('#gFig')).boundingBox();await pg.screenshot({path:`/workspace/hangar2/shots/g_${id}${mode?'_'+mode:''}.png`,clip:bb,captureBeyondViewport:false});console.log('shot',id,JSON.stringify(await pg.evaluate(()=>[...document.querySelectorAll('#gHolo .hc')].map(e=>e.className+':'+Math.round(e.getBoundingClientRect().left)+'/'+e.style.transform))));}
console.log(errs.join('\n'));await b.close();})();
