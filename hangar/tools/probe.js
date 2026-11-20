const p=require('puppeteer-core');
(async()=>{const b=await p.launch({executablePath:'/usr/bin/google-chrome',headless:'new',protocolTimeout:600000,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const pg=await b.newPage();await pg.setViewport({width:1280,height:900});pg.on('pageerror',e=>console.log('PAGEERR '+e.message));
await pg.goto('http://localhost:8799/EasyWAR_hangar.html',{timeout:180000});
await pg.waitForFunction(()=>document.getElementById('load').hidden,{timeout:180000});
await pg.keyboard.press(process.argv[3]);await pg.waitForFunction(k=>window.__ST[k]&&window.__ST[k].ready,{timeout:120000},process.argv[2]);
const r=await pg.evaluate(k=>{const O=__ST[k];const T=THREE;O.pv.updateMatrixWorld(true);const inv=new T.Matrix4().copy(O.pv.matrixWorld).invert();const v=new T.Vector3();const P=[];
 O.m.traverse(o=>{if(!o.isMesh)return;const a=o.geometry.attributes.position;const m=new T.Matrix4().multiplyMatrices(inv,o.matrixWorld);const dn=a.normalized?({Int8Array:127,Uint8Array:255,Int16Array:32767,Uint16Array:65535})[a.array.constructor.name]||1:1;for(let i=0;i<a.count;i+=1){v.fromBufferAttribute(a,i).multiplyScalar(1/dn).applyMatrix4(m);P.push([v.x,v.y,v.z]);}});
 const bb=[[1e9,-1e9],[1e9,-1e9],[1e9,-1e9]];P.forEach(p=>{for(let j=0;j<3;j++){bb[j][0]=Math.min(bb[j][0],p[j]);bb[j][1]=Math.max(bb[j][1],p[j]);}});
 // trailing edge per z slice (z>0 side): min x, and y at it; leading edge max x
 const sl={};P.forEach(p=>{if(p[2]<0)return;const k=Math.round(p[2]*2)/2;const s=sl[k]||(sl[k]={te:1e9,le:-1e9,yte:0,ymin:1e9,ymax:-1e9,n:0});s.n++;if(p[0]<s.te){s.te=p[0];s.yte=p[1];}if(p[0]>s.le)s.le=p[0];s.ymin=Math.min(s.ymin,p[1]);s.ymax=Math.max(s.ymax,p[1]);});
 const out={};Object.keys(sl).sort((a,b)=>a-b).forEach(k=>{const s=sl[k];out[k]=[+s.te.toFixed(2),+s.le.toFixed(2),+s.yte.toFixed(2),+s.ymin.toFixed(2),+s.ymax.toFixed(2),s.n];});
 // vertical tail: points with |z|<.3, y high: per y slice te/le
 const vt={};P.forEach(p=>{if(Math.abs(p[2])>.4)return;const k=Math.round(p[1]*2)/2;const s=vt[k]||(vt[k]={te:1e9,le:-1e9});s.te=Math.min(s.te,p[0]);s.le=Math.max(s.le,p[0]);});
 const vo={};Object.keys(vt).sort((a,b)=>a-b).forEach(k=>vo[k]=[+vt[k].te.toFixed(2),+vt[k].le.toFixed(2)]);
 return {n:P.length,bb,out,vo,mpos:O.m.position,pvpos:O.pv.position};},process.argv[2]);
console.log(JSON.stringify(r));await b.close();})();
