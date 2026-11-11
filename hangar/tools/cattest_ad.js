const p=require('puppeteer-core');
(async()=>{const b=await p.launch({executablePath:'/usr/bin/google-chrome',headless:'new',protocolTimeout:600000,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const pg=await b.newPage();await pg.setViewport({width:1280,height:900});const errs=[];
pg.on('console',m=>{const t=m.text();if((m.type()==='error'||m.type()==='warning')&&!/404/.test(t))errs.push(m.type()+': '+t.slice(0,300));});
pg.on('pageerror',e=>errs.push('PAGEERR '+e.message));
await pg.goto('http://localhost:8799/EasyWAR_hangar.html#garage',{timeout:180000});
await pg.waitForFunction(()=>window.GAR&&GAR.ready,{timeout:180000});
const res={};
for(const c of ['ad']){await pg.evaluate(c=>GAR.setCat(c),c);await new Promise(r=>setTimeout(r,1500));
 res[c]=await pg.evaluate(()=>[...document.querySelectorAll('.chip')].filter(e=>e.offsetParent&&e.closest('#gCats')==null&&e.closest('.g-cats')==null).map(e=>e.textContent.trim()).join(' | '));
 if(c==='ad'){await pg.waitForFunction(()=>GAR.ready,{timeout:120000});await new Promise(r=>setTimeout(r,2500));await pg.screenshot({path:'/workspace/hangar2/shots/cat/ad/garage_cat_ad.png'});}}
console.log(JSON.stringify(res,null,1));console.log('ERR',errs.join('|'));await b.close();})();
