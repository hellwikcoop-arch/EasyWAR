/* =========================================================
   HANGAR  (процедурний ангар замість поворотного диска)
   ========================================================= */
const HX={HF:1,hw:44,hd:36,wallH:13,chordY:13.6,peakY:19.4,g:new T.Group(),roof:new T.Group(),mats:[],roofMats:[],props:[],t:0};
world.add(HX.g);HX.g.add(HX.roof);
// ховаємо радар-диск і кільце; розмітка лишається, але з м'яким радіальним згасанням
[baseDisc,vig,ringLn].forEach(o=>o.visible=false);
ground.children.forEach(o=>{if(o.geometry&&o.geometry.type==='RingGeometry')o.visible=false;});
markMat.onBeforeCompile=sh=>{
  sh.vertexShader='varying vec2 vLP;\n'+sh.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvLP=position.xz;');
  sh.fragmentShader='varying vec2 vLP;\n'+sh.fragmentShader.replace('#include <dithering_fragment>','#include <dithering_fragment>\ngl_FragColor.a*=smoothstep('+GR.toFixed(1)+','+(GR*.5).toFixed(1)+',length(vLP));');};
markMat.needsUpdate=true;
shadow.scale.set(1.15,1,1.25);
function cvTex(w,h,fn){const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d');fn(x,w,h);const t=new T.CanvasTexture(c);t.anisotropy=4;return t;}
const rnd2=(a,b)=>a+Math.random()*(b-a);

/* ---- floor: wet concrete reflector ---- */
const floorTex=cvTex(1024,1024,(x,w,h)=>{ // R = бетон, G = вологість (калюжі), B = шви
  x.fillStyle='rgb(120,60,0)';x.fillRect(0,0,w,h);
  for(let i=0;i<9000;i++){const v=90+Math.random()*60|0;x.fillStyle=`rgba(${v},0,0,.18)`;const s=1+Math.random()*4;x.fillRect(Math.random()*w,Math.random()*h,s,s);}
  for(let i=0;i<60;i++){const cx=Math.random()*w,cy=Math.random()*h,r=20+Math.random()*120;const g=x.createRadialGradient(cx,cy,0,cx,cy,r);const d=Math.random()<.5?60:170;g.addColorStop(0,`rgba(${d},0,0,.16)`);g.addColorStop(1,`rgba(${d},0,0,0)`);x.fillStyle=g;x.fillRect(cx-r,cy-r,r*2,r*2);}
  x.globalCompositeOperation='lighter';
  for(let i=0;i<34;i++){const cx=Math.random()*w,cy=Math.random()*h,rx=30+Math.random()*190,ry=rx*(.3+Math.random()*.7);x.save();x.translate(cx,cy);x.rotate(Math.random()*PI);const g=x.createRadialGradient(0,0,0,0,0,rx);g.addColorStop(0,'rgba(0,140,0,.9)');g.addColorStop(.6,'rgba(0,90,0,.5)');g.addColorStop(1,'rgba(0,0,0,0)');x.scale(1,ry/rx);x.fillStyle=g;x.beginPath();x.arc(0,0,rx,0,PI*2);x.fill();x.restore();}
  x.globalCompositeOperation='source-over';
  x.fillStyle='rgba(0,0,255,1)';[0,w/2].forEach(p=>{x.fillRect(p,0,3,h);x.fillRect(0,p,w,3);});
  x.fillStyle='rgba(0,0,140,1)';[w/4,w*3/4].forEach(p=>{x.fillRect(p,0,2,h);x.fillRect(0,p,w,2);});});
floorTex.wrapS=floorTex.wrapT=T.RepeatWrapping;floorTex.anisotropy=8;
const FloorShader={uniforms:{color:{value:null},tDiffuse:{value:null},textureMatrix:{value:null},tFloor:{value:null},uScroll:{value:0},uHF:{value:1},uFog:{value:new T.Color()},uFogR:{value:new T.Vector2(30,150)},uRefl:{value:1}},
 vertexShader:`uniform mat4 textureMatrix;varying vec4 vUv;varying vec2 vP;varying float vD;varying vec3 vW;
  void main(){vUv=textureMatrix*vec4(position,1.0);vP=vec2(position.x,-position.y);vec4 w=modelMatrix*vec4(position,1.0);vW=w.xyz;vec4 mv=viewMatrix*w;vD=-mv.z;gl_Position=projectionMatrix*mv;}`,
 fragmentShader:`uniform vec3 color;uniform sampler2D tDiffuse;uniform sampler2D tFloor;uniform float uScroll,uHF,uRefl;uniform vec3 uFog;uniform vec2 uFogR;
  varying vec4 vUv;varying vec2 vP;varying float vD;varying vec3 vW;
  void main(){
   vec2 p=vP;vec2 q=vec2(p.x+uScroll,p.y);
   vec4 f=texture2D(tFloor,q/24.0);vec4 f2=texture2D(tFloor,q/97.0+.37);
   float conc=f.r*.75+f2.r*.25, wet=clamp(f.g*.8+f2.g*.6,0.,1.), seam=f.b;
   vec3 base=mix(vec3(.050,.060,.064),vec3(.095,.105,.11),conc)*(1.0-.55*seam);
   // світлові плями: центральний прожектор + ряди підвісних світильників
   float r2=dot(p,p);
   float pool=exp(-r2/170.0)*.95+exp(-r2/900.0)*.25;
   vec2 lp=vec2(mod(p.x+4.5,9.0)-4.5,mod(p.y+6.0,12.0)-6.0);
   float rows=exp(-dot(lp,lp)/10.0)*.28*step(abs(p.x),36.)*step(abs(p.y),24.);
   vec3 lit=base*(.55+uHF*(pool*vec3(1.6,1.5,1.35)+rows*vec3(1.1,1.15,1.2)))+base*(1.-uHF)*.35;
   // розмите (по вертикалі) вологе відображення
   float bl=(.004+.022*(1.0-wet))*vUv.w;
   vec3 rf=texture2DProj(tDiffuse,vUv).rgb*.30;
   rf+=texture2DProj(tDiffuse,vUv+vec4(0.,bl,0.,0.)).rgb*.2;rf+=texture2DProj(tDiffuse,vUv-vec4(0.,bl,0.,0.)).rgb*.2;
   rf+=texture2DProj(tDiffuse,vUv+vec4(bl*.35,bl*2.2,0.,0.)).rgb*.15;rf+=texture2DProj(tDiffuse,vUv-vec4(bl*.35,bl*2.2,0.,0.)).rgb*.15;
   vec3 V=normalize(cameraPosition-vW);float fr=pow(1.0-clamp(V.y,0.,1.),3.0);
   float k=uRefl*(.45+.75*wet)*(.55+.6*fr)*(1.0-.5*seam);
   vec3 col=lit+rf*k*color;
   col=mix(col,uFog,smoothstep(uFogR.x,uFogR.y,vD));
   gl_FragColor=vec4(col,1.0);}`};
const floor=new T.Reflector(new T.PlaneGeometry(320,320),{textureWidth:1024,textureHeight:640,clipBias:.003,color:0xffffff,shader:FloorShader});
floor.rotation.x=-PI/2;floor.position.y=-.002;floor.renderOrder=-2;world.add(floor);
floor.material.uniforms.tFloor.value=floorTex;HX.floor=floor;
HX.rs=.5;HX.hq=/[?&]hq\b/.test(location.search);HX.ft=16;HX.qt=0;
HX.resize=(w,h)=>{const pr=renderer.getPixelRatio();floor.getRenderTarget().setSize(Math.max(64,Math.round(w*pr*HX.rs)),Math.max(64,Math.round(h*pr*HX.rs)));};

/* ---- hangar structure ---- */
const HW=HX.hw,HD=HX.hd,WH=HX.wallH,CY=HX.chordY,PY_=HX.peakY;
const steel=new T.MeshStandardMaterial({color:0x2b3235,metalness:.55,roughness:.55,emissive:0x0b1214,transparent:true});
const steelL=new T.MeshStandardMaterial({color:0x4a5459,metalness:.5,roughness:.5,emissive:0x111a1d,transparent:true});
HX.roofMats.push(steel,steelL);
function beams(list,mat,th){const im=new T.InstancedMesh(new T.BoxGeometry(1,1,1),mat,list.length);const o=new T.Object3D(),up=new T.Vector3(0,1,0);
  list.forEach(([a,b,t],i)=>{const A=new T.Vector3(...a),B=new T.Vector3(...b),d=B.clone().sub(A);o.position.copy(A).addScaledVector(d,.5);o.quaternion.setFromUnitVectors(up,d.clone().normalize());o.scale.set(t||th,d.length(),t||th);o.updateMatrix();im.setMatrixAt(i,o.matrix);});
  im.instanceMatrix.needsUpdate=true;im.raycast=()=>{};return im;}
const topY=z=>CY+1.4+(PY_-CY-1.6)*(1-Math.abs(z)/HD);
const TR=[],TR2=[],TX=[];for(let x=-HW+8;x<=HW-8;x+=9)TX.push(x);
TX.forEach(x=>{
  TR.push([[x,CY,-HD],[x,CY,HD],.42]);
  TR.push([[x,topY(-HD),-HD],[x,topY(0),0],.42]);TR.push([[x,topY(0),0],[x,topY(HD),HD],.42]);
  for(let z=-HD;z<HD-.1;z+=4){const z2=z+4;TR2.push([[x,CY,z],[x,topY(z),z],.16]);TR2.push([[x,CY,z],[x,topY(z2),z2],.13]);}
  TR.push([[x,0,-HD+.4],[x,CY,-HD+.4],.6]);TR.push([[x,0,HD-.4],[x,CY,HD-.4],.6]);});
for(let z=-HD+4;z<HD;z+=8)TR2.push([[-HW,topY(z)+.25,z],[HW,topY(z)+.25,z],.2]);
[-18,-6,6,18].forEach(z=>TR2.push([[-HW,CY-.35,z],[HW,CY-.35,z],.18]));
HX.roof.add(beams(TR,steel,.4),beams(TR2,steelL,.15));
// дах зі світловими панелями
const roofTex=cvTex(512,1024,(x,w,h)=>{const g=x.createLinearGradient(0,0,0,h);g.addColorStop(0,'#0b1214');g.addColorStop(.5,'#121b1e');g.addColorStop(1,'#0b1214');x.fillStyle=g;x.fillRect(0,0,w,h);
  x.fillStyle='rgba(255,255,255,.03)';for(let i=0;i<w;i+=8)x.fillRect(i,0,3,h);});
const roofE=cvTex(512,1024,(x,w,h)=>{x.fillStyle='#000';x.fillRect(0,0,w,h);for(let i=0;i<5;i++){const y=h*(.12+i*.19);const g=x.createLinearGradient(0,y,0,y+40);g.addColorStop(0,'rgba(70,120,130,.0)');g.addColorStop(.5,'rgba(90,150,160,.55)');g.addColorStop(1,'rgba(70,120,130,0)');x.fillStyle=g;x.fillRect(0,y,w,40);}});
const roofMat=new T.MeshStandardMaterial({map:roofTex,emissiveMap:roofE,emissive:0x6a8a90,roughness:.9,metalness:.2,transparent:true});HX.roofMats.push(roofMat);
{const y0=topY(HD)+.45,y1=topY(0)+.45;const pos=[],uv=[];
 const quad=(a,b,c,d,ua,ub,uc,ud)=>{pos.push(...a,...c,...b,...a,...d,...c);uv.push(...ua,...uc,...ub,...ua,...ud,...uc);};
 quad([-HW,y0,-HD],[-HW,y1,0],[HW,y1,0],[HW,y0,-HD],[0,0],[0,1],[1,1],[1,0]);
 quad([-HW,y1,0],[-HW,y0,HD],[HW,y0,HD],[HW,y1,0],[0,1],[0,0],[1,0],[1,1]);
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.computeVertexNormals();
 const m=M(g,roofMat);m.raycast=()=>{};HX.roof.add(m);}
// стіни
function wallTex(kind){return cvTex(2048,1024,(x,w,h)=>{
  const g=x.createLinearGradient(0,0,0,h);g.addColorStop(0,'#141c1f');g.addColorStop(.7,'#1d2629');g.addColorStop(1,'#232c2f');x.fillStyle=g;x.fillRect(0,0,w,h);
  for(let i=0;i<w;i+=14){x.fillStyle=i%28?'rgba(255,255,255,.025)':'rgba(0,0,0,.18)';x.fillRect(i,0,6,h*.93);}
  if(kind==='door'){x.strokeStyle='rgba(0,0,0,.55)';x.lineWidth=6;for(let i=1;i<6;i++){x.beginPath();x.moveTo(w*i/6,h*.12);x.lineTo(w*i/6,h*.93);x.stroke();}
    x.fillStyle='#0c1113';x.fillRect(0,h*.09,w,h*.04);for(let i=0;i<6;i++){x.fillStyle='rgba(255,255,255,.05)';x.fillRect(w*i/6+30,h*.2,w/6-60,4);x.fillRect(w*i/6+30,h*.55,w/6-60,4);}
    x.font=`700 ${h*.2}px "Exo 2",sans-serif`;x.textAlign='center';x.fillStyle='rgba(200,215,220,.07)';x.fillText('АНГАР 05',w/2,h*.5);}
  else{x.fillStyle='#0d1315';x.fillRect(0,h*.34,w,h*.06);
    x.font=`700 ${h*.09}px "Exo 2",sans-serif`;x.fillStyle='rgba(200,215,220,.06)';x.fillText('ТЕХ. ЗОНА · TECH AREA',w*.06,h*.6);}
  for(let i=0;i<w;i+=64){x.fillStyle=(i/64)%2?'#d8a51c':'#141414';x.save();x.beginPath();x.rect(0,h*.94,w,h*.06);x.clip();x.translate(i,h*.94);x.transform(1,0,-.9,1,0,0);x.fillRect(0,0,32,h*.06);x.restore();}
  x.fillStyle='rgba(0,0,0,.5)';x.fillRect(0,h*.935,w,4);});}
function wallEm(kind){return cvTex(1024,512,(x,w,h)=>{x.fillStyle='#000';x.fillRect(0,0,w,h);
  const win=(cx,cy,ww,hh,c)=>{const g=x.createLinearGradient(0,cy,0,cy+hh);g.addColorStop(0,c);g.addColorStop(1,'rgba(30,60,70,.4)');x.fillStyle=g;x.fillRect(cx,cy,ww,hh);x.fillStyle='rgba(0,0,0,.85)';for(let i=1;i<4;i++)x.fillRect(cx+ww*i/4-1,cy,2,hh);};
  if(kind==='door'){for(let i=0;i<12;i++)win(30+i*82,h*.025,60,h*.05,'rgba(120,190,200,.9)');x.fillStyle='rgba(80,150,165,.55)';x.fillRect(w/2-3,h*.14,6,h*.79);}
  else{for(let i=0;i<10;i++)win(40+i*98,h*.05,70,h*.2,'rgba(110,170,185,.75)');
    for(let i=0;i<6;i++){x.fillStyle='rgba(255,255,255,.85)';x.fillRect(80+i*170,h*.42,70,6);}
    [0.18,0.82].forEach(p=>{const g=x.createRadialGradient(w*p,h*.55,0,w*p,h*.55,16);g.addColorStop(0,'rgba(255,140,50,1)');g.addColorStop(1,'rgba(255,90,20,0)');x.fillStyle=g;x.fillRect(w*p-16,h*.55-16,32,32);});}});}
function wall(kind,len,hh){const m=new T.MeshStandardMaterial({map:wallTex(kind),emissiveMap:wallEm(kind),emissive:0xffffff,roughness:.85,metalness:.25,transparent:true});HX.mats.push(m);
  const me=M(new T.PlaneGeometry(len,hh),m);me.raycast=()=>{};return me;}
{const wd=wall('door',HD*2,WH);wd.position.set(-HW,WH/2,0);wd.rotation.y=PI/2;HX.g.add(wd);
 const we=wall('side',HD*2,WH);we.position.set(HW,WH/2,0);we.rotation.y=-PI/2;HX.g.add(we);
 const wn=wall('side',HW*2,WH);wn.position.set(0,WH/2,-HD);HX.g.add(wn);
 const ws=wall('side',HW*2,WH);ws.position.set(0,WH/2,HD);ws.rotation.y=PI;HX.g.add(ws);
 // фронтони
 const gm=new T.MeshStandardMaterial({color:0x111719,roughness:.9,metalness:.2,emissive:0x05090a,transparent:true});HX.roofMats.push(gm);
 [-1,1].forEach(s=>{const sh=new T.Shape();sh.moveTo(-HD,WH);sh.lineTo(HD,WH);sh.lineTo(HD,topY(HD)+.5);sh.lineTo(0,topY(0)+.5);sh.lineTo(-HD,topY(HD)+.5);sh.lineTo(-HD,WH);
   const m=M(new T.ShapeGeometry(sh),gm);m.rotation.y=s*PI/2;m.position.x=-s*HW;HX.roof.add(m);});}
// світильники
const LAMP=[];for(let x=-HW+12.5;x<HW-8;x+=9)[-18,-6,6,18].forEach(z=>LAMP.push([x,CY-2.3,z]));
{const shade=new T.InstancedMesh(new T.CylinderGeometry(.28,.75,.7,16,1,true),new T.MeshStandardMaterial({color:0x2a3134,metalness:.6,roughness:.4,side:T.DoubleSide,transparent:true}),LAMP.length);
 const disc=new T.InstancedMesh(new T.CircleGeometry(.68,16).rotateX(PI/2),new T.MeshBasicMaterial({color:0xfff3dc,transparent:true}),LAMP.length);
 const o=new T.Object3D();LAMP.forEach((p,i)=>{o.position.set(...p);o.updateMatrix();shade.setMatrixAt(i,o.matrix);o.position.y-=.34;o.updateMatrix();disc.setMatrixAt(i,o.matrix);});
 HX.roofMats.push(shade.material,disc.material);shade.raycast=disc.raycast=()=>{};HX.roof.add(shade,disc);
 const cab=[];LAMP.forEach(p=>cab.push(new T.Vector3(p[0],p[1]+.35,p[2]),new T.Vector3(p[0],CY-.35,p[2])));
 const cl=new T.LineSegments(new T.BufferGeometry().setFromPoints(cab),new T.LineBasicMaterial({color:0x2a3236,transparent:true}));HX.roofMats.push(cl.material);HX.roof.add(cl);
 // ореоли (bloom-подібне світіння)
 const gp=new T.BufferGeometry();gp.setAttribute('position',new T.Float32BufferAttribute(LAMP.flatMap(p=>[p[0],p[1]-.45,p[2]]),3));
 const gpm=new T.PointsMaterial({map:glowTex,color:0xffe7c4,size:4.2,sizeAttenuation:true,transparent:true,opacity:.85,depthWrite:false,blending:T.AdditiveBlending});
 const pts=new T.Points(gp,gpm);pts.raycast=()=>{};HX.roof.add(pts);HX.glowM=gpm;
 // об'ємні конуси світла
 const pos=[],al=[];const cone=(ax,ay,az,h,r0,r1,seg)=>{for(let i=0;i<seg;i++){const a0=i/seg*PI*2,a1=(i+1)/seg*PI*2;
   const P=(a,r,y)=>[ax+Math.cos(a)*r,y,az+Math.sin(a)*r];const t0=P(a0,r0,ay),t1=P(a1,r0,ay),b0=P(a0,r1,ay-h),b1=P(a1,r1,ay-h);
   pos.push(...t0,...b0,...b1,...t0,...b1,...t1);al.push(1,0,0,1,0,1);}};
 LAMP.forEach(p=>cone(p[0],p[1]-.4,p[2],p[1]-.4,.62,3.6,18));
 cone(0,CY-.6,1.2,CY-.6,1.2,10.5,40);
 const cg=new T.BufferGeometry();cg.setAttribute('position',new T.Float32BufferAttribute(pos,3));cg.setAttribute('aT',new T.Float32BufferAttribute(al,1));cg.computeVertexNormals();
 const cm=new T.ShaderMaterial({uniforms:{uO:{value:1},uC:{value:new T.Color(0xffe9cc)}},transparent:true,depthWrite:false,blending:T.AdditiveBlending,side:T.DoubleSide,
   vertexShader:'attribute float aT;varying float vT;varying vec3 vN;varying vec3 vV;void main(){vT=aT;vN=normalize(normalMatrix*normal);vec4 mv=modelViewMatrix*vec4(position,1.);vV=normalize(-mv.xyz);gl_Position=projectionMatrix*mv;}',
   fragmentShader:'uniform float uO;uniform vec3 uC;varying float vT;varying vec3 vN;varying vec3 vV;void main(){float e=pow(abs(dot(normalize(vN),normalize(vV))),2.0);gl_FragColor=vec4(uC*(.055*pow(vT,1.6)+.01*vT)*e*uO,1.);}'});
 const cmesh=M(cg,cm);cmesh.raycast=()=>{};cmesh.renderOrder=5;HX.roof.add(cmesh);HX.coneM=cm;}
// головний прожектор над літаком + тепло-холодне світло ангара
HX.spot=new T.SpotLight(0xfff0dc,0,80,.62,.85,1.1);HX.spot.position.set(3,CY-.8,6);HX.spot.target.position.set(0,0,0);HX.g.add(HX.spot,HX.spot.target);
HX.fill=new T.SpotLight(0x8fd6e6,0,90,.75,1,1.2);HX.fill.position.set(-30,9,-20);HX.fill.target.position.set(0,1.5,0);HX.g.add(HX.fill,HX.fill.target);
HX.orange=new T.PointLight(0xff7a2e,0,38,1.6);HX.orange.position.set(-22,3,16);HX.g.add(HX.orange);
// реквізит ангара (процедурний, у стилі WoWp): тягач, паливозаправник, драбини, візки, домкрати, ящики, верстат, кабелі, вогнегасники
{const pm=(c,r=.7,mt=.25,o={})=>{const m=new T.MeshStandardMaterial(Object.assign({color:c,roughness:r,metalness:mt,transparent:true},o));HX.mats.push(m);return m;};
 const P=(g,x,z,ry=0)=>{const G=new T.Group();g(G);G.position.set(x,0,z);G.rotation.y=ry;G.traverse(o=>{if(o.isMesh){o.castShadow=o.receiveShadow=true;o.raycast=()=>{};}});HX.g.add(G);HX.props.push(G);return G;};
 const bx=(G,w,h,d,x,y,z,m)=>{const b=M(new T.BoxGeometry(w,h,d),m);b.position.set(x,y,z);G.add(b);return b;};
 const cy=(G,r,h,x,y,z,m,ax='y',s=16)=>{const c=M(new T.CylinderGeometry(r,r,h,s),m);c.position.set(x,y,z);if(ax==='z')c.rotation.x=PI/2;if(ax==='x')c.rotation.z=PI/2;G.add(c);return c;};
 const stTex=(bg,fg,txt,sub)=>cvTex(256,128,(x,w,h)=>{x.fillStyle=bg;x.fillRect(0,0,w,h);for(let i=0;i<500;i++){x.fillStyle=`rgba(0,0,0,${Math.random()*.08})`;x.fillRect(Math.random()*w,Math.random()*h,3,3);}
   x.strokeStyle='rgba(0,0,0,.35)';x.lineWidth=6;x.strokeRect(4,4,w-8,h-8);x.fillStyle=fg;x.font='bold 34px sans-serif';x.textAlign='center';x.fillText(txt,w/2,62);x.font='16px sans-serif';x.fillText(sub,w/2,92);});
 const steel=pm(0x3a4246,.45,.7),dark=pm(0x15191b,.6,.4),tyre=pm(0x0d0f10,.9,0),yel=pm(0xc8961c,.45,.3),red=pm(0x7a1a14,.45,.3),olive=pm(0x3d4630,.7,.2),chrome=pm(0xaab4b8,.25,.9),glass=pm(0x1d2a30,.1,.6);
 const crateM=[pm(0xffffff,.8,.05,{map:stTex('#3c4630','#d8d2b0','ЗСУ','БК · 7.62')}),pm(0xffffff,.8,.05,{map:stTex('#2f3a2a','#e8c46a','ОБЕРЕЖНО','ВОГНЕНЕБЕЗПЕЧНО')}),pm(0xffffff,.8,.05,{map:stTex('#40352a','#e0d8c0','ЗАПЧАСТИНИ','Р-27 / Р-73')})];
 const wheel=(G,r,w,x,y,z)=>{cy(G,r,w,x,y,z,tyre,'z',20);cy(G,r*.55,w*1.04,x,y,z,steel,'z',12);};
 // тягач-буксирувальник
 P(G=>{bx(G,3.6,.7,2,0,.75,0,yel);bx(G,1.4,1.1,1.8,-.9,1.6,0,yel);bx(G,1.2,.7,1.7,-.95,1.85,0,glass);bx(G,.2,.3,1.8,1.9,.6,0,dark);bx(G,1.2,.12,.12,2.6,.55,0,steel);
   [[-1.1,1],[-1.1,-1],[1.1,1],[1.1,-1]].forEach(([x,z])=>wheel(G,.45,.36,x,.45,z));bx(G,.08,.8,.08,-.3,2.5,.8,dark);cy(G,.08,.06,-.3,2.95,.8,pm(0xff8a1c,.3,0,{emissive:0xff6a00,emissiveIntensity:2}),'y',10);},-34,24,.5);
 // паливозаправник
 P(G=>{bx(G,2.2,2,2.3,3.2,1.5,0,olive);bx(G,.05,.8,2,4.32,2,0,glass);bx(G,6.6,.4,1.6,-.3,.8,0,dark);const tk=cy(G,1.15,5.6,-.6,2.2,0,olive,'x',24);
   cy(G,1.16,.1,-3.4,2.2,0,steel,'x',24);cy(G,1.16,.1,2.2,2.2,0,steel,'x',24);bx(G,5.4,.08,.6,-.6,3.38,0,steel);bx(G,1.2,1,2.4,-3.2,1.2,0,dark);
   [[3.2,1.05],[3.2,-1.05],[-1.6,1.05],[-1.6,-1.05],[-2.9,1.05],[-2.9,-1.05]].forEach(([x,z])=>wheel(G,.55,.4,x,.55,z));
   const tx=cvTex(512,64,(x,w,h)=>{x.fillStyle='#000';x.fillRect(0,0,w,h);x.fillStyle='#e8c040';x.font='bold 44px sans-serif';x.textAlign='center';x.fillText('ВОГНЕНЕБЕЗПЕЧНО · ПАЛЬНЕ',w/2,48);});
   const lab=M(new T.PlaneGeometry(3.6,.45),pm(0xffffff,.6,0,{map:tx,emissive:0x221a00}));lab.position.set(-.6,2.2,1.17);G.add(lab);},34,-26,-.35);
 // технічна драбина-стрем'янка з майданчиком
 const stairs=(G)=>{for(let i=0;i<7;i++)bx(G,.9,.05,.32,0,.4+i*.38,-1.1+i*.3,steel);[-.47,.47].forEach(x=>{const s=bx(G,.06,3.2,.06,x,1.5,-.2,yel);s.rotation.x=-.65;bx(G,.06,3,.06,x,1.5,1.3,yel);bx(G,.06,1,.06,x,3.4,1.3,yel);});
   bx(G,1,.08,1.1,0,2.95,1.15,steel);bx(G,1,.05,.05,0,3.9,1.7,yel);bx(G,1,.05,.05,0,3.9,.6,yel);[[-.4,-1.4],[.4,-1.4],[-.4,1.6],[.4,1.6]].forEach(([x,z])=>cy(G,.1,.08,x,.1,z,tyre,'x',10));};
 P(stairs,-27,-16,.4);P(stairs,26,15,-2.4);
 // візки з інструментом
 const cart=(G,c)=>{bx(G,1.2,.9,.6,0,.6,0,c);for(let i=0;i<4;i++)bx(G,1.12,.02,.56,0,.32+i*.2,.31,steel);bx(G,1.25,.04,.65,0,1.07,0,dark);bx(G,.3,.15,.15,-.2,1.17,0,red);bx(G,.5,.05,.05,.25,1.12,.1,chrome);
   [[-.5,-.22],[.5,-.22],[-.5,.22],[.5,.22]].forEach(([x,z])=>cy(G,.08,.05,x,.08,z,tyre,'z',10));bx(G,.04,.4,.6,.66,1.1,0,chrome);};
 P(G=>cart(G,red),-24,-22,.3);P(G=>cart(G,pm(0x1e4a6e,.45,.3)),29,20,-.8);P(G=>cart(G,red),24,-21,1.1);
 // гідравлічні домкрати (крилові)
 const jack=G=>{[0,2.1,4.2].forEach(a=>{const l=bx(G,.12,.12,1.6,Math.cos(a)*.6,.1,Math.sin(a)*.6,yel);l.rotation.y=-a+PI/2;});cy(G,.16,1.6,0,.9,0,yel,'y',12);cy(G,.1,1,0,2.1,0,chrome,'y',10);cy(G,.22,.08,0,2.62,0,dark,'y',12);};
 P(jack,-22,12,0);P(jack,21,-11,0);
 // ящики зі стенсилами
 P(G=>{const c=(w,h,d,x,y,z,m,r=0)=>{const b=bx(G,w,h,d,x,y,z,m);b.rotation.y=r;};c(2.2,1.1,1.3,0,.55,0,crateM[0]);c(2.2,1.1,1.3,.1,1.65,.05,crateM[2],.08);c(1.4,.9,1.2,-.2,.45,1.6,crateM[1],-.15);c(1.2,.8,1,1.9,.4,1.2,crateM[0],.4);},-38,-28,.2);
 P(G=>{bx(G,2.2,1.1,1.3,0,.55,0,crateM[1]);bx(G,2.2,1.1,1.3,0,.55,1.5,crateM[0]);bx(G,1.2,.15,1.2,2,.08,0,pm(0x6b4d2a,.9,0));bx(G,1,.9,1,2,.6,0,crateM[2]);},38,-6,-.4);
 // верстат з інструментальною стінкою та лампою
 P(G=>{bx(G,4,.08,1,0,1,0,pm(0x5a4630,.8,.05));bx(G,4,.06,.9,0,.3,0,steel);[-1.9,1.9].forEach(x=>[-.4,.4].forEach(z=>bx(G,.07,1,.07,x,.5,z,dark)));
   const pb=cvTex(512,256,(x,w,h)=>{x.fillStyle='#2b3134';x.fillRect(0,0,w,h);x.fillStyle='#14181a';for(let i=8;i<w;i+=16)for(let j=8;j<h;j+=16)x.fillRect(i,j,3,3);
     x.strokeStyle='#c9cfd2';x.lineWidth=5;for(let i=0;i<9;i++){const a=30+i*52;x.beginPath();x.moveTo(a,40);x.lineTo(a+(i%3)*6,40+60+(i%4)*14);x.stroke();}x.fillStyle='#b8261a';x.fillRect(60,170,120,46);x.fillStyle='#d8a020';x.fillRect(300,160,70,60);});
   const w=M(new T.PlaneGeometry(4,2),pm(0xffffff,.8,.1,{map:pb}));w.position.set(0,2.2,-.48);G.add(w);bx(G,.3,.25,.5,1.3,1.17,0,pm(0x23466a,.4,.4));bx(G,.4,.15,.25,-1.2,1.12,.1,red);
   cy(G,.25,.05,0,3.3,-.2,dark,'y',12);},0,-34.5,0);
 // візок з вогнегасниками
 P(G=>{bx(G,.9,.06,.6,0,.25,0,steel);[-.25,.25].forEach(x=>{cy(G,.17,1,x,.8,0,red,'y',14);cy(G,.05,.15,x,1.37,0,dark,'y',8);});bx(G,.04,1.3,.04,-.42,.9,-.25,steel);cy(G,.22,.08,0,.22,.32,tyre,'x',12);},-17,-34,0);
 // колодки під колеса та кабелі
 P(G=>{[[0,0],[0,.8],[1.4,.3]].forEach(([x,z])=>{const b=bx(G,.5,.22,.32,x,.11,z,yel);b.rotation.y=.3*z;});},-30,8,0);
 {const m=pm(0x0e1112,.6,.2);[[[-44,0,-12],[-36,0,-10],[-30,0,-14],[-24,0,-12]],[[44,0,8],[37,0,10],[33,0,6],[28,0,8.5]]].forEach(pts=>{const c=new T.CatmullRomCurve3(pts.map(p=>new T.Vector3(p[0],.05,p[2])));const t=M(new T.TubeGeometry(c,48,.05,6),m);t.receiveShadow=true;t.raycast=()=>{};HX.g.add(t);});}
 // підсвічений «подіум»: кільце й мітки під літаком
 {const rt=cvTex(1024,1024,(x,w,h)=>{const c=w/2;const gr=x.createRadialGradient(c,c,0,c,c,c);gr.addColorStop(0,'rgba(255,236,200,.22)');gr.addColorStop(.7,'rgba(255,236,200,.07)');gr.addColorStop(.93,'rgba(255,200,90,.0)');gr.addColorStop(.95,'rgba(255,196,64,.55)');gr.addColorStop(.965,'rgba(255,196,64,0)');gr.addColorStop(1,'rgba(0,0,0,0)');x.fillStyle=gr;x.fillRect(0,0,w,h);
   x.strokeStyle='rgba(255,196,64,.5)';x.lineWidth=6;for(let i=0;i<36;i++){const a=i/36*PI*2;x.beginPath();x.moveTo(c+Math.cos(a)*c*.88,c+Math.sin(a)*c*.88);x.lineTo(c+Math.cos(a)*c*.92,c+Math.sin(a)*c*.92);x.stroke();}});
  const m=new T.MeshBasicMaterial({map:rt,transparent:true,depthWrite:false,blending:T.AdditiveBlending});HX.dec=[[m,1]];const d=M(new T.PlaneGeometry(30,30),m);d.rotation.x=-PI/2;d.position.y=.03;d.raycast=()=>{};d.renderOrder=2;HX.g.add(d);
  // плями мастила
  const st=cvTex(512,512,(x,w,h)=>{for(let i=0;i<26;i++){const px=Math.random()*w,py=Math.random()*h,r=20+Math.random()*70;const g=x.createRadialGradient(px,py,0,px,py,r);g.addColorStop(0,'rgba(0,0,0,.5)');g.addColorStop(1,'rgba(0,0,0,0)');x.fillStyle=g;x.fillRect(0,0,w,h);}});
  const sm=new T.MeshBasicMaterial({map:st,transparent:true,depthWrite:false,color:0x000000});HX.dec.push([sm,.55]);
  [[-14,-10,12],[16,12,14],[-30,18,10],[30,-18,12],[4,22,9]].forEach(([x,z,s])=>{const p=M(new T.PlaneGeometry(s,s),sm);p.rotation.x=-PI/2;p.rotation.z=x;p.position.set(x,.02,z);p.raycast=()=>{};p.renderOrder=1;HX.g.add(p);});}
}
// пил у світлі
{const n=420,p=new Float32Array(n*3);for(let i=0;i<n;i++){const a=Math.random()*PI*2,r=Math.sqrt(Math.random())*14;p[i*3]=Math.cos(a)*r;p[i*3+1]=Math.random()*12;p[i*3+2]=Math.sin(a)*r;}
 const g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(p,3));
 HX.dustM=new T.PointsMaterial({map:softTex,color:0xcfe6ea,size:.09,sizeAttenuation:true,transparent:true,opacity:.55,depthWrite:false,blending:T.AdditiveBlending});
 HX.dust=new T.Points(g,HX.dustM);HX.dust.raycast=()=>{};HX.g.add(HX.dust);}
HX.allMats=()=>HX.mats.concat(HX.roofMats);
const FOG_H=new T.Color(0x0a1519),FOG_O=new T.Color(0x111214),fogTmp=new T.Color();
const HEMI_SKY_O=new T.Color(0xa9b8cc),HEMI_SKY_H=new T.Color(0x86a6b0);
const camW=new T.Vector3();
function updHangar(dt){
  // адаптивна якість: якщо стабільно < ~40 fps — зменшуємо відбиття та pixel ratio (вимкнути: ?hq)
  HX.ft=HX.ft*.96+dt*1000*.04;HX.qt+=dt;
  if(!HX.hq&&HX.qt>4&&HX.ft>25&&HX.rs>.3){HX.qt=0;if(renderer.getPixelRatio()>1)renderer.setPixelRatio(1);else HX.rs=.3;resize();}
  HX.t+=dt;const want=(S.ground==='apron'&&!S.air&&C.land<.02)?1:0;HX.HF=ease(HX.HF,want,2.2,dt);const hf=HX.HF;
  // камера в координатах world: ховаємо дах, коли дивимось згори, і реквізит, що заступає кадр
  camW.copy(camera.position);world.worldToLocal(camW);
  const rk=hf*clamp((CY+1-camera.position.y)/3,0,1);
  HX.roof.visible=rk>.01;HX.roofMats.forEach(m=>{m.opacity=rk;});HX.glowM.opacity=.85*rk;HX.coneM.uniforms.uO.value=rk;
  HX.g.visible=hf>.01;HX.mats.forEach(m=>{m.opacity=hf;});if(HX.dec)HX.dec.forEach(([m,b])=>{m.opacity=b*hf;});
  HX.props.forEach(p=>{p.visible=Math.hypot(p.position.x-camW.x,p.position.z-camW.z)>9;});
  HX.dustM.opacity=.5*hf;const dp=HX.dust.geometry.attributes.position;for(let i=0;i<dp.count;i++){let y=dp.getY(i)+dt*.12*(.4+(i%7)*.1);if(y>12)y=0;dp.setY(i,y);dp.setX(i,dp.getX(i)+Math.sin(HX.t*.3+i)*dt*.05);}dp.needsUpdate=true;
  HX.spot.intensity=1.9*hf;HX.fill.intensity=.75*hf;HX.orange.intensity=(.9+.15*Math.sin(HX.t*2.1))*hf;
  hemi.intensity=.6-.22*hf;hemi.color.copy(HEMI_SKY_O).lerp(HEMI_SKY_H,hf);key.intensity=.85-.45*hf;rim.intensity=.45+.25*hf;rim.color.setHex(hf>.5?0x6fb6c6:0x8899aa);
  const f=scene.fog;fogTmp.copy(FOG_O).lerp(FOG_H,hf);f.color.copy(fogTmp);renderer.setClearColor(fogTmp);
  f.near=f.near+(26-f.near)*hf;f.far=f.far+(150-f.far)*hf;
  const u=floor.material.uniforms;u.uScroll.value=S.scroll;u.uHF.value=hf;u.uFog.value.copy(fogTmp);u.uFogR.value.set(f.near,f.far);u.uRefl.value=.6+.4*hf;
  floor.visible=C.land<.98;
}
