const p=require('puppeteer-core');
(async()=>{const b=await p.launch({executablePath:'/usr/bin/google-chrome',headless:'new',protocolTimeout:600000,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const pg=await b.newPage();await pg.setViewport({width:1600,height:1000});
await pg.goto('http://localhost:8799/EasyWAR_hangar.html#garage',{timeout:180000});await pg.waitForFunction(()=>GAR.ready,{timeout:120000});
for(const id of process.argv[2].split(',')){await pg.evaluate(i=>GAR.set(i),id);await pg.waitForFunction(i=>GAR.ready&&GAR.cur===i,{timeout:120000},id);
 const r=await pg.evaluate(()=>{GAR.holo=false;GAR.yaw=-Math.PI/2;GAR.el=0;GAR.zoom=.8;GAR.step(90);GAR.yaw=-Math.PI/2;GAR.yawV=0;GAR.models[GAR.cur].wheels.forEach(w=>w.g.rotation.z=.7);GAR.step(2);window.__NW=GAR.models[GAR.cur].wheels.length;const S=GAR.models[GAR.cur],c=GAR.camera,W=GAR.renderer.domElement.clientWidth,H=GAR.renderer.domElement.clientHeight;
  const pr=(x,y)=>{const v=new THREE.Vector3(x,y,S.wbox.max.z).project(c);return [Math.round((v.x*.5+.5)*W),Math.round((-v.y*.5+.5)*H)]};return {nw:GAR.models[GAR.cur].wheels.length,W,H,a:pr(S.wbox.min.x,0),b:pr(S.wbox.max.x,0),y1:pr(0,1),wb:S.wbox,seat:S.seat.position}});
 console.log(id,JSON.stringify(r));const e=await pg.$('#gStage');await e.screenshot({path:`/tmp/side_${id}.png`});}
await b.close();})();
