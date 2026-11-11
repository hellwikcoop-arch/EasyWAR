const p=require('puppeteer-core');
(async()=>{const b=await p.launch({executablePath:'/usr/bin/google-chrome',headless:'new',args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const pg=await b.newPage();await pg.goto('http://localhost:8799/EasyWAR_hangar.html#garage',{timeout:180000});
for(const id of process.argv[2].split(',')){await pg.evaluate(i=>GAR.set(i),id);await pg.waitForFunction(i=>GAR.ready&&GAR.cur===i,{timeout:120000},id);
console.log(id,await pg.evaluate(()=>{const S=GAR.models[GAR.cur],seat=S.seat;seat.updateMatrixWorld(true);const inv=new THREE.Matrix4().copy(seat.matrixWorld).invert();let m=null;seat.traverse(o=>{if(o.name==='model'||(!m&&o.parent===seat&&o.type==='Group'&&o.name!=='kb'))m=m||o;});const bb=new THREE.Box3().setFromObject(m).applyMatrix4(inv);return JSON.stringify([bb.min.toArray().map(v=>+v.toFixed(2)),bb.max.toArray().map(v=>+v.toFixed(2))]);}));}
await b.close();})();
