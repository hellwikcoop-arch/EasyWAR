// prints per-material bbox in kb coords (x from nose, y from ground, z centred)
const p=require('puppeteer-core');
(async()=>{const b=await p.launch({executablePath:'/usr/bin/google-chrome',headless:'new',args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const pg=await b.newPage();await pg.goto('http://localhost:8799/EasyWAR_hangar.html#garage',{timeout:180000});
for(const id of process.argv[2].split(',')){await pg.evaluate(i=>GAR.set(i),id);await pg.waitForFunction(i=>GAR.ready&&GAR.cur===i,{timeout:120000},id);
console.log(id,await pg.evaluate(()=>{const S=GAR.models[GAR.cur],seat=S.seat;seat.updateMatrixWorld(true);const inv=new THREE.Matrix4().copy(seat.matrixWorld).invert();
 const all=new THREE.Box3();const per={};seat.traverse(o=>{if(!o.isMesh||o.parent&&o.parent.name==='kb')return;let p=o;while(p){if(p.name==='kb'||p.userData.mk)return;p=p.parent;}const bb=new THREE.Box3().setFromObject(o).applyMatrix4(inv);const k=(o.material&&o.material.name)||o.name;per[k]=per[k]?per[k].union(bb):bb;all.union(bb);});
 const X0=all.max.x,Y0=all.min.y,Z0=(all.min.z+all.max.z)/2;const f=v=>v.toFixed(2);
 return 'ALL L'+f(all.max.x-all.min.x)+' H'+f(all.max.y-all.min.y)+' W'+f(all.max.z-all.min.z)+'\n'+Object.entries(per).map(([k,bb])=>'  '+k.slice(0,40)+' x '+f(X0-bb.max.x)+'..'+f(X0-bb.min.x)+' y '+f(bb.min.y-Y0)+'..'+f(bb.max.y-Y0)+' z '+f(bb.min.z-Z0)+'..'+f(bb.max.z-Z0)).join('\n');}));}
await b.close();})();
