const p=require('puppeteer-core');
(async()=>{const b=await p.launch({executablePath:'/usr/bin/google-chrome',headless:'new',protocolTimeout:600000,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const pg=await b.newPage();await pg.setViewport({width:1280,height:900});const errs=[];pg.on('console',m=>{const t=m.text();if((m.type()==='error'||m.type()==='warning')&&!/404/.test(t))errs.push(t.slice(0,200));});pg.on('pageerror',e=>errs.push('PE '+e.message));
await pg.goto('http://localhost:8799/EasyWAR_hangar.html#garage',{timeout:180000});
for(const id of process.argv[2].split(',')){await pg.evaluate(i=>GAR.set(i),id);await pg.waitForFunction(i=>GAR.ready&&GAR.cur===i,{timeout:120000},id).catch(()=>errs.push('timeout '+id));
 console.log(id,await pg.evaluate(i=>{const S=GAR.models[i];return S.wheels.length+' tris:'+S.wheels.reduce((a,w)=>{let n=0;w.g.traverse(o=>{if(o.isMesh)n+=o.geometry.attributes.position.count/3;});return a+n;},0)},id));}
console.log('ERR',errs.join('|'));await b.close();})();
