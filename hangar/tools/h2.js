const p=require('puppeteer-core');
(async()=>{const b=await p.launch({executablePath:'/usr/bin/google-chrome',headless:'new',protocolTimeout:600000,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const pg=await b.newPage();await pg.setViewport({width:1280,height:900});
await pg.goto('http://localhost:8799/EasyWAR_hangar.html',{timeout:180000});
await pg.keyboard.press('BracketLeft');await new Promise(r=>setTimeout(r,1500));
await pg.waitForFunction(()=>document.getElementById('load').hidden,{timeout:180000});
await pg.mouse.move(640,300);for(let i=0;i<12;i++){await pg.mouse.wheel({deltaY:300});await new Promise(r=>setTimeout(r,100));}
await new Promise(r=>setTimeout(r,3000));const el=await pg.$('#aFig');await el.screenshot({path:'/tmp/an1.png'});
await b.close();})();
