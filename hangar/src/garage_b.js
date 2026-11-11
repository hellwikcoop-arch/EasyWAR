/* ---------- зала ---------- */
function buildHall(){
  const fc=cv(2048,2048,(x,w,h)=>{x.fillStyle='#6d6c66';x.fillRect(0,0,w,h);speck(x,w,h,60000,.10,40,170,1,3);blot(x,w,h,70,'rgba(40,38,34,.22)',40,260);blot(x,w,h,40,'rgba(150,146,135,.18)',60,300);
    blot(x,w,h,26,'rgba(18,16,12,.42)',10,70);
    x.strokeStyle='rgba(25,24,22,.55)';x.lineWidth=5;for(let i=0;i<=4;i++){x.beginPath();x.moveTo(i*w/4,0);x.lineTo(i*w/4,h);x.stroke();x.beginPath();x.moveTo(0,i*h/4);x.lineTo(w,i*h/4);x.stroke();}
    x.strokeStyle='rgba(30,28,25,.35)';x.lineWidth=1.5;for(let i=0;i<40;i++){x.beginPath();let px=Math.random()*w,py=Math.random()*h;x.moveTo(px,py);for(let k=0;k<6;k++){px+=rnd(-40,40);py+=rnd(-40,40);x.lineTo(px,py);}x.stroke();}
    x.fillStyle='rgba(20,20,18,.16)';for(let t=0;t<6;t++){const y0=rnd(0,h);for(let i=0;i<w;i+=14){x.fillRect(i,y0+Math.sin(i*.004+t)*40,8,26);}}});
  const fr=cv(1024,1024,(x,w,h)=>{x.fillStyle='#d8d8d8';x.fillRect(0,0,w,h);speck(x,w,h,20000,.25,120,255,1,3);blot(x,w,h,30,'rgba(40,40,40,.7)',10,60);});
  const fmap=tex(fc),frough=tex(fr,null,false);[fmap,frough].forEach(t=>{t.wrapS=t.wrapT=T.RepeatWrapping;t.repeat.set(1/16,1/16);});frough.repeat.set(1/8,1/8);
  mats.floor=std({map:fmap,roughnessMap:frough,roughness:.8,metalness:0,envMapIntensity:.32,color:0x8e8b84});
  const PX=6.2,PZ=.78,PD=1.55;G.pit={PX,PZ};
  const sh=new T.Shape();sh.moveTo(-HL,-HW);sh.lineTo(HL+30,-HW-6);sh.lineTo(HL+30,HW+6);sh.lineTo(-HL,HW);sh.lineTo(-HL,-HW);
  const hole=new T.Path();hole.moveTo(-PX,-PZ);hole.lineTo(-PX,PZ);hole.lineTo(PX,PZ);hole.lineTo(PX,-PZ);hole.lineTo(-PX,-PZ);sh.holes.push(hole);
  const fg=new T.ShapeGeometry(sh);fg.rotateX(-PI/2);
  add(M(fg,mats.floor,false,true));
  const lineTex=tex(cv(512,64,(x,w,h)=>{x.fillStyle='#e0b52a';x.fillRect(0,0,w,h);speck(x,w,h,1500,.3,0,90,1,4);wear(x,w,h,700);}));
  const lineMat=std({map:lineTex,transparent:true,roughness:.7,polygonOffset:true,polygonOffsetFactor:-2,depthWrite:false});
  const strip=(x0,z0,x1,z1,wd)=>{const L=Math.hypot(x1-x0,z1-z0);const g=new T.PlaneGeometry(L,wd);g.rotateX(-PI/2);const m=M(g,lineMat,false,true);m.position.set((x0+x1)/2,.004,(z0+z1)/2);m.rotation.y=-Math.atan2(z1-z0,x1-x0);add(m);};
  strip(-14,-4.6,HL,-4.6,.16);strip(-14,4.6,HL,4.6,.16);strip(-14,-4.6,-14,4.6,.16);
  strip(-HL+1,-HW+3,HL,-HW+3,.12);strip(-HL+1,HW-3,HL,HW-3,.12);
  for(let x=8;x<HL;x+=4.5)strip(x,0,x+2.2,0,.16);
  const hzc=cv(1024,64,(x,w,h)=>{hazard(x,0,0,w,h,32);wear(x,w,h,500);});
  const hz=(cx,cz,lx,lz,rep,ry=0)=>{const g=new T.PlaneGeometry(lx,lz);g.rotateX(-PI/2);const t=tex(hzc,[rep,1]);const mm=std({map:t,transparent:true,roughness:.65,polygonOffset:true,polygonOffsetFactor:-2,depthWrite:false});const m=M(g,mm,false,true);m.position.set(cx,.005,cz);m.rotation.y=ry;add(m);return m;};
  hz(0,PZ+.22,PX*2+.88,.44,7);hz(0,-PZ-.22,PX*2+.88,.44,7);hz(PX+.22,0,PZ*2,.44,1,PI/2);hz(-PX-.22,0,PZ*2,.44,1,PI/2);hz(HL-.6,0,16,1.0,8,PI/2);
  const pitC=cv(512,256,(x,w,h)=>{x.fillStyle='#4a4945';x.fillRect(0,0,w,h);speck(x,w,h,8000,.15,20,120);blot(x,w,h,20,'rgba(10,10,8,.5)',10,50);x.fillStyle='rgba(0,0,0,.35)';x.fillRect(0,h*.82,w,h*.18);});
  const pitM=std({map:tex(pitC),roughness:.95});
  [[-PZ,0],[PZ,PI]].forEach(([pz,ry])=>{const m=M(new T.PlaneGeometry(PX*2,PD),pitM,false,true);m.position.set(0,-PD/2,pz);m.rotation.y=ry;add(m);});
  [[-PX,PI/2],[PX,-PI/2]].forEach(([px,ry])=>{const m=M(new T.PlaneGeometry(PZ*2,PD),pitM,false,true);m.position.set(px,-PD/2,0);m.rotation.y=ry;add(m);});
  {const g=new T.PlaneGeometry(PX*2,PZ*2);g.rotateX(-PI/2);add(M(g,std({color:0x2a2a28,roughness:.6,metalness:.2}),false,true),[0,-PD,0]);}
  const edgeM=std({color:0xc89a1c,roughness:.5,metalness:.6});
  [PZ,-PZ].forEach(pz=>add(M(new T.BoxGeometry(PX*2,.06,.08),edgeM),[0,-.02,pz]));
  for(let i=0;i<5;i++)add(M(new T.BoxGeometry(.3,.05,PZ*2-.06),std({color:0x3c3d3a,metalness:.7,roughness:.5})),[-PX+.2+i*.28,-PD+.3+i*.26,0]);
  const grC=cv(256,256,(x,w,h)=>{x.fillStyle='#000';x.fillRect(0,0,w,h);x.fillStyle='#fff';for(let i=0;i<w;i+=16)x.fillRect(i,0,5,h);for(let j=0;j<h;j+=32)x.fillRect(0,j,w,4);});
  const grate=(cx,cy,cz,lx,lz)=>{const g=new T.PlaneGeometry(lx,lz);g.rotateX(-PI/2);const at=tex(grC,[lx*2,lz*2],false);const m=M(g,std({color:0x5a5c58,metalness:.85,roughness:.45,alphaMap:at,alphaTest:.5,side:T.DoubleSide}),true,true);m.position.set(cx,cy,cz);add(m);
    const fr2=std({color:0x3b3d3a,metalness:.8,roughness:.5});[lz/2,-lz/2].forEach(b=>add(M(new T.BoxGeometry(lx,.04,.05),fr2),[cx,cy-.02,cz+b]));};
  grate(-PX+1.1,0,0,1.9,PZ*2+.02);grate(PX-1.1,0,0,1.9,PZ*2+.02);
  for(let x=-30;x<30;x+=6.5)grate(x,.012,HW-1.35,1.2,.9);
  const pitL=new T.MeshBasicMaterial({color:0xfff1d0});
  [-PZ+.04,PZ-.04].forEach(z=>{for(let x=-PX+2.4;x<PX-2;x+=2.2)add(M(new T.BoxGeometry(.7,.06,.02),pitL,false,false),[x,-.35,z]);});
  G.pitLight=new T.PointLight(0xffe2b0,.9,9,2);G.pitLight.position.set(0,-.6,0);add(G.pitLight);
  
  // колони
  const colC=cv(256,1024,(x,w,h)=>{x.fillStyle='#8a8781';x.fillRect(0,0,w,h);speck(x,w,h,12000,.12,50,180);blot(x,w,h,20,'rgba(50,48,44,.25)',20,90);
    x.fillStyle='rgba(0,0,0,.12)';for(let j=0;j<h;j+=128)x.fillRect(0,j,w,3);
    for(let i=0;i<14;i++){x.fillStyle='rgba(40,36,30,.12)';x.fillRect(rnd(0,w),rnd(0,h*.5),rnd(2,6),rnd(60,300));}
    hazard(x,0,h-100,w,100,26);x.fillStyle='rgba(15,15,12,.7)';x.fillRect(0,h-104,w,4);});
  const colM=std({map:tex(colC),roughness:.9,metalness:0});const colG=new T.BoxGeometry(.9,WH,.9);
  G.colX=[];for(let x=-HL+4;x<=HL-4;x+=8)G.colX.push(x);
  G.colX.forEach((x,i)=>[-1,1].forEach(s=>{add(M(colG,colM),[x,WH/2,s*(HW-.45)]);add(M(new T.BoxGeometry(.9,.8,1.1),colM),[x,8.6,s*(HW-1.4)]);
    const nc=cv(128,128,(q,w,h)=>{stencil(q,'К-'+(i+1),w/2,h*.62,46,'rgba(230,226,215,.85)','center');wear(q,w,h,200);});
    const nm=new T.Mesh(new T.PlaneGeometry(.8,.8),std({map:tex(nc),transparent:true,roughness:.9}));nm.position.set(x,2.4,s*(HW-.9)-.002*s);nm.rotation.y=s>0?PI:0;add(nm);}));
  // підкранові балки і мостовий кран
  const steelD=std({color:0x2c3033,metalness:.75,roughness:.5}),yellow=std({color:0xc99a1b,metalness:.45,roughness:.5});
  [-1,1].forEach(s=>{const g=new T.Group();[[.35,.06,.42],[-.35,.06,.42],[0,.7,.05]].forEach(([y,hh,d])=>{const b=M(new T.BoxGeometry(HL*2,hh,d),steelD);b.position.y=Math.abs(y)===.35?y:0;g.add(b);});g.position.set(0,9.35,s*(HW-1.4));add(g);
    add(M(new T.BoxGeometry(HL*2,.1,.1),std({color:0x777a7c,metalness:.9,roughness:.3})),[0,9.75,s*(HW-1.4)]);});
  G.crane=new T.Group();G.crane.position.set(14,0,0);G.root.add(G.crane);
  {const girC=cv(1024,128,(x,w,h)=>{x.fillStyle='#c99a1b';x.fillRect(0,0,w,h);speck(x,w,h,3000,.12,0,90);hazard(x,0,0,110,h,22);hazard(x,w-110,0,110,h,22);stencil(x,'Q = 10 т',w/2,h*.68,64,'#1a1710','center',800);blot(x,w,h,12,'rgba(60,40,10,.25)',10,50);});
    const gm=std({map:tex(girC),metalness:.45,roughness:.55});
    [-.7,.7].forEach(dx=>{const g=M(new T.BoxGeometry(.55,.95,(HW-1.4)*2),[yellow,yellow,yellow,yellow,gm,gm]);g.position.set(dx,10.35,0);G.crane.add(g);});
    [-1,1].forEach(s=>{const e=M(new T.BoxGeometry(2.6,.6,.7),yellow);e.position.set(0,10.1,s*(HW-1.4));G.crane.add(e);});
    const tr=new T.Group();tr.position.set(0,11.0,.6);G.crane.add(tr);tr.add(M(new T.BoxGeometry(2.0,.5,1.6),yellow));
    const drum=M(new T.CylinderGeometry(.32,.32,1.3,24),steelD);drum.rotation.x=PI/2;drum.position.y=-.1;tr.add(drum);
    const mot=M(new T.CylinderGeometry(.22,.22,.6,16),std({color:0x30495a,metalness:.5,roughness:.5}));mot.rotation.x=PI/2;mot.position.set(.6,.1,.95);tr.add(mot);
    const cab=std({color:0x1d1e1f,metalness:.6,roughness:.4});
    [-.12,.12].forEach(dx=>{const c=M(new T.CylinderGeometry(.018,.018,3.6,6),cab);c.position.set(dx,-2.2,0);tr.add(c);});
    const blk=new T.Group();blk.position.set(0,-3.0,0);tr.add(blk);G.hook=blk;
    const hzB=cv(256,256,(x,w,h)=>hazard(x,0,0,w,h,36));blk.add(M(new T.BoxGeometry(.52,.62,.32),[yellow,yellow,yellow,yellow,std({map:tex(hzB),metalness:.4,roughness:.5}),std({map:tex(hzB),metalness:.4,roughness:.5})]));
    const shank=M(new T.CylinderGeometry(.05,.05,.35,10),steelD);shank.position.y=-.48;blk.add(shank);
    const hook=M(new T.TorusGeometry(.2,.055,10,24,PI*1.45),steelD);hook.position.set(.04,-.82,0);hook.rotation.z=PI*.65;blk.add(hook);}
  // ферми
  const TY0=WH,TY1=WH+2.6;const topY=z=>TY0+.35+(TY1-TY0)*(1-Math.abs(z)/HW);G.topY=topY;
  const bars=[];G.colX.forEach(x=>{bars.push([[x,TY0,-HW],[x,TY0,HW],.22]);bars.push([[x,topY(-HW),-HW],[x,topY(0),0],.26]);bars.push([[x,topY(0),0],[x,topY(HW),HW],.26]);
    for(let z=-HW;z<HW-.1;z+=2.125){bars.push([[x,TY0,z],[x,topY(z),z],.09]);bars.push([[x,TY0,z],[x,topY(z+2.125),z+2.125],.08]);}});
  for(let z=-HW+1;z<HW;z+=3.4)bars.push([[-HL,topY(z)+.18,z],[HL,topY(z)+.18,z],.14]);
  [-HW+.2,HW-.2].forEach(z=>bars.push([[-HL,TY0,z],[HL,TY0,z],.3]));
  {const im=new T.InstancedMesh(new T.BoxGeometry(1,1,1),steelD,bars.length);const o=new T.Object3D(),up=new T.Vector3(0,1,0);
    bars.forEach(([a,b,t],i)=>{const A=new T.Vector3(...a),B=new T.Vector3(...b),d=B.clone().sub(A);o.position.copy(A).addScaledVector(d,.5);o.quaternion.setFromUnitVectors(up,d.clone().normalize());o.scale.set(t,d.length(),t);o.updateMatrix();im.setMatrixAt(i,o.matrix);});
    im.receiveShadow=true;add(im);}
  // дах
  const roofC=cv(512,512,(x,w,h)=>{for(let i=0;i<w;i+=16){const g=x.createLinearGradient(i,0,i+16,0);g.addColorStop(0,'#15181a');g.addColorStop(.5,'#2a2f31');g.addColorStop(1,'#15181a');x.fillStyle=g;x.fillRect(i,0,16,h);}blot(x,w,h,20,'rgba(0,0,0,.4)',20,90);});
  const roofE=cv(512,512,(x,w,h)=>{x.fillStyle='#000';x.fillRect(0,0,w,h);x.fillStyle='rgba(150,170,180,.55)';x.fillRect(0,h*.45,w,h*.1);x.fillStyle='rgba(0,0,0,.9)';for(let i=0;i<w;i+=64)x.fillRect(i,h*.45,6,h*.1);});
  const rm=std({map:tex(roofC,[8,1]),emissiveMap:tex(roofE,[8,1]),emissive:0x8ea0a8,emissiveIntensity:.35,roughness:.8,metalness:.5,side:T.DoubleSide});
  [-1,1].forEach(s=>{const L=Math.hypot(HW,TY1-TY0);const m=M(new T.PlaneGeometry(HL*2,L),rm,false,true);m.position.set(0,(topY(0)+topY(HW*s))/2+.3,s*HW/2);m.rotation.x=-PI/2+s*Math.atan2(TY1-TY0,HW)*-1;add(m);});
  // бічні стіни з верхніми вікнами
  const sideC=cv(2048,1024,(x,w,h)=>{const bh=h*.26;x.fillStyle='#3a3f37';x.fillRect(0,h-bh,w,bh);
    for(let j=h-bh;j<h;j+=32){for(let i=((j/32)%2)*40;i<w;i+=80){x.fillStyle='rgba(0,0,0,.25)';x.fillRect(i,j,2,32);}x.fillRect(0,j,w,2);}
    speck(x,w,bh,8000,.12,30,140);
    for(let i=0;i<w;i+=24){const g=x.createLinearGradient(i,0,i+24,0);g.addColorStop(0,'#2c3134');g.addColorStop(.5,'#3c4246');g.addColorStop(1,'#2a2f32');x.fillStyle=g;x.fillRect(i,0,24,h-bh);}
    blot(x,w,h-bh,60,'rgba(70,50,30,.18)',20,140);for(let i=0;i<50;i++){x.fillStyle='rgba(60,40,20,.16)';x.fillRect(rnd(0,w),rnd(h*.3,h-bh),rnd(2,5),rnd(30,160));}
    x.fillStyle='#1a1d1e';x.fillRect(0,h-bh-8,w,10);
    for(let i=0;i<8;i++){const X=i*w/8+30,Y=h*.08,ww=w/8-60,hh=h*.22;x.fillStyle='#0c0f10';x.fillRect(X-6,Y-6,ww+12,hh+12);}
    stencil(x,'ПАРК БОЙОВИХ МАШИН · БОКС № 3',w*.04,h*.68,64,'rgba(214,206,180,.55)');});
  const sideE=cv(1024,512,(x,w,h)=>{x.fillStyle='#000';x.fillRect(0,0,w,h);for(let i=0;i<8;i++){const X=i*w/8+15,Y=h*.08,ww=w/8-30,hh=h*.22;const g=x.createLinearGradient(0,Y,0,Y+hh);g.addColorStop(0,'rgba(200,220,230,1)');g.addColorStop(1,'rgba(120,150,165,.9)');x.fillStyle=g;x.fillRect(X,Y,ww,hh);
      x.fillStyle='rgba(0,0,0,.92)';for(let k=1;k<4;k++)x.fillRect(X+ww*k/4-2,Y,4,hh);x.fillRect(X,Y+hh/2-2,ww,4);x.fillStyle='rgba(0,0,0,.45)';for(let k=0;k<5;k++)x.fillRect(X+rnd(0,ww),Y+rnd(0,hh),rnd(6,30),rnd(4,16));}});
  const sideM=std({map:tex(sideC),emissiveMap:tex(sideE),emissive:0xffffff,emissiveIntensity:1.2,roughness:.8,metalness:.35});
  [-1,1].forEach(s=>{const m=M(new T.PlaneGeometry(HL*2,WH+.4),sideM,false,true);m.position.set(0,(WH+.4)/2,s*HW);m.rotation.y=s>0?PI:0;add(m);});
  // задня стіна: цегла
  const backC=cv(2048,1024,(x,w,h)=>{x.fillStyle='#5a3a2c';x.fillRect(0,0,w,h);for(let j=0;j<h;j+=22){for(let i=((j/22)%2)*30;i<w;i+=60){const v=rnd(-18,18);x.fillStyle=`rgb(${100+v|0},${58+v*.6|0},${44+v*.5|0})`;x.fillRect(i+1,j+1,57,19);}}
    speck(x,w,h,30000,.1,20,140);x.fillStyle='rgba(30,30,28,.8)';x.fillRect(0,h*.72,w,h*.28);blot(x,w,h,50,'rgba(20,16,12,.3)',30,180);hazard(x,0,h*.71,w,h*.02,20);
    stencil(x,'ТЕХНІКА — ЗАПОРУКА ПЕРЕМОГИ',w/2,h*.16,86,'rgba(236,230,210,.55)','center',800);});
  {const m=M(new T.PlaneGeometry(HW*2,WH+.4),std({map:tex(backC),roughness:.92}),false,true);m.position.set(-HL,(WH+.4)/2,0);m.rotation.y=PI/2;add(m);}
  const gab=std({color:0x15181a,roughness:.9,metalness:.3,side:T.DoubleSide});
  [-HL,HL].forEach(x=>{const s=new T.Shape();s.moveTo(-HW,WH+.4);s.lineTo(HW,WH+.4);s.lineTo(HW,topY(HW)+.5);s.lineTo(0,topY(0)+.5);s.lineTo(-HW,topY(HW)+.5);s.lineTo(-HW,WH+.4);
    const m=M(new T.ShapeGeometry(s),gab,false,false);m.rotation.y=PI/2;m.position.x=x;add(m);});
  // передня стіна з відкритою рулонною брамою
  const GWh=8.0,GW=6.5;
  const frontC=cv(1024,512,(x,w,h)=>{for(let i=0;i<w;i+=14){const g=x.createLinearGradient(i,0,i+14,0);g.addColorStop(0,'#2a2f32');g.addColorStop(.5,'#3b4246');g.addColorStop(1,'#292e31');x.fillStyle=g;x.fillRect(i,0,14,h);}blot(x,w,h,30,'rgba(60,40,20,.2)',20,100);});
  const frM=std({map:tex(frontC,[3,1]),roughness:.8,metalness:.4});
  [-1,1].forEach(s=>{const wd=HW-GW;const m=M(new T.PlaneGeometry(wd,WH+.4),frM,false,true);m.position.set(HL,(WH+.4)/2,s*(GW+wd/2));m.rotation.y=-PI/2;add(m);});
  {const m=M(new T.PlaneGeometry(GW*2,WH+.4-GWh),frM,false,true);m.position.set(HL,GWh+(WH+.4-GWh)/2,0);m.rotation.y=-PI/2;add(m);}
  {const slatC=cv(512,512,(x,w,h)=>{for(let j=0;j<h;j+=32){const g=x.createLinearGradient(0,j,0,j+32);g.addColorStop(0,'#5d655f');g.addColorStop(.6,'#3f4641');g.addColorStop(1,'#262b28');x.fillStyle=g;x.fillRect(0,j,w,32);}speck(x,w,h,3000,.12,0,120);blot(x,w,h,16,'rgba(70,50,20,.3)',10,60);});
    const sm=std({map:tex(slatC,[4,1]),roughness:.6,metalness:.6});
    const drum=M(new T.CylinderGeometry(.55,.55,GW*2+.6,24),sm);drum.rotation.x=PI/2;add(drum,[HL-.7,GWh+.35,0]);
    const flap=M(new T.PlaneGeometry(GW*2,1.1),sm);flap.rotation.y=-PI/2;add(flap,[HL-.12,GWh-.25,0]);
    const hzC=cv(512,64,(x,w,h)=>hazard(x,0,0,w,h,24));add(M(new T.BoxGeometry(.12,.16,GW*2),std({map:tex(hzC,[2,1]),roughness:.6})),[HL-.12,GWh-.82,0]);
    const post=std({map:tex(cv(64,512,(x,w,h)=>hazard(x,0,0,w,h,20,-1))),roughness:.6});[-1,1].forEach(s=>add(M(new T.BoxGeometry(.3,GWh,.3),post),[HL-.15,GWh/2,s*(GW+.15)]));
    const sig=cv(512,128,(x,w,h)=>{x.fillStyle='#0a0c0c';x.fillRect(0,0,w,h);stencil(x,'ВИЇЗД',w/2,h*.72,84,'#9dffa8','center',800);});
    const sgn=new T.Mesh(new T.PlaneGeometry(2.4,.6),new T.MeshBasicMaterial({map:tex(sig),toneMapped:false}));sgn.rotation.y=-PI/2;add(sgn,[HL-.05,GWh+1.6,0]);}
  // надвір'я
  {const skyC=cv(1024,512,(x,w,h)=>{const g=x.createLinearGradient(0,0,0,h);g.addColorStop(0,'#c9d6dc');g.addColorStop(.55,'#e9eef0');g.addColorStop(.62,'#9aa49c');g.addColorStop(1,'#545b52');x.fillStyle=g;x.fillRect(0,0,w,h);
      x.fillStyle='rgba(40,50,42,.85)';for(let i=0;i<w;i+=3){const t=h*.62-(Math.sin(i*.02)*20+Math.sin(i*.071)*12+Math.random()*10+30);x.fillRect(i,t,3,h*.62-t);}
      x.fillStyle='rgba(30,34,32,.9)';for(let i=0;i<w;i+=40)x.fillRect(i,h*.58,3,h*.08);x.fillRect(0,h*.6,w,2);x.fillRect(0,h*.63,w,2);
      x.fillStyle='rgba(60,66,60,.85)';x.fillRect(w*.62,h*.46,w*.2,h*.16);});
    const sky=new T.Mesh(new T.PlaneGeometry(120,60),new T.MeshBasicMaterial({map:tex(skyC),fog:false}));sky.material.color.setScalar(.72);sky.rotation.y=-PI/2;add(sky,[HL+32,13.2,0]);
    const outC=cv(512,512,(x,w,h)=>{x.fillStyle='#4a4d4b';x.fillRect(0,0,w,h);speck(x,w,h,30000,.18,20,200);blot(x,w,h,30,'rgba(150,160,165,.35)',20,120);});
    const out=M(new T.PlaneGeometry(34,70),std({map:tex(outC,[6,8]),roughness:.55,metalness:.05,color:0x80868a,envMapIntensity:.6}),false,true);out.rotation.x=-PI/2;add(out,[HL+17,-.01,0]);}
}
