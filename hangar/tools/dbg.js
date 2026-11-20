const p=require('puppeteer-core');
(async()=>{const b=await p.launch({executablePath:'/usr/bin/google-chrome',headless:'new',args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const pg=await b.newPage();pg.on('console',m=>console.log('C',m.text()));pg.on('pageerror',e=>console.log('PE',e.message));pg.on('requestfailed',r=>console.log('RF',r.url()));
await pg.goto(process.argv[2]);await new Promise(r=>setTimeout(r,8000));console.log(await pg.title());await pg.screenshot({path:'/tmp/dbg.png'});await b.close();})();
