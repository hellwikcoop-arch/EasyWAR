const p=require('puppeteer-core');
(async()=>{const b=await p.launch({executablePath:'/usr/bin/google-chrome',headless:'new',protocolTimeout:600000,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const pg=await b.newPage();await pg.setViewport({width:1280,height:900});
await pg.goto('http://localhost:8799/EasyWAR_hangar.html#garage',{timeout:180000});
const id=process.argv[2]||'himars';await pg.evaluate(i=>GAR.set(i),id);await pg.waitForFunction(i=>GAR.ready&&GAR.cur===i,{timeout:120000},id);await pg.evaluate(()=>GAR.step(80));
console.log(await pg.evaluate((xs)=>{const S=GAR.models[GAR.cur];const out=[];const rc=new THREE.Raycaster();
 for(const x of xs){rc.set(new THREE.Vector3(x,8,0.3),new THREE.Vector3(0,-1,0));const h=rc.intersectObject(S.seat,true).filter(coVis).slice(0,3);out.push(x+': '+h.map(q=>(q.object.name||q.object.parent.name||'?')+'@'+q.point.y.toFixed(2)).join(' | '));}
 return out.join('\n');},[-3.5,-3,-2,-1,0,1,2,3,3.8]));
await b.close();})();
