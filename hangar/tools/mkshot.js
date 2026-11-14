const p=require('puppeteer-core');
(async()=>{const b=await p.launch({executablePath:'/usr/bin/google-chrome',headless:'new',protocolTimeout:600000,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const pg=await b.newPage();await pg.setViewport({width:1280,height:900});const errs=[];
pg.on('console',m=>{const t=m.text();if(m.type()==='error'||m.type()==='warning'||/rror/.test(t))errs.push(m.type()+': '+t.slice(0,300));});pg.on('pageerror',e=>errs.push('PAGEERR '+e.message));
await pg.goto('http://localhost:8799/EasyWAR_hangar.html#garage',{timeout:180000});
const out=process.env.OUT||'/tmp/mk';require('fs').mkdirSync(out,{recursive:true});
for(const id of process.argv[2].split(',')){await pg.evaluate(i=>GAR.set(i),id);await pg.waitForFunction(i=>GAR.ready&&GAR.cur===i,{timeout:120000},id).catch(e=>errs.push('timeout '+id));
  await pg.evaluate(()=>GAR.step(30));const views=[['a',-(Math.PI-.62),.12],['b',.62,.12],['s',-Math.PI/2,.05]];
  for(const [n,y,e] of views){await pg.evaluate((y,e)=>{GAR.holo=false;GAR.yaw=y;GAR.el=e;GAR.yawV=0;GAR.step(40);},y,e);await new Promise(r=>setTimeout(r,300));
    const bb=await (await pg.$('#gFig')).boundingBox();await pg.screenshot({path:`${out}/${id}_${n}.png`,clip:{x:bb.x,y:bb.y,width:bb.width,height:Math.min(bb.height,560)},captureBeyondViewport:false});}
  console.log('marks',id,await pg.evaluate(()=>{const S=GAR.models[GAR.cur];return S.marks?S.marks.length:-1;}));}
console.log(errs.join('\n'));await b.close();})();
