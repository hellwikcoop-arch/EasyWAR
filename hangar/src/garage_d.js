/* ---------- освітлення ---------- */
function buildLights(){
  scene.add(new T.HemisphereLight(0x6a7a86,0x141210,.2));
  const shadeM=std({color:0x2b3a32,metalness:.55,roughness:.45,side:T.DoubleSide}),inner=new T.MeshBasicMaterial({color:0xfff2dc,toneMapped:false});
  G.lampPos=[];
  G.colX.forEach((x,i)=>{if(i===G.colX.length-1)return;[-6.5,6.5].forEach(z=>{const lx=x+4,ly=10.2;G.lampPos.push([lx,ly,z]);
    const g=new T.Group();g.position.set(lx,ly,z);G.root.add(g);g.add(M(new T.CylinderGeometry(.18,.7,.55,24,1,true),shadeM,false,false));
    const cap=M(new T.CylinderGeometry(.18,.18,.22,16),shadeM,false,false);cap.position.y=.36;g.add(cap);
    const b=M(new T.CircleGeometry(.62,24),inner,false,false);b.rotation.x=PI/2;b.position.y=-.26;g.add(b);
    const wl=WH+1.6-ly;const wire=M(new T.CylinderGeometry(.012,.012,wl,4),shadeM,false,false);wire.position.y=wl/2+.4;g.add(wire);});});
  G.glowTex=tex(cv(128,128,(x,w,h)=>{const g=x.createRadialGradient(w/2,h/2,0,w/2,h/2,w/2);g.addColorStop(0,'rgba(255,240,215,1)');g.addColorStop(.2,'rgba(255,225,180,.45)');g.addColorStop(1,'rgba(255,200,150,0)');x.fillStyle=g;x.fillRect(0,0,w,h);}));
  {const gp=new T.BufferGeometry();gp.setAttribute('position',new T.Float32BufferAttribute(G.lampPos.flatMap(p=>[p[0],p[1]-.35,p[2]]),3));
   G.root.add(new T.Points(gp,new T.PointsMaterial({map:G.glowTex,size:4.5,sizeAttenuation:true,transparent:true,opacity:.9,depthWrite:false,blending:T.AdditiveBlending,color:0xffe2b8})));}
  G.key=new T.SpotLight(0xffe4c2,1.5,46,.62,.55,1.2);G.key.position.set(4,10.0,6.5);G.key.target.position.set(0,.6,0);G.key.castShadow=true;G.key.shadow.mapSize.set(2048,2048);G.key.shadow.bias=-.0004;G.key.shadow.normalBias=.02;G.key.shadow.camera.near=2;G.key.shadow.camera.far=30;
  scene.add(G.key,G.key.target);
  G.key2=new T.SpotLight(0xffd9a8,.7,40,.6,.6,1.3);G.key2.position.set(-4,10.0,-6.5);G.key2.target.position.set(0,.6,0);G.key2.castShadow=true;G.key2.shadow.mapSize.set(1024,1024);G.key2.shadow.bias=-.0004;G.key2.shadow.normalBias=.02;
  scene.add(G.key2,G.key2.target);
  G.sun=new T.SpotLight(0xdfe9f0,2.6,70,.36,.8,1.0);G.sun.position.set(HL+22,10,0);G.sun.target.position.set(HL-14,0,0);G.sun.castShadow=true;G.sun.shadow.mapSize.set(1024,1024);G.sun.shadow.bias=-.0006;G.sun.shadow.normalBias=.03;scene.add(G.sun,G.sun.target);
  G.top=new T.SpotLight(0xffe2b8,2.4,30,.5,.85,1.2);G.top.position.set(0,11.5,0);G.top.target.position.set(0,0,0);G.top.castShadow=true;G.top.shadow.mapSize.set(2048,2048);G.top.shadow.bias=-.0004;G.top.shadow.normalBias=.02;scene.add(G.top,G.top.target);
  G.rim=new T.SpotLight(0x7fb4d6,.7,60,.7,.8,1.2);G.rim.position.set(-26,7,-10);G.rim.target.position.set(0,1.5,0);scene.add(G.rim,G.rim.target);
  G.warm=new T.PointLight(0xff9a4e,.7,22,2);G.warm.position.set(-30,3.2,8);scene.add(G.warm);}
/* ---------- атмосфера ---------- */
function buildFx(){
  const shaftM=(col,op)=>new T.ShaderMaterial({uniforms:{uC:{value:new T.Color(col)},uO:{value:op},uT:{value:0}},transparent:true,depthWrite:false,blending:T.AdditiveBlending,side:T.DoubleSide,
    vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader:'uniform vec3 uC;uniform float uO,uT;varying vec2 vUv;void main(){float edge=smoothstep(0.,.25,vUv.x)*smoothstep(1.,.75,vUv.x);float fall=pow(vUv.y,1.3)*(.25+.75*smoothstep(0.,.35,vUv.y));float n=.75+.25*sin(vUv.x*40.+uT*.3)*sin(vUv.x*13.-uT*.2);gl_FragColor=vec4(uC*edge*fall*n*uO,1.);}'});
  G.shafts=[];
  for(let i=0;i<8;i++){const x=-HL+i*10+5;const m=new T.Mesh(new T.PlaneGeometry(4.2,15),shaftM(0xcfe3ee,.16));m.position.set(x+3,6.0,-HW+5.8);m.rotation.set(-.5,0,.28);G.root.add(m);G.shafts.push(m);
    const m2=new T.Mesh(m.geometry,m.material);m2.position.copy(m.position);m2.position.z+=.6;m2.rotation.set(-.5,PI/2.2,.28);G.root.add(m2);}
  {const sp=new T.Mesh(new T.PlaneGeometry(22,13),new T.MeshBasicMaterial({map:tex(cv(256,256,(x,w,h)=>{const gr=x.createLinearGradient(w,0,0,0);gr.addColorStop(0,'rgba(210,225,232,.55)');gr.addColorStop(1,'rgba(210,225,232,0)');x.fillStyle=gr;x.fillRect(0,0,w,h);
      const g2=x.createLinearGradient(0,0,0,h);g2.addColorStop(0,'rgba(0,0,0,1)');g2.addColorStop(.3,'rgba(0,0,0,0)');g2.addColorStop(.7,'rgba(0,0,0,0)');g2.addColorStop(1,'rgba(0,0,0,1)');x.globalCompositeOperation='destination-out';x.fillStyle=g2;x.fillRect(0,0,w,h);})),transparent:true,depthWrite:false,blending:T.AdditiveBlending,opacity:.45}));
    sp.rotation.x=-PI/2;sp.position.set(HL-11,.012,0);G.root.add(sp);
    for(let k=0;k<3;k++){const v=new T.Mesh(new T.PlaneGeometry(22,8.5),shaftM(0xdfeaf0,.07));v.position.set(HL-11,4.2,(k-1)*4.2);v.rotation.z=-.12;G.root.add(v);G.shafts.push(v);}}
  {const n=900,p=new Float32Array(n*3);for(let i=0;i<n;i++){p[i*3]=rnd(-HL+2,HL-2);p[i*3+1]=rnd(.2,11);p[i*3+2]=rnd(-HW+2,HW-2);}
    const g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(p,3));
    G.dust=new T.Points(g,new T.PointsMaterial({map:G.glowTex,color:0xc8d6dc,size:.07,sizeAttenuation:true,transparent:true,opacity:.6,depthWrite:false,blending:T.AdditiveBlending}));G.root.add(G.dust);}
  {const pt=tex(cv(128,128,(x,w,h)=>{const g=x.createRadialGradient(w/2,h/2,0,w/2,h/2,w/2);g.addColorStop(0,'rgba(255,226,180,.45)');g.addColorStop(1,'rgba(255,226,180,0)');x.fillStyle=g;x.fillRect(0,0,w,h);}));
    const pm=new T.MeshBasicMaterial({map:pt,transparent:true,depthWrite:false,blending:T.AdditiveBlending});
    G.lampPos.forEach(p=>{if(Math.abs(p[0])<9)return;const m=new T.Mesh(new T.PlaneGeometry(7,7),pm);m.rotation.x=-PI/2;m.position.set(p[0],.012,p[2]);G.root.add(m);});}
  G.puffTex=tex(cv(128,128,(x,w,h)=>{for(let i=0;i<9;i++){const cx=w*rnd(.3,.7),cy=h*rnd(.3,.7),r=w*rnd(.15,.32);const g=x.createRadialGradient(cx,cy,0,cx,cy,r);g.addColorStop(0,'rgba(255,255,255,.55)');g.addColorStop(1,'rgba(255,255,255,0)');x.fillStyle=g;x.fillRect(0,0,w,h);}}));
  // підсвічений «подіум» під технікою
  {const c=cv(1024,1024,(x,w,h)=>{const m=w/2;const g=x.createRadialGradient(m,m,0,m,m,m);g.addColorStop(0,'rgba(255,230,190,.30)');g.addColorStop(.6,'rgba(255,225,180,.12)');g.addColorStop(.86,'rgba(255,210,150,.03)');g.addColorStop(.9,'rgba(255,190,70,.0)');g.addColorStop(.915,'rgba(255,190,60,.55)');g.addColorStop(.93,'rgba(255,190,60,0)');g.addColorStop(1,'rgba(0,0,0,0)');x.fillStyle=g;x.fillRect(0,0,w,h);
    x.strokeStyle='rgba(255,190,60,.45)';x.lineWidth=5;for(let i=0;i<48;i++){const a=i/48*PI*2;x.beginPath();x.moveTo(m+Math.cos(a)*m*.95,m+Math.sin(a)*m*.95);x.lineTo(m+Math.cos(a)*m*.99,m+Math.sin(a)*m*.99);x.stroke();}});
    G.spot=new T.Mesh(new T.PlaneGeometry(1,1),new T.MeshBasicMaterial({map:tex(c),transparent:true,depthWrite:false,blending:T.AdditiveBlending}));G.spot.rotation.x=-PI/2;G.spot.position.y=.02;G.spot.renderOrder=1;G.root.add(G.spot);}
  G.puffs=[];}
function puff(pos,vel,op,s0,s1,life,col){let p=G.puffs.find(q=>!q.alive);if(!p){if(G.puffs.length>260)return;const s=new T.Sprite(new T.SpriteMaterial({map:G.puffTex,transparent:true,depthWrite:false}));G.root.add(s);p={s};G.puffs.push(p);}
  Object.assign(p,{alive:true,t:0,life,s0,s1,op,vel:vel.clone()});p.s.position.copy(pos);p.s.material.color.setHex(col);p.s.material.rotation=rnd(0,6.28);p.s.visible=true;}
function updPuffs(dt){G.puffs.forEach(p=>{if(!p.alive)return;p.t+=dt;const k=p.t/p.life;if(k>=1){p.alive=false;p.s.visible=false;return;}p.vel.y+=dt*.25;p.vel.multiplyScalar(1-dt*.6);p.s.position.addScaledVector(p.vel,dt);
  p.s.scale.setScalar(p.s0+(p.s1-p.s0)*(1-Math.pow(1-k,2)));p.s.material.opacity=p.op*Math.min(1,k*6)*Math.pow(1-k,1.4);});}
