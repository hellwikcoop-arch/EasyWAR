/* ---------- розпізнавальні знаки: деколі, що облягають поверхню моделі ---------- */
const MK={tex:{},mat:{}};
function mkRd(a){const il=a.isInterleavedBufferAttribute,arr=il?a.data.array:a.array,st=il?a.data.stride:a.itemSize,off=il?a.offset:0;
  const dv=!a.normalized?1:arr instanceof Int16Array?32767:arr instanceof Uint16Array?65535:arr instanceof Int8Array?127:arr instanceof Uint8Array?255:1;
  return a.normalized?(i,c)=>Math.max(arr[i*st+off+c]/dv,-1):(i,c)=>arr[i*st+off+c];}
function mkTryzub(x,cx,cy,s,col){// тризуб (контур 100×140, малюється штрихами)
  x.save();x.translate(cx,cy);x.scale(s/140,s/140);x.translate(-50,-70);x.strokeStyle=col;x.fillStyle=col;x.lineWidth=9;x.lineJoin='round';x.lineCap='butt';
  x.beginPath();x.moveTo(14,16);x.lineTo(14,90);x.quadraticCurveTo(14,116,40,116);x.lineTo(60,116);x.quadraticCurveTo(86,116,86,90);x.lineTo(86,16);x.stroke();
  x.beginPath();x.moveTo(50,30);x.lineTo(50,116);x.stroke();
  x.lineWidth=7;x.beginPath();x.moveTo(50,98);x.quadraticCurveTo(30,98,28,76);x.lineTo(28,66);x.quadraticCurveTo(28,58,14,52);x.stroke();
  x.beginPath();x.moveTo(50,98);x.quadraticCurveTo(70,98,72,76);x.lineTo(72,66);x.quadraticCurveTo(72,58,86,52);x.stroke();
  const tri=(a)=>{x.beginPath();x.moveTo(a[0],a[1]);for(let i=2;i<a.length;i+=2)x.lineTo(a[i],a[i+1]);x.closePath();x.fill();};
  tri([9.5,17,14,0,18.5,17]);tri([81.5,17,86,0,90.5,17]);tri([50,2,59,22,50,34,41,22]);tri([50,112,57,126,50,140,43,126]);
  x.restore();}
function mkStar(x,cx,cy,R,fill,edge,ew){x.beginPath();for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5,r=i%2?R*.38:R;x.lineTo(cx+Math.cos(a)*r,cy+Math.sin(a)*r);}x.closePath();if(edge){x.lineWidth=ew;x.strokeStyle=edge;x.lineJoin='miter';x.stroke();}x.fillStyle=fill;x.fill();}
function mkCanvas(kind){const c=document.createElement('canvas');let w=256,h=256;if(kind==='flag'||kind==='fin')h=Math.round(w*2/3);c.width=w;c.height=h;const x=c.getContext('2d');
  if(kind==='glass'){// скло в гумовій рамці з відблиском
    const r=26;const rr=(a,b,c2,d,rad)=>{x.beginPath();x.moveTo(a+rad,b);x.arcTo(a+c2,b,a+c2,b+d,rad);x.arcTo(a+c2,b+d,a,b+d,rad);x.arcTo(a,b+d,a,b,rad);x.arcTo(a,b,a+c2,b,rad);x.closePath();};
    x.fillStyle='#0b0c0c';rr(4,4,248,248,r);x.fill();const gr=x.createLinearGradient(0,0,256,256);gr.addColorStop(0,'#3a4a50');gr.addColorStop(.45,'#18242a');gr.addColorStop(1,'#0e1518');x.fillStyle=gr;rr(16,16,224,224,r-10);x.fill();
    x.save();rr(16,16,224,224,r-10);x.clip();x.globalAlpha=.22;x.fillStyle='#cfe3ea';x.beginPath();x.moveTo(40,16);x.lineTo(110,16);x.lineTo(30,240);x.lineTo(16,240);x.lineTo(16,90);x.closePath();x.fill();x.globalAlpha=.12;x.beginPath();x.moveTo(140,16);x.lineTo(165,16);x.lineTo(85,240);x.lineTo(60,240);x.closePath();x.fill();x.restore();}
  else if(kind==='cross'){// хрест ЗСУ: чорний з білою облямівкою
    const bar=(t,col)=>{x.fillStyle=col;x.fillRect(128-t,10+(46-t)*0,2*t,236);x.fillRect(10,128-t,236,2*t);};
    x.fillStyle='#f4f4ef';x.fillRect(128-52,10,104,236);x.fillRect(10,128-52,236,104);
    x.fillStyle='#0c0c0c';x.fillRect(128-38,22,76,212);x.fillRect(22,128-38,212,76);}
  else if(kind==='flag'||kind==='fin'){x.fillStyle='#0057b7';x.fillRect(0,0,w,h/2);x.fillStyle='#ffd700';x.fillRect(0,h/2,w,h/2);}
  else if(kind==='roundel'){x.fillStyle='#ffd700';x.beginPath();x.arc(128,128,124,0,7);x.fill();x.fillStyle='#0057b7';x.beginPath();x.arc(128,128,112,0,7);x.fill();mkTryzub(x,128,128,196,'#ffd700');}
  else if(kind==='redstar'){x.fillStyle='rgba(0,0,0,0)';mkStar(x,128,134,116,'#c8102e','#f2f2f2',14);mkStar(x,128,134,84,'#c8102e','#7a0010',3);}
  else if(/^[ZVO]$/.test(kind)){x.font='900 230px Arial Black,Arial,sans-serif';x.textAlign='center';x.textBaseline='middle';x.lineWidth=10;x.strokeStyle='#111';x.strokeText(kind,128,136);x.fillStyle='#f5f5f0';x.fillText(kind,128,136);}
  return c;}
function mkMat(kind){if(MK.mat[kind])return MK.mat[kind];const t=new THREE.CanvasTexture(mkCanvas(kind));t.encoding=THREE.sRGBEncoding;t.anisotropy=4;
  const gl=kind==='glass';const m=new THREE.MeshStandardMaterial({map:t,transparent:true,alphaTest:.05,roughness:gl?.12:.68,metalness:gl?.55:.05,envMapIntensity:gl?1.4:1,polygonOffset:true,polygonOffsetFactor:-4,polygonOffsetUnits:-4,depthWrite:false});m.userData.mk=1;MK.mat[kind]=m;return m;}
// деколь: P — центр (світові), N — напрям «до глядача», up — верх знака; w×h — розмір, dep — глибина проєкції
function mkDecalGeo(root,P,N,up,w,h,dep){const zA=N.clone().normalize(),xA=new THREE.Vector3().crossVectors(up,zA).normalize(),yA=new THREE.Vector3().crossVectors(zA,xA);
  const R=Math.hypot(w,h,dep)*.5,pos=[],uv=[],nor=[];const va=new THREE.Vector3(),vb=new THREE.Vector3(),vc=new THREE.Vector3(),e1=new THREE.Vector3(),e2=new THREE.Vector3(),fn=new THREE.Vector3(),sph=new THREE.Sphere(P,R),bs=new THREE.Sphere();
  const loc=v=>{const d=v.clone().sub(P);return [d.dot(xA),d.dot(yA),d.dot(zA)];};
  const clip=(poly,ax,lim,sg)=>{const out=[];for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],da=sg*a[ax]-lim,db=sg*b[ax]-lim;if(da<=0)out.push(a);if((da<=0)!==(db<=0)){const t=da/(da-db);out.push(a.map((q,k)=>q+(b[k]-q)*t));}}return out;};
  root.updateMatrixWorld(true);root.traverse(o=>{if(!o.isMesh||!o.geometry||o.material&&o.material.userData&&o.material.userData.mk||o.isSkinnedMesh)return;if(!o.visible)return;let p=o.parent,vis=true;while(p){if(!p.visible)vis=false;p=p.parent;}if(!vis)return;
    const g=o.geometry;if(!g.boundingSphere)g.computeBoundingSphere();bs.copy(g.boundingSphere).applyMatrix4(o.matrixWorld);if(!bs.intersectsSphere(sph))return;
    const pa=g.attributes.position,rd=mkRd(pa),M=o.matrixWorld,idx=g.index?g.index.array:null,n=idx?idx.length:pa.count;
    for(let t=0;t<n;t+=3){const i0=idx?idx[t]:t,i1=idx?idx[t+1]:t+1,i2=idx?idx[t+2]:t+2;
      va.set(rd(i0,0),rd(i0,1),rd(i0,2)).applyMatrix4(M);vb.set(rd(i1,0),rd(i1,1),rd(i1,2)).applyMatrix4(M);vc.set(rd(i2,0),rd(i2,1),rd(i2,2)).applyMatrix4(M);
      if(va.distanceTo(P)>R*1.6&&vb.distanceTo(P)>R*1.6&&vc.distanceTo(P)>R*1.6){// швидке відсікання (з урахуванням великих трикутників)
        const mnx=Math.min(va.x,vb.x,vc.x),mxx=Math.max(va.x,vb.x,vc.x),mny=Math.min(va.y,vb.y,vc.y),mxy=Math.max(va.y,vb.y,vc.y),mnz=Math.min(va.z,vb.z,vc.z),mxz=Math.max(va.z,vb.z,vc.z);
        if(P.x<mnx-R||P.x>mxx+R||P.y<mny-R||P.y>mxy+R||P.z<mnz-R||P.z>mxz+R)continue;}
      e1.subVectors(vb,va);e2.subVectors(vc,va);fn.crossVectors(e1,e2);const ln=fn.length();if(ln<1e-12)continue;fn.multiplyScalar(1/ln);
      const fd=fn.dot(zA);if(Math.abs(fd)<.3)continue;const flip=fd<0;// двосторонні площини: орієнтуємо на глядача
      let poly=[loc(va),loc(vb),loc(vc)];poly=clip(poly,0,w/2,1);if(poly.length<3)continue;poly=clip(poly,0,w/2,-1);if(poly.length<3)continue;poly=clip(poly,1,h/2,1);if(poly.length<3)continue;poly=clip(poly,1,h/2,-1);if(poly.length<3)continue;poly=clip(poly,2,dep/2,1);if(poly.length<3)continue;poly=clip(poly,2,dep/2,-1);if(poly.length<3)continue;
      const nn=flip?fn.clone().negate():fn;const vs=poly.map(q=>new THREE.Vector3().copy(P).addScaledVector(xA,q[0]).addScaledVector(yA,q[1]).addScaledVector(zA,q[2]).addScaledVector(nn,.006));
      for(let i=1;i<vs.length-1;i++){const tri=flip?[0,i+1,i]:[0,i,i+1];for(const j of tri){const v=vs[j],q=poly[j];pos.push(v.x,v.y,v.z);uv.push(q[0]/w+.5,q[1]/h+.5);nor.push(nn.x,nn.y,nn.z);}}}});
  if(!pos.length)return null;const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(nor,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));return g;}
// знак через промінь: from — початок (світові), dir — напрям; parent — куди причепити
function mkPlace(root,parent,from,dir,kind,w,h,up,filt,dep){const rc=new THREE.Raycaster(from,dir.clone().normalize(),0,100);rc.camera=typeof camera!=='undefined'?camera:null;const hs=rc.intersectObject(root,true).filter(x=>(filt||coVis)(x)&&!(x.object.material&&x.object.material.userData&&x.object.material.userData.mk));if(!hs.length)return null;
  if(typeof parent==='function')parent=parent(hs[0].object);const P=hs[0].point,N=dir.clone().normalize().negate();const g=mkDecalGeo(root,P,N,up||new THREE.Vector3(0,1,0),w,h||w,dep||Math.max(w,h||w)*.9);if(!g)return null;
  parent.updateMatrixWorld(true);g.applyMatrix4(new THREE.Matrix4().copy(parent.matrixWorld).invert());const m=new THREE.Mesh(g,mkMat(kind));m.renderOrder=2;m.raycast=()=>{};m.name='mk_'+kind;parent.add(m);return m;}
// стирання чужих написів/знаків із текстури: трикутники в межах box (світові) → пікселі «білі»/«червоні»/«темні» замінюються медіаною фону
function mkScrub(root,box,mode){root.updateMatrixWorld(true);const done=new Map();let n=0;const va=new THREE.Vector3(),vb=new THREE.Vector3(),vc=new THREE.Vector3(),ce=new THREE.Vector3();
  root.traverse(o=>{if(!o.isMesh||!o.geometry||!o.material||!o.material.map||!o.geometry.attributes.uv)return;const mp=o.material.map,img=mp.image;if(!img||!img.width)return;
    let st=done.get(mp);if(!st){const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const x=c.getContext('2d');x.drawImage(img,0,0);st={c,x,d:x.getImageData(0,0,c.width,c.height),ch:0};done.set(mp,st);}
    const g=o.geometry,pa=g.attributes.position,rp=mkRd(pa),ru=mkRd(g.attributes.uv),M=o.matrixWorld,idx=g.index?g.index.array:null,cnt=idx?idx.length:pa.count,W=st.c.width,H=st.c.height,D=st.d.data;
    for(let t=0;t<cnt;t+=3){const ii=[idx?idx[t]:t,idx?idx[t+1]:t+1,idx?idx[t+2]:t+2];va.set(rp(ii[0],0),rp(ii[0],1),rp(ii[0],2)).applyMatrix4(M);vb.set(rp(ii[1],0),rp(ii[1],1),rp(ii[1],2)).applyMatrix4(M);vc.set(rp(ii[2],0),rp(ii[2],1),rp(ii[2],2)).applyMatrix4(M);
      ce.copy(va).add(vb).add(vc).multiplyScalar(1/3);if(!box.containsPoint(ce))continue;
      const U=ii.map(i=>[((ru(i,0)%1)+1)%1*W,((ru(i,1)%1)+1)%1*H]);const x0=Math.max(0,Math.floor(Math.min(U[0][0],U[1][0],U[2][0]))),x1=Math.min(W-1,Math.ceil(Math.max(U[0][0],U[1][0],U[2][0]))),y0=Math.max(0,Math.floor(Math.min(U[0][1],U[1][1],U[2][1]))),y1=Math.min(H-1,Math.ceil(Math.max(U[0][1],U[1][1],U[2][1])));
      if((x1-x0)*(y1-y0)>W*H*.25||x1<=x0||y1<=y0)continue;
      const ins=(px,py)=>{const s=(a,b)=>(b[0]-a[0])*(py-a[1])-(b[1]-a[1])*(px-a[0]);const d1=s(U[0],U[1]),d2=s(U[1],U[2]),d3=s(U[2],U[0]);return !((d1<0||d2<0||d3<0)&&(d1>0||d2>0||d3>0));};
      const bad=(r,g2,b)=>{const mx=Math.max(r,g2,b),mn=Math.min(r,g2,b),l=(mx+mn)/510,sat=mx?(mx-mn)/mx:0;if(mode==='red')return r>110&&r>g2*1.6&&r>b*1.6;if(mode==='dark')return mx<45;if(mode==='ink')return (r+g2+b)/3<medL*.86;return l>.55&&sat<.3;};
      let medL=0;if(mode==='ink'){const ls=[];for(let py=y0;py<=y1;py+=2)for(let px=x0;px<=x1;px+=2){if(!ins(px+.5,py+.5))continue;const k=(py*W+px)*4;ls.push((D[k]+D[k+1]+D[k+2])/3);}ls.sort((a,b)=>a-b);medL=ls.length?ls[Math.floor(ls.length*.6)]:0;}
      const keep=[],fix=[];for(let py=y0;py<=y1;py++)for(let px=x0;px<=x1;px++){if(!ins(px+.5,py+.5))continue;const k=(py*W+px)*4;(bad(D[k],D[k+1],D[k+2])?fix:keep).push(k);}
      if(!fix.length||!keep.length)continue;const med=[0,1,2].map(ch=>{const a=keep.map(k=>D[k+ch]).sort((p,q)=>p-q);return a[a.length>>1];});
      // дилатація на 1 px, щоб не лишалось ореолу
      const fx=new Set(fix);fix.forEach(k=>{[-4,4,-W*4,W*4].forEach(dk=>fx.add(k+dk));});fx.forEach(k=>{if(k<0||k>=D.length)return;const j=(Math.random()-.5)*10;D[k]=med[0]+j;D[k+1]=med[1]+j;D[k+2]=med[2]+j;});st.ch=1;n+=fix.length;}});
  done.forEach((st,mp)=>{if(!st.ch)return;st.x.putImageData(st.d,0,0);mp.image=st.c;mp.needsUpdate=true;});return n;}
