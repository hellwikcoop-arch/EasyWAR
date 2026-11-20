/* Процедурне шасі для цільних моделей (Су-25, Gripen): стійки з амортизаторами, шліц-шарніри, колеса з дисками, стулки ніш.
   Розміри — за відкритими кресленнями, округлено; координати в осях літака (ніс +x, земля y=0). */
function stGear(O,D,F){const G0=D.gear,g=new T.Group();O.pv.add(g);O.gearG=g;O.m.position.y+=G0.lift;
  const mk=(c,r,m)=>{const q=new T.MeshStandardMaterial({color:c,roughness:r,metalness:m});F.mats.push(q);return q;};
  const strutM=mk(0x9aa0a4,.35,.85),chromeM=mk(0xd8dde0,.18,1),tyreM=mk(0x161616,.9,0),hubM=mk(G0.hub||0x6f7a70,.5,.5),doorM=mk(G0.door||0x7d8a86,.6,.3),redM=mk(0xb02a20,.6,.2);
  const cyl=(r0,r1,h,m,seg=14)=>new T.Mesh(new T.CylinderGeometry(r0,r1,h,seg),m);
  function wheel(r,w){const q=new T.Group();const t=new T.Mesh(new T.TorusGeometry(r*.72,r*.28,12,28),tyreM);t.scale.z=w/(r*.56);q.add(t);
    const h=cyl(r*.5,r*.5,w*.92,hubM,20);h.rotation.x=Math.PI/2;q.add(h);const c=cyl(r*.16,r*.16,w*1.02,chromeM,10);c.rotation.x=Math.PI/2;q.add(c);return q;}
  function leg(L){const q=new T.Group();q.position.set(L.x,0,L.z||0);g.add(q);const top=G0.lift+(L.top||.35),axY=L.r;
    const up=cyl(L.sr||.07,L.sr||.07,top-axY-(L.st||.45),strutM);up.position.y=axY+(L.st||.45)+(top-axY-(L.st||.45))/2;q.add(up);
    const lo=cyl((L.sr||.07)*.7,(L.sr||.07)*.7,(L.st||.45)+.06,chromeM);lo.position.y=axY+(L.st||.45)/2;q.add(lo);
    const tl=new T.Mesh(new T.BoxGeometry(.04,.32,.05),strutM);tl.position.set(-(L.sr||.07)*1.6,axY+(L.st||.45)*.55,0);tl.rotation.z=.35;q.add(tl);   // шліц-шарнір
    const n=L.twin?2:1;for(let i=0;i<n;i++){const wh=wheel(L.r,L.w);const dz=n===2?(i?1:-1)*(L.w*.62+.03):(L.side||0)*(L.w*.5+(L.sr||.07)+.03);wh.position.set(0,L.r,dz);q.add(wh);}
    if(n===1&&L.side){const ax=cyl(.035,.035,L.w*.5+(L.sr||.07)+.05,chromeM,8);ax.rotation.x=Math.PI/2;ax.position.set(0,L.r,L.side*(L.w*.25+(L.sr||.07)*.5));q.add(ax);}
    if(L.fork){const f=new T.Mesh(new T.BoxGeometry(.07,L.r*1.3,L.w*1.5),strutM);f.position.y=L.r*1.35;q.add(f);}
    (L.doors||[]).forEach(d=>{const dr=new T.Mesh(new T.BoxGeometry(d[0],d[1],.025),doorM);dr.position.set(d[2],top-d[1]/2+.05,d[3]);dr.rotation.x=d[4]||0;q.add(dr);
      const st=new T.Mesh(new T.BoxGeometry(d[0]*.96,.03,.03),redM);st.position.set(d[2],top-d[1]+.07,d[3]);q.add(st);});
    if(L.brace){const b=cyl(.035,.035,L.brace[1],strutM,8);b.position.set(L.brace[0],top-L.brace[1]*.4,0);b.rotation.z=L.brace[2];q.add(b);}
    return q;}
  G0.legs.forEach(leg);
  // колодки під колеса й червоні прапорці «зняти перед польотом»
  const chock=mk(0xd8a51c,.55,.1);G0.legs.forEach(L=>{[-1,1].forEach(s=>{const c=new T.Mesh(new T.BoxGeometry(.18,.16,L.w*(L.twin?2.6:1.3)),chock);c.position.set(L.x+s*(L.r+.12),.08,(L.z||0)+(L.twin?0:(L.side||0)*(L.w*.5+.1)));g.add(c);});});
  g.traverse(o=>{if(o.isMesh){o.castShadow=true;o.raycast=()=>{};}});}
