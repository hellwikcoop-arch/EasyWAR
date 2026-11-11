const p=require('puppeteer-core');const {PNG}=(()=>{try{return require('pngjs')}catch(e){return {}}})();
(async()=>{const b=await p.launch({executablePath:'/usr/bin/google-chrome',headless:'new',protocolTimeout:600000,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const pg=await b.newPage();await pg.setViewport({width:1280,height:900});
await pg.goto('http://localhost:8799/EasyWAR_hangar.html#garage',{timeout:180000});const id=process.argv[2];
await pg.evaluate(i=>GAR.set(i),id);await pg.waitForFunction(i=>GAR.ready&&GAR.cur===i,{timeout:120000},id);
await pg.evaluate(()=>{GAR.step(30);GAR.holo=false;GAR.yaw=-Math.PI/2;GAR.el=.05;GAR.yawV=0;GAR.step(40);});await new Promise(r=>setTimeout(r,300));
const r=await pg.evaluate(()=>{const c=GAR.renderer.domElement;const gl=GAR.renderer.getContext();GAR.renderer.render(GAR.scene,GAR.camera);const w=gl.drawingBufferWidth,h=gl.drawingBufferHeight;const px=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,px);
 const hits=[];for(let y=0;y<h;y+=2)for(let x=0;x<w;x+=2){const i=(y*w+x)*4;const R=px[i],G=px[i+1],B=px[i+2];if(R>90&&R>G*1.7&&R>B*1.5)hits.push([x,h-1-y]);}
 const T=THREE,rc=new T.Raycaster(),S=GAR.models[GAR.cur];const res={};
 for(const [x,y] of hits){rc.setFromCamera(new T.Vector2(x/w*2-1,-(y/h*2-1)),GAR.camera);const it=rc.intersectObject(S.root||S.seat||GAR.scene,true)[0];if(!it)continue;const k=(it.object.name||'?')+'|'+(it.object.material&&it.object.material.name)+'|'+(it.object.material&&it.object.material.map?'map':'nomap');res[k]=res[k]||[];if(it.uv)res[k].push([+it.uv.x.toFixed(3),+it.uv.y.toFixed(3)]);}
 const o={};for(const k in res)o[k]=[res[k].length,res[k].slice(0,4)];return {w,h,n:hits.length,o};});
console.log(JSON.stringify(r,null,1));await b.close();})();
