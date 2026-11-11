// node tools/kshot.js outdir id1,id2 [views] ; views "yaw:el:zoom;..." ; output outdir/<id>_<k>.png (scene only, no HUD callouts)
const p=require('puppeteer-core');
(async()=>{const b=await p.launch({executablePath:'/usr/bin/google-chrome',headless:'new',protocolTimeout:600000,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const pg=await b.newPage();await pg.setViewport({width:1280,height:900});const errs=[];
pg.on('console',m=>{const t=m.text();if((m.type()==='error'||/rror/.test(t))&&!/404/.test(t))errs.push(m.type()+': '+t.slice(0,300));});
pg.on('pageerror',e=>errs.push('PAGEERR '+e.message));
const out=process.argv[2],ids=process.argv[3].split(',');const V=(process.argv[4]||'d:.12:1;-1.2:.3:.8;2.4:.2:.85').split(';');
await pg.goto('http://localhost:8799/EasyWAR_hangar.html'+(process.env.HASH||'#garage'),{timeout:180000});
for(const id of ids){await pg.evaluate(i=>GAR.set(i),id);await pg.waitForFunction(i=>GAR.ready&&GAR.cur===i,{timeout:120000},id).catch(e=>errs.push('timeout '+id));
  await pg.evaluate(()=>{GAR.holo=false;const h=document.getElementById('gHolo');if(h)h.style.visibility='hidden';});
  let k=0;for(const v of V){const [y,e,z]=v.split(':');await pg.evaluate((y,e,z)=>{GAR.yawV=0;if(y!=='d')GAR.yaw=+y;else GAR.yaw=GAR.yaw;GAR.el=+e;GAR.zoom=+z;GAR.camD=null;},y,e,z);
    if(y==='d')await pg.evaluate(()=>{});
    await pg.evaluate(n=>GAR.step(n),40);await new Promise(r=>setTimeout(r,300));
    const bb=await (await pg.$('#gFig')).boundingBox();await pg.screenshot({path:`${out}/${id}_${'abcdefgh'[k++]}.png`,clip:{x:bb.x,y:bb.y,width:bb.width,height:Math.min(bb.height,bb.width*.45)}});}}
console.log('ERR',errs.join('\n'));await b.close();})();
