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
