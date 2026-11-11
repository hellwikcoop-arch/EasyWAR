const p=require('puppeteer-core');
(async()=>{const b=await p.launch({executablePath:'/usr/bin/google-chrome',headless:'new',protocolTimeout:600000,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--allow-file-access-from-files']});
const pg=await b.newPage();await pg.setViewport({width:1280,height:900});const errs=[];await pg.setOfflineMode(true);
pg.on('pageerror',e=>errs.push('PE '+e.message));pg.on('console',m=>{if(m.type()==='error'||m.type()==='warning')errs.push(m.type()+' '+m.text().slice(0,200))});
await pg.goto('file:///workspace/hangar2/EasyWAR_hangar.html',{timeout:180000});
for(const k of ['KeyW','Equal','BracketLeft']){await pg.keyboard.press(k);await new Promise(r=>setTimeout(r,1500));await pg.waitForFunction(()=>document.getElementById('load').hidden,{timeout:120000}).catch(()=>errs.push('to '+k));}
await pg.keyboard.press('Backquote');await pg.waitForFunction(()=>window.GAR&&GAR.ready,{timeout:120000}).catch(()=>errs.push('gar'));
await pg.evaluate(()=>GAR.set('marder'));await pg.waitForFunction(()=>GAR.ready&&GAR.cur==='marder',{timeout:120000}).catch(()=>errs.push('marder'));
await pg.keyboard.press('Backquote');await new Promise(r=>setTimeout(r,2000));
console.log('fonts',await pg.evaluate(()=>document.fonts.check('16px "Exo 2"')),'ERRS:',errs.join(' | '));await b.close();})();
