/* ---------- завантаження техніки ---------- */
function dequant(g){for(const k in g.attributes){const a=g.attributes[k];const arr=a.isInterleavedBufferAttribute?a.data.array:a.array;
  if(arr instanceof Float32Array&&!a.isInterleavedBufferAttribute&&!a.normalized)continue;const n=a.count,s=a.itemSize,o=new Float32Array(n*s);
  const div=a.normalized?(arr instanceof Int8Array?127:arr instanceof Uint8Array?255:arr instanceof Int16Array?32767:arr instanceof Uint16Array?65535:1):1;
  const get=[a.getX,a.getY,a.getZ,a.getW];for(let i=0;i<n;i++)for(let j=0;j<s;j++){const v=get[j].call(a,i);o[i*s+j]=a.normalized?Math.max(v/div,-1):v;}
  g.setAttribute(k,new T.BufferAttribute(o,s));}
  if(g.attributes.normal&&k0(g))g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();}
function k0(){return false;}
function b64buf(b){const s=atob(b),u=new Uint8Array(s.length);for(let i=0;i<s.length;i++)u[i]=s.charCodeAt(i);return u.buffer;}
function loadGlb(file){return new Promise((res,rej)=>{const L=new T.GLTFLoader();L.setMeshoptDecoder(MeshoptDecoder);
  const src=window.__GLB&&window.__GLB['g:'+file];
  if(src){L.parse(b64buf(src),'',res,rej);return;}
  const key='g_'+file,D0=window.__GLBD||{};const go=()=>{const s=(window.__GLBD||{})[key];if(s){L.parse(b64buf(s),'',res,rej);delete window.__GLBD[key];}else rej(new Error('model '+file));};
  if(D0[key]){go();return;}const sc=document.createElement('script');sc.src='models/'+key+'.js';sc.onload=go;sc.onerror=()=>L.load('glb/'+file+'.glb',res,undefined,rej);document.head.append(sc);});}
function camoTex(base){return tex(cv(512,512,(x,w,h)=>{const c=new T.Color(base);x.fillStyle='#'+c.getHexString();x.fillRect(0,0,w,h);
  const cols=['rgba(40,44,28,.55)','rgba(98,92,62,.45)','rgba(24,26,18,.5)'];for(let i=0;i<34;i++){x.fillStyle=cols[i%3];x.beginPath();const cx=rnd(0,w),cy=rnd(0,h),r=rnd(30,90);
    for(let a=0;a<6.28;a+=.5){const rr=r*rnd(.55,1.1);x.lineTo(cx+Math.cos(a)*rr,cy+Math.sin(a)*rr*.6);}x.fill();}speck(x,w,h,9000,.12,0,160);blot(x,w,h,12,'rgba(70,58,40,.35)',20,70);}),[2,2]);}
const WRE=/tyre|tire|wheel|rim|bolt|hub|road|idler|sprock|колес/i;
function splitWheels(seat,model,centers){seat.updateMatrixWorld(true);const out=[];const inv=new T.Matrix4().copy(seat.matrixWorld).invert();
  const groups=centers.map(c=>{const g=new T.Group();g.position.copy(c.p);model.parent.add(g);out.push({g,r:c.r});return g;});
  const meshes=[];model.traverse(o=>{if(o.isMesh&&!o.isSkinnedMesh&&o.geometry&&!o.morphTargetInfluences)meshes.push(o);});
  const named=meshes.filter(o=>WRE.test(o.name)||WRE.test(o.parent&&o.parent.name||''));const list=named.length?named:meshes;
  const m=new T.Matrix4(),nm=new T.Matrix3(),va=new T.Vector3(),vb=new T.Vector3(),vc=new T.Vector3(),ce=new T.Vector3();
  list.forEach(o=>{let g=o.geometry;if(g.index)g=g.toNonIndexed();m.multiplyMatrices(inv,o.matrixWorld);const P=g.attributes.position,n=P.count/3;
    const own=new Int16Array(n).fill(-1);let any=0;
    for(let t=0;t<n;t++){va.fromBufferAttribute(P,t*3).applyMatrix4(m);vb.fromBufferAttribute(P,t*3+1).applyMatrix4(m);vc.fromBufferAttribute(P,t*3+2).applyMatrix4(m);ce.copy(va).add(vb).add(vc).multiplyScalar(1/3);
      for(let w=0;w<centers.length;w++){const c=centers[w];if(Math.abs(ce.z-c.p.z)<c.hw&&Math.hypot(ce.x-c.p.x,ce.y-c.p.y)<c.r*1.04){if(c.trk){const lim=c.r*.96;if(Math.hypot(va.x-c.p.x,va.y-c.p.y)>lim||Math.hypot(vb.x-c.p.x,vb.y-c.p.y)>lim||Math.hypot(vc.x-c.p.x,vc.y-c.p.y)>lim)continue;}own[t]=w;any++;break;}}}
    if(!any)return;
    const keys=Object.keys(g.attributes);const mk=(sel)=>{const ng=new T.BufferGeometry();let cnt=0;for(let t=0;t<n;t++)if(sel(own[t]))cnt++;if(!cnt)return null;
      keys.forEach(k=>{const a=g.attributes[k],s=a.itemSize,src=a.array,dst=new src.constructor(cnt*3*s);let j=0;for(let t=0;t<n;t++)if(sel(own[t])){dst.set(src.subarray(t*3*s,t*3*s+3*s),j);j+=3*s;}ng.setAttribute(k,new T.BufferAttribute(dst,s,a.normalized));});return ng;};
    const rest=mk(w=>w<0);
    for(let w=0;w<centers.length;w++){const ng=mk(q=>q===w);if(!ng)continue;nm.getNormalMatrix(m);ng.applyMatrix4(m);ng.translate(-centers[w].p.x,-centers[w].p.y,-centers[w].p.z);
      const wm=new T.Mesh(ng,o.material);wm.castShadow=wm.receiveShadow=true;groups[w].add(wm);}
    if(rest){rest.computeBoundingBox();o.geometry=rest;}else o.visible=false;});
  return out.filter(w=>w.g.children.length);}
function wheelIslands(seat,model,A){seat.updateMatrixWorld(true);const inv=new T.Matrix4().copy(seat.matrixWorld).invert(),m=new T.Matrix4(),v=new T.Vector3();const C=[];let y0=1e9,zmn=1e9,zmx=-1e9;
  const meshes=[];model.traverse(o=>{if(o.isMesh&&o.geometry&&o.visible)meshes.push(o);});
  meshes.forEach(o=>{m.multiplyMatrices(inv,o.matrixWorld);const g=o.geometry,a=g.attributes.position,nv=a.count;const X=new Float32Array(nv*3);for(let i=0;i<nv;i++){v.fromBufferAttribute(a,i).applyMatrix4(m);X[i*3]=v.x;X[i*3+1]=v.y;X[i*3+2]=v.z;if(v.y<y0)y0=v.y;if(v.z<zmn)zmn=v.z;if(v.z>zmx)zmx=v.z;}
    // weld by position then union-find over triangles
    const key=new Map(),rep=new Int32Array(nv);for(let i=0;i<nv;i++){const k=Math.round(X[i*3]*500)+','+Math.round(X[i*3+1]*500)+','+Math.round(X[i*3+2]*500);let r=key.get(k);if(r===undefined){r=i;key.set(k,i);}rep[i]=r;}
    const par=new Int32Array(nv);for(let i=0;i<nv;i++)par[i]=i;const f=x=>{while(par[x]!==x){par[x]=par[par[x]];x=par[x];}return x;};const u=(a,b)=>{a=f(a);b=f(b);if(a!==b)par[a]=b;};
    const idx=g.index?g.index.array:null,nt=idx?idx.length/3:nv/3;for(let t=0;t<nt;t++){const a0=rep[idx?idx[t*3]:t*3],a1=rep[idx?idx[t*3+1]:t*3+1],a2=rep[idx?idx[t*3+2]:t*3+2];u(a0,a1);u(a1,a2);}
    const bb=new Map();for(let i=0;i<nv;i++){const r=f(rep[i]);let b=bb.get(r);if(!b){b=[1e9,1e9,1e9,-1e9,-1e9,-1e9,0];bb.set(r,b);}for(let k=0;k<3;k++){const q=X[i*3+k];if(q<b[k])b[k]=q;if(q>b[k+3])b[k+3]=q;}b[6]++;}
    bb.forEach(b=>C.push(b));});
  const W=zmx-zmn,cz=(zmn+zmx)/2,cand=[];
  C.forEach(b=>{const dx=b[3]-b[0],dy=b[4]-b[1],dz=b[5]-b[2],d=Math.max(dx,dy);if(b[6]<12||d<2*A.r0||d>2*A.r1||Math.abs(dx-dy)>.12*d||dz>Math.max(.55,d*.9))return;const x=(b[0]+b[3])/2,y=(b[1]+b[4])/2,z=(b[2]+b[5])/2;
    if(Math.abs(z-cz)<W*.22||y>y0+A.r1*1.7)return;cand.push({x,y,z,r:d/2,dz,za:b[2],zb:b[5]});});
  // cluster concentric islands, keep the largest per cluster
  const cl=[];cand.sort((a,b)=>b.r-a.r).forEach(c=>{const q=cl.find(q=>Math.abs(q.x-c.x)<.08&&Math.abs(q.y-c.y)<.08&&Math.sign(q.z-cz)===Math.sign(c.z-cz));if(q){q.za=Math.min(q.za,c.za);q.zb=Math.max(q.zb,c.zb);q.n++;}else cl.push(Object.assign({n:1},c));});
  return {y0,cz,W,cl};}
/* auto wheel finder: Hough circles on the side silhouette vertices (seat frame, front +x) */
function autoWheels(seat,model,D){const A=D.wauto==='trk'?{r0:.22,r1:.46,tk:1}:{r0:.38,r1:.72,tk:0};if(D.wr)Object.assign(A,{r0:D.wr[0],r1:D.wr[1]});
  {const I=wheelIslands(seat,model,window.__WDBG?{r0:.12,r1:.7}:A);if(window.__WDBG)D.__isl=I.cl.filter(q=>q.z>I.cz).sort((a,b)=>a.x-b.x).map(q=>[q.x,q.y,q.r,q.n,q.za,q.zb].map(x=>+x.toFixed(2)).join(' '));const side=I.cl.filter(q=>q.z>I.cz);if(side.length>=2){const rs=side.map(q=>q.r).sort((a,b)=>a-b);const low0=side.filter(q=>q.r>=A.r0&&q.r<=A.r1&&q.y-q.r<I.y0+.6);const base=low0.length?Math.min(...low0.map(q=>q.y-q.r)):0;const low=low0.filter(q=>q.y-q.r<base+(A.tk?.15:.045));const cnt=q=>low.filter(p=>Math.abs(p.r-q.r)<=Math.max(.03,q.r*.1)).length;const rm=low.length?low.slice().sort((a,b)=>cnt(b)-cnt(a)||b.r-a.r)[0].r:0;
    let L=low.filter(q=>Math.abs(q.r-rm)<=Math.max(.05,rm*.18)||(!A.tk&&cnt(q)>=2)).sort((a,b)=>a.x-b.x);L=L.filter((q,i)=>!L.some((p,j)=>j<i&&Math.abs(p.x-q.x)<p.r));
    if(L.length>=2){const zc=L.reduce((a,q)=>a+(q.za+q.zb)/2,0)/L.length-I.cz,hw=Math.min(.6,Math.max(.12,L.reduce((a,q)=>a+(q.zb-q.za)/2,0)/L.length+.05));
      D.__wh={src:'isl',y0:I.y0,list:L.map(q=>[+q.x.toFixed(3),+q.y.toFixed(3),+q.r.toFixed(3)]),zc:+zc.toFixed(3),hw:+hw.toFixed(3)};const out=[];
      L.forEach(q=>[-1,1].forEach(s=>out.push({p:new T.Vector3(q.x,q.y,I.cz+s*zc),r:q.r*1.03,hw,trk:A.tk})));return out;}}}
  seat.updateMatrixWorld(true);const inv=new T.Matrix4().copy(seat.matrixWorld).invert(),m=new T.Matrix4(),v=new T.Vector3();const P=[];let y0=1e9,zmx=-1e9,zmn=1e9;
  model.traverse(o=>{if(!o.isMesh||!o.geometry)return;m.multiplyMatrices(inv,o.matrixWorld);const a=o.geometry.attributes.position;const st=Math.max(1,Math.floor(a.count/60000));for(let i=0;i<a.count;i+=st){v.fromBufferAttribute(a,i).applyMatrix4(m);P.push(v.x,v.y,v.z);if(v.y<y0)y0=v.y;}});
  const n=P.length/3;const zs=[];for(let i=0;i<n;i++)if(P[i*3+1]<y0+1.2)zs.push(P[i*3+2]);zs.sort((a,b)=>a-b);zmn=zs[Math.floor(zs.length*.005)];zmx=zs[Math.floor(zs.length*.995)];const W=zmx-zmn;
  const res=.02,R=[];for(let r=A.r0;r<=A.r1+1e-6;r+=.02)R.push(r);const CY=[0,.03,.06,.09,.12,.15];
  let xmn=1e9,xmx=-1e9;const pts=[];for(let i=0;i<n;i++){const x=P[i*3],y=P[i*3+1],z=P[i*3+2];if(z<zmx-W*.3||y>y0+A.r1*2.3)continue;pts.push(x,y,z);if(x<xmn)xmn=x;if(x>xmx)xmx=x;}
  if(pts.length<60)return null;const NX=Math.ceil((xmx-xmn)/res)+2;
  const acc=new Float32Array(NX*R.length*CY.length);
  for(let i=0;i<pts.length;i+=3){const px=pts[i],py=pts[i+1];for(let ri=0;ri<R.length;ri++){const r=R[ri];for(let ci=0;ci<CY.length;ci++){const cy=y0+r+CY[ci],dy=py-cy;if(Math.abs(dy)>r)continue;const dx=Math.sqrt(r*r-dy*dy);
      for(const cx of [px-dx,px+dx]){const xi=Math.round((cx-xmn)/res);if(xi<0||xi>=NX)continue;acc[(ri*CY.length+ci)*NX+xi]+=1/r;}}}}
  // smooth along x, collapse cy by max
  const best=new Float32Array(NX),bri=new Int16Array(NX),bci=new Int16Array(NX);
  for(let ri=0;ri<R.length;ri++)for(let ci=0;ci<CY.length;ci++){const o=(ri*CY.length+ci)*NX;for(let x=1;x<NX-1;x++){const s=acc[o+x-1]*.5+acc[o+x]+acc[o+x+1]*.5;if(s>best[x]){best[x]=s;bri[x]=ri;bci[x]=ci;}}}
  let mx=0;for(let x=0;x<NX;x++)if(best[x]>mx)mx=best[x];const pk=[];
  const ord=[...best.keys()].sort((a,b)=>best[b]-best[a]);
  for(const x of ord){if(best[x]<mx*(D.wth||.42))break;const r=R[bri[x]],cx=xmn+x*res;if(pk.some(q=>Math.abs(q.x-cx)<(q.r+r)*.92))continue;pk.push({x:cx,y:y0+r+CY[bci[x]],r,s:best[x]});}
  if(!pk.length)return null;
  // keep the dominant radius family
  const rs=pk.slice(0,3).map(q=>q.r).sort((a,b)=>a-b),rm=rs[Math.floor(rs.length/2)];let W2=pk.filter(q=>Math.abs(q.r-rm)<=rm*.2);
  if(!A.tk)W2=W2.filter(q=>q.s>mx*.5);W2.sort((a,b)=>a.x-b.x);
  // side z of the wheel discs
  let zs2=[];for(let i=0;i<pts.length;i+=3){if(W2.some(q=>Math.hypot(pts[i]-q.x,pts[i+1]-q.y)<q.r*.95))zs2.push(pts[i+2]);}zs2.sort((a,b)=>a-b);
  const za=zs2.length?zs2[Math.floor(zs2.length*.05)]:zmx-W*.15,zb=zs2.length?zs2[Math.floor(zs2.length*.95)]:zmx;const zc=(za+zb)/2-(zmn+zmx)/2,hw=Math.max(.12,(zb-za)/2+.04);
  D.__wh={y0,W,list:W2.map(q=>[+q.x.toFixed(3),+q.y.toFixed(3),+q.r.toFixed(3)]),zc:+zc.toFixed(3),hw:+hw.toFixed(3)};
  const cz=(zmn+zmx)/2,out=[];W2.forEach(q=>[-1,1].forEach(s=>out.push({p:new T.Vector3(q.x,q.y,cz+s*zc),r:q.r*(A.tk?1:1.03),hw,trk:A.tk})));return out;}
function nodeBy(root,name){let f=null;root.traverse(o=>{if(!f&&o.name===name)f=o;});return f;}
G.pend={};function getModel(id){if(G.models[id])return Promise.resolve(G.models[id]);return G.pend[id]||(G.pend[id]=mkModel(id).finally(()=>delete G.pend[id]));}
async function mkModel(id){const D=GV[id];const gl=await loadGlb(D.file);
  const veh=new T.Group(),seat=new T.Group(),model=new T.Group();veh.add(seat);seat.add(model);model.add(gl.scene);
  if(D.hideMat){const rm=[];gl.scene.traverse(o=>{if(o.isMesh&&o.material&&D.hideMat.includes(o.material.name))rm.push(o);});rm.forEach(o=>o.parent.remove(o));}
  {const sk=[];gl.scene.updateMatrixWorld(true);gl.scene.traverse(o=>{if(o.isSkinnedMesh)sk.push(o);});sk.forEach(o=>{try{o.skeleton.update();const g=o.geometry.clone(),P=g.attributes.position,v=new T.Vector3();const np=new Float32Array(P.count*3);for(let i=0;i<P.count;i++){o.boneTransform(i,v);np[i*3]=v.x;np[i*3+1]=v.y;np[i*3+2]=v.z;}
    g.setAttribute('position',new T.BufferAttribute(np,3));g.deleteAttribute('skinIndex');g.deleteAttribute('skinWeight');g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();const bs=g.boundingSphere;if(!isFinite(bs.radius)||bs.radius*o.matrixWorld.getMaxScaleOnAxis()>50){o.parent.remove(o);return;}const m=new T.Mesh(g,o.material);m.name=o.name;m.position.copy(o.position);m.quaternion.copy(o.quaternion);m.scale.copy(o.scale);o.parent.add(m);o.parent.remove(o);}catch(e){console.warn('unskin',e);}});}
  if(D.tf){const R=D.tf.R,s=D.tf.s,t=D.tf.t;const m4=new T.Matrix4().set(R[0][0]*s,R[0][1]*s,R[0][2]*s,t[0],R[1][0]*s,R[1][1]*s,R[1][2]*s,t[1],R[2][0]*s,R[2][1]*s,R[2][2]*s,t[2],0,0,0,1);model.applyMatrix4(m4);}
  if(D.scale)model.scale.multiplyScalar(D.scale);
  const camo=D.paint?camoTex(D.paint):null,dark=std({color:0x1b1c1a,roughness:.85,metalness:.2});
  gl.scene.traverse(o=>{if(!o.isMesh)return;dequant(o.geometry);if(!o.geometry.attributes.normal)o.geometry.computeVertexNormals();if(D.flat)(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>{m.flatShading=true;m.needsUpdate=true;});o.castShadow=o.receiveShadow=true;
    if(camo){const big=(o.geometry.boundingSphere||{radius:1}).radius;o.material=/tyre|tire|wheel|rubber/i.test(o.name)?dark:std({map:camo,color:0xffffff,roughness:.72,metalness:.25});if(!o.geometry.attributes.uv)boxUV(o);}
    const ms=Array.isArray(o.material)?o.material:[o.material];ms.forEach(mm=>{if(!mm.isMeshStandardMaterial)return;mm.envMapIntensity=.85;if((D.bright||D.tint)&&!mm.__br){mm.__br=1;if(D.bright)mm.color.multiplyScalar(D.bright);if(D.tint)mm.color.multiply(new T.Color(D.tint[0],D.tint[1],D.tint[2]));}if(D.solid&&mm.map&&!mm.__sd){mm.__sd=1;mm.map=null;mm.color.setHex(D.solid);mm.needsUpdate=true;}if(D.nomip&&mm.map&&!mm.map.__nm){mm.map.__nm=1;mm.map.generateMipmaps=false;mm.map.minFilter=T.LinearFilter;mm.map.needsUpdate=true;}if(D.metal!=null&&mm.metalnessMap){mm.metalnessMap=null;mm.roughnessMap=null;mm.metalness=D.metal;mm.roughness=.72;mm.needsUpdate=true;}if(mm.roughness<.35&&!mm.transparent)mm.roughness=.45;if(mm.map)mm.map.anisotropy=8;});});
  veh.updateMatrixWorld(true);
  if(D.kb){try{const kg=kbBuild(D,seat,model);if(D.kbBox&&kg){model.attach(kg);veh.updateMatrixWorld(true);}}catch(e){console.warn('kb',id,e);}}
  let wheels=[];const rig=D.rig||{};const cs=[];
  if(rig.wheels){const w=rig.wheels;w.axles.forEach(x=>[-1,1].forEach(s=>cs.push({p:new T.Vector3(x,w.y,s*w.z),r:w.r,hw:(w.hw||.42)})));}
  if(rig.tracked)rig.tracked.forEach(([x,y,r])=>{const zz=D.trackZ||1.2;[-1,1].forEach(s=>cs.push({p:new T.Vector3(x,y,s*zz),r,hw:D.trackHW||.55,trk:1}));});
  if(!cs.length&&D.wauto&&!D.nospin){try{const aw=autoWheels(seat,model,D);if(aw)cs.push(...aw);}catch(e){console.warn('autoWheels',id,e);}}
  if(cs.length){try{wheels=splitWheels(seat,model,cs);}catch(e){console.warn('wheels',id,e);}}
  const box=new T.Box3().setFromObject(model);const c=box.getCenter(new T.Vector3());seat.rotation.y=PI;seat.position.set(c.x,-box.min.y,c.z);veh.updateMatrixWorld(true);const wbox=new T.Box3().setFromObject(seat);
  const S={id,D,veh,seat,model,wheels,box,wbox,L:Math.max(box.max.x-box.min.x,D.kb?wbox.max.x-wbox.min.x:0),W:Math.max(box.max.z-box.min.z,D.kb?wbox.max.z-wbox.min.z:0),H:Math.max(box.max.y-box.min.y,D.kb?wbox.max.y-wbox.min.y:0)};S.cOff=(wbox.min.x+wbox.max.x)/2-veh.position.x;S.cZ=(wbox.min.z+wbox.max.z)/2;try{kit(S);}catch(e){console.warn('kit',id,e);}try{gvMarks(S);}catch(e){console.warn('mk',id,e);}
  if(gl.animations&&gl.animations.length){S.mixer=new T.AnimationMixer(gl.scene);S.clip=gl.animations[0];S.act=S.mixer.clipAction(S.clip);S.act.clampWhenFinished=true;S.act.setLoop(T.LoopOnce,1);S.rest=[];gl.scene.traverse(o=>S.rest.push([o,o.position.clone(),o.quaternion.clone(),o.scale.clone()]));if(D.combat!=='hand'){S.act.play();S.act.paused=true;}
    S.park=D.clip?D.clip.raise[0]:0;if(D.combat!=='hand'){S.act.time=S.park;S.mixer.update(0);}}
  const tn=D.tel?nodeBy(gl.scene,D.tel.node):D.arm3d?nodeBy(gl.scene,D.arm3d.node):null;
  if(tn){tn.updateMatrixWorld(true);S.tel={n:tn,q:tn.quaternion.clone(),p:tn.position.clone(),pv:D.tel?new T.Vector3(D.tel.pivot[0],D.tel.pivot[1],tn.position.z):tn.position.clone(),elev:(D.tel?D.tel.elev:D.arm3d.elev)*PI/180};}
  const ao=new T.Mesh(new T.PlaneGeometry(1,1),new T.MeshBasicMaterial({map:G.aoTex,transparent:true,depthWrite:false,opacity:.9}));ao.rotation.x=-PI/2;ao.scale.set(S.L*1.25,S.W*1.7,1);ao.position.y=.015;ao.renderOrder=-1;veh.add(ao);
  G.models[id]=S;return S;}
/* ---------- HUD ---------- */
const gh={el:{},box:new T.Box3(),bt:0},gsvg=$('#gHolo svg'),SVGN='http://www.w3.org/2000/svg';
['dim','mass','spd','rng','eng','arm'].forEach(k=>{const d=document.createElement('div');d.className='hc hc-'+(k==='arm'?'eng hc-arm':k);$('#gHolo').append(d);const pl=document.createElementNS(SVGN,'polyline'),c=document.createElementNS(SVGN,'circle');c.setAttribute('r','3');gsvg.append(pl,c);gh.el[k]={d,pl,c,x:null,y:null};});gh.dimP=coDimG(gsvg);
function stars(v){let h='';for(let i=1;i<=5;i++)h+=`<i class="${v>=i?'f':v>=i-.5?'h':''}">★</i>`;return h;}
const ND='<i style="font:500 12px/1 var(--hx-ui);font-style:normal;color:#8fa3a8">н/д</i>';
function hudSet(id){const D=GV[id];
  $('#gName').firstChild.textContent=D.n.toUpperCase()+' ';{const nm=$('#gName');let f=$('#gFlag');if(!f){f=document.createElement('span');f.id='gFlag';f.className='nflag';nm.parentNode.insertBefore(f,nm);}f.innerHTML=flagSVG(D.origin);}$('#gTtl').textContent=D.note||'ЗСУ';
  $('#gCls').innerHTML='<i>▸</i>'+D.cls;$('#gOrg').innerHTML='<i>✓</i>'+flagSVG(D.origin)+D.org;
  $('#gFire').innerHTML=stars(D.r[0]);$('#gProt').innerHTML=stars(D.r[1]);['#gSpd','#gXc','#gRng'].forEach((s,i)=>$(s).style.width=Math.round(D.r[2+i]*100)+'%');
  $('#gIcon').innerHTML=`<path d="${GV_ICON[D.ic]}" fill="#7dff8a" fill-opacity=".85" stroke="#d9ffe0" stroke-width="1" fill-rule="evenodd"/>`;
  const i=GV_ORDER.indexOf(id),n=GV_ORDER.length;{const a=GV[GV_ORDER[(i+n-1)%n]],b=GV[GV_ORDER[(i+1)%n]];$('#gPrev').innerHTML=flagSVG(a.origin)+a.n;$('#gNext').innerHTML=flagSVG(b.origin)+b.n;}
  const E=gh.el,row=(k,v,u)=>`<span class="k">${k}</span><b>${v?v.replace(/^≈ /,'≈'):'—'}</b><i>${v?u:''}</i>`;
  E.dim.d.innerHTML=row('Довжина',D.L,'м')+row('Ширина',D.W,'м')+row('Висота',D.H,'м');
  E.mass.d.innerHTML=D.mass?`<span class="v">МАСА</span><div><b>${D.mass}<i class="u">т</i></b><small>${D.pay?'вантаж '+D.pay+' т':'бойова / спорядження'}</small></div>`:D.pay?`<span class="v">ВАНТАЖ</span><div><b>${D.pay}<i class="u">т</i></b><small>вантажопідйомність</small></div>`:'';
  E.spd.d.innerHTML=D.v?`<div class="t"><span>Макс.</span><span>швидкість</span></div><b>${D.v}<i>км/год</i></b>`:'';
  E.rng.d.innerHTML=(!D.rng&&!D.fire)?'':(!D.rng&&D.fire)?`<small>Дальність ураження</small><em>${D.fire}</em>`:`<small>Запас ходу, км</small>${D.rng||ND}`+(D.fire?`<em>Дальність ураження: ${D.fire}</em>`:'');
  E.eng.d.innerHTML=D.crew?`<div class="box"><span class="k">Екіпаж</span><b>${D.crew}</b></div>`:'';E.arm.d.innerHTML=`<div class="arm"><span class="k">${D.eqk||'Озброєння'}</span>${D.arm}</div>`;
  Object.values(E).forEach(o=>{o.d.style.display=o.d.innerHTML?'':'none';});gh.bt=0;}
const hv=new T.Vector3();
function proj(v,out){hv.copy(v);hv.project(camera);out.x=(hv.x*.5+.5)*W;out.y=(-hv.y*.5+.5)*H;out.z=hv.z;return out;}
function hudFrame(dt){const S=G.models[G.cur];const on=G.holo&&S&&$('#gLoad').hidden&&G.mode!=='reload'&&G.mode!=='drive';$('#gHolo').classList.toggle('off',!on);if(!on)return;
  if(G.mode==='park'){S.age=(S.age||0)+dt;const pa=S.ancN||0;if((pa===0&&S.age>.6)||(pa===1&&S.age>2.2)){S.ancN=pa+1;try{ancInit(S);}catch(e){console.warn('anc',e);}}}if(!S.anc){for(const k in gh.el){const o=gh.el[k];o.d.style.opacity=0;o.pl.style.opacity=o.c.style.opacity=0;}gh.dimP.style.opacity=0;return;}
  const vx=S.veh.position.x,side=camera.position.z>=S.cZ?1:-1,si=side>0?0:1;const pj=v=>proj(v.clone().add(new T.Vector3(vx,0,0)),{});
  const B0=(S.abox||S.wbox).clone();const c0=pj(new T.Vector3((B0.min.x+B0.max.x)/2,B0.max.y*.5,(B0.min.z+B0.max.z)/2));const dl=S.D||{};const dm=coDims(gh.dimP,pj,B0,side,1,[dl.L,dl.W,dl.H].map(v=>{const m=v==null?null:String(v).match(/^[≈~]?\s*[\d.,–-]+/);return m?m[0].replace(/\s/g,''):'';}),c0.x,c0.y);
  gh.ot=(gh.ot||0)-dt;const doOcc=gh.ot<=0;if(doOcc)gh.ot=.2;gh.occ=gh.occ||{};
  const items=[];for(const k of ['eng','arm','mass','spd','rng','dim']){const o=gh.el[k];if(!o.d.innerHTML){o.d.style.opacity=0;o.pl.style.opacity=o.c.style.opacity=0;continue;}
    let P,vis=true;if(k==='dim'){P=dm;}else{const cs=S.anc[k]&&S.anc[k][si];if(!cs){o.d.style.opacity=0;o.pl.style.opacity=o.c.style.opacity=0;continue;}gh.occ[k+si]=gh.occ[k+si]||{i:0,h:false};const st=gh.occ[k+si];
      if(doOcc&&S.D.noocc){st.i=0;st.h=false;}else if(doOcc){st.h=true;for(let i=0;i<cs.length;i++){const w=coW(cs[i]),rc=new T.Raycaster(),d=w.clone().sub(camera.position),dl=d.length();rc.set(camera.position,d.normalize());rc.far=dl;const h=rc.intersectObject(S.seat,true).filter(coVis);if(!(h.length&&h[0].distance<dl-.35)){st.i=i;st.h=false;break;}}}
      if(st.i>=cs.length)st.i=0;P=proj(coW(cs[st.i]),{});vis=!st.h;}
    vis=vis&&P.z<1&&P.x>0&&P.x<W&&P.y>0&&P.y<H;items.push({k,o,P,vis,fix:k==='dim'?'L':null});}
  const c=proj(new T.Vector3(vx+(S.cOff||0),B0.max.y*.5,S.cZ||0),{});
  window.__GW=[W,H,items.map(i=>i.k+':'+i.o.d.offsetWidth+'x'+i.o.d.offsetHeight+'@'+Math.round(i.P.x)+','+Math.round(i.P.y)+(i.vis?'':'H')).join(' ')];let rx=72;const tl=stage.querySelector('.ui-tools')||document.querySelector('#gFig .ui-tools');if(tl&&tl.offsetParent){const a=tl.getBoundingClientRect(),b=stage.getBoundingClientRect();if(a.width&&a.left>b.left+b.width*.5)rx=Math.max(rx,b.right-a.left+14);}
  coLayout(items,{W,H,cx:c.x,top:140,bot:H*.645,lx:22,rx,dt});window.__GW.push(items.map(i=>i.k+'='+i.o.d.style.transform+(i.o.left?'L':'R')).join(' '));}
let toastT=0;function status(s){$('#gStatus').textContent=s;}
function toast(s){const e=$('#gStatus');e.textContent=s;e.classList.add('toast');toastT=2;}
function cap(s){const e=$('#gCap');if(s){e.textContent=s;e.classList.add('on');}else e.classList.remove('on');}
