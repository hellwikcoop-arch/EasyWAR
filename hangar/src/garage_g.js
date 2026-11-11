/* ---------- деталізація техніки: фари, ліхтарі, дзеркала, антени, гаки, каністри; камуфляж без UV ---------- */
function boxUV(o){let g=o.geometry;if(g.attributes.uv)return;if(g.index)g=g.toNonIndexed();g.computeBoundingBox();const bb=g.boundingBox,sz=bb.getSize(new T.Vector3()),k=6/Math.max(sz.x,sz.y,sz.z);
  if(!g.attributes.normal)g.computeVertexNormals();const P=g.attributes.position,N=g.attributes.normal,uv=new Float32Array(P.count*2),col=new Float32Array(P.count*3);
  for(let i=0;i<P.count;i++){const x=P.getX(i)*k,y=P.getY(i)*k,z=P.getZ(i)*k,nx=Math.abs(N.getX(i)),ny=Math.abs(N.getY(i)),nz=Math.abs(N.getZ(i));
    if(nx>=ny&&nx>=nz){uv[i*2]=z;uv[i*2+1]=y;}else if(ny>=nz){uv[i*2]=x;uv[i*2+1]=z;}else{uv[i*2]=x;uv[i*2+1]=y;}
    const t=(P.getY(i)-bb.min.y)/sz.y,d=.55+.45*Math.min(1,t*2.2),up=N.getY(i)>.7?1.08:1;col.set([d*up,d*up,d*.96*up],i*3);}
  g.setAttribute('uv',new T.BufferAttribute(uv,2));g.setAttribute('color',new T.BufferAttribute(col,3));o.geometry=g;
  if(o.material&&o.material.isMeshStandardMaterial){o.material.vertexColors=true;o.material.needsUpdate=true;}}
function kit(S){const B=S.wbox,mn=B.min,mx=B.max,L=mx.x-mn.x,W=mx.z-mn.z,Hh=mx.y-mn.y,id=S.id;const tracked=!!(S.D.rig&&S.D.rig.tracked)||id==='m270'||S.D.wauto==='trk'||S.D.cat==='tank';
  const rc=new T.Raycaster();const hit=(o,d)=>{rc.set(new T.Vector3(...o),new T.Vector3(...d).normalize());rc.far=40;const h=rc.intersectObject(S.seat,true);return h.length?h[0].point:null;};
  const K=new T.Group();const steel=std({color:0x1d1f1e,metalness:.7,roughness:.45}),chrome=std({color:0x9aa2a6,metalness:.9,roughness:.25}),black=std({color:0x0d0e0e,roughness:.6,metalness:.3});
  const hlM=new T.MeshStandardMaterial({color:0xfff6e0,emissive:0xfff0cc,emissiveIntensity:.15,roughness:.1,metalness:.2}),tlM=new T.MeshStandardMaterial({color:0x7a0d08,emissive:0xff2010,emissiveIntensity:.35,roughness:.2});
  const add=(geo,mat,p,r)=>{const m=new T.Mesh(geo,mat);m.position.set(...p);if(r)m.rotation.set(...r);m.castShadow=true;K.add(m);return m;};
  const cfg=Object.assign({hl:1,tl:1,hook:1,ant:tracked?2:1,mir:!tracked,jer:tracked},S.D.kit||{});const out={hl:[]};
  // фари
  const hy=cfg.hly||Math.min(tracked?1.25:1.05,Hh*.38);
  if(cfg.hl)[-1,1].forEach(s=>{const z=s*W*(cfg.hlz||.34);let p=hit([mn.x-1,hy,z],[1,0,0]);if(!p||p.x>mn.x+L*.25)p=new T.Vector3(mn.x+.05,hy,z);
    add(new T.CylinderGeometry(.13,.15,.12,20),steel,[p.x-.04,p.y,p.z],[0,0,PI/2]);add(new T.CircleGeometry(.115,20),hlM,[p.x-.105,p.y,p.z],[0,-PI/2,0]);
    add(new T.BoxGeometry(.06,.05,.05),chrome,[p.x-.02,p.y+.15,p.z]);out.hl.push([p.x-.12,p.y,p.z]);});
  // габаритні/стоп-ліхтарі
  const ty=cfg.tly||Math.min(1.0,Hh*.3);
  if(cfg.tl)[-1,1].forEach(s=>{const z=s*W*.4;let p=hit([mx.x+1,ty,z],[-1,0,0]);if(!p||p.x<mx.x-L*.25)p=new T.Vector3(mx.x-.05,ty,z);
    add(new T.BoxGeometry(.06,.1,.22),steel,[p.x+.03,p.y,p.z]);add(new T.BoxGeometry(.02,.07,.09),tlM,[p.x+.065,p.y,p.z-s*.05]);add(new T.BoxGeometry(.02,.07,.07),new T.MeshStandardMaterial({color:0x8a5a10,emissive:0xff9a20,emissiveIntensity:.25}),[p.x+.065,p.y,p.z+s*.06]);});
  // буксирні гаки
  const ky=Math.min(.75,Hh*.24);
  if(cfg.hook)[-1,1].forEach(s=>{const z=s*W*.24;let p=hit([mn.x-1,ky,z],[1,0,0]);if(!p||p.x>mn.x+L*.25)return;
    add(new T.BoxGeometry(.12,.14,.14),steel,[p.x-.05,p.y,p.z]);add(new T.TorusGeometry(.08,.025,8,16,PI*1.4),steel,[p.x-.15,p.y,p.z],[PI/2,0,-PI*.2]);});
  // антени
  const ax=cfg.antx!=null?mn.x+L*cfg.antx:(tracked?mn.x+L*.66:mn.x+L*.16);
  for(let i=0;i<cfg.ant;i++){const s=i?-1:1,z=s*W*.36;const p=hit([ax,mx.y+2,z],[0,-1,0]);if(!p||p.y<Hh*.35)continue;
    add(new T.CylinderGeometry(.05,.07,.14,10),black,[p.x,p.y+.07,p.z]);const len=cfg.antl||2.2;const wp=add(new T.CylinderGeometry(.008,.014,len,6),black,[p.x+Math.sin(.1)*len/2,p.y+.14+len/2,p.z],[0,0,-.1]);
    add(new T.SphereGeometry(.025,8,6),black,[p.x+Math.sin(.1)*len,p.y+.14+len,p.z]);}
  // дзеркала (колісні)
  if(cfg.mir){const x0=mn.x+(cfg.mirx||.6);const top=hit([x0,mx.y+2,0],[0,-1,0]);const my=(top?Math.min(top.y,3.2):2.4)-.55;
    [-1,1].forEach(s=>{let p=hit([x0,my,s*(W/2+1.5)],[0,0,-s]);if(!p)p=new T.Vector3(x0,my,s*W/2);
      const arm=add(new T.CylinderGeometry(.018,.018,.42,6),steel,[p.x,p.y,p.z+s*.21],[PI/2,0,0]);add(new T.CylinderGeometry(.018,.018,.32,6),steel,[p.x,p.y-.16,p.z+s*.12],[s*.6,0,0]);
      add(new T.BoxGeometry(.07,.4,.24),black,[p.x+.02,p.y+.02,p.z+s*.44]);add(new T.PlaneGeometry(.21,.36),chrome,[p.x+.06,p.y+.02,p.z+s*.44],[0,PI/2,0]);});}
  // каністри на кормі (гусеничні)
  if(cfg.jer){const jy=Math.max(.7,Hh*.36),jm=std({color:0x3c4a2a,roughness:.6,metalness:.3});[-1,1].forEach(s=>{const z=s*W*.2;const p=hit([mx.x+1,jy,z],[-1,0,0]);if(!p||p.x<mx.x-L*.3)return;
    const j=add(new T.BoxGeometry(.17,.47,.35),jm,[p.x+.09,p.y,p.z]);add(new T.BoxGeometry(.05,.05,.2),jm,[p.x+.09,p.y+.26,p.z]);add(new T.BoxGeometry(.04,.5,.04),steel,[p.x+.19,p.y,p.z-.12]);add(new T.BoxGeometry(.04,.5,.04),steel,[p.x+.19,p.y,p.z+.12]);});}
  // таблички / номери (бортові)
  if(cfg.num){const nc=cv(256,96,(x,w,h)=>{x.fillStyle='#0d0e0c';x.fillRect(0,0,w,h);x.fillStyle='#f2f0e6';x.font=`700 60px ${FONT}`;x.textAlign='center';x.fillText(cfg.num,w/2,h*.72);});
    const nm=new T.MeshStandardMaterial({map:tex(nc),roughness:.6});[-1,1].forEach(s=>{const p=hit([mn.x+L*(cfg.numx||.12),cfg.numy||Hh*.3,s*(W/2+1.5)],[0,0,-s]);if(!p)return;add(new T.PlaneGeometry(.55,.2),nm,[p.x,p.y,p.z+s*.012],[0,s>0?0:PI,0]);});}
  K.traverse(o=>{if(o.isMesh)o.raycast=()=>{};});
  const inv=new T.Matrix4().copy(S.seat.matrixWorld).invert();K.applyMatrix4(inv);S.seat.add(K);S.kit={hlM,tlM,hl:out.hl};}

/* якорі виносок ТТХ: u — частка довжини від носа, v — частка висоти; обидва борти */
const ANC_W={eng:[.1,.68],arm:[.66,.72],mass:[[.5,.3],[.5,.55],[.45,.8,0],[.62,.2]],spd:[.13,.12],rng:[.3,.3]},ANC_T={eng:[.38,.93],arm:[.42,.82],mass:[[.55,.5],[.55,.75,.3],[.45,.4]],spd:[.06,.22],rng:[.86,.55]};
const ANC_OV={tank:{spd:[[.3,.3],[.36,.25],[.26,.4],[.16,.3],[.45,.25]],rng:[[.8,.45],[.74,.45],[.62,.5],[.88,.35]],arm:[[.45,.8,0],[.5,.75,0],[.3,.85,0]]},leo1:{spd:[[.16,.3],[.26,.28],[.1,.45]],rng:[[.74,.45],[.62,.5],[.85,.4]],arm:[[.3,.85,0],[.45,.8,0]]},m270:{eng:[.1,.72],arm:[.66,.9,0],rng:[.42,.45]},
  abrams:{eng:[.48,.95,.3],arm:[.04,.72,0],rng:[.8,.5]},bradley:{eng:[.5,.95,.3],arm:[.12,.85,0]},marder:{eng:[.5,.95,.3],arm:[.12,.85,0]},
  };
function solidBox(root,B0){const rc=new THREE.Raycaster(),ys=[];const L=B0.max.x-B0.min.x,Wd=B0.max.z-B0.min.z;
  for(let i=0;i<24;i++)for(let j=0;j<9;j++){rc.set(new THREE.Vector3(B0.min.x+L*(i+.5)/24,B0.max.y+2,B0.min.z+Wd*(j+.5)/9),new THREE.Vector3(0,-1,0));const h=rc.intersectObject(root,true).filter(coVis);if(h.length)ys.push(h[0].point.y);}
  ys.sort((a,b)=>a-b);const B=B0.clone();if(ys.length>8)B.max.y=Math.min(B0.max.y,ys[Math.floor(ys.length*.9)]+.05);return B;}
function ancInit(S){S.veh.updateMatrixWorld(true);const vx=S.veh.position.x,Bw=S.wbox.clone().translate(new THREE.Vector3(vx,0,0));const B=solidBox(S.seat,Bw);S.abox=B.clone().translate(new THREE.Vector3(-vx,0,0));const L=B.max.x-B.min.x,Hh=B.max.y-B.min.y;const tracked=['m270','leo1','berge','bradley','marder','abrams'].includes(S.id)||S.D.wauto==='trk'||S.D.cat==='tank';
  const spec=Object.assign({},tracked?ANC_T:ANC_W,(ANC_OV[S.id]||((S.D.cat==='tank'||S.D.ic==='spg')?ANC_OV.tank:null))||{},S.D.anc||{});S.anc={};
  for(const k in spec){const cs=Array.isArray(spec[k][0])?spec[k]:[spec[k]];S.anc[k]=[1,-1].map(sd=>{const r=cs.map(q=>coSnap(S.seat,B.min.x+q[0]*L,B.min.y+q[1]*Hh,sd,B,null,q[2])).filter(Boolean);return r.length?r:null;});}}
/* розпізнавальні знаки ЗСУ (або ворожі літери) на бортах, кормі й лобі */
function gvMarks(S){const D=S.D,B=solidBox(S.seat,S.wbox),L=B.max.x-B.min.x,Wd=B.max.z-B.min.z,Hh=B.max.y-B.min.y,cz=(B.min.z+B.max.z)/2;S.seat.updateMatrixWorld(true);
  (D.scrub||[]).forEach(q=>{const bx=new THREE.Box3(new THREE.Vector3(B.min.x+q[0]*L,B.min.y+q[2]*Hh,B.min.z-1),new THREE.Vector3(B.min.x+q[1]*L,B.min.y+q[3]*Hh,B.max.z+1));try{S.scrubN=(S.scrubN||0)+mkScrub(S.seat,bx,q[4]||'white');}catch(e){console.warn('scrub',e);}});
  const en=D.enemy,mk=Object.assign({s:[[.5,.55]],f:[[.55,0]],r:[[.55,0]],fl:[]},D.mk||{}),sz=mk.sz||Math.min(.9,Math.max(.45,Hh*.2));const kind=en?(D.zl||'Z'):'cross';
  const arr=a=>a&&(Array.isArray(a[0])?a:[a]);const out=[];
  arr(mk.s).forEach(q=>{[-1,1].forEach(sd=>{const x=B.min.x+q[0]*L,y=B.min.y+q[1]*Hh;const m=mkPlace(S.seat,S.seat,new THREE.Vector3(x,y,cz+sd*(Wd/2+3)),new THREE.Vector3(0,0,-sd),q[3]||kind,q[2]||sz,null,null,null,.4);if(m)out.push(m);});});
  arr(mk.f).forEach(q=>{const m=mkPlace(S.seat,S.seat,new THREE.Vector3(B.min.x-3,B.min.y+q[0]*Hh,cz+(q[1]||0)*Wd/2),new THREE.Vector3(1,0,0),q[3]||kind,(q[2]||sz*.8));if(m)out.push(m);});
  arr(mk.r).forEach(q=>{const m=mkPlace(S.seat,S.seat,new THREE.Vector3(B.max.x+3,B.min.y+q[0]*Hh,cz+(q[1]||0)*Wd/2),new THREE.Vector3(-1,0,0),q[3]||kind,(q[2]||sz*.8));if(m)out.push(m);});
  if(!en)arr(mk.fl).forEach(q=>{[-1,1].forEach(sd=>{const x=B.min.x+q[0]*L,y=B.min.y+q[1]*Hh,w=q[2]||sz*.8;const m=mkPlace(S.seat,S.seat,new THREE.Vector3(x,y,cz+sd*(Wd/2+3)),new THREE.Vector3(0,0,-sd),'flag',w,w*2/3,null,null,.4);if(m)out.push(m);});});
  const gs=D.glass||{};arr(gs.f||[]).forEach(q=>{const m=mkPlace(S.seat,S.seat,new THREE.Vector3(B.min.x-3,B.min.y+q[0]*Hh,cz+(q[1]||0)*Wd/2),new THREE.Vector3(1,0,0),'glass',q[2],q[3],null,null,.35);if(m)out.push(m);});
  arr(gs.s||[]).forEach(q=>{[-1,1].forEach(sd=>{const m=mkPlace(S.seat,S.seat,new THREE.Vector3(B.min.x+q[0]*L,B.min.y+q[1]*Hh,cz+sd*(Wd/2+3)),new THREE.Vector3(0,0,-sd),'glass',q[2],q[3],null,null,.3);if(m)out.push(m);});});
  S.marks=out;return out.length;}
