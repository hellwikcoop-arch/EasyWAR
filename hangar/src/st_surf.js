/* Рухомі рулі для цільних моделей (Су-25М1, Gripen): трикутники позаду лінії шарніра переносяться у власні групи-шарніри
   і віддаються в загальний RIG/driveRig (крен — елерони/елевони, тангаж — рулі висоти, рискання — руль напрямку). Плюс ППД. */
function stSurf(k,O,D,F){O.pv.updateMatrixWorld(true);const inv=new T.Matrix4().copy(O.pv.matrixWorld).invert(),X1=new T.Vector3(1,0,0);
  const meshes=[];O.m.traverse(o=>{if(o.isMesh&&!Array.isArray(o.material)&&o.geometry&&!o.isSkinnedMesh&&!(O.gearG&&isAnc(O.gearG,o)))meshes.push(o);});
  function isAnc(a,o){while(o){if(o===a)return true;o=o.parent;}return false;}
  const va=new T.Vector3(),vb=new T.Vector3(),vc=new T.Vector3(),ce=new T.Vector3(),m=new T.Matrix4();
  const SF=D.surf.map(([name,type,A,B,sel])=>{const pvA=new T.Vector3(...A),pvB=new T.Vector3(...B);const wA=O.pv.localToWorld(pvA.clone()),wB=O.pv.localToWorld(pvB.clone());
    const pv=new T.Group();O.m.add(pv);O.m.updateMatrixWorld(true);const lA=O.m.worldToLocal(wA.clone()),lB=O.m.worldToLocal(wB.clone());
    pv.position.copy(lA);pv.quaternion.setFromUnitVectors(X1,lB.clone().sub(lA).normalize());pv.updateMatrixWorld(true);
    return {name,type,A,B,sel,ax:sel.ax==='y'?1:2,oth:sel.ax==='y'?2:1,pv,pvA,pvB,cnt:0,cen:new T.Vector3()};});
  O.pv.updateMatrixWorld(true);
  meshes.forEach(o=>{const g=o.geometry,P=g.attributes.position;const dn=P.normalized?({Int8Array:127,Uint8Array:255,Int16Array:32767,Uint16Array:65535})[P.array.constructor.name]||1:1;
    const idx=g.index?g.index.array:null,n=(idx?idx.length:P.count)/3;m.multiplyMatrices(inv,o.matrixWorld);const own=new Uint8Array(n);let any=0;const c=[0,0,0];O.tip=O.tip||new T.Vector3(-1e9,0,0);
    for(let t=0;t<n;t++){const i0=idx?idx[t*3]:t*3,i1=idx?idx[t*3+1]:t*3+1,i2=idx?idx[t*3+2]:t*3+2;
      va.fromBufferAttribute(P,i0);vb.fromBufferAttribute(P,i1);vc.fromBufferAttribute(P,i2);ce.copy(va).add(vb).add(vc).multiplyScalar(1/(3*dn)).applyMatrix4(m);c[0]=ce.x;c[1]=ce.y;c[2]=ce.z;if(ce.x>O.tip.x&&Math.abs(ce.z)<.5)O.tip.copy(ce);
      for(let si=0;si<SF.length;si++){const f=SF[si],A=f.A,B=f.B;const u=(c[f.ax]-A[f.ax])/(B[f.ax]-A[f.ax]);if(u<0||u>1)continue;
        const hx=A[0]+(B[0]-A[0])*u;if(ce.x>hx+.02||ce.x<hx-f.sel.d)continue;if(c[f.oth]<f.sel.b[0]||c[f.oth]>f.sel.b[1])continue;
        own[t]=si+1;any++;f.cnt++;f.cen.add(ce);break;}}
    if(!any)return;
    const mkIdx=sel=>{let k=0;for(let t=0;t<n;t++)if(own[t]===sel)k++;if(!k)return null;const big=P.count>65535;const out=big?new Uint32Array(k*3):new Uint16Array(k*3);let j=0;
      for(let t=0;t<n;t++)if(own[t]===sel){out[j++]=idx?idx[t*3]:t*3;out[j++]=idx?idx[t*3+1]:t*3+1;out[j++]=idx?idx[t*3+2]:t*3+2;}return new T.BufferAttribute(out,1);};
    const mkG=ia=>{const ng=new T.BufferGeometry();for(const kk in g.attributes)ng.setAttribute(kk,g.attributes[kk]);ng.setIndex(ia);if(g.boundingSphere)ng.boundingSphere=g.boundingSphere.clone();return ng;};
    const restI=mkIdx(0);
    SF.forEach((f,si)=>{const ia=mkIdx(si+1);if(!ia)return;const sm=new T.Mesh(mkG(ia),o.material);sm.castShadow=o.castShadow;sm.receiveShadow=o.receiveShadow;o.matrixWorld.decompose(sm.position,sm.quaternion,sm.scale);f.pv.attach(sm);});
    o.geometry=mkG(restI||new T.BufferAttribute(new Uint16Array(0),1));});
  const rep=[];SF.forEach(f=>{rep.push(f.name+':'+f.cnt);if(!f.cnt){O.m.remove(f.pv);return;}
    f.cen.multiplyScalar(1/f.cnt);const dir=f.pvB.clone().sub(f.pvA).normalize(),v=f.cen.clone().sub(f.pvA),w=v.clone().applyAxisAngle(dir,.3);
    const dy=w.y-v.y,dl=w.z-v.z;const sign=f.type==='down'?(dy<0?1:-1):f.type==='up'?(dy>0?1:-1):(dl>0?1:-1);
    RIG[k].push({pv:f.pv,q0:f.pv.quaternion.clone(),sign,name:f.name,type:f.type});});
  O.surfInfo=rep.join(' ');
  // ППД (приймачі повітряного тиску)
  (D.pitot||[]).forEach(([x,y,z,len,r])=>{const mat=new T.MeshStandardMaterial({color:0xb8bec2,metalness:.85,roughness:.3});F.mats.push(mat);
    const g=new T.Group();const b=new T.Mesh(new T.CylinderGeometry(r*.6,r,len,10),mat);b.rotation.z=-PI/2;b.position.x=len/2;g.add(b);
    const t=new T.Mesh(new T.CylinderGeometry(r*.3,r*.6,len*.25,8),mat);t.rotation.z=-PI/2;t.position.x=len*1.1;g.add(t);
    const v=new T.Mesh(new T.BoxGeometry(len*.12,r*1.4,r*.5),mat);v.position.set(len*.75,-r*1.2,0);g.add(v);
    g.position.set(O.tip.x+x,O.tip.y+y,O.tip.z+z);O.pv.add(g);O.pv.updateMatrixWorld(true);O.m.attach(g);});}
