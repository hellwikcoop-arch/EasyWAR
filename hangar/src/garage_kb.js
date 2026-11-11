/* ---------- доробка моделей (kitbash): деталізовані вузли поверх реальних моделей-основ ---------- */
const KB={tex:{},mat:{}};
function kbNoiseTex(key,base,opt){if(KB.tex[key])return KB.tex[key];opt=opt||{};const c=document.createElement('canvas');c.width=c.height=512;const x=c.getContext('2d');
  x.fillStyle=base;x.fillRect(0,0,512,512);let s=opt.seed||7;const r=()=>(s=(s*16807)%2147483647)/2147483647;
  if(opt.camo){opt.camo.forEach((col,k)=>{x.fillStyle=col;for(let i=0;i<9;i++){const cx=r()*512,cy=r()*512,n=7+(r()*5|0);x.beginPath();for(let j=0;j<n;j++){const a=j/n*6.283,rr=40+r()*70;x.lineTo(cx+Math.cos(a)*rr*1.5,cy+Math.sin(a)*rr*.8);}x.closePath();x.fill();
    for(const dx of [-512,512])for(const dy of [-512,512,0]){x.save();x.translate(dx,dy);x.fill();x.restore();}}});}
  if(opt.plate){x.strokeStyle='rgba(0,0,0,.35)';x.lineWidth=2;for(let i=0;i<16;i++)for(let j=0;j<16;j++){const px=i*32+(j%2)*16,py=j*32;x.save();x.translate(px+8,py+16);x.rotate(j%2?.8:-.8);x.strokeRect(-7,-2,14,4);x.restore();}}
  for(let i=0;i<9000;i++){const v=r();x.fillStyle=v>.5?`rgba(255,255,255,${r()*.05})`:`rgba(0,0,0,${r()*.07})`;x.fillRect(r()*512,r()*512,1+r()*2,1+r()*2);}
  if(opt.panel){x.strokeStyle='rgba(0,0,0,.42)';x.lineWidth=1.6;for(let i=0;i<5;i++){const v=i*128+r()*6;x.beginPath();x.moveTo(v,0);x.lineTo(v,512);x.stroke();x.beginPath();x.moveTo(0,v+40);x.lineTo(512,v+40);x.stroke();}
    x.fillStyle='rgba(0,0,0,.35)';for(let i=0;i<5;i++)for(let j=0;j<40;j++){x.beginPath();x.arc(i*128+r()*6+5,j*13,1.1,0,7);x.fill();}}
  for(let i=0;i<(opt.streak||40);i++){const px=r()*512,py=r()*512,l=20+r()*90;const g=x.createLinearGradient(px,py,px,py+l);g.addColorStop(0,`rgba(40,30,20,${.12*r()})`);g.addColorStop(1,'rgba(40,30,20,0)');x.fillStyle=g;x.fillRect(px,py,2+r()*5,l);}
  for(let i=0;i<120;i++){x.fillStyle=`rgba(${opt.chip||'60,55,45'},${.25+r()*.3})`;x.beginPath();x.arc(r()*512,r()*512,.6+r()*1.8,0,7);x.fill();}
  const t=new T.CanvasTexture(c);t.wrapS=t.wrapT=T.RepeatWrapping;t.encoding=T.sRGBEncoding;t.anisotropy=4;t.repeat.set(opt.rep||.7,opt.rep||.7);KB.tex[key]=t;return t;}
function kbTreadTex(key,base){if(KB.tex[key])return KB.tex[key];const c=document.createElement('canvas');c.width=c.height=256;const x=c.getContext('2d');x.fillStyle=base;x.fillRect(0,0,256,256);
  let s=3;const r=()=>(s=(s*16807)%2147483647)/2147483647;
  for(let i=0;i<8;i++)for(let j=0;j<8;j++){const cx=i*32+(j%2)*16+8,cy=j*32+8;x.save();x.translate(cx,cy);x.rotate((i+j)%2?.78:-.78);x.fillStyle='rgba(255,255,255,.22)';x.fillRect(-9,-2.2,18,4.4);x.fillStyle='rgba(0,0,0,.45)';x.fillRect(-9,2.2,18,1.6);x.restore();}
  for(let i=0;i<2500;i++){x.fillStyle=r()>.5?`rgba(255,255,255,${r()*.06})`:`rgba(0,0,0,${r()*.12})`;x.fillRect(r()*256,r()*256,1+r()*3,1+r()*3);}
  for(let i=0;i<30;i++){const g=x.createRadialGradient(r()*256,r()*256,0,128,128,0);x.fillStyle=`rgba(60,45,30,${r()*.12})`;x.beginPath();x.arc(r()*256,r()*256,6+r()*20,0,7);x.fill();}
  const t=new T.CanvasTexture(c);t.wrapS=t.wrapT=T.RepeatWrapping;t.encoding=T.sRGBEncoding;t.anisotropy=4;t.repeat.set(3,3);KB.tex[key]=t;return t;}
function kbHaz(){if(KB.tex.haz)return KB.tex.haz;const c=document.createElement('canvas');c.width=c.height=128;const x=c.getContext('2d');x.fillStyle='#e8b400';x.fillRect(0,0,128,128);x.fillStyle='#161616';for(let i=-2;i<4;i++){x.beginPath();x.moveTo(i*48,0);x.lineTo(i*48+24,0);x.lineTo(i*48+24+128,128);x.lineTo(i*48+128,128);x.fill();}
  const t=new T.CanvasTexture(c);t.wrapS=t.wrapT=T.RepeatWrapping;t.encoding=T.sRGBEncoding;t.repeat.set(2.5,2.5);KB.tex.haz=t;return t;}
function kbM(k){if(KB.mat[k])return KB.mat[k];let m;const S=o=>new T.MeshStandardMaterial(o);
  switch(k){case 'sand':m=S({map:kbNoiseTex('sand','#bfae86',{chip:'90,80,60'}),roughness:.78,metalness:.15});break;
    case 'rmet':{const t=kbNoiseTex('rmet','#4b5536',{chip:'38,36,28',panel:1,streak:140,rep:.55,seed:11});m=S({map:t,bumpMap:t,bumpScale:.035,roughness:.7,metalness:.18});break;}
    case 'rmetd':{const t=kbNoiseTex('rmetd','#3f4630',{chip:'28,27,22',streak:90,rep:.6,seed:5});m=S({map:t,bumpMap:t,bumpScale:.02,roughness:.75,metalness:.2});break;}
    case 'sov':{const t=kbNoiseTex('sov','#3c4529',{chip:'30,30,22',panel:1,streak:130,rep:.5,seed:21});m=S({map:t,bumpMap:t,bumpScale:.03,roughness:.78,metalness:.12});break;}
    case 'natob':{const t=kbNoiseTex('natob','#3e4a2e',{camo:['#4a3a29','#1f201b'],rep:.33,chip:'30,30,25',streak:110,seed:9});m=S({map:t,bumpMap:t,bumpScale:.02,roughness:.74,metalness:.12});break;}
    case 'treadS':{const t=kbTreadTex('treadS','#353c27');m=S({map:t,bumpMap:t,bumpScale:.06,roughness:.6,metalness:.35});break;}
    case 'treadN':{const t=kbTreadTex('treadN','#3a4030');m=S({map:t,bumpMap:t,bumpScale:.06,roughness:.6,metalness:.35});break;}
    case 'olive':m=S({map:kbNoiseTex('olive','#4b5233',{chip:'35,35,25'}),roughness:.75,metalness:.15});break;
    case 'nato':m=S({map:kbNoiseTex('nato','#3e4a2e',{camo:['#4a3a29','#1f201b'],rep:.33,chip:'30,30,25'}),roughness:.74,metalness:.12});break;
    case 'steel':m=S({map:kbNoiseTex('steel','#3b3c3a',{plate:1,rep:.9}),roughness:.55,metalness:.6});break;
    case 'dark':m=S({map:kbNoiseTex('dark','#262724'),roughness:.7,metalness:.35});break;
    case 'rubber':m=S({color:0x141414,roughness:.9,metalness:0});break;
    case 'chrome':m=S({color:0xc9ced2,roughness:.18,metalness:.95});break;
    case 'cable':m=S({color:0x2a2a28,roughness:.5,metalness:.7});break;
    case 'yellow':m=S({color:0xd9a400,roughness:.45,metalness:.2});break;
    case 'haz':m=S({map:kbHaz(),roughness:.6,metalness:.1});break;
    case 'amber':m=S({color:0xffa31a,emissive:0xff8800,emissiveIntensity:.35,roughness:.15,metalness:0,transparent:true,opacity:.92});break;
    case 'red':m=S({color:0x8a0e0a,emissive:0xff2010,emissiveIntensity:.25,roughness:.2});break;
    case 'glass':m=S({color:0x1b2a2c,roughness:.08,metalness:.6});break;
    case 'wood':m=S({map:kbNoiseTex('wood','#7a6142',{chip:'50,35,20',rep:1.5}),roughness:.85});break;
    case 'crate':m=S({map:kbNoiseTex('crate','#4f5a36',{chip:'30,30,20',rep:1.2}),roughness:.8,metalness:.05});break;
    case 'strap':m=S({color:0x9b8a3c,roughness:.8});break;}
  KB.mat[k]=m;return m;}
// геометрія з фасками: прямокутник w×h (x,y) екструдований на d (z), центр у (0,0,0); UV у метрах
function kbRB(w,h,d,r){r=Math.min(r==null?.03:r,w/2-.002,h/2-.002,d/2-.002);const s=new T.Shape(),x0=-w/2+r,x1=w/2-r,y0=-h/2+r,y1=h/2-r;
  s.moveTo(x0,-h/2);s.lineTo(x1,-h/2);s.quadraticCurveTo(w/2,-h/2,w/2,y0);s.lineTo(w/2,y1);s.quadraticCurveTo(w/2,h/2,x1,h/2);s.lineTo(x0,h/2);s.quadraticCurveTo(-w/2,h/2,-w/2,y1);s.lineTo(-w/2,y0);s.quadraticCurveTo(-w/2,-h/2,x0,-h/2);
  const g=new T.ExtrudeGeometry(s,{depth:Math.max(.001,d-2*r),bevelEnabled:r>.002,bevelThickness:r,bevelSize:r*.8,bevelSegments:2,curveSegments:2});g.translate(0,0,-(d-2*r)/2);g.computeVertexNormals();return g;}
// профіль (масив [x,y]) у площині xy, екструдований уздовж z на d
function kbProf(pts,d,r){const s=new T.Shape();pts.forEach((p,i)=>i?s.lineTo(p[0],p[1]):s.moveTo(p[0],p[1]));s.closePath();r=r==null?.025:r;
  const g=new T.ExtrudeGeometry(s,{depth:d-2*r,bevelEnabled:true,bevelThickness:r,bevelSize:r*.8,bevelSegments:2,curveSegments:2});g.translate(0,0,-(d-2*r)/2);g.computeVertexNormals();return g;}
function kbCtx(seat,model,B){const X0=B.max.x,Y0=B.min.y,Z0=(B.min.z+B.max.z)/2,G=new T.Group();G.name='kb';seat.add(G);
  const P=(x,y,z)=>new T.Vector3(X0-x,Y0+y,Z0+z);
  const mesh=(g,m,p,rot)=>{const o=new T.Mesh(g,typeof m==='string'?kbM(m):m);o.position.copy(p);if(rot)o.rotation.set(rot[0],rot[1],rot[2]);o.castShadow=o.receiveShadow=true;G.add(o);return o;};
  const C={G,P,mesh,
    // коробка за межами: x0..x1 (від носа), y0..y1, z0..z1
    box:(x0,x1,y0,y1,z0,z1,m,r)=>mesh(kbRB(Math.abs(x1-x0),Math.abs(y1-y0),Math.abs(z1-z0),r),m,P((x0+x1)/2,(y0+y1)/2,(z0+z1)/2)),
    // профіль у площині «від носа × висота», товщина за z
    prof:(pts,z0,z1,m,r)=>{const o=mesh(kbProf(pts.map(p=>[-p[0],p[1]]),Math.abs(z1-z0),r),m,P(0,0,(z0+z1)/2));return o;},
    cylZ:(x,y,z0,z1,rad,m,seg)=>mesh(new T.CylinderGeometry(rad,rad,Math.abs(z1-z0),seg||24),m,P(x,y,(z0+z1)/2),[Math.PI/2,0,0]),
    cylY:(x,z,y0,y1,rad,m,seg,r2)=>mesh(new T.CylinderGeometry(r2==null?rad:r2,rad,Math.abs(y1-y0),seg||24),m,P(x,(y0+y1)/2,z)),
    rod:(a,b,rad,m,seg)=>{const pa=P(...a),pb=P(...b),d=pb.clone().sub(pa),L=d.length();const o=mesh(new T.CylinderGeometry(rad,rad,L,seg||16),m,pa.clone().add(pb).multiplyScalar(.5));o.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),d.normalize());return o;},
    // гідроциліндр: корпус + шток
    ram:(a,b,rb,m)=>{const pa=new T.Vector3(...a),pb=new T.Vector3(...b),mid=pa.clone().lerp(pb,.58);C.rod(a,mid.toArray(),rb,m||'dark',20);C.rod(mid.toArray(),b,rb*.55,'chrome',16);C.rod(pa.clone().lerp(pb,.56).toArray(),pa.clone().lerp(pb,.6).toArray(),rb*1.15,'dark',20);},
    // лампа
    lamp:(x,y,z,m,r)=>{C.cylY(x,z,y,y+.06,(r||.07)*1.2,'dark',16);return mesh(new T.SphereGeometry(r||.07,16,10,0,Math.PI*2,0,Math.PI/2),m||'amber',P(x,y+.06,z));},
    handle:(x,y,z,len,ax)=>{ax=ax||'x';const a=[x,y,z],b=ax==='x'?[x-len,y,z]:[x,y+len,z];C.rod(a,b,.012,'chrome',8);},
    bolts:(pts,m)=>{const g=new T.CylinderGeometry(.018,.018,.02,8);const im=new T.InstancedMesh(g,kbM(m||'dark'),pts.length);const q=new T.Object3D();pts.forEach((p,i)=>{q.position.copy(P(p[0],p[1],p[2]));q.rotation.set(p[3]||0,0,p[4]||0);q.updateMatrix();im.setMatrixAt(i,q.matrix);});im.castShadow=true;G.add(im);return im;}};
  return C;}
/* M984A2: евакуаційний HEMTT — кузов з інструментальними відсіками, поворотна стріла-кран, підхват і сошники */
function kbM984(C){const S='sand';
  C.box(4.2,9.95,1.28,1.42,-1.2,1.2,'steel',.02);// настил
  [-1,1].forEach(sd=>{const zi=sd*.6,zo=sd*1.2;C.box(4.25,7.35,1.42,2.22,zi,zo,S,.035);
    for(let i=0;i<3;i++){const a=4.35+i*1.0,b=a+.94;C.box(a,b,1.5,2.12,zo+sd*.005,zo+sd*.02,S,.01);C.handle(a+.47+.12,1.82,zo+sd*.045,.24);C.bolts([[a+.06,2.08,zo+sd*.03,Math.PI/2],[b-.06,2.08,zo+sd*.03,Math.PI/2]]);}
    C.box(4.25,7.35,2.2,2.26,zi,zo+sd*.03,'dark',.01);// кромка кришки
    C.box(7.4,9.95,1.42,1.72,sd*.85,sd*1.2,S,.03);// задні ящики
    C.box(9.6,9.98,.55,1.3,sd*.62,sd*1.2,S,.03);// задня стінка
    C.ram([9.75,1.35,sd*1.02],[9.75,.62,sd*1.02],.07,'dark');C.prof([[9.45,.08],[10.15,.08],[10.25,.55],[9.55,.55]],sd*.78,sd*1.26,'dark',.02);// сошник
    C.box(10.0,10.1,.6,.72,sd*.78,sd*1.26,'haz',.01);
    C.lamp(9.95,1.3,sd*1.1,'red',.05);});
  // поворотна основа та стріла
  C.cylY(8.7,0,1.42,1.62,.62,'dark',32);C.cylY(8.7,0,1.62,1.74,.5,S,32);
  [-1,1].forEach(sd=>C.prof([[8.25,1.74],[9.15,1.74],[8.95,2.55],[8.55,2.55]],sd*.2,sd*.34,S,.02));
  C.cylZ(8.72,2.42,-.4,.4,.08,'chrome',16);
  C.prof([[8.95,2.3],[8.95,2.78],[4.55,2.7],[4.55,2.32]],-.25,.25,S,.04);// головна секція
  C.prof([[4.6,2.37],[4.6,2.65],[3.95,2.63],[3.95,2.39]],-.18,.18,S,.03);// висувна секція
  C.cylZ(3.98,2.5,-.2,.2,.14,'dark',24);C.cylZ(3.98,2.5,-.06,.06,.16,'cable',24);
  C.rod([3.98,2.36,0],[3.98,2.02,0],.012,'cable',6);C.box(3.88,4.08,1.82,2.02,-.1,.1,'yellow',.02);C.mesh(new T.TorusGeometry(.07,.018,8,16,Math.PI*1.4),kbM('yellow'),C.P(3.98,1.74,0),[0,Math.PI/2,0]);
  C.ram([8.5,1.8,0],[6.6,2.31,0],.11,S);
  C.box(4.5,4.75,2.22,2.33,-.62,.62,'dark',.02);// ложемент стріли
  C.rod([8.9,2.8,0],[4.0,2.66,0],.012,'cable',6);
  // лебідки під настилом
  C.cylZ(4.6,1.0,-.42,.42,.24,'dark',28);C.cylZ(4.6,1.0,-.38,.38,.26,'cable',28);C.cylZ(5.4,1.0,-.42,.42,.2,'dark',28);
  // підхват (стрінгер)
  C.prof([[9.3,1.15],[9.3,.95],[10.55,.62],[10.55,.82]],-.16,.16,S,.03);C.box(10.45,10.7,.6,.82,-.7,.7,'dark',.03);
  [-1,1].forEach(sd=>{C.box(10.55,10.85,.62,.72,sd*.42,sd*.56,'dark',.02);C.box(10.78,10.85,.62,.86,sd*.42,sd*.56,'dark',.01);});
  C.box(10.45,10.5,.66,.8,-.3,.3,'haz',.005);
  // проблискові маячки на даху кабіни, робоча фара
  [-1,1].forEach(sd=>C.lamp(2.55,2.88,sd*.85,'amber',.08));C.lamp(8.7,2.55,.3,'glass',.06);}
/* HEMTT LHS (M1120A4): гаковий навантажувач + платформа-флетрек з ящиками */
function kbLHS(C){
  [-1,1].forEach(sd=>{C.box(4.15,10.0,1.28,1.46,sd*.36,sd*.56,'dark',.02);C.box(4.6,9.95,1.46,1.62,sd*.3,sd*.52,'sand',.03);
    C.ram([6.5,1.5,sd*.3],[4.75,2.15,sd*.3],.1,'sand');});
  C.cylZ(9.85,1.5,-.62,.62,.11,'dark',20);// задній шарнір
  C.prof([[4.42,1.5],[4.82,1.5],[4.82,2.55],[4.6,2.9],[4.32,2.9],[4.32,2.75],[4.55,2.55]],-.2,.2,'sand',.03);// стріла гака
  C.mesh(new T.TorusGeometry(.11,.035,10,20,Math.PI*1.25),kbM('dark'),C.P(4.36,2.86,0),[0,0,Math.PI*.65]);
  // флетрек
  C.box(4.75,10.1,1.64,1.8,-1.2,1.2,'sand',.03);
  [-1,1].forEach(sd=>{C.box(4.75,10.1,1.6,1.84,sd*1.1,sd*1.22,'dark',.02);for(let i=0;i<6;i++)C.mesh(new T.TorusGeometry(.04,.01,6,12),kbM('dark'),C.P(5.2+i*.9,1.8,sd*1.2),[Math.PI/2,0,0]);
    C.rod([4.8,1.8,sd*1.1],[4.62,2.62,sd*.32],.05,'sand',12);C.rod([5.3,1.8,sd*1.1],[4.62,2.62,sd*.32],.04,'sand',12);
    C.cylZ(9.95,1.55,sd*.95,sd*1.1,.09,'dark',18);});
  C.cylZ(4.6,2.62,-.38,.38,.045,'chrome',14);
  // піддони з ящиками під стяжками
  for(let i=0;i<4;i++)for(const sd of [-1,1]){const x=5.0+i*1.22,z=sd*.58;C.box(x,x+1.12,1.8,1.92,z-.54,z+.54,'wood',.01);
    for(let l=0;l<2;l++)for(let a=0;a<2;a++)for(let b=0;b<3;b++){const xa=x+.04+a*.53,za=z-.5+b*.335;C.box(xa,xa+.5,1.92+l*.3,2.2+l*.3,za,za+.32,'crate',.015);C.handle(xa+.32,2.06+l*.3,za-.004,.14);}
    [.25,.85].forEach(f=>{C.box(x+f*1.12-.03,x+f*1.12+.03,2.5,2.53,z-.55,z+.55,'strap',.005);[-1,1].forEach(s2=>C.box(x+f*1.12-.03,x+f*1.12+.03,1.92,2.52,z+s2*.55,z+s2*.56,'strap',.003));});}
  C.box(10.05,10.12,1.2,1.4,-1.1,1.1,'haz',.01);[-1,1].forEach(sd=>{C.lamp(10.05,1.42,sd*1.0,'red',.05);C.lamp(2.55,2.88,sd*.85,'amber',.08);});}
/* M1084A1P2: FMTV з краном-маніпулятором у кормі кузова */
function kbM1084(C){const O='olive';
  C.box(6.25,6.9,1.08,1.18,-1.1,1.1,'steel',.02);
  C.cylY(6.55,0,1.18,1.3,.32,'dark',28);C.cylY(6.55,0,1.3,2.15,.17,O,24);C.cylY(6.55,0,2.1,2.3,.22,O,24);
  [-1,1].forEach(sd=>{C.ram([6.75,1.15,sd*1.08],[6.75,.42,sd*1.08],.055,'dark');C.box(6.6,6.9,.36,.42,sd*.95,sd*1.2,'dark',.02);C.box(6.55,6.95,1.0,1.08,sd*.6,sd*1.15,O,.02);
    C.prof([[6.35,2.15],[6.75,2.15],[6.65,2.62],[6.42,2.62]],sd*.11,sd*.2,O,.015);});
  C.cylZ(6.55,2.5,-.24,.24,.06,'chrome',14);
  C.prof([[6.75,2.38],[6.75,2.62],[3.2,2.56],[3.2,2.4]],-.13,.13,O,.03);C.prof([[3.25,2.42],[3.25,2.55],[2.75,2.54],[2.75,2.43]],-.09,.09,O,.02);
  C.ram([6.4,1.75,0],[5.2,2.38,0],.07,O);
  C.cylZ(2.78,2.48,-.1,.1,.08,'dark',18);C.rod([2.78,2.4,0],[2.78,2.12,0],.01,'cable',6);C.box(2.7,2.86,1.98,2.12,-.07,.07,'yellow',.015);
  C.box(3.05,3.2,1.54,2.4,-.08,.08,O,.02);C.box(3.0,3.25,2.36,2.4,-.25,.25,'dark',.01);// стояк-ложемент
  C.box(6.45,6.65,1.4,1.8,.25,.42,'dark',.02);[0,1,2].forEach(i=>C.handle(6.47+i*.06,1.72,.43,.12,'y'));// пульт
  C.lamp(6.55,2.3,0,'amber',.06);}
/* Bergepanzer 2: корпус Leopard 1 без башти + рубка, А-подібна стріла крана, запасний силовий блок, лебідка */
function kbBerge(C){const N='nato';
  C.box(2.5,5.7,1.48,1.58,-1.18,1.18,N,.02);// перекриття погону
  C.prof([[1.95,1.55],[4.35,1.55],[4.35,2.42],[2.55,2.42],[1.95,1.95]],-1.38,-.08,N,.04);// рубка
  [-1.15,-.75,-.35].forEach(z=>{C.box(2.12,2.32,2.02,2.18,z-.1,z+.1,'dark',.015);C.box(2.1,2.14,2.05,2.15,z-.08,z+.08,'glass',.004);});
  [[3.0,-1.0],[3.8,-.45]].forEach(([x,z])=>{C.cylY(x,z,2.42,2.5,.3,N,28);C.cylY(x,z,2.5,2.54,.22,'dark',24);C.box(x-.36,x-.28,2.46,2.56,z-.12,z+.12,'dark',.01);});
  C.rod([3.0,2.54,-1.0],[2.6,2.72,-1.0],.02,'dark',8);C.box(2.35,2.85,2.68,2.78,-1.04,-.96,'dark',.02);// кулемет
  for(let i=0;i<4;i++)C.cylZ(2.2+i*.12,2.25,-1.44,-1.38,.035,'dark',10);
  [2.3,3.0,3.7].forEach(x=>C.rod([x,2.44,-1.36],[x,2.44,-.12],.012,'dark',6));
  // кран: основа праворуч спереду, А-стріла покладена назад
  C.cylY(2.2,.72,1.55,1.78,.48,'dark',32);C.cylY(2.2,.72,1.78,1.95,.4,N,32);
  [.38,1.06].forEach(z=>C.prof([[2.0,1.95],[6.55,1.92],[6.55,2.1],[2.0,2.16]],z-.07,z+.07,N,.02));
  for(let i=0;i<5;i++){const x=2.6+i*.85;C.rod([x,2.05,.38],[x+.4,2.05,1.06],.035,N,10);}
  C.cylZ(6.65,2.0,.4,1.04,.12,'dark',20);C.mesh(new T.TorusGeometry(.12,.035,10,20,Math.PI*1.3),kbM('dark'),C.P(6.8,1.84,.72),[0,Math.PI/2,0]);
  C.box(6.3,6.5,1.58,1.92,.55,.9,'dark',.02);// опора стріли
  C.ram([2.45,1.85,.72],[3.9,2.08,.72],.09,N);
  // запасний силовий блок під брезентом
  C.box(5.75,7.35,1.58,2.32,-1.1,.1,'olive',.08);[5.95,6.55,7.15].forEach(x=>C.box(x-.03,x+.03,1.58,2.34,-1.12,.12,'strap',.005));
  // буксирні троси й штанги на бортах
  [-1,1].forEach(sd=>{C.rod([2.5,1.4,sd*1.66],[6.9,1.4,sd*1.66],.05,'cable',10);C.rod([2.5,1.5,sd*1.66],[6.9,1.5,sd*1.66],.05,'cable',10);
    C.mesh(new T.TorusGeometry(.12,.035,8,16),kbM('cable'),C.P(2.42,1.45,sd*1.66));C.mesh(new T.TorusGeometry(.12,.035,8,16),kbM('cable'),C.P(6.98,1.45,sd*1.66));});
  C.cylZ(7.95,1.2,-.55,.55,.22,'dark',28);C.cylZ(7.95,1.2,-.5,.5,.24,'cable',28);// лебідка
  for(let i=0;i<3;i++)C.box(7.6,7.95,1.6,2.05,-1.2+i*.3,-.95+i*.3,'olive',.03);// каністри
  C.lamp(4.1,2.42,.0,'amber',.08);}
/* Zuzana 2: шасі Tatra 815 (основа — «Дана») + нова двосекційна башта, 155 мм L52, автомат заряджання, домкрати */
function kbZuzana(C){const N='nato',Y=1.52;
  C.box(3.7,8.9,Y-.06,Y+.06,-1.42,1.42,'dark',.02);// опорна плита башти
  C.cylY(5.9,0,Y+.04,Y+.16,1.05,'dark',40);
  [-1,1].forEach(sd=>{const zi=sd*.3,zo=sd*1.42;
    C.prof([[4.15,Y+.14],[7.9,Y+.14],[7.9,3.12],[5.2,3.12],[4.6,2.85],[4.15,2.3]],zi,zo,N,.05);// півбашта
    C.prof([[3.92,2.25],[4.42,2.95],[4.5,2.92],[4.0,2.24]],zi+sd*.06,zo-sd*.06,'dark',.01);// лобовий лист
    C.box(4.62,4.66,2.55,2.85,sd*.55,sd*1.0,'glass',.004);C.box(4.6,4.64,2.52,2.88,sd*.52,sd*1.03,'dark',.004);// оглядові блоки
    C.box(5.4,6.6,1.82,2.95,zo+sd*.005,zo+sd*.03,N,.01);C.handle(6.4,2.4,zo+sd*.05,.2,'y');C.bolts([[5.45,2.9,zo+sd*.03,Math.PI/2],[6.55,2.9,zo+sd*.03,Math.PI/2],[5.45,1.87,zo+sd*.03,Math.PI/2],[6.55,1.87,zo+sd*.03,Math.PI/2]]);// двері
    C.cylY(6.6,sd*.95,3.12,3.2,.3,N,24);C.cylY(6.6,sd*.95,3.2,3.23,.24,'dark',20);// люк
    for(let i=0;i<4;i++)C.rod([4.3+i*.02,2.62+i*.11,zo+sd*.02],[4.05+i*.02,2.72+i*.11,zo+sd*.2],.045,'dark',10);// димові гранатомети
    C.box(7.0,7.8,3.12,3.18,sd*.4,sd*1.3,'dark',.01);// жалюзі
    // домкрати між 2-ю і 3-ю осями та в кормі
    C.ram([6.15,1.35,sd*1.38],[6.15,.42,sd*1.38],.075,'dark');C.cylY(6.15,sd*1.38,.3,.36,.24,'dark',20);
    C.lamp(7.9,2.9,sd*1.3,'red',.04);});
  C.ram([10.6,1.3,0],[10.6,.4,0],.085,'dark');C.cylY(10.6,0,.28,.34,.28,'dark',20);
  // люлька, противідкотні, ствол L52 (8,06 м), ежектор, дульне гальмо
  C.box(4.3,6.5,2.2,2.78,-.28,.28,'dark',.04);C.cylZ(6.0,2.48,-.34,.34,.17,'steel',24);
  [-.14,.14].forEach(z=>C.rod([4.4,2.73,z],[6.3,2.73,z],.06,'chrome',14));
  C.rod([4.3,2.48,0],[2.4,2.48,0],.17,'dark',28);C.rod([2.4,2.48,0],[-2.05,2.48,0],.125,N,28);
  C.rod([.9,2.48,0],[1.85,2.48,0],.185,N,28);C.rod([1.78,2.48,0],[1.88,2.48,0],.2,'dark',28);C.rod([.86,2.48,0],[.94,2.48,0],.2,'dark',28);
  C.rod([-2.05,2.48,0],[-2.7,2.48,0],.18,'dark',24);[-2.2,-2.38,-2.56].forEach(x=>C.box(x-.05,x+.05,2.3,2.66,-.24,.24,'steel',.01));
  // похідний фіксатор ствола на даху кабіни
  [-1,1].forEach(sd=>C.rod([1.15,2.38,sd*.35],[1.15,2.36,sd*.12],.04,'dark',10));C.prof([[1.05,2.36],[1.25,2.36],[1.22,2.4],[1.08,2.4]],-.4,.4,'dark',.01);
  C.mesh(new T.TorusGeometry(.13,.03,8,16,Math.PI),kbM('dark'),C.P(1.15,2.4,0),[0,Math.PI/2,0]);
  // енергоблок між баштами в кормі, кулемет 12,7 мм
  C.box(8.1,9.3,Y+.1,2.6,-1.0,1.0,N,.05);[8.4,8.8,9.2].forEach(x=>C.box(x-.05,x+.05,2.6,2.63,-.8,.8,'dark',.005));
  C.cylY(5.6,1.0,3.12,3.22,.22,'dark',20);C.rod([5.6,3.35,1.0],[4.6,3.38,1.0],.025,'dark',10);C.box(5.4,5.9,3.22,3.42,.92,1.08,'dark',.02);C.box(5.3,5.55,3.2,3.5,.88,.9,N,.01);
  // антени
  [-1,1].forEach(sd=>C.rod([7.7,3.12,sd*1.3],[7.75,4.6,sd*1.3],.008,'dark',6));
  C.lamp(5.0,3.12,-1.1,'amber',.06);}
/* Д-20: 152 мм гармата-гаубиця на лафеті з розсувними станинами (бойове положення) */
function kbD20(C){const O='olive';
  const beam=(a,b,h,w,m,r)=>{const pa=C.P(...a),pb=C.P(...b),d=pb.clone().sub(pa),L=d.length();const o=C.mesh(kbRB(L,h,w,r==null?.02:r),m,pa.clone().add(pb).multiplyScalar(.5));
    const q=new T.Quaternion().setFromUnitVectors(new T.Vector3(1,0,0),d.clone().normalize());o.quaternion.copy(q);return o;};
  const E=.06,yb=x=>1.32-(x-4.45)*Math.tan(E);// невелике піднесення ствола
  // ствол: дульне гальмо, труба, казенник
  C.rod([0,yb(0),0],[.5,yb(.5),0],.165,'dark',24);[.08,.32].forEach(x=>C.box(x,x+.1,yb(x)-.06,yb(x)+.06,-.2,.2,'dark',.01));
  C.rod([.5,yb(.5),0],[3.4,yb(3.4),0],.1,O,24);C.rod([3.4,yb(3.4),0],[5.0,yb(5.0),0],.15,O,24);C.rod([.48,yb(.48),0],[.56,yb(.56),0],.13,'dark',20);
  C.box(5.0,5.45,yb(5.2)-.2,yb(5.2)+.2,-.2,.2,'dark',.03);C.handle(5.45,yb(5.2)+.05,.21,.14,'y');
  // люлька, противідкотні пристрої, урівноважувачі
  C.box(3.65,5.15,yb(4.4)-.24,yb(4.4)-.12,-.22,.22,O,.02);
  [.1,-.1].forEach(z=>C.rod([3.1,yb(3.1)+.24,z],[5.15,yb(5.15)+.24,z],.08,O,16));C.rod([3.25,yb(3.25)+.24,0],[3.32,yb(3.32)+.24,0],.12,'dark',16);
  [-1,1].forEach(sd=>{C.ram([4.95,.62,sd*.42],[3.95,1.32,sd*.42],.07,O);
    C.prof([[3.75,.5],[5.25,.5],[5.05,1.25],[4.15,1.42],[3.75,1.1]],sd*.24,sd*.34,O,.02);// верхній станок
    C.cylZ(4.45,1.24,sd*.22,sd*.38,.09,'dark',16);});
  C.mesh(new T.TorusGeometry(.55,.035,6,24,Math.PI*.55),kbM('dark'),C.P(4.45,1.24,.4),[0,0,Math.PI*1.05]);// сектор підйомного механізму
  // щит
  [-1,1].forEach(sd=>{C.prof([[3.62,.45],[3.72,.45],[3.62,1.62],[3.52,1.62]],sd*.3,sd*1.12,O,.012);C.prof([[3.5,1.62],[3.58,1.62],[3.55,1.86],[3.47,1.86]],sd*.26,sd*.95,O,.01);});
  C.prof([[3.6,1.52],[3.7,1.52],[3.66,1.62],[3.56,1.62]],-.3,.3,O,.01);C.prof([[3.68,.45],[3.78,.45],[3.74,.95],[3.64,.95]],-.3,.3,O,.01);
  C.box(3.3,3.55,1.55,1.75,.52,.68,'dark',.02);C.box(3.27,3.31,1.6,1.7,.55,.65,'glass',.004);// приціл
  // нижній станок, бойовий хід, колеса
  C.box(3.9,5.0,.38,.58,-.62,.62,O,.04);C.rod([4.45,.55,-1.05],[4.45,.55,1.05],.07,'dark',14);
  [-1,1].forEach(sd=>{const z=sd*1.0;C.cylZ(4.45,.55,z-.16,z+.16,.55,'rubber',32);C.cylZ(4.45,.55,z-.165,z+.165,.33,O,24);C.mesh(new T.TorusGeometry(.44,.05,8,32),kbM('rubber'),C.P(4.45,.55,z+sd*.16));C.cylZ(4.45,.55,z+sd*.12,z+sd*.18,.12,'dark',16);
    C.bolts([0,1,2,3,4,5].map(i=>{const a=i/6*6.283;return [4.45+Math.cos(a)*.2,.55+Math.sin(a)*.2,z+sd*.17,Math.PI/2];}));
    C.box(4.15,4.75,1.0,1.06,z-.2,z+.2,O,.02);// крило
    // станини розсунуті ≈ 55°
    const a=[4.95,.48,sd*.28],b=[8.55,.1,sd*1.95];beam(a,b,.26,.2,O);beam([5.2,.62,sd*.4],[8.2,.25,sd*1.78],.06,.06,'dark',.01);
    C.prof([[8.35,-.02],[8.85,-.02],[8.75,.42],[8.45,.42]],sd*1.75,sd*2.15,'dark',.02);// сошник
    C.rod([8.2,.32,sd*1.82],[8.35,.75,sd*1.9],.025,'dark',8);C.cylY(7.6,sd*1.6,.3,.45,.03,'chrome',8);});
  C.lamp(5.0,1.0,-.6,'red',.03);}
/* Skynex: гармата Oerlikon Revolver Gun Mk3 35 мм на двовісному причепі з дизель-генератором і виносними опорами */
function kbSkynex(C){const G='rmet',D='rmetd';
  const hexa=(pts,m)=>{const v=pts.map(p=>C.P(p[0],p[1],p[2]));const c=v.reduce((a,b)=>a.clone().add(b),new T.Vector3()).multiplyScalar(1/8);
    const F=[[0,1,2,3],[7,6,5,4],[0,4,5,1],[1,5,6,2],[2,6,7,3],[3,7,4,0]],pos=[],uv=[];
    F.forEach(f=>{let q=f.map(i=>v[i]);const n=q[1].clone().sub(q[0]).cross(q[2].clone().sub(q[0]));const fc=q.reduce((a,b)=>a.clone().add(b),new T.Vector3()).multiplyScalar(.25);if(n.dot(fc.clone().sub(c))<0)q=q.slice().reverse();
      const ax=Math.abs(n.x)>Math.abs(n.y)?(Math.abs(n.x)>Math.abs(n.z)?'x':'z'):(Math.abs(n.y)>Math.abs(n.z)?'y':'z');const U=p=>ax==='x'?[p.z,p.y]:ax==='y'?[p.x,p.z]:[p.x,p.y];
      [[0,1,2],[0,2,3]].forEach(t=>t.forEach(i=>{pos.push(q[i].x,q[i].y,q[i].z);const u=U(q[i]);uv.push(u[0]*.42,u[1]*.42);}));});
    const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.computeVertexNormals();return C.mesh(g,m,new T.Vector3());};
  const seam=(x0,x1,y0,y1,z0,z1)=>C.box(x0,x1,y0,y1,z0,z1,'dark',.002);
  const DK=1.08;// висота настилу
  // ── причіп: лонжерони, поперечки, настил з рифленого листа
  [-1,1].forEach(sd=>{C.box(3.2,9.3,.62,DK-.04,sd*.72,sd*.92,'dark',.01);C.box(3.2,9.3,DK-.08,DK-.02,sd*.66,sd*.98,'dark',.005);C.box(3.2,9.3,.62,.68,sd*.66,sd*.98,'dark',.005);
    C.box(3.2,9.3,DK-.04,DK+.04,sd*1.18,sd*1.24,D,.01);// бортова балка
  });
  for(let x=3.4;x<9.2;x+=.7)C.box(x,x+.12,.68,DK-.06,-1.18,1.18,'dark',.01);
  C.box(3.2,9.3,DK-.02,DK+.03,-1.24,1.24,'steel',.006);
  C.box(3.1,3.22,.66,DK+.06,-1.25,1.25,D,.015);C.box(9.28,9.4,.66,DK+.06,-1.25,1.25,D,.015);
  // ходова: дві осі, здвоєні колеса, ресори, крила
  [6.75,7.85].forEach(ax=>{C.rod([ax,.5,-1.0],[ax,.5,1.0],.06,'dark',12);
    [-1,1].forEach(sd=>{const z=sd*1.02;C.cylZ(ax,.5,z-.15,z+.15,.5,'rubber',32);C.mesh(new T.TorusGeometry(.42,.07,8,32),kbM('rubber'),C.P(ax,.5,z+sd*.15));
      C.cylZ(ax,.5,z-.155,z+.155,.3,D,24);C.cylZ(ax,.5,z+sd*.12,z+sd*.17,.11,'dark',16);
      C.bolts([0,1,2,3,4,5,6,7].map(i=>{const a=i/8*6.283;return [ax+Math.cos(a)*.19,.5+Math.sin(a)*.19,z+sd*.16,Math.PI/2];}));
      C.box(ax-.45,ax+.45,.56,.64,sd*.6,sd*.75,'dark',.01);for(let k=0;k<4;k++)C.box(ax-.42+k*.04,ax+.42-k*.04,.5-k*.03,.53-k*.03,sd*.6,sd*.75,'dark',.004);});});
  [-1,1].forEach(sd=>{C.prof([[6.15,1.02],[8.45,1.02],[8.45,1.12],[6.15,1.12]],sd*.84,sd*1.22,D,.01);C.prof([[6.1,.8],[6.18,.8],[6.18,1.1],[6.1,1.1]],sd*.84,sd*1.22,D,.005);C.prof([[8.42,.8],[8.5,.8],[8.5,1.1],[8.42,1.1]],sd*.84,sd*1.22,D,.005);
    C.box(8.5,8.56,.6,.9,sd*.95,sd*1.2,'rubber',.004);// бризковики
    C.box(9.3,9.4,.8,.95,sd*.9,sd*1.15,'red',.01);C.box(9.3,9.4,.95,1.02,sd*.9,sd*1.15,'amber',.01);});
  // дишло з буксирною петлею та опорним колесом
  [-1,1].forEach(sd=>C.rod([9.35,.8,sd*.6],[10.5,.62,sd*.06],.06,'dark',12));C.box(10.45,10.75,.55,.69,-.08,.08,'dark',.02);C.mesh(new T.TorusGeometry(.1,.03,8,16),kbM('dark'),C.P(10.85,.62,0));
  C.cylY(10.1,.32,.18,.85,.045,'dark',10);C.cylZ(10.1,.12,.26,.38,.12,'rubber',16);C.cylY(10.1,.32,.85,.92,.07,'chrome',10);
  // виносні опори з гвинтовими домкратами
  [[3.45,-1],[3.45,1],[9.0,-1],[9.0,1]].forEach(([x,sd])=>{const zo=sd*1.95;C.box(x-.12,x+.12,.82,1.0,sd*1.0,sd*1.9,D,.015);C.box(x-.09,x+.09,.86,.96,sd*1.85,sd*2.05,'dark',.01);
    C.cylY(x,zo,.18,.9,.08,D,16);C.cylY(x,zo,.04,.22,.05,'chrome',12);C.cylY(x,zo,.9,.96,.05,'dark',10);C.rod([x,.96,zo],[x+.15,.96,zo],.012,'dark',6);
    C.cylY(x,zo,0,.05,.25,'dark',24);});
  // дизель-генератор у кормі причепа
  hexa([[7.9,DK+.03,-1.1],[9.2,DK+.03,-1.1],[9.2,DK+.03,1.1],[7.9,DK+.03,1.1],[7.95,2.05,-1.05],[9.15,2.05,-1.05],[9.15,2.05,1.05],[7.95,2.05,1.05]],D);
  [-1,1].forEach(sd=>{const z=sd*1.11;for(let i=0;i<8;i++)C.box(8.05,8.6,1.25+i*.08,1.28+i*.08,z,z+sd*.025,'dark',.003);
    C.box(8.7,9.08,1.2,1.95,z,z+sd*.012,'dark',.003);C.box(8.72,9.06,1.22,1.93,z+sd*.004,z+sd*.018,D,.006);C.handle(8.95,1.5,z+sd*.03,.2,'y');
    [1.3,1.85].forEach(y=>C.rod([8.72,y,z+sd*.022],[8.72,y+.08,z+sd*.022],.016,'dark',8));});
  C.cylY(8.3,-.6,2.05,2.5,.06,'dark',12);C.cylY(8.3,-.6,2.5,2.56,.08,'dark',12);// вихлоп
  C.cylY(8.9,.7,2.05,2.1,.07,'dark',12);C.box(9.16,9.2,1.4,1.8,-.4,.4,'dark',.01);C.box(9.19,9.21,1.5,1.7,-.3,-.05,'glass',.004);// панель керування
  // кабельний барабан
  C.cylZ(8.4,1.6,-.95,-.55,.32,D,24);[-.95,-.55].forEach(z=>C.cylZ(8.4,1.6,z-.02,z+.02,.36,'dark',24));C.cylZ(8.4,1.6,-.92,-.58,.26,'cable',24);
  C.box(7.75,8.0,1.2,1.5,-.9,-.6,D,.02);
  // ── погон і конічний п'єдестал башти
  const TX=5.55;C.cylY(TX,0,DK+.03,DK+.2,1.12,'dark',40);C.cylY(TX,0,DK+.2,DK+.3,1.06,D,40);
  C.bolts([...Array(24)].map((_,i)=>{const a=i/24*6.283;return [TX+Math.cos(a)*1.0,DK+.31,Math.sin(a)*1.0,0];}));
  hexa([[TX-.95,DK+.3,-.92],[TX+1.4,DK+.3,-.92],[TX+1.4,DK+.3,.92],[TX-.95,DK+.3,.92],[TX-1.6,1.95,-1.22],[TX+1.95,1.95,-1.22],[TX+1.95,1.95,1.22],[TX-1.6,1.95,1.22]],G);
  // ── корпус башти: основний об'єм, лобовий скіс, фаски даху
  const X0=TX-1.6,X1=TX+1.95;
  hexa([[X0,1.95,-1.22],[X1,1.95,-1.22],[X1,1.95,1.22],[X0,1.95,1.22],[X0-.05,2.55,-1.22],[X1,2.55,-1.22],[X1,2.55,1.22],[X0-.05,2.55,1.22]],G);
  hexa([[X0-.05,2.55,-1.22],[X1,2.55,-1.22],[X1,2.55,1.22],[X0-.05,2.55,1.22],[X0+.75,3.05,-1.02],[X1-.12,3.05,-1.02],[X1-.12,3.05,1.02],[X0+.75,3.05,1.02]],G);
  // кормова ніша з скосом
  hexa([[X1,2.0,-1.12],[X1+.42,2.08,-1.05],[X1+.42,2.08,1.05],[X1,2.0,1.12],[X1,2.95,-1.0],[X1+.38,2.82,-.95],[X1+.38,2.82,.95],[X1,2.95,1.0]],G);
  // лобовий блок гармати (амбразура) з вертикальним пазом
  hexa([[X0-.02,1.98,-.48],[X0-.02,1.98,.48],[X0-.62,2.08,.36],[X0-.62,2.08,-.36],[X0+.1,2.95,-.48],[X0+.1,2.95,.48],[X0-.5,2.85,.36],[X0-.5,2.85,-.36]],G);
  C.box(X0-.66,X0-.6,2.15,2.78,-.13,.13,'dark',.01);
  // шви панелей на бортах, лобі та даху
  [-1,1].forEach(sd=>{const z=sd*1.222;[X0+.85,TX+.2,TX+1.2].forEach(x=>seam(x-.008,x+.008,1.97,2.54,z,z+sd*.006));seam(X0,X1,2.24,2.256,z,z+sd*.006);
    C.bolts([...Array(14)].map((_,i)=>[X0+.1+i*.25,2.5,z+sd*.006,Math.PI/2]));C.bolts([...Array(14)].map((_,i)=>[X0+.1+i*.25,2.0,z+sd*.006,Math.PI/2]));
    // бічний люк завантаження боєкомплекту з петлями та замками
    C.box(TX+.3,TX+1.12,2.02,2.48,z,z+sd*.01,'dark',.003);C.box(TX+.33,TX+1.09,2.05,2.45,z+sd*.004,z+sd*.022,G,.01);
    [2.1,2.38].forEach(y=>{C.rod([TX+.3,y,z+sd*.03],[TX+.3,y+.06,z+sd*.03],.02,'dark',8);C.box(TX+1.02,TX+1.08,y-.02,y+.05,z+sd*.02,z+sd*.045,'dark',.005);});
    C.handle(TX+.95,2.2,z+sd*.04,.14,'y');
    // жалюзі охолодження в кормі
    for(let i=0;i<5;i++)C.box(X1-.55,X1-.1,2.05+i*.085,2.08+i*.085,z,z+sd*.03,'dark',.003);
    // рим-болти на кутах даху
    [X0+.85,X1-.25].forEach(x=>C.mesh(new T.TorusGeometry(.065,.016,6,14),kbM('dark'),C.P(x,3.11,sd*.88),[0,Math.PI/2,0]));
    // ступені та поручні для обслуги
    C.box(X1-.2,X1+.05,1.6,1.64,sd*1.0,sd*1.25,'steel',.005);C.handle(X1+.1,2.7,sd*1.0,.3);
  });
  seam(X0+.3,X0+.32,2.56,3.04,-1.0,1.0);seam(TX+.2,TX+.216,3.05,3.058,-1.0,1.0);seam(TX+1.2,TX+1.216,3.05,3.058,-1.0,1.0);
  // ── ствол 35 мм L/90 з кожухом, муфтою та дульним вимірювачем AHEAD (3 котушки)
  const E=.1,PX=X0-.55,PY=2.47,yb=x=>PY+(PX-x)*Math.tan(E);
  C.rod([PX+.25,yb(PX+.25),0],[PX-.55,yb(PX-.55),0],.14,G,24);C.rod([PX-.55,yb(PX-.55),0],[PX-.62,yb(PX-.62),0],.1,'dark',20);
  C.rod([PX-.62,yb(PX-.62),0],[.95,yb(.95),0],.058,'dark',20);C.rod([1.9,yb(1.9),0],[2.0,yb(2.0),0],.075,'dark',16);
  C.rod([.95,yb(.95),0],[.2,yb(.2),0],.15,'steel',28);[.25,.48,.71].forEach(x=>C.rod([x,yb(x),0],[x+.14,yb(x+.14),0],.168,D,28));
  C.rod([.2,yb(.2),0],[.04,yb(.04),0],.08,'dark',20);C.rod([.95,yb(.95),0],[1.0,yb(1.0),0],.12,'dark',20);
  // ── ОЕ-сенсор (ТВ / ІЧ / лазерний далекомір) на п'єдесталі праворуч
  const SX=X0+1.15,SZ=.55;hexa([[SX-.3,3.05,SZ-.3],[SX+.35,3.05,SZ-.3],[SX+.35,3.05,SZ+.3],[SX-.3,3.05,SZ+.3],[SX-.25,3.22,SZ-.25],[SX+.3,3.22,SZ-.25],[SX+.3,3.22,SZ+.25],[SX-.25,3.22,SZ+.25]],D);
  C.cylY(SX,SZ,3.22,3.3,.2,'dark',24);
  hexa([[SX-.34,3.3,SZ-.24],[SX+.3,3.3,SZ-.24],[SX+.3,3.3,SZ+.24],[SX-.34,3.3,SZ+.24],[SX-.3,3.72,SZ-.22],[SX+.28,3.72,SZ-.22],[SX+.28,3.72,SZ+.22],[SX-.3,3.72,SZ+.22]],G);
  C.box(SX-.36,SX-.33,3.4,3.62,SZ-.2,SZ-.04,'glass',.008);C.box(SX-.36,SX-.33,3.46,3.6,SZ+.02,SZ+.12,'glass',.008);C.cylZ(SX-.34,3.36,SZ+.14,SZ+.2,.04,'glass',12);
  C.box(SX-.42,SX-.3,3.72,3.75,SZ-.24,SZ+.24,'dark',.004);// козирок
  C.rod([SX+.3,3.4,SZ],[SX+.7,3.07,SZ],.025,'cable',8);
  // антена зв'язку, GNSS, проблискові маячки, люк даху
  C.cylY(X1-.35,-.75,3.05,3.1,.05,'dark',10);C.rod([X1-.35,3.1,-.75],[X1-.32,4.1,-.75],.008,'dark',6);C.cylY(X1-.7,-.35,3.05,3.1,.08,'dark',16);
  C.lamp(X1-.4,3.05,.75,'amber',.035);
  C.box(TX+.4,TX+1.2,3.05,3.085,-.75,-.15,'dark',.01);C.box(TX+.43,TX+1.17,3.085,3.11,-.72,-.18,G,.01);C.handle(TX+1.05,3.12,-.45,.22);
  [TX+.5,TX+1.1].forEach(x=>C.rod([x,3.1,-.78],[x+.08,3.1,-.78],.018,'dark',8));
  // кабель живлення від генератора до башти
  C.rod([X1+.42,2.2,.4],[X1+.7,1.5,.7],.03,'cable',8);C.rod([X1+.7,1.5,.7],[7.9,1.2,.8],.03,'cable',8);
  C.box(X1+.4,X1+.48,2.1,2.35,.25,.55,'dark',.01);
  // накладні бронепанелі на бортах (рельєф + тіньові зазори), ящики ЗІП, кабельні короби, такелажні вушка
  [-1,1].forEach(sd=>{const z=sd*1.222;
    [[X0+.06,X0+.8,2.03,2.47],[TX+1.24,X1-.62,2.03,2.47],[X0+.06,TX+.18,2.03,2.2]].forEach(([a,b,c,d])=>{C.box(a,b,c,d,z,z+sd*.03,G,.012);C.bolts([[a+.05,c+.04],[b-.05,c+.04],[a+.05,d-.04],[b-.05,d-.04],[(a+b)/2,d-.04],[(a+b)/2,c+.04]].map(([x,y])=>[x,y,z+sd*.032,Math.PI/2]));});
    C.box(X0+.15,X0+.75,2.25,2.42,z+sd*.03,z+sd*.06,D,.01);// табличка/ящик
    C.box(X0+.3,TX+.1,1.9,1.98,z-sd*.05,z+sd*.05,'dark',.01);// кабельний короб під бортом
    // ящик ЗІП на кронштейнах
    C.box(TX-1.05,TX-.25,1.62,1.93,sd*1.1,sd*1.38,D,.02);C.box(TX-1.02,TX-.28,1.9,1.95,sd*1.12,sd*1.36,G,.01);[TX-.95,TX-.35].forEach(x=>C.box(x-.03,x+.03,1.6,1.66,sd*1.0,sd*1.38,'dark',.005));
    C.box(TX-.7,TX-.6,1.73,1.82,sd*1.38,sd*1.4,'dark',.004);
    // фаска даху: стики листів
    // генератор: дверцята з петлями, замками і швами на бортах
    });
  [-1,1].forEach(sd=>{const z=sd*1.105;C.box(7.98,8.68,1.18,1.98,z,z+sd*.012,'dark',.002);C.box(8.0,8.66,1.2,1.96,z+sd*.003,z+sd*.016,D,.006);[1.3,1.85].forEach(y=>C.rod([8.0,y,z+sd*.02],[8.0,y+.08,z+sd*.02],.016,'dark',8));C.handle(8.55,1.5,z+sd*.025,.2,'y');
    C.mesh(new T.TorusGeometry(.05,.013,6,12),kbM('dark'),C.P(8.0,2.08,sd*.95),[0,0,0]);C.mesh(new T.TorusGeometry(.05,.013,6,12),kbM('dark'),C.P(9.1,2.08,sd*.95),[0,0,0]);});
  // торець генератора: дві дверцята, решітка радіатора, заливна горловина, табличка
  [[-1.0,-.05],[.05,1.0]].forEach(([a,b])=>{C.box(9.2,9.215,1.15,1.98,a,b,'dark',.002);C.box(9.205,9.225,1.17,1.96,a+.02,b-.02,D,.006);C.box(9.225,9.24,1.55,1.62,a<0?b-.15:a+.05,a<0?b-.05:a+.15,'chrome',.004);});
  for(let i=0;i<6;i++)C.box(9.225,9.25,1.62+i*.05,1.645+i*.05,-.85,-.2,'dark',.003);C.box(9.225,9.25,1.25,1.4,.3,.6,'steel',.004);C.cylZ(9.0,2.06,.6,.66,.06,'dark',12);
  // кришка генератора: шви і решітка вихлопу
  C.box(8.0,9.1,2.05,2.065,-1.0,1.0,'dark',.002);C.box(8.02,9.08,2.06,2.08,-.98,.98,D,.008);for(let i=0;i<6;i++)C.box(8.35+i*.1,8.4+i*.1,2.08,2.1,-.3,.4,'dark',.003);
  // лобовий накладний лист і протиковзкі ділянки на даху
  hexa([[X0-.06,2.58,-1.1],[X0+.38,2.58,-1.1],[X0+.38,2.58,1.1],[X0-.06,2.58,1.1],[X0+.72,3.0,-.95],[X0+.86,3.0,-.95],[X0+.86,3.0,.95],[X0+.72,3.0,.95]],D);
  [[TX-.5,TX+.2,-.9,-.2],[TX+.4,TX+1.25,.2,.9]].forEach(([a,b,c,d])=>C.box(a,b,3.05,3.075,c,d,'treadS',.004));
  // решітка кормової ніші
  for(let i=0;i<7;i++)C.box(X1+.38,X1+.43,2.2+i*.08,2.235+i*.08,-.7,.7,'dark',.003);C.box(X1+.36,X1+.4,2.15,2.75,-.75,.75,'dark',.006);}
/* Crotale: доповнення — радар супроводу з обтічником, ТВ/ІЧ-візир, РЛС виявлення, фари, дзеркала, антени, спорядження */
function kbCrotale(C){const O='olive';
  // РЛС супроводу: обтічник на лобі центрального блока
  C.rod([2.47,2.72,0],[2.3,2.72,0],.36,'dark',32);C.rod([2.3,2.72,0],[2.22,2.72,0],.33,O,32);
  C.mesh(new T.SphereGeometry(.33,24,12,0,Math.PI*2,0,Math.PI/2),kbM(O),C.P(2.22,2.72,0),[0,0,Math.PI/2]).scale.set(1,.35,1);
  // ТВ / ІЧ-візир над ним
  C.box(2.5,3.0,2.98,3.24,-.17,.17,'dark',.03);C.box(2.47,2.52,3.03,3.19,-.13,-.01,'glass',.005);C.box(2.47,2.52,3.05,3.17,.03,.12,'glass',.005);
  // РЛС виявлення на щоглі
  C.cylY(3.45,0,2.98,3.42,.08,'dark',16);C.cylY(3.45,0,3.42,3.5,.18,O,24);
  C.box(3.3,3.6,3.5,3.62,-.25,.25,'dark',.02);C.prof([[3.18,3.6],[3.62,3.6],[3.55,4.05],[3.25,4.05]],-.78,.78,O,.02);
  for(let i=0;i<5;i++)C.box(3.17,3.19,3.65+i*.08,3.68+i*.08,-.72,.72,'dark',.003);
  // торці контейнерів
  [-1,1].forEach(sd=>{[2.62,2.94].forEach(y=>{C.cylZ(1.38,y,sd*.62,sd*1.02,.02,'dark',8);});});
  // фари з захисними ґратами, буксирні скоби
  [-1,1].forEach(sd=>{const z=sd*.92;C.rod([.42,1.22,z],[.3,1.22,z],.1,'dark',20);C.rod([.31,1.22,z],[.29,1.22,z],.085,'glass',20);
    [-.06,0,.06].forEach(d=>C.rod([.26,1.12,z+d],[.26,1.32,z+d],.008,'dark',6));C.rod([.42,1.33,z],[.25,1.33,z],.01,'dark',6);
    C.lamp(.5,1.4,sd*1.12,'amber',.035);
    C.mesh(new T.TorusGeometry(.07,.02,8,16),kbM('dark'),C.P(.22,.78,sd*.55),[0,Math.PI/2,0]);
    // дзеркала
    C.rod([1.1,1.75,sd*1.26],[1.0,1.95,sd*1.48],.015,'dark',8);C.box(.94,1.04,1.9,2.15,sd*1.43,sd*1.6,'dark',.015);
    // ящики ЗІП на бортах, поручні
    C.box(4.6,5.15,1.0,1.42,sd*1.25,sd*1.4,O,.02);C.handle(4.75,1.3,sd*1.42,.25);
    C.handle(1.5,1.98,sd*1.2,.6);C.handle(4.6,1.97,sd*1.2,.5);
    // антени на кормі
    C.cylY(5.8,sd*1.05,1.76,1.84,.05,'dark',10);C.rod([5.8,1.84,sd*1.05],[5.85,3.7,sd*1.05],.008,'dark',6);
    // задні ліхтарі
    C.box(6.1,6.2,1.25,1.4,sd*.95,sd*1.15,'red',.01);C.box(6.1,6.2,1.08,1.2,sd*.95,sd*1.15,'amber',.01);});
  // каністри та скатка маскувальної сітки на кормі
  [.45,.68].forEach(z=>{C.box(5.2,5.55,1.86,2.32,z-.1,z+.1,O,.02);C.box(5.2,5.24,2.24,2.32,z-.05,z+.05,'dark',.01);});
  C.cylZ(5.45,2.05,-.9,.2,.17,'strap',18);[-.7,-.1].forEach(z=>C.cylZ(5.45,2.05,z-.03,z+.03,.18,'dark',18));
  C.cylZ(5.95,1.95,-.3,.1,.12,'dark',16);C.cylZ(5.95,1.95,-.27,.07,.13,'cable',16);}
/* спільні допоміжні: балка між двома точками; кришка погону Т-72 */
function kbBeam(C,a,b,h,w,m,r){const pa=C.P(...a),pb=C.P(...b),d=pb.clone().sub(pa),L=d.length();const o=C.mesh(kbRB(L,h,w,r==null?.02:r),m,pa.clone().add(pb).multiplyScalar(.5));o.quaternion.setFromUnitVectors(new T.Vector3(1,0,0),d.normalize());return o;}
/* колійна секція мосту: бортові ферми (пояси + розкоси Уоррена + стійки), рифлений настил, бордюри, поперечні балки, скоси-аппарелі.
   x0..x1 від носа, y0 низ, y1 верх, z0<z1 ширина колії; e — довжина скосу; M — фарба, TR — настил; o.hinge — шарнірні вушка на кінці x1 */
function kbTreadway(C,x0,x1,y0,y1,z0,z1,M,TR,o){o=o||{};const e=o.e||1.0,h=y1-y0,yr=y1-h*.72;// висота торця скосу
  const P=(x,y)=>[x,y];const bot=x=>x<x0+e?yr+(y0-yr)*(x-x0)/e:x>x1-e?y0+(yr-y0)*(x-(x1-e))/e:y0;
  // настил з рифленого листа та верхні пояси
  C.box(x0,x1,y1-.035,y1,z0,z1,TR,.006);
  [z0,z1].forEach((z,k)=>{const zo=k?z-.07:z+.07;// бортова ферма на відстані .07 від краю
    kbBeam(C,[x0,y1-.06,zo],[x1,y1-.06,zo],.09,.12,M,.012);// верхній пояс
    kbBeam(C,[x0,yr,zo],[x0+e,y0+.04,zo],.08,.12,M,.01);kbBeam(C,[x0+e,y0+.04,zo],[x1-e,y0+.04,zo],.08,.12,M,.01);kbBeam(C,[x1-e,y0+.04,zo],[x1,yr,zo],.08,.12,M,.01);// нижній пояс
    C.box(x0-.02,x0+.06,yr-.02,y1,zo-.07,zo+.07,M,.01);C.box(x1-.06,x1+.02,yr-.02,y1,zo-.07,zo+.07,M,.01);
    // решітка: стійки + розкоси
    const n=Math.max(4,Math.round((x1-x0)/.85)),dx=(x1-x0)/n;
    for(let i=0;i<=n;i++){const x=x0+i*dx;if(i>0&&i<n)C.box(x-.03,x+.03,bot(x)+.06,y1-.1,zo-.045,zo+.045,M,.008);
      if(i<n){const xa=x,xb=x+dx;const up=i%2===0;kbBeam(C,[xa,up?bot(xa)+.07:y1-.1,zo],[xb,up?y1-.1:bot(xb)+.07,zo],.055,.07,M,.008);}}
    // косинки у вузлах
    for(let i=1;i<n;i++){const x=x0+i*dx;C.box(x-.09,x+.09,y1-.2,y1-.1,zo-.012,zo+.012,M,.004);C.box(x-.09,x+.09,bot(x)+.06,bot(x)+.15,zo-.012,zo+.012,M,.004);}
    C.bolts([...Array(Math.round((x1-x0)/.3))].map((_,i)=>[x0+.15+i*.3,y1-.06,zo+(k?.065:-.065),Math.PI/2]));});
  // внутрішній поздовжній лонжерон і поперечні балки під настилом
  kbBeam(C,[x0+e*.6,y1-.14,(z0+z1)/2],[x1-e*.6,y1-.14,(z0+z1)/2],.18,.06,'dark',.01);
  for(let x=x0+.45;x<x1-.3;x+=.85)C.box(x-.04,x+.04,y1-.2,y1-.035,z0+.1,z1-.1,'dark',.006);
  // поперечні планки-грунтозачепи на настилі та бордюри зі стійками
  for(let x=x0+.25;x<x1-.15;x+=.42)C.box(x,x+.035,y1,y1+.022,z0+.12,z1-.12,'dark',.004);
  [z0+.04,z1-.04].forEach(z=>{kbBeam(C,[x0+.15,y1+.13,z],[x1-.15,y1+.13,z],.05,.05,M,.008);for(let x=x0+.3;x<x1-.2;x+=.9)C.box(x-.025,x+.025,y1,y1+.11,z-.022,z+.022,M,.004);});
  // скоси: зубчаста кромка
  [[x0,1],[x1,-1]].forEach(([xe,sg])=>{for(let z=z0+.1;z<z1-.05;z+=.18)C.box(xe-.03,xe+.03,yr-.04,yr+.02,z,z+.09,'steel',.004);});
  if(o.web)[z0,z1].forEach((z,k)=>{const zi=k?z-.13:z+.13;C.prof([[x0+.05,yr+.02],[x0+e,y0+.08],[x1-e,y0+.08],[x1-.05,yr+.02],[x1-.05,y1-.1],[x0+.05,y1-.1]],zi-.008,zi+.008,'dark',.003);});
  if(o.hinge){[z0+.12,(z0+z1)/2,z1-.12].forEach(z=>{C.box(x1-.15,x1+.1,y1-.22,y1-.02,z-.06,z+.06,'dark',.01);});}}
function kbT72Deck(C,O){C.box(2.5,4.3,1.3,1.42,-1.0,1.0,O,.03);C.bolts([...Array(10)].map((_,i)=>[2.6+i*.18,1.42,.95,0]).concat([...Array(10)].map((_,i)=>[2.6+i*.18,1.42,-.95,0])));}
function kbBlade(C,x,w,h,m,arm){// бульдозерний відвал перед носом (x — передня кромка)
  C.prof([[x,0.08],[x+.32,0.08],[x+.42,.3],[x+.38,h],[x+.12,h+.06],[x+.02,h-.25],[x+.1,.5]],-w/2,w/2,m,.02);
  C.box(x-.05,x+.08,0.05,0.14,-w/2,w/2,'steel',.01);// ріжуча кромка
  for(let z=-w/2+.35;z<w/2;z+=.55)C.prof([[x+.36,.15],[x+.46,.15],[x+.46,h-.1],[x+.36,h-.05]],z-.04,z+.04,m,.01);
  [-1,1].forEach(sd=>{kbBeam(C,[x+.4,.45,sd*1.25],[arm,.7,sd*1.25],.16,.14,m);C.ram([x+.4,h-.15,sd*.8],[arm-.3,1.1,sd*.8],.07,m);});}
/* БРЕМ-1 (Т-72): рубка, кран 12 т, вантажна платформа, бульдозерний відвал, НСВТ */
function kbBrem1(C){const O='sov';kbT72Deck(C,O);
  C.prof([[2.25,1.36],[4.55,1.36],[4.55,2.12],[2.75,2.12],[2.25,1.78]],-1.32,.35,O,.04);// рубка
  [-1.1,-.6,-.1].forEach(z=>{C.box(2.38,2.62,1.82,1.98,z-.11,z+.11,'dark',.015);C.box(2.36,2.4,1.85,1.95,z-.08,z+.08,'glass',.004);});
  C.cylY(3.7,-.75,2.12,2.24,.36,O,28);C.cylY(3.7,-.75,2.24,2.29,.28,'dark',24);for(let i=0;i<6;i++){const a=i/6*6.28;C.box(3.7+Math.cos(a)*.34-.04,3.7+Math.cos(a)*.34+.04,2.14,2.22,-.75+Math.sin(a)*.34-.04,-.75+Math.sin(a)*.34+.04,'glass',.004);}
  C.rod([3.6,2.4,-.75],[2.85,2.42,-.75],.022,'dark',10);C.box(3.45,3.85,2.3,2.48,-.86,-.64,'dark',.02);C.box(3.6,3.75,2.29,2.33,-.82,-.68,'dark',.01);// НСВТ
  C.cylY(4.15,-.1,2.12,2.2,.3,O,24);C.handle(4.1,2.22,-.1,.2);
  // кран: поворотна основа праворуч спереду, стріла покладена назад уздовж правого борту
  C.cylY(1.95,.98,1.34,1.62,.42,'dark',32);C.cylY(1.95,.98,1.62,1.8,.36,O,32);
  [.86,1.12].forEach(z=>C.prof([[1.7,1.8],[2.3,1.8],[2.15,2.25],[1.85,2.25]],z-.05,z+.05,O,.02));
  C.prof([[1.9,2.02],[6.6,2.1],[6.6,2.34],[1.9,2.3]],.84,1.14,O,.03);C.prof([[6.6,2.12],[7.25,2.15],[7.25,2.32],[6.6,2.32]],.88,1.1,O,.02);
  C.cylZ(7.25,2.24,.86,1.12,.1,'dark',16);C.rod([7.25,2.14,.99],[7.25,1.75,.99],.012,'cable',6);C.box(7.15,7.35,1.55,1.75,.92,1.06,'yellow',.02);
  C.mesh(new T.TorusGeometry(.07,.018,8,16,Math.PI*1.4),kbM('dark'),C.P(7.25,1.47,.99),[0,Math.PI/2,0]);
  C.ram([2.3,1.75,.99],[3.6,2.12,.99],.08,O);C.box(6.3,6.5,1.45,2.08,.9,1.08,'dark',.02);// опора стріли
  // вантажна платформа на МТВ з бортиками й вантажем
  C.box(4.7,6.35,1.47,1.53,-1.3,.6,'steel',.01);[-1.3,.6].forEach(z=>C.box(4.7,6.35,1.53,1.75,z-.03,z+.03,'dark',.01));[4.7,6.35].forEach(x=>C.box(x-.03,x+.03,1.53,1.75,-1.3,.6,'dark',.01));
  C.box(4.9,5.9,1.53,2.05,-1.15,-.1,'crate',.04);[5.15,5.65].forEach(x=>C.box(x-.03,x+.03,1.53,2.07,-1.17,-.08,'strap',.004));
  C.box(6.0,6.3,1.53,1.9,-1.2,-.85,O,.02);C.box(6.0,6.3,1.53,1.9,-.8,-.45,O,.02);// каністри
  // буксирні штанги, троси, запасні траки
  [-1,1].forEach(sd=>{C.rod([1.3,1.38,sd*1.5],[5.8,1.38,sd*1.5],.05,'cable',10);C.rod([1.3,1.47,sd*1.5],[5.8,1.47,sd*1.5],.05,'cable',10);
    for(let i=0;i<4;i++)C.box(.9+i*.2,1.08+i*.2,1.25,1.33,sd*1.3,sd*1.6,'dark',.01);});
  kbBeam(C,[2.4,1.48,-1.42],[6.3,1.48,-1.42],.1,.1,'dark');
  C.cylZ(6.8,1.25,-.6,.6,.2,'dark',24);C.cylZ(6.8,1.25,-.55,.55,.22,'cable',24);// лебідка
  kbBlade(C,-.75,3.4,1.05,O,.65);C.lamp(2.5,1.36,1.25,'amber',.05);}
/* МТУ-72 (Т-72): колійний міст 20 м складений удвоє, механізм наведення, опорна плита */
function kbMtu72(C){const O='sov';kbT72Deck(C,O);
  C.prof([[1.55,1.36],[2.55,1.36],[2.55,1.85],[1.85,1.85],[1.55,1.6]],-1.3,-.45,O,.03);C.box(1.62,1.72,1.6,1.75,-1.2,-.55,'glass',.004);// кабіна
  C.cylY(2.2,-.85,1.85,1.93,.25,O,24);
  // міст: дві колії × дві секції (верхня складена над нижньою), шарніри складання в кормі, гідроциліндри розкладання
  const LO=[1.72,2.42],UP=[2.56,3.3];
  [-1,1].forEach(sd=>{const z0=Math.min(sd*.27,sd*1.68),z1=Math.max(sd*.27,sd*1.68);
    kbTreadway(C,-2.3,8.75,LO[0],LO[1],z0,z1,O,'treadS',{e:1.1,hinge:1});kbTreadway(C,-2.2,8.75,UP[0],UP[1],z0,z1,O,'treadS',{e:1.1,hinge:1});
    // шарнір складання: проушини обох секцій, вісь, тяги
    [z0+.12,(z0+z1)/2,z1-.12].forEach(z=>{C.prof([[8.6,LO[1]-.25],[8.95,LO[1]-.1],[9.05,UP[0]+.25],[8.6,UP[0]+.35]],z-.035,z+.035,'dark',.01);});
    C.cylZ(8.95,(LO[1]+UP[0])/2,z0+.05,z1-.05,.085,'steel',20);[z0+.03,z1-.03].forEach(z=>C.cylZ(8.95,(LO[1]+UP[0])/2,z-.03,z+.03,.12,'dark',20));
    // гідроциліндри складання між секціями (на зовнішньому борту)
    const zo=sd>0?z1+.06:z0-.06;C.ram([6.9,LO[0]+.25,zo],[8.7,UP[0]+.45,zo],.07,O);[[6.9,LO[0]+.25],[8.7,UP[0]+.45]].forEach(([x,y])=>C.cylZ(x,y,zo-.06,zo+.06,.06,'dark',14));
    // з'єднувальні траверси між коліями
    // ложементи на корпусі
    [3.0,5.9].forEach(x=>{C.box(x-.14,x+.14,1.4,1.5,sd*.5,sd*1.4,'dark',.02);C.box(x-.1,x+.1,1.5,1.72,sd*.6,sd*1.3,O,.02);C.box(x-.12,x+.12,1.68,1.72,sd*.55,sd*1.35,'rubber',.005);});});
  [-1.4,1.6,4.6,7.6].forEach(x=>{C.box(x-.06,x+.06,LO[0]+.08,LO[0]+.2,-.3,.3,'dark',.01);C.box(x-.06,x+.06,UP[1]-.2,UP[1]-.08,-.3,.3,'dark',.01);});
  // пускова балка (консоль) з кареткою та А-подібна рама наведення
  kbBeam(C,[-.3,1.38,0],[7.2,1.62,0],.24,.36,O,.03);for(let x=.3;x<7;x+=.8)C.box(x-.02,x+.02,1.4,1.62,-.19,.19,'dark',.004);
  C.box(-.25,.45,1.55,1.72,-.4,.4,'dark',.02);[-1,1].forEach(sd=>{kbBeam(C,[.6,1.25,sd*.9],[.05,1.68,sd*.25],.12,.12,O);});C.cylZ(.05,1.68,-.45,.45,.07,'steel',14);
  C.ram([1.0,1.3,.35],[3.5,1.6,.35],.1,O);C.ram([1.0,1.3,-.35],[3.5,1.6,-.35],.1,O);[-1,1].forEach(sd=>C.cylZ(1.0,1.3,sd*.28,sd*.42,.08,'dark',14));
  kbBlade(C,-.62,3.2,.9,O,.6);C.lamp(.5,1.2,1.3,'amber',.05);C.lamp(.5,1.2,-1.3,'amber',.05);}
/* ІМР-2 (Т-72): поворотна кабіна оператора, телескопічна стріла з маніпулятором, універсальний відвал, трал */
function kbImr2(C){const O='sov',R=3.4;kbT72Deck(C,O);
  C.cylY(R,0,1.36,1.5,.95,'dark',36);C.cylY(R,0,1.5,1.6,.9,O,36);
  // броньована кабіна оператора (ліворуч) і поворотна платформа
  C.prof([[2.55,1.6],[4.4,1.6],[4.4,2.45],[3.2,2.55],[2.75,2.3],[2.55,1.95]],-1.05,-.05,O,.04);
  [[2.62,2.05],[2.85,2.38]].forEach(([x,y],i)=>C.box(x-.04,x+.04,y-.1,y+.08,-.95,-.15,'glass',.005));
  C.box(3.3,4.3,2.47,2.6,-.95,-.2,O,.02);C.cylY(3.85,-.6,2.6,2.72,.25,'dark',20);C.rod([3.7,2.7,-.6],[3.1,2.72,-.6],.012,'dark',8);C.box(3.6,3.9,2.64,2.78,-.68,-.52,'dark',.01);// ПКТ
  C.box(3.0,4.4,1.6,2.0,.05,1.0,O,.03);// гідравлічний відсік
  // телескопічна стріла, складена назад праворуч, з маніпулятором-захватом
  C.box(3.3,3.75,2.0,2.45,.3,.75,'dark',.02);C.cylZ(3.5,2.3,.25,.8,.12,'dark',16);
  kbBeam(C,[3.5,2.35,.52],[7.6,2.05,.52],.34,.3,O,.03);kbBeam(C,[7.4,2.07,.52],[8.6,1.98,.52],.26,.22,O,.02);
  C.ram([3.9,2.0,.52],[5.2,2.25,.52],.08,O);
  [-1,1].forEach(sd=>{kbBeam(C,[8.6,1.98,.52+sd*.08],[9.0,1.7,.52+sd*.22],.1,.08,'dark');kbBeam(C,[9.0,1.7,.52+sd*.22],[9.05,1.3,.52+sd*.12],.08,.07,'dark');});
  C.cylZ(8.6,1.98,.35,.69,.08,'dark',14);C.box(6.2,6.5,1.45,1.95,.38,.66,'dark',.02);// опора стріли
  // трал КМТ на кормі (складений) і заряди розмінування
  C.box(6.2,6.9,1.47,1.95,-1.3,-.35,O,.03);for(let i=0;i<4;i++)C.cylZ(6.3+i*.15,1.85,-1.25,-.4,.06,'dark',12);
  [-1,1].forEach(sd=>{C.rod([1.3,1.42,sd*1.5],[5.8,1.42,sd*1.5],.05,'cable',10);for(let i=0;i<4;i++)C.box(.9+i*.2,1.08+i*.2,1.25,1.33,sd*1.3,sd*1.6,'dark',.01);});
  // універсальний відвал (дві секції — V або пряме положення)
  [-1,1].forEach(sd=>{C.prof([[-.9,0.08],[-.58,0.08],[-.46,.3],[-.5,1.12],[-.78,1.18],[-.88,.9],[-.8,.5]],sd*.05,sd*2.15,O,.02);
    C.box(-.95,-.82,.05,.15,sd*.05,sd*2.15,'steel',.01);for(let z=.4;z<2.1;z+=.5)C.prof([[-.52,.15],[-.42,.15],[-.42,1.0],[-.52,1.05]],sd*z-.04,sd*z+.04,O,.01);
    kbBeam(C,[-.45,.45,sd*1.2],[.65,.7,sd*1.2],.16,.14,O);C.ram([-.45,1.0,sd*.8],[.4,1.1,sd*.8],.07,O);});
  C.lamp(2.6,1.36,1.25,'amber',.05);}
/* Pionierpanzer 2 Dachs (Leopard 1): рубка, телескопічний екскаватор праворуч, відвал 3,75 м, лебідка */
function kbDachs(C){const N='natob';
  C.box(2.65,7.15,1.4,1.5,-1.2,1.2,N,.03);// перекриття
  C.prof([[1.95,1.42],[4.6,1.42],[4.6,2.35],[2.55,2.35],[1.95,1.9]],-1.38,-.05,N,.04);// рубка
  [-1.15,-.75,-.35].forEach(z=>{C.box(2.12,2.32,2.0,2.16,z-.1,z+.1,'dark',.015);C.box(2.1,2.14,2.03,2.13,z-.08,z+.08,'glass',.004);});
  [[3.1,-1.0],[3.9,-.45]].forEach(([x,z])=>{C.cylY(x,z,2.35,2.43,.3,N,28);C.cylY(x,z,2.43,2.47,.22,'dark',24);});
  C.rod([3.1,2.5,-1.0],[2.6,2.62,-1.0],.02,'dark',8);C.box(2.95,3.3,2.47,2.62,-1.06,-.94,'dark',.02);// MG3
  // екскаватор: основа праворуч спереду, телескопічна стріла назад, ківш на кормі
  C.cylY(2.1,.72,1.48,1.72,.5,'dark',32);C.cylY(2.1,.72,1.72,1.9,.42,N,32);
  [.42,1.02].forEach(z=>C.prof([[1.8,1.9],[2.5,1.9],[2.35,2.45],[1.95,2.45]],z-.07,z+.07,N,.02));
  kbBeam(C,[2.15,2.3,.72],[6.4,2.12,.72],.42,.4,N,.03);kbBeam(C,[6.2,2.12,.72],[7.7,2.05,.72],.32,.3,N,.03);kbBeam(C,[7.5,2.05,.72],[8.5,2.0,.72],.24,.22,'dark',.02);
  C.ram([2.5,1.95,.72],[3.9,2.3,.72],.1,N);
  C.prof([[8.35,1.55],[8.95,1.55],[9.05,2.05],[8.55,2.18],[8.35,1.95]],.38,1.06,'dark',.02);for(let i=0;i<5;i++)C.box(8.95,9.1,1.48,1.58,.42+i*.14,.5+i*.14,'steel',.005);// ківш
  C.box(6.6,6.9,1.5,1.95,.5,.95,'dark',.02);
  // лебідка, троси, ящики
  C.cylZ(7.95,1.3,-.55,.55,.22,'dark',28);C.cylZ(7.95,1.3,-.5,.5,.24,'cable',28);
  [-1,1].forEach(sd=>{C.rod([2.5,1.4,sd*1.66],[6.9,1.4,sd*1.66],.05,'cable',10);C.rod([2.5,1.5,sd*1.66],[6.9,1.5,sd*1.66],.05,'cable',10);});
  C.box(4.8,6.0,1.5,1.9,-1.15,-.1,N,.03);C.box(4.85,5.95,1.9,1.94,-1.1,-.15,'dark',.01);
  kbBlade(C,-.85,3.75,1.1,N,.75);C.lamp(4.3,2.35,-.6,'amber',.07);}
/* Biber (Leopard 1): двосекційний міст 22 м (секції одна над одною), консоль наведення, опорний відвал */
function kbBiber(C){const N='natob';
  C.box(2.65,7.15,1.4,1.5,-1.2,1.2,N,.03);
  C.prof([[1.95,1.42],[3.4,1.42],[3.4,1.95],[2.4,1.95],[1.95,1.7]],-1.35,-.35,N,.03);C.box(2.0,2.1,1.72,1.88,-1.25,-.45,'glass',.004);
  // міст 22 м: дві секції одна над одною, кожна — дві колії з коробчастими фермами та рифленим настилом; центральна ферма між коліями
  const sect=(x0,x1,y0,y1)=>{[-1,1].forEach(sd=>{const z0=Math.min(sd*.16,sd*2.0),z1=Math.max(sd*.16,sd*2.0);kbTreadway(C,x0,x1,y0,y1,z0,z1,N,'treadN',{e:1.25,web:1});});
    for(let x=x0+.6;x<x1-.4;x+=1.4)C.box(x-.05,x+.05,y0+.1,y1-.06,-.17,.17,'dark',.008);kbBeam(C,[x0+.4,y1-.08,0],[x1-.4,y1-.08,0],.08,.3,'dark',.01);};
  sect(-1.9,9.6,1.62,2.42);sect(-1.8,9.5,2.56,3.4);
  // замки-фіксатори між секціями, напрямні каретки, вушка
  [-.8,2.4,5.6,8.6].forEach(x=>[-1,1].forEach(sd=>{C.box(x-.1,x+.1,2.38,2.6,sd*1.95,sd*2.08,'dark',.01);C.cylZ(x,2.49,sd*2.06,sd*2.12,.05,'steel',10);}));
  // консоль наведення: поворотна балка з кареткою, рами і гідроциліндри
  kbBeam(C,[-.2,1.32,0],[7.6,1.58,0],.22,.5,N,.03);for(let x=.4;x<7.4;x+=.75)C.box(x-.02,x+.02,1.35,1.58,-.26,.26,'dark',.004);
  [-1,1].forEach(sd=>{kbBeam(C,[.8,1.2,sd*1.0],[.1,1.58,sd*.3],.14,.12,N);C.ram([.9,1.3,sd*.42],[4.0,1.56,sd*.42],.11,N);C.cylZ(.9,1.3,sd*.32,sd*.52,.09,'dark',14);});
  C.cylZ(.1,1.58,-.5,.5,.08,'steel',14);C.box(-.3,.5,1.5,1.62,-.45,.45,'dark',.02);
  [3.2,6.4].forEach(x=>[-1,1].forEach(sd=>{C.box(x-.14,x+.14,1.48,1.55,sd*.5,sd*1.5,'dark',.02);C.box(x-.1,x+.1,1.55,1.62,sd*.6,sd*1.4,'rubber',.005);}));
  kbBlade(C,-.7,3.5,.95,N,.6);C.lamp(.5,1.25,1.3,'amber',.05);C.lamp(.5,1.25,-1.3,'amber',.05);}
const KB_FN={brem1:kbBrem1,mtu72:kbMtu72,imr2:kbImr2,dachs:kbDachs,biber:kbBiber,crotale:kbCrotale,skynex:kbSkynex,d20:kbD20,zuzana:kbZuzana,m984:kbM984,lhs:kbLHS,m1084:kbM1084,berge:kbBerge};
function kbBuild(D,seat,model){const f=KB_FN[D.kb];if(!f)return null;seat.updateMatrixWorld(true);let B=new T.Box3().setFromObject(model);B.applyMatrix4(new T.Matrix4().copy(seat.matrixWorld).invert());if(D.kbBox){const k=D.kbBox;B=new T.Box3(new T.Vector3(-k[0]/2,0,-k[2]/2),new T.Vector3(k[0]/2,k[1],k[2]/2));}const C=kbCtx(seat,model,B);f(C);return C.G;}
