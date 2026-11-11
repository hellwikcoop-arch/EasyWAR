const p=require('puppeteer-core');
(async()=>{const b=await p.launch({executablePath:'/usr/bin/google-chrome',headless:'new',args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const ks=process.argv.slice(2);for(const k of ks){const pg=await b.newPage();await pg.setViewport({width:800,height:500});
pg.on('console',m=>{if(/ERR|rror/.test(m.text()))console.log(k,m.text())});
await pg.goto('http://localhost:8799/thumb.html?m='+(process.env.M||.75)+'&sx='+(process.env.SX||1.1)+'&k='+k);try{await pg.waitForFunction('window.DONE||document.title.startsWith("ERR")',{timeout:120000});}catch(e){console.log(k,'timeout')}
console.log(k,await pg.title());await pg.screenshot({path:'/workspace/hangar2/shots/thumb_'+k.split('/').pop()+'.png'});await pg.close();}
await b.close();})();
