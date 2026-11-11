const p=require('puppeteer-core');
(async()=>{const b=await p.launch({executablePath:'/usr/bin/google-chrome',headless:'new',protocolTimeout:600000,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const pg=await b.newPage();await pg.setViewport({width:1280,height:900});
await pg.goto('http://localhost:8799/EasyWAR_hangar.html',{timeout:180000});
for(const k of ['Minus','BracketLeft']){await pg.keyboard.press(k);await new Promise(r=>setTimeout(r,1500));
await pg.waitForFunction(()=>document.getElementById('load').hidden,{timeout:180000});}
const r=await pg.evaluate(()=>{const o={};for(const k in __ST){const O=__ST[k];const B=new THREE.Box3().setFromObject(O.m);o[k]={s:O.m.scale.x,ry:O.m.rotation.y,p:O.m.position,vis:O.pv&&O.pv.visible,bmin:B.min,bmax:B.max};let n=0,meshes=[];O.m.traverse(q=>{if(q.isMesh){n++;if(meshes.length<4)meshes.push([q.name,q.geometry.attributes.position.array.constructor.name,q.geometry.attributes.position.normalized,q.scale.x.toFixed(4),q.matrixWorld.elements[0].toFixed(4)]);}});o[k].n=n;o[k].meshes=meshes;}return o;});
console.log(JSON.stringify(r,null,0));await b.close();})();
