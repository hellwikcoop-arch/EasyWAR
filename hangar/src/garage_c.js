/* ---------- реквізит ---------- */
function buildProps(){
  const R=G.root;
  const treadC=cv(512,64,(x,w,h)=>{x.fillStyle='#1a1a1a';x.fillRect(0,0,w,h);x.fillStyle='#0a0a0a';for(let i=0;i<w;i+=16){x.save();x.translate(i,0);x.transform(1,0,.5,1,0,0);x.fillRect(0,0,7,h);x.restore();}speck(x,w,h,800,.2,40,90);});
  const treadM=std({map:tex(treadC,[8,1]),roughness:.95}),rimM=std({color:0x3b4430,metalness:.6,roughness:.45}),hubM=std({color:0x222222,metalness:.8,roughness:.4});
  const tyre=(r,t)=>{const g=new T.Group();const tor=M(new T.TorusGeometry(r-t*.5,t*.55,14,36),treadM);tor.scale.z=.85;g.add(tor);
    const rim=M(new T.CylinderGeometry(r*.55,r*.55,t*.9,24),rimM);rim.rotation.x=PI/2;g.add(rim);const hub=M(new T.CylinderGeometry(r*.18,r*.18,t*1.05,12),hubM);hub.rotation.x=PI/2;g.add(hub);return g;};
  const stack=(x,z,n,r,t)=>{for(let i=0;i<n;i++){const y=tyre(r,t);y.rotation.x=PI/2;y.rotation.z=rnd(-.2,.2);y.position.set(x+rnd(-.04,.04),t*.48+i*t*.98,z+rnd(-.04,.04));R.add(y);}};
  stack(-35.5,-13.4,4,.62,.4);stack(-34.1,-13.6,3,.62,.4);stack(-35.2,-12.0,2,.55,.34);
  {const y=tyre(.62,.4);y.position.set(-32.8,.62,-14.2);y.rotation.y=.3;R.add(y);}
  {const y=tyre(.56,.36);y.position.set(25.5,.56,14.4);y.rotation.y=-.5;y.rotation.z=.12;R.add(y);}
  stack(24.2,15.0,3,.56,.36);
  // траки
  const trkC=cv(256,128,(x,w,h)=>{x.fillStyle='#2a2826';x.fillRect(0,0,w,h);speck(x,w,h,3000,.3,40,140);blot(x,w,h,10,'rgba(120,70,30,.4)',10,40);x.fillStyle='#161514';x.fillRect(w*.1,h*.3,w*.8,h*.4);});
  const trkM=std({map:tex(trkC),metalness:.75,roughness:.55,color:0x9a948c});
  const link=new T.BoxGeometry(.16,.06,.64),pin=new T.CylinderGeometry(.02,.02,.7,6);pin.rotateX(PI/2);
  {const n=30,im=new T.InstancedMesh(link,trkM,n),ip=new T.InstancedMesh(pin,trkM,n);const o=new T.Object3D();
    for(let i=0;i<n;i++){const a=i/n;o.position.set(-28+a*5,.035,-12.2+Math.sin(a*3)*.6);o.rotation.set(0,Math.cos(a*3)*.35,0);o.updateMatrix();im.setMatrixAt(i,o.matrix);o.position.y+=.03;o.updateMatrix();ip.setMatrixAt(i,o.matrix);}
    im.castShadow=im.receiveShadow=true;R.add(im,ip);}
  {const n=16,im=new T.InstancedMesh(link,trkM,n);const o=new T.Object3D();for(let i=0;i<n;i++){o.position.set(-31.5+rnd(-.5,.5),.04+(i>9?.07:0),-11.2+rnd(-.4,.4));o.rotation.set(rnd(-.2,.2),rnd(0,PI),rnd(-.2,.2));o.updateMatrix();im.setMatrixAt(i,o.matrix);}im.castShadow=im.receiveShadow=true;R.add(im);}
  // ящики
  const plank=cv(512,512,(x,w,h)=>{for(let j=0;j<h;j+=64){const v=rnd(-14,14)|0;x.fillStyle=`rgb(${118+v},${92+v},${60+v})`;x.fillRect(0,j,w,62);x.fillStyle='rgba(60,40,20,.5)';x.fillRect(0,j+62,w,2);for(let k=0;k<40;k++){x.fillStyle='rgba(70,50,30,.18)';x.fillRect(0,j+rnd(0,60),w,1);}}
    x.fillStyle='#6d5233';x.fillRect(0,0,w,26);x.fillRect(0,h-26,w,26);x.fillRect(0,0,26,h);x.fillRect(w-26,0,26,h);x.save();x.translate(w/2,h/2);x.rotate(.78);x.fillRect(-w*.7,-12,w*1.4,24);x.restore();speck(x,w,h,2000,.15,0,80);});
  const wood=std({map:tex(plank),roughness:.85});
  const olive=t=>cv(512,256,(x,w,h)=>{x.fillStyle='#4a5236';x.fillRect(0,0,w,h);speck(x,w,h,6000,.15,20,140);blot(x,w,h,8,'rgba(30,30,20,.3)',10,60);x.strokeStyle='rgba(20,22,14,.8)';x.lineWidth=6;x.strokeRect(8,8,w-16,h-16);
    stencil(x,t,w/2,h*.48,44,'rgba(228,220,190,.85)','center',800);stencil(x,'ОБЕРЕЖНО · НЕ КАНТУВАТИ',w/2,h*.75,22,'rgba(228,220,190,.75)','center',600);});
  const oc=std({color:0x434a32,roughness:.7});
  const ammoM=['ЗІП · БЛОК 7','КОМПЛЕКТ ЗІП','МАСТИЛО ЛІТОЛ-24'].map(t=>{const m=std({map:tex(olive(t)),roughness:.7});return [oc,oc,oc,oc,m,m];});
  const box=(w,h,d,x,y,z,ry,m)=>{const b=M(new T.BoxGeometry(w,h,d),m);b.position.set(x,y+h/2,z);b.rotation.y=ry;R.add(b);return b;};
  box(1.6,1.0,1.1,-36.2,0,9.5,.1,wood);box(1.6,1.0,1.1,-36.0,1.0,9.6,-.05,wood);box(1.2,.8,1.0,-34.4,0,10.2,.4,wood);
  box(1.2,.5,.6,-30.5,0,13.8,0,ammoM[0]);box(1.2,.5,.6,-30.5,.5,13.8,.06,ammoM[1]);box(1.2,.5,.6,-29.2,0,13.9,-.05,ammoM[0]);box(1.0,.45,.55,22.2,0,-14.6,.3,ammoM[2]);box(1.2,.5,.6,23.6,0,-14.4,-.1,ammoM[1]);
  box(1.2,.5,.6,12.5,0,14.6,.1,ammoM[0]);box(1.2,.5,.6,12.6,.5,14.6,-.08,ammoM[2]);box(1.6,1.0,1.1,14.4,0,14.4,.2,wood);
  // бочки
  const drumC=(c,t)=>cv(512,256,(x,w,h)=>{x.fillStyle=c;x.fillRect(0,0,w,h);speck(x,w,h,5000,.18,0,130);blot(x,w,h,10,'rgba(70,40,10,.4)',10,40);x.fillStyle='rgba(0,0,0,.3)';[h*.33,h*.66].forEach(y=>x.fillRect(0,y,w,8));if(t)stencil(x,t,w*.25,h*.56,36,'rgba(240,235,220,.85)','center');});
  const drum=(x,z,c,t,lying=0,ry=0)=>{const d=M(new T.CylinderGeometry(.29,.29,.88,24),std({map:tex(drumC(c,t)),metalness:.55,roughness:.5}));if(lying){d.rotation.set(0,ry,PI/2);d.position.set(x,.29,z);}else d.position.set(x,.44,z);R.add(d);};
  drum(-33.0,14.8,'#2a4d7a','ДП');drum(-32.3,14.9,'#2a4d7a','ДП');drum(-32.6,14.2,'#7a2a22','МАСЛО');drum(-31.8,14.0,'#4b5636','');drum(26.7,-14.3,'#7a2a22','МАСЛО',1,.4);drum(27.6,-14.7,'#4b5636','ДП');drum(28.2,-14.2,'#2a4d7a','ДП');
  const jer=std({color:0x3e4a2c,roughness:.6,metalness:.3});for(let i=0;i<4;i++){const j=box(.36,.47,.17,-29+i*.4,0,14.9,0,jer);const hn=M(new T.BoxGeometry(.2,.04,.04),jer);hn.position.y=.27;j.add(hn);}
  // двигун на піддоні
  {const pg=new T.Group();pg.position.set(-26.5,0,13.0);R.add(pg);for(let i=0;i<5;i++){const p=M(new T.BoxGeometry(1.8,.03,.16),wood);p.position.set(0,.13,-.5+i*.25);pg.add(p);}[-.7,0,.7].forEach(px=>{const b=M(new T.BoxGeometry(.14,.1,1.2),wood);b.position.set(px,.05,0);pg.add(b);});
    const g=new T.Group();g.position.y=.15;pg.add(g);const eng=std({color:0x3c4134,metalness:.6,roughness:.55}),chr=std({color:0x8a8d8f,metalness:.9,roughness:.3}),rust=std({color:0x5a3a24,metalness:.4,roughness:.8});
    const blk=M(new T.BoxGeometry(1.5,.7,.8),eng);blk.position.y=.5;g.add(blk);[-1,1].forEach(s=>{const hd=M(new T.BoxGeometry(1.45,.25,.32),eng);hd.position.set(0,.93,s*.3);hd.rotation.x=s*.35;g.add(hd);});
    for(let i=0;i<6;i++){const p=M(new T.CylinderGeometry(.04,.04,.3,8),rust);p.position.set(-.6+i*.24,.72,.5);p.rotation.x=PI/2.6;g.add(p);}
    const pul=M(new T.CylinderGeometry(.2,.2,.08,24),chr);pul.rotation.z=PI/2;pul.position.set(.8,.5,0);g.add(pul);const fly=M(new T.CylinderGeometry(.36,.36,.12,32),eng);fly.rotation.z=PI/2;fly.position.set(-.82,.45,0);g.add(fly);
    const sum=M(new T.BoxGeometry(1.3,.22,.6),std({color:0x2c2f2a,metalness:.6,roughness:.5}));sum.position.y=.1;g.add(sum);const tb=M(new T.TorusGeometry(.18,.05,8,16),chr);tb.position.set(.3,1.1,0);g.add(tb);}
  // верстаки, перфопанель
  {const top=std({color:0x5d4a34,roughness:.8}),frm=std({color:0x2f3f4a,metalness:.6,roughness:.45}),red=std({color:0x8a1f1a,metalness:.45,roughness:.45});
    const bench=z=>{const g=new T.Group();g.position.set(-HL+.6,0,z);R.add(g);const t=M(new T.BoxGeometry(.8,.06,2.6),top);t.position.y=.92;g.add(t);
      [[-.34,-1.22],[.34,-1.22],[-.34,1.22],[.34,1.22]].forEach(([a,b])=>{const l=M(new T.BoxGeometry(.06,.9,.06),frm);l.position.set(a,.45,b);g.add(l);});
      const s2=M(new T.BoxGeometry(.7,.03,2.5),frm);s2.position.y=.25;g.add(s2);const vice=M(new T.BoxGeometry(.25,.18,.18),std({color:0x2c4a6a,metalness:.6,roughness:.4}));vice.position.set(.2,1.04,.9);g.add(vice);
      const cab=M(new T.BoxGeometry(.6,.7,.5),red);cab.position.set(0,.36,-.7);g.add(cab);const tb=M(new T.BoxGeometry(.5,.18,.25),red);tb.position.set(.05,1.04,-.4);g.add(tb);};
    bench(-6.5);bench(-3.4);
    const peg=cv(1024,512,(x,w,h)=>{x.fillStyle='#4f5a4b';x.fillRect(0,0,w,h);x.fillStyle='rgba(0,0,0,.35)';for(let j=12;j<h;j+=24)for(let i=12;i<w;i+=24){x.beginPath();x.arc(i,j,3,0,PI*2);x.fill();}
      const tool=(px,py,s,k)=>{x.save();x.translate(px,py);x.fillStyle='rgba(240,240,230,.18)';x.fillRect(-s*.6,-s*.1,s*1.2,s*2.6);x.fillStyle=k;x.fillRect(-s*.12,0,s*.24,s*2);x.fillRect(-s*.45,-s*.1,s*.9,s*.35);x.restore();};
      for(let i=0;i<12;i++)tool(60+i*80,90,22+(i%3)*6,i%4?'#2d2f31':'#7a1f19');for(let i=0;i<9;i++){x.beginPath();x.arc(80+i*105,360,28-(i%3)*6,0,PI*2);x.lineWidth=10;x.strokeStyle='#2a2c2d';x.stroke();}
      stencil(x,'ІНСТРУМЕНТ · ПОВЕРНИ НА МІСЦЕ',w/2,h-24,30,'rgba(240,230,200,.8)','center',700);});
    const pm=new T.Mesh(new T.PlaneGeometry(5.6,2.2),std({map:tex(peg),roughness:.8}));pm.position.set(-HL+.04,2.2,-5);pm.rotation.y=PI/2;pm.receiveShadow=true;R.add(pm);}
  // стелажі
  {const frm=std({color:0x2a4a6a,metalness:.55,roughness:.5}),shm=std({color:0x3a3e40,metalness:.6,roughness:.5});
    const rack=(x,z,ry)=>{const g=new T.Group();g.position.set(x,0,z);g.rotation.y=ry;R.add(g);[[-1.4,-.4],[1.4,-.4],[-1.4,.4],[1.4,.4]].forEach(([a,b])=>{const p=M(new T.BoxGeometry(.08,3.2,.08),frm);p.position.set(a,1.6,b);g.add(p);});
      for(let k=0;k<4;k++){const s=M(new T.BoxGeometry(2.9,.04,.85),shm);s.position.y=.25+k*.95;g.add(s);for(let n=0;n<4;n++){const hh=rnd(.2,.5);const b=M(new T.BoxGeometry(rnd(.3,.6),hh,rnd(.3,.6)),[wood,ammoM[n%2],shm][n%3]);b.position.set(-1.1+n*.7+rnd(-.1,.1),.27+k*.95+hh/2,rnd(-.1,.1));g.add(b);}}};
    rack(-HL+.7,4.5,PI/2);rack(-HL+.7,9.9,PI/2);rack(-18,HW-.7,0);rack(-11,HW-.7,0);}
  // плакати
  const poster=(lines,bg,fg,x,y,z,ry,w=1.4,h=2)=>{const c=cv(512,732,(q,W2,H2)=>{q.fillStyle=bg;q.fillRect(0,0,W2,H2);q.fillStyle=fg;q.fillRect(16,16,W2-32,10);q.fillRect(16,H2-26,W2-32,10);
      lines.forEach(l=>{if(l.icon){q.save();q.translate(W2/2,H2*.45);l.icon(q);q.restore();}else stencil(q,l.t,W2/2,l.y*H2,l.s,l.c||fg,'center',l.w||800);});speck(q,W2,H2,4000,.08,0,255);blot(q,W2,H2,6,'rgba(90,70,40,.25)',30,120);});
    const m=new T.Mesh(new T.PlaneGeometry(w,h),std({map:tex(c),roughness:.9}));m.position.set(x,y,z);m.rotation.y=ry;m.receiveShadow=true;R.add(m);};
  const tankIcon=q=>{q.fillStyle='#1d1f1a';q.beginPath();q.moveTo(-200,40);q.lineTo(-170,0);q.lineTo(170,0);q.lineTo(200,40);q.lineTo(170,90);q.lineTo(-170,90);q.closePath();q.fill();q.fillRect(-90,-60,170,60);q.fillRect(60,-45,170,16);
    q.fillStyle='#d8a51c';for(let i=-150;i<=150;i+=60){q.beginPath();q.arc(i,62,22,0,PI*2);q.fill();}};
  poster([{t:'ТЕХНІКА',y:.12,s:72},{t:'БЕЗПЕКИ',y:.22,s:72},{icon:tankIcon},{t:'ПЕРЕД ВИЇЗДОМ:',y:.7,s:36,w:700},{t:'ГАЛЬМА · ТИСК У ШИНАХ',y:.77,s:30,w:600},{t:'РІВЕНЬ ОЛИВИ · СВІТЛО',y:.83,s:30,w:600}],'#d9cfb4','#1d1f1a',-HL+.05,3.6,1.6,PI/2);
  poster([{t:'ПАЛИТИ',y:.16,s:82},{t:'ЗАБОРОНЕНО',y:.27,s:70},{icon:q=>{q.strokeStyle='#c22a1f';q.lineWidth=36;q.beginPath();q.arc(0,40,150,0,PI*2);q.stroke();q.beginPath();q.moveTo(-105,-65);q.lineTo(105,145);q.stroke();q.fillStyle='#222';q.fillRect(-110,30,200,24);}}],'#efe9da','#c22a1f',-HL+.05,3.6,-1.2,PI/2,1.2,1.7);
  poster([{t:'ВОГНЕГАСНИК',y:.12,s:58,c:'#fff'},{icon:q=>{q.fillStyle='#fff';q.fillRect(-60,-120,120,260);q.beginPath();q.arc(0,-120,60,PI,0);q.fill();q.fillRect(-20,-200,40,40);}},{t:'ВП-5',y:.88,s:70,c:'#fff'}],'#9b1f17','#fff',14,2.6,-HW+.06,0,1,1.4);
  poster([{t:'БЕРЕЖИ',y:.15,s:76},{t:'ТЕХНІКУ —',y:.26,s:70},{icon:q=>{q.fillStyle='#2f3a24';q.fillRect(-180,-90,360,240);q.fillStyle='#d8a51c';q.font=`800 120px ${FONT}`;q.textAlign='center';q.fillText('ЗСУ',0,70);}},{t:'ВОНА БЕРЕЖЕ',y:.8,s:52},{t:'ТЕБЕ',y:.9,s:70}],'#d9cfb4','#1d1f1a',-4,3.0,-HW+.06,0);
  poster([{t:'КРАН',y:.12,s:80},{t:'Q = 10 т',y:.24,s:64,c:'#c22a1f'},{icon:q=>{q.strokeStyle='#1d1f1a';q.lineWidth=14;q.beginPath();q.moveTo(-160,-120);q.lineTo(160,-120);q.moveTo(0,-120);q.lineTo(0,60);q.stroke();q.beginPath();q.arc(0,90,40,-PI*.1,PI*1.1);q.stroke();}},{t:'НЕ СТІЙ ПІД ВАНТАЖЕМ',y:.84,s:36,w:700}],'#d8a51c','#1d1f1a',6,3.0,HW-.06,PI);
  poster([{t:'СХЕМА',y:.12,s:70},{t:'ТО-1 · ТО-2',y:.22,s:50},{icon:q=>{q.strokeStyle='#1d1f1a';q.lineWidth=5;q.fillStyle='#1d1f1a';for(let i=0;i<6;i++){q.strokeRect(-180,-160+i*60,360,46);q.fillRect(-170,-150+i*60,(i*53)%300+40,26);}}},{t:'ЖУРНАЛ ОБСЛУГОВУВАННЯ',y:.88,s:30,w:700}],'#e2ddcc','#1d1f1a',-20,3.0,HW-.06,PI);
  // вогнегасники
  const ext=(x,z,ry)=>{const g=new T.Group();g.position.set(x,0,z);g.rotation.y=ry;R.add(g);const b=M(new T.CylinderGeometry(.12,.12,.62,16),std({color:0xb0201a,metalness:.3,roughness:.35}));b.position.set(0,1.1,.16);g.add(b);
    const hd=M(new T.CylinderGeometry(.04,.06,.12,10),std({color:0x222222,metalness:.8,roughness:.3}));hd.position.set(0,1.46,.16);g.add(hd);const br=M(new T.BoxGeometry(.3,.4,.03),std({color:0x8a1f1a}));br.position.set(0,1.2,.02);g.add(br);};
  ext(15.2,-HW+.02,0);ext(-14.5,HW-.02,PI);ext(-HL+.02,-9,PI/2);
  // шланги й кабелі
  const hose=(pts,r,col)=>{const c=new T.CatmullRomCurve3(pts.map(p=>new T.Vector3(p[0],p[1],p[2])));const m=M(new T.TubeGeometry(c,Math.max(60,pts.length*20),r,8,false),std({color:col,roughness:.55,metalness:.05}));R.add(m);};
  const reel=(x,z,col)=>{const g=new T.Group();g.position.set(x,1.4,z);R.add(g);const d=M(new T.CylinderGeometry(.35,.35,.25,20),std({color:0xc22a1f,metalness:.4,roughness:.4}));d.rotation.x=PI/2;g.add(d);g.add(M(new T.TorusGeometry(.24,.05,8,20),std({color:col,roughness:.5})));};
  reel(-8,-HW+.9,0xd8b020);hose([[-8,1.15,-HW+1.0],[-8,.4,-HW+1.3],[-7.6,.035,-HW+1.9],[-6,.035,-12.6],[-4.5,.035,-9.5],[-6.2,.035,-7.4],[-3.6,.035,-6],[-1.8,.035,-6.4],[-.6,.035,-5.2]],.035,0xd8b020);
  reel(8,-HW+.9,0x111111);hose([[8,1.15,-HW+1.0],[8,.4,-HW+1.3],[8.4,.03,-HW+1.9],[9.5,.03,-12.2],[8.2,.03,-9.6],[10.5,.03,-7.6],[12.8,.03,-8.2],[14,.03,-6.2]],.03,0x161616);
  hose([[-16,.025,HW-1.5],[-14,.025,12],[-15,.025,9.5],[-12.4,.025,8],[-10.5,.025,9.2],[-9,.025,7.4]],.025,0x1c1c1c);
  hose([[-HL+1,.04,-2],[-36,.04,-1.2],[-34.5,.04,-2.4],[-33,.04,-1],[-31.2,.04,-1.8]],.04,0x2d5a2a);
  // візок, домкрат, драбина, фільтри, піддон з оливою
  {const g=new T.Group();g.position.set(-13.2,0,-12.4);g.rotation.y=.6;R.add(g);const bx=M(new T.BoxGeometry(.6,.7,.4),std({color:0x2f5d8a,metalness:.5,roughness:.4}));bx.position.y=.55;g.add(bx);
    const bt=M(new T.CylinderGeometry(.11,.11,1.1,14),std({color:0x2b6e3a,metalness:.4,roughness:.4}));bt.position.set(-.38,.75,0);g.add(bt);}
  {const g=new T.Group();g.position.set(9.2,0,-10.8);g.rotation.y=-.7;R.add(g);const m=std({color:0xb0201a,metalness:.5,roughness:.4});const b=M(new T.BoxGeometry(1.2,.16,.36),m);b.position.y=.16;g.add(b);
    const arm=M(new T.BoxGeometry(.9,.08,.1),m);arm.position.set(.2,.32,0);arm.rotation.z=.35;g.add(arm);const h=M(new T.CylinderGeometry(.02,.02,1.1,6),std({color:0x222222}));h.position.set(-.9,.6,0);h.rotation.z=-1.0;g.add(h);}
  {const g=new T.Group();g.position.set(-HL+1.3,0,13.6);g.rotation.set(0,PI/2,-.28);R.add(g);const m=std({color:0x8a8d8f,metalness:.8,roughness:.35});[-.25,.25].forEach(z=>{const r=M(new T.BoxGeometry(.06,4.2,.06),m);r.position.set(0,2.1,z);g.add(r);});for(let i=0;i<12;i++){const s=M(new T.BoxGeometry(.04,.04,.5),m);s.position.set(0,.3+i*.32,0);g.add(s);}}
  for(let i=0;i<3;i++)add(M(new T.CylinderGeometry(.1,.1,.22,14),std({color:[0x1d3a6a,0xd8a51c,0x2a2a2a][i],metalness:.5,roughness:.5})),[-12.2+i*.28,.11,2.4+(i%2)*.2]);
  add(M(new T.CylinderGeometry(.42,.38,.1,24),std({color:0x1a1a1a,metalness:.7,roughness:.35})),[-12.0,.05,-2.6]);
  {const o=new T.Mesh(new T.CircleGeometry(.38,24),std({color:0x050505,roughness:.08}));o.rotation.x=-PI/2;add(o,[-12.0,.101,-2.6]);}
  const oilM=std({color:0x0a0908,roughness:.12,transparent:true,opacity:.7,polygonOffset:true,polygonOffsetFactor:-3,depthWrite:false});
  [[-3,1.9,.9],[4.4,-2.1,.6],[-9.5,-.6,1.1],[12,2.6,.7],[20,-1.2,.8]].forEach(([x,z,r])=>{const m=new T.Mesh(new T.CircleGeometry(r,24),oilM);m.rotation.x=-PI/2;m.scale.set(1,rnd(.5,.8),1);m.position.set(x,.006,z);m.receiveShadow=true;R.add(m);});
  // ---- передній план кадру (видимий з камери): візки, траки, шини, двигун на стенді, стелажі, каністри, бочки, галерея ----
  {const blue=std({color:0x23466a,metalness:.5,roughness:.4}),redC=std({color:0x8e1f18,metalness:.45,roughness:.4}),frm=std({color:0x2a2e30,metalness:.7,roughness:.45}),chr=std({color:0x9aa0a3,metalness:.9,roughness:.3}),rub=std({color:0x0e0f0f,roughness:.8});
   const cart=(x,z,ry,m)=>{const g=new T.Group();g.position.set(x,0,z);g.rotation.y=ry;R.add(g);const b=M(new T.BoxGeometry(1.0,.8,.55),m);b.position.y=.62;g.add(b);
     for(let i=0;i<4;i++){const d=M(new T.BoxGeometry(.96,.015,.02),chr);d.position.set(0,.34+i*.19,.28);g.add(d);}
     const tp=M(new T.BoxGeometry(1.1,.05,.62),frm);tp.position.y=1.05;g.add(tp);const tb=M(new T.BoxGeometry(.42,.16,.2),redC);tb.position.set(-.2,1.16,0);g.add(tb);
     const w1=M(new T.BoxGeometry(.32,.03,.03),chr);w1.position.set(.25,1.09,.1);w1.rotation.y=.4;g.add(w1);const hd=M(new T.CylinderGeometry(.018,.018,.55,8),chr);hd.rotation.x=PI/2;hd.position.set(.6,1.0,0);g.add(hd);
     [[-.42,-.2],[.42,-.2],[-.42,.2],[.42,.2]].forEach(([a,c])=>{const w=M(new T.CylinderGeometry(.07,.07,.05,12),rub);w.rotation.x=PI/2;w.position.set(a,.07,c);g.add(w);});};
   cart(-7.5,6.8,.5,redC);cart(4.5,-7.2,-.3,blue);cart(16,8.2,2.6,redC);
   stack(13.5,9.6,4,.62,.4);stack(14.8,10.3,2,.62,.4);{const y=tyre(.62,.4);y.position.set(12.6,.62,8.4);y.rotation.y=.9;R.add(y);}
   stack(19,-11.5,3,.56,.36);
   // купа траків
   {const n=26,im=new T.InstancedMesh(link,trkM,n);const o=new T.Object3D();for(let i=0;i<n;i++){const a=i/n;o.position.set(8.6+rnd(-.6,.6),.04+(i>14?.07:0)+(i>21?.07:0),-9.6+rnd(-.5,.5));o.rotation.set(rnd(-.15,.15),rnd(0,PI),rnd(-.15,.15));o.updateMatrix();im.setMatrixAt(i,o.matrix);}im.castShadow=im.receiveShadow=true;R.add(im);
    const n2=18,im2=new T.InstancedMesh(link,trkM,n2);for(let i=0;i<n2;i++){o.position.set(6.4+i*.17,.035,-11.2);o.rotation.set(0,0,0);o.updateMatrix();im2.setMatrixAt(i,o.matrix);}im2.rotation.y=.25;im2.castShadow=true;R.add(im2);}
   // двигун на ремонтному стенді
   {const g=new T.Group();g.position.set(7.8,0,10.2);g.rotation.y=-.4;R.add(g);const fm=std({color:0x8e1f18,metalness:.5,roughness:.45});
     [[-.7,-.45],[.7,-.45],[-.7,.45],[.7,.45]].forEach(([a,c])=>{const l=M(new T.BoxGeometry(.08,.08,1.0),fm);l.position.set(a,.08,0);g.add(l);const w=M(new T.CylinderGeometry(.06,.06,.05,10),rub);w.rotation.x=PI/2;w.position.set(a,.06,c);g.add(w);});
     const up=M(new T.BoxGeometry(.1,1.0,.1),fm);up.position.set(-.75,.6,0);g.add(up);const ar=M(new T.BoxGeometry(.4,.1,.1),fm);ar.position.set(-.55,1.0,0);g.add(ar);
     const e=std({color:0x3c4134,metalness:.6,roughness:.55}),rs=std({color:0x5a3a24,metalness:.4,roughness:.8});const blk=M(new T.BoxGeometry(1.2,.6,.7),e);blk.position.set(.1,1.0,0);g.add(blk);
     [-1,1].forEach(s=>{const h=M(new T.BoxGeometry(1.15,.22,.3),e);h.position.set(.1,1.38,s*.27);h.rotation.x=s*.35;g.add(h);for(let i=0;i<5;i++){const p=M(new T.CylinderGeometry(.035,.035,.28,8),rs);p.position.set(-.35+i*.22,1.15,s*.45);p.rotation.x=s*1.1;g.add(p);}});
     const fl=M(new T.CylinderGeometry(.32,.32,.1,28),e);fl.rotation.z=PI/2;fl.position.set(-.55,1.0,0);g.add(fl);const pu=M(new T.CylinderGeometry(.17,.17,.07,20),chr);pu.rotation.z=PI/2;pu.position.set(.75,1.0,0);g.add(pu);
     const tb=M(new T.TorusGeometry(.17,.05,8,18),chr);tb.position.set(.4,1.55,0);g.add(tb);}
   // стелажі з запчастинами вздовж стін
   const rack2=(x,z,ry)=>{const g=new T.Group();g.position.set(x,0,z);g.rotation.y=ry;R.add(g);const fr=std({color:0x2a4a6a,metalness:.55,roughness:.5}),sh=std({color:0x3a3e40,metalness:.6,roughness:.5});
     [[-1.4,-.4],[1.4,-.4],[-1.4,.4],[1.4,.4]].forEach(([a,b])=>{const p=M(new T.BoxGeometry(.08,3.2,.08),fr);p.position.set(a,1.6,b);g.add(p);});
     for(let k=0;k<4;k++){const s=M(new T.BoxGeometry(2.9,.04,.85),sh);s.position.y=.25+k*.95;g.add(s);for(let n=0;n<4;n++){const t=(k+n)%4;let b;
       if(t===0){b=M(new T.CylinderGeometry(.18,.18,.36,14),std({color:0x2a4d7a,metalness:.5,roughness:.5}));b.position.set(-1.05+n*.7,.25+k*.95+.2,0);}
       else if(t===1){b=tyre(.22,.12);b.rotation.x=PI/2;b.position.set(-1.05+n*.7,.25+k*.95+.08,0);}
       else{const hh=rnd(.22,.5);b=M(new T.BoxGeometry(rnd(.35,.6),hh,rnd(.35,.6)),t===2?ammoM[k%3]:wood);b.position.set(-1.05+n*.7,.25+k*.95+hh/2+.02,rnd(-.1,.1));}g.add(b);}}};
   rack2(3,-HW+.7,0);rack2(9.5,-HW+.7,0);rack2(22,HW-.7,PI);rack2(28.5,HW-.7,PI);
   // ящики зі стенсилами та каністри
   box(1.2,.5,.6,24.5,0,9.8,.2,ammoM[0]);box(1.2,.5,.6,24.6,.5,9.8,.15,ammoM[1]);box(1.2,.5,.6,25.9,0,10.4,-.3,ammoM[2]);box(1.6,1.0,1.1,22.6,0,11.2,.1,wood);
   box(1.2,.5,.6,-10.5,0,-9.6,.4,ammoM[1]);box(1.6,1.0,1.1,-12,0,-10.8,.1,wood);box(1.2,.5,.6,-12.1,1.0,-10.8,-.2,ammoM[0]);
   for(let i=0;i<5;i++){const j=box(.36,.47,.17,10.6+i*.4,0,-13.0,0,jer);const hn=M(new T.BoxGeometry(.2,.04,.04),jer);hn.position.y=.27;j.add(hn);}
   drum(27.6,12.4,'#2a4d7a','ДП');drum(28.3,12.9,'#7a2a22','МАСЛО');drum(27.5,13.3,'#4b5636','ДП');drum(16.5,-12.6,'#7a2a22','МАСЛО',1,.8);drum(17.3,-13.6,'#2a4d7a','ДП');
   // верстак з лещатами біля стіни
   {const g=new T.Group();g.position.set(15,0,-HW+.9);R.add(g);const top=M(new T.BoxGeometry(3.2,.07,.9),std({color:0x5d4a34,roughness:.8}));top.position.y=.92;g.add(top);
    [[-1.5,-.38],[1.5,-.38],[-1.5,.38],[1.5,.38]].forEach(([a,b])=>{const l=M(new T.BoxGeometry(.07,.9,.07),frm);l.position.set(a,.45,b);g.add(l);});
    const cab=M(new T.BoxGeometry(.7,.7,.75),redC);cab.position.set(-1,.36,0);g.add(cab);const v=M(new T.BoxGeometry(.25,.2,.2),blue);v.position.set(1.1,1.05,.2);g.add(v);
    const lamp=M(new T.CylinderGeometry(.06,.18,.2,14,1,true),frm);lamp.position.set(.2,1.6,-.2);g.add(lamp);const la=M(new T.CylinderGeometry(.015,.015,.7,6),frm);la.position.set(.2,1.25,-.3);g.add(la);
    const lp=new T.PointLight(0xffd9a0,.6,4,2);lp.position.set(.2,1.4,0);g.add(lp);}
   // галерея (кетвок) уздовж правої стіни
   {const gy=5.2,x0=-12,x1=32,zc=HW-1.3;const gm=std({color:0x2c3033,metalness:.75,roughness:.5}),ym=std({color:0xc99a1b,metalness:.45,roughness:.5});
    const deck=M(new T.BoxGeometry(x1-x0,.08,1.6),std({color:0x3a3d3c,metalness:.8,roughness:.5}));deck.position.set((x0+x1)/2,gy,zc);R.add(deck);
    [-.8,.8].forEach(dz=>{const b=M(new T.BoxGeometry(x1-x0,.18,.08),gm);b.position.set((x0+x1)/2,gy-.1,zc+dz);R.add(b);});
    const rl=M(new T.BoxGeometry(x1-x0,.05,.05),ym);rl.position.set((x0+x1)/2,gy+1.05,zc-.8);R.add(rl);const rl2=rl.clone();rl2.position.y=gy+.55;R.add(rl2);
    const n=Math.round((x1-x0)/1.5),ip=new T.InstancedMesh(new T.BoxGeometry(.05,1.05,.05),ym,n+1),o=new T.Object3D();for(let i=0;i<=n;i++){o.position.set(x0+i*(x1-x0)/n,gy+.52,zc-.8);o.updateMatrix();ip.setMatrixAt(i,o.matrix);}R.add(ip);
    const bk=new T.InstancedMesh(new T.BoxGeometry(.08,.5,.9),gm,G.colX.length);G.colX.forEach((x,i)=>{o.position.set(x,gy-.35,zc+.35);o.updateMatrix();bk.setMatrixAt(i,o.matrix);});R.add(bk);
    // сходи
    for(let i=0;i<14;i++){const st=M(new T.BoxGeometry(.3,.05,1.0),gm);st.position.set(x1+.2+i*.3,gy-(i+1)*gy/14,zc);R.add(st);}
    [-.5,.5].forEach(dz=>{const s=M(new T.BoxGeometry(Math.hypot(4.2,gy),.12,.05),ym);s.position.set(x1+2.3,gy/2,zc+dz);s.rotation.z=-Math.atan2(gy,4.2);R.add(s);});}
  }
}
