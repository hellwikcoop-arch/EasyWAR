// node tools/kbray.js id [dx] : top-surface heights + side half-width in kb coords (x from nose, y up, z centred)
const p=require('puppeteer-core');
(async()=>{const b=await p.launch({executablePath:'/usr/bin/google-chrome',headless:'new',protocolTimeout:600000,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const pg=await b.newPage();await pg.goto('http://localhost:8799/EasyWAR_hangar.html#garage',{timeout:180000});
const id=process.argv[2],dx=+(process.argv[3]||.3);await pg.evaluate(i=>GAR.set(i),id);await pg.waitForFunction(i=>GAR.ready&&GAR.cur===i,{timeout:120000},id);
console.log(await pg.evaluate((dx)=>{const T=THREE,S=GAR.models[GAR.cur],seat=S.seat;seat.updateMatrixWorld(true);const inv=new T.Matrix4().copy(seat.matrixWorld).invert();
 const ms=[];const all=new T.Box3();seat.traverse(o=>{if(!o.isMesh)return;let q=o;while(q){if(q.name==='kb'||q.userData.mk)return;q=q.parent;}ms.push(o);all.union(new T.Box3().setFromObject(o).applyMatrix4(inv));});
 const X0=all.max.x,Y0=all.min.y,Z0=(all.min.z+all.max.z)/2,L=all.max.x-all.min.x,H=all.max.y-all.min.y,W=all.max.z-all.min.z;
 const rc=new T.Raycaster();const M=seat.matrixWorld;const w=(x,y,z)=>new T.Vector3(X0-x,Y0+y,Z0+z).applyMatrix4(M);
 const dir=(a,b)=>b.clone().sub(a).normalize();
 const hit=(a,b)=>{rc.set(a,dir(a,b));rc.far=a.distanceTo(b);const h=rc.intersectObjects(ms,false)[0];return h?h.point.applyMatrix4(inv):null;};
 const f=v=>v==null?' -- ':v.toFixed(2).padStart(5);let out='L '+L.toFixed(2)+' H '+H.toFixed(2)+' W '+W.toFixed(2)+'\nTOP y at z:   ';const zs=[-1.3,-1.0,-.6,-.3,0,.3,.6,1.0,1.3];out+=zs.map(f).join('')+'\n';
 for(let x=0;x<=L+1e-3;x+=dx){out+='x'+f(x)+'      ';for(const z of zs){const h=hit(w(x,H+1,z),w(x,-1,z));out+=f(h?h.y-Y0:null);}out+='\n';}
 const ys=[.3,.6,.9,1.2,1.5,1.8,2.1,2.4,2.7,3.0];out+='SIDE +z half-width at y:'+ys.map(f).join('')+'\n';
 for(let x=0;x<=L+1e-3;x+=dx){out+='x'+f(x)+'                 ';for(const y of ys){const h=hit(w(x,y,W),w(x,y,0));out+=f(h?h.z-Z0:null);}out+='\n';}
 return out;},dx));await b.close();})();
