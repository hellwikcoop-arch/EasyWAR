const p=require('puppeteer-core');
(async()=>{const b=await p.launch({executablePath:'/usr/bin/google-chrome',headless:'new',args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const pg=await b.newPage();await pg.setViewport({width:1280,height:900});await pg.goto('http://localhost:8799/EasyWAR_hangar.html#garage',{timeout:180000});
const [id,mode,fx,fy]=process.argv.slice(2);await pg.evaluate(i=>GAR.set(i),id);await pg.waitForFunction(i=>GAR.ready&&GAR.cur===i,{timeout:120000},id);
if(mode!=='-')await pg.evaluate(m=>GAR.setMode(m),mode);await pg.evaluate(()=>GAR.step(20));
console.log(await pg.evaluate((fx,fy)=>{const fig=document.querySelector('#gFig').getBoundingClientRect(),c=GAR.renderer.domElement.getBoundingClientRect();const x=fig.left+fx*fig.width,y=fig.top+fy*fig.height;
 const v=new THREE.Vector2((x-c.left)/c.width*2-1,-((y-c.top)/c.height*2-1));const rc=new THREE.Raycaster();rc.setFromCamera(v,GAR.camera);const h=rc.intersectObject(GAR.scene,true).slice(0,4);
 return h.map(i=>{let p=i.object,ch=[];while(p){ch.push(p.name||p.type);p=p.parent;}return i.distance.toFixed(1)+' '+ch.join('<')+' mat '+(i.object.material&&i.object.material.name);}).join('\n');},+fx,+fy));await b.close();})();
