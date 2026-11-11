const p=require('puppeteer-core');
(async()=>{const b=await p.launch({executablePath:'/usr/bin/google-chrome',headless:'new',protocolTimeout:600000,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const pg=await b.newPage();pg.on('pageerror',e=>console.log('PE',e.message));
await pg.goto('http://localhost:8799/EasyWAR_hangar.html#garage',{timeout:180000});await pg.waitForFunction(()=>window.GAR&&GAR.ready,{timeout:180000});
for(const id of process.argv[2].split(',')){
console.log(id,await pg.evaluate(async i=>{const D=GV[i];const gl=await loadGlb(D.file);const seat=new THREE.Group(),model=new THREE.Group();seat.add(model);model.add(gl.scene);const R=D.tf.R,s=D.tf.s;model.applyMatrix4(new THREE.Matrix4().set(R[0][0]*s,R[0][1]*s,R[0][2]*s,0,R[1][0]*s,R[1][1]*s,R[1][2]*s,0,R[2][0]*s,R[2][1]*s,R[2][2]*s,0,0,0,0,1));
 const I=wheelIslands(seat,model,{r0:.15,r1:.6});return JSON.stringify({y0:I.y0.toFixed(2),cz:I.cz.toFixed(2),n:I.cl.length,cl:I.cl.filter(q=>q.z>I.cz).sort((a,b)=>a.x-b.x).map(q=>[q.x.toFixed(2),q.y.toFixed(2),q.r.toFixed(2),q.n,q.za.toFixed(2),q.zb.toFixed(2)].join(' '))});},id));}
await b.close();})();
