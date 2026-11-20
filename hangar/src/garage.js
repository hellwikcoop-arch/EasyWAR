/* ---------- виноски ТТХ: прив'язка до реальних вузлів моделі, колонки без перетину ліній ---------- */
// точка на поверхні моделі: промінь збоку (з боку камери) до центру; якщо мимо — згори; інакше точка габариту
function coVis(h){let o=h.object;if(!o.isMesh)return false;const m=Array.isArray(o.material)?o.material[0]:o.material;if(m&&(m.visible===false||(m.transparent&&m.opacity<.35)||m.blending===THREE.AdditiveBlending))return false;while(o){if(!o.visible)return false;o=o.parent;}return true;}
function coSnap(root,x,y,side,B,filt,topZ,M,mode){const rc=new THREE.Raycaster(),zc=(B.min.z+B.max.z)/2,hw=(B.max.z-B.min.z)/2;
  const tryR=(o,d)=>{if(M){o.applyMatrix4(M);d.transformDirection(M);}rc.set(o,d);rc.far=200;rc.camera=typeof camera!=='undefined'?camera:null;const h=rc.intersectObject(root,true).filter(filt||coVis);return h.length?h[0]:null;};
  const up=M?new THREE.Vector3(0,1,0).transformDirection(M):new THREE.Vector3(0,1,0),sv=M?new THREE.Vector3(0,0,side).transformDirection(M):new THREE.Vector3(0,0,side);let h;
  if(mode==='b'){h=tryR(new THREE.Vector3(x,B.min.y-2,zc+side*hw*(topZ||0)),new THREE.Vector3(0,1,0));if(h)return coLoc(h,up.clone().multiplyScalar(-.04));}
  if(mode!=='t'){h=tryR(new THREE.Vector3(x,y,zc+side*(hw+3)),new THREE.Vector3(0,0,-side));
  if(h){const lz=M?h.point.clone().applyMatrix4(M.clone().invert()).z:h.point.z;if(Math.abs(lz-zc)>hw*.25||mode==='s')return coLoc(h,sv.clone().multiplyScalar(.04));}}
  h=tryR(new THREE.Vector3(x,B.max.y+3,zc+side*hw*(topZ==null?.2:topZ)),new THREE.Vector3(0,-1,0));if(h)return coLoc(h,up.clone().multiplyScalar(.04));
  return null;}
function coLoc(h,off){return {o:h.object,p:h.object.worldToLocal(h.point.clone().add(off))};}
function coW(a){a.o.updateWorldMatrix(true,false);return a.o.localToWorld(a.p.clone());}
// розкладка: ліва/права колонка за положенням якоря, порядок у колонці — за висотою якоря
function coLayout(items,o){const L=[],R=[];items.forEach(it=>{if(!it.vis){it.o.d.style.opacity=0;it.o.pl.style.opacity=it.o.c.style.opacity=0;return;}let lf=it.fix?it.fix==='L':it.P.x<o.cx;if(!it.fix&&it.o.left!=null&&Math.abs(it.P.x-o.cx)<90)lf=it.o.left;(lf?L:R).push(it);});
  while(L.length>R.length+1){L.sort((a,b)=>b.P.x-a.P.x);const m=L.findIndex(i=>!i.fix);if(m<0)break;R.push(L.splice(m,1)[0]);}
  while(R.length>L.length+1){R.sort((a,b)=>a.P.x-b.P.x);const m=R.findIndex(i=>!i.fix);if(m<0)break;L.push(R.splice(m,1)[0]);}
  const k=Math.min(1,o.dt*10);
  [[L,true],[R,false]].forEach(([col,left])=>{col.sort((a,b)=>a.P.y-b.P.y);const hs=col.map(i=>i.o.d.offsetHeight),ws=col.map(i=>i.o.d.offsetWidth),gap=16;
    const tot=hs.reduce((a,b)=>a+b,0)+gap*Math.max(0,col.length-1);const my=col.length?col.reduce((a,i)=>a+i.P.y,0)/col.length:0;
    let y=Math.max(o.top,Math.min(o.bot-tot,my-tot/2));
    col.forEach((it,j)=>{const bw=ws[j],bh=hs[j],tx=left?o.lx:o.W-o.rx-bw,ty=y;y+=bh+gap;const b=it.o;
      b.x=b.x==null||b.left!==left?tx:b.x+(tx-b.x)*k;b.y=b.y==null||b.left!==left?ty:b.y+(ty-b.y)*k;b.left=left;
      b.d.style.transform=`translate(${b.x.toFixed(1)}px,${b.y.toFixed(1)}px)`;
      const jx=left?b.x+bw+4:b.x-4,jy=b.y+Math.min(bh*.5,22),ex=jx+(left?22:-22);
      b.pl.setAttribute('points',`${it.P.x.toFixed(1)},${it.P.y.toFixed(1)} ${ex.toFixed(1)},${jy.toFixed(1)} ${jx.toFixed(1)},${jy.toFixed(1)}`);
      b.c.setAttribute('cx',it.P.x.toFixed(1));b.c.setAttribute('cy',it.P.y.toFixed(1));b.d.style.opacity=1;b.pl.style.opacity=b.c.style.opacity=1;});});}
// розмірні лінії: довжина — по землі вздовж борту з боку камери, ширина — по землі за кормою, висота — вертикаль на кормовому куті; з засічками і підписами
function coDimG(svg){const NS='http://www.w3.org/2000/svg',g=document.createElementNS(NS,'g');g.setAttribute('class','codim');const p=document.createElementNS(NS,'path');g.append(p);g.t=[0,1,2].map(()=>{const t=document.createElementNS(NS,'text');g.append(t);return t;});g.p=p;svg.prepend(g);return g;}
function coDims(g,pj,B,side,rear,lab,cx,cy,hc){const V=(x,y,z)=>pj(new THREE.Vector3(x,y,z));const zN=side>0?B.max.z:B.min.z,zF=side>0?B.min.z:B.max.z,o=.45,y0=B.min.y+.03;
  const xr=rear>0?B.max.x:B.min.x,xf=rear>0?B.min.x:B.max.x,xo=xr+rear*o,zo=zN+side*o;
  const segs=[[V(xf,y0,zo),V(xr,y0,zo)],[V(xo,y0,zN),V(xo,y0,zF)],[V(xo,B.min.y,hc?(B.min.z+B.max.z)/2:zo),V(xo,B.max.y,hc?(B.min.z+B.max.z)/2:zo)]];
  let d='',ok=segs.every(s=>s[0].z<1&&s[1].z<1);const f=n=>n.x.toFixed(1)+','+n.y.toFixed(1);
  segs.forEach((s,i)=>{const [a,b]=s,dx=b.x-a.x,dy=b.y-a.y,l=Math.hypot(dx,dy)||1;let nx=-dy/l,ny=dx/l;const mx=(a.x+b.x)/2,my=(a.y+b.y)/2;if((mx-cx)*nx+(my-cy)*ny<0){nx=-nx;ny=-ny;}
    const T=6;d+=`M${f(a)}L${f(b)}M${(a.x-nx*T).toFixed(1)},${(a.y-ny*T).toFixed(1)}L${(a.x+nx*T).toFixed(1)},${(a.y+ny*T).toFixed(1)}M${(b.x-nx*T).toFixed(1)},${(b.y-ny*T).toFixed(1)}L${(b.x+nx*T).toFixed(1)},${(b.y+ny*T).toFixed(1)}`;
    const t=g.t[i];t.textContent=lab[i]?lab[i]+' м':'';t.setAttribute('x',(mx+nx*16).toFixed(1));t.setAttribute('y',(my+ny*16+4).toFixed(1));t.style.display=l>30?'':'none';if(l>30){try{const r=t.getBoundingClientRect(),hp=g.ownerSVGElement&&g.ownerSVGElement.parentNode;if(hp&&r.width)for(const e of hp.querySelectorAll(':scope > div')){if(!e.offsetParent)continue;const q=e.getBoundingClientRect();if(q.width&&r.left<q.right+12&&r.right>q.left-12&&r.top<q.bottom+4&&r.bottom>q.top-4){t.style.display='none';break;}}}catch(e){}}});
  g.p.setAttribute('d',d);g.style.opacity=ok?1:0;const s0=segs[0];return {x:(s0[0].x+s0[1].x)/2,y:(s0[0].y+s0[1].y)/2,z:Math.max(s0[0].z,s0[1].z)};}

// квантовані (normalized) позиції ламають Raycaster у r128 — переводимо у Float32 один раз (рендер не змінюється)
function coDeq(root){const mp=new Map();root.traverse(o=>{const g=o.geometry;if(!o.isMesh||!g)return;const pa=g.attributes.position;if(!pa||!pa.normalized)return;
  let na=mp.get(pa);if(!na){const a=pa.isInterleavedBufferAttribute?pa.data.array:pa.array,dv=a instanceof Int16Array?32767:a instanceof Uint16Array?65535:a instanceof Int8Array?127:a instanceof Uint8Array?255:1,is=pa.itemSize,n=pa.count,f=new Float32Array(n*is);
    if(pa.isInterleavedBufferAttribute){const ib=pa.data,st=ib.stride,off=pa.offset,arr=ib.array;for(let i=0;i<n;i++)for(let j=0;j<is;j++)f[i*is+j]=Math.max(arr[i*st+off+j]/dv,-1);}
    else for(let i=0;i<a.length;i++)f[i]=Math.max(a[i]/dv,-1);na=new THREE.BufferAttribute(f,is);mp.set(pa,na);}
  g.setAttribute('position',na);g.computeBoundingBox();g.computeBoundingSphere();});return mp.size;}
/* ---------- прапори країни-розробника (вбудований SVG 3:2) ---------- */
const FLAG_N={UA:'Україна',US:'США',DE:'Німеччина',SE:'Швеція',FR:'Франція',SU:'СРСР',RU:'росія',IR:'Іран',GB:'Велика Британія',PL:'Польща',CZ:'Чехія',SK:'Словаччина',IT:'Італія',NO:'Норвегія',FI:'Фінляндія',NL:'Нідерланди',CA:'Канада',AU:'Австралія',TR:'Туреччина',ES:'Іспанія',DK:'Данія',BE:'Бельгія',CH:'Швейцарія',KR:'Південна Корея',IL:'Ізраїль',PT:'Португалія',GR:'Греція',BY:'білорусь',KP:'КНДР'};
function flagSVG(c){const R=(x,y,w,h,f)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${f}"/>`,H3=(a,b,d)=>R(0,0,30,7,a)+R(0,7,30,6,b)+R(0,13,30,7,d),V3=(a,b,d)=>R(0,0,10,20,a)+R(10,0,10,20,b)+R(20,0,10,20,d),NX=(bg,cr,in2)=>R(0,0,30,20,bg)+R(8,0,in2?6:4,20,cr)+R(0,in2?7:8,30,in2?6:4,cr)+(in2?R(9.5,0,3,20,in2)+R(0,8.5,30,3,in2):'');let b='';
  switch(c){case 'UA':b=R(0,0,30,10,'#0057b7')+R(0,10,30,10,'#ffd700');break;
    case 'US':for(let i=0;i<7;i++)b+=R(0,i*20/6.5,30,20/13,'#b22234');b=R(0,0,30,20,'#fff')+b+R(0,0,13,10.8,'#3c3b6e');for(let r=0;r<4;r++)for(let k=0;k<5;k++)b+=`<circle cx="${1.5+k*2.5}" cy="${1.5+r*2.6}" r=".55" fill="#fff"/>`;break;
    case 'DE':b=H3('#000','#dd0000','#ffce00');break;case 'RU':b=H3('#fff','#0039a6','#d52b1e');break;case 'IR':b=H3('#239f40','#fff','#da0000')+`<circle cx="15" cy="10" r="2" fill="none" stroke="#da0000" stroke-width=".9"/>`;break;
    case 'NL':b=H3('#ae1c28','#fff','#21468b');break;case 'FR':b=V3('#0055a4','#fff','#ef4135');break;case 'IT':b=V3('#009246','#fff','#ce2b37');break;case 'BE':b=V3('#000','#fdda24','#ef3340');break;
    case 'SE':b=NX('#006aa7','#fecc00');break;case 'FI':b=NX('#fff','#002f6c');break;case 'DK':b=NX('#c8102e','#fff');break;case 'NO':b=NX('#ba0c2f','#fff','#00205b');break;
    case 'PL':b=R(0,0,30,10,'#fff')+R(0,10,30,10,'#dc143c');break;case 'CZ':b=R(0,0,30,10,'#fff')+R(0,10,30,10,'#d7141a')+'<path d="M0 0 L15 10 L0 20 Z" fill="#11457e"/>';break;
    case 'SK':b=H3('#fff','#0b4ea2','#ee1c25')+'<path d="M6.5 4.2 H15.5 V11 Q15.5 15.6 11 17.2 Q6.5 15.6 6.5 11 Z" fill="#ee1c25" stroke="#fff" stroke-width=".9"/><path d="M10.4 6 h1.2 v1.6 h1.9 v1 h-1.9 v1.4 h2.4 v1 h-2.4 v2.4 h-1.2 v-2.4 h-2.4 v-1 h2.4 v-1.4 h-1.9 v-1 h1.9 Z" fill="#fff"/><path d="M7.4 14.3 Q9 12.6 11 13.6 Q13 12.6 14.6 14.3 Q13 16.3 11 16.9 Q9 16.3 7.4 14.3 Z" fill="#0b4ea2"/>';break;case 'GR':for(let i=0;i<9;i++)b+=R(0,i*20/9,30,20/9+.05,i%2?'#fff':'#0d5eaf');b+=R(0,0,11,11.1,'#0d5eaf')+R(4.4,0,2.2,11.1,'#fff')+R(0,4.45,11,2.2,'#fff');break;
    case 'GB':b=R(0,0,30,20,'#012169')+'<path d="M0 0 L30 20 M30 0 L0 20" stroke="#fff" stroke-width="4"/><path d="M0 0 L30 20 M30 0 L0 20" stroke="#c8102e" stroke-width="1.4"/>'+R(12,0,6,20,'#fff')+R(0,7,30,6,'#fff')+R(13.3,0,3.4,20,'#c8102e')+R(0,8.3,30,3.4,'#c8102e');break;
    case 'CA':b=R(0,0,30,20,'#fff')+R(0,0,7.5,20,'#d52b1e')+R(22.5,0,7.5,20,'#d52b1e')+'<path d="M15 4 L16.5 8 L19 7 L18 11 L20 11 L15 16 L10 11 L12 11 L11 7 L13.5 8 Z" fill="#d52b1e"/>';break;
    case 'AU':b=R(0,0,30,20,'#012169')+'<circle cx="7.5" cy="15" r="1.6" fill="#fff"/><circle cx="23" cy="5" r="1" fill="#fff"/><circle cx="25" cy="12" r="1" fill="#fff"/><circle cx="21" cy="15" r="1" fill="#fff"/>'+R(0,0,15,10,'#012169')+R(6,0,3,10,'#fff')+R(0,3.5,15,3,'#fff')+R(6.75,0,1.5,10,'#c8102e')+R(0,4.25,15,1.5,'#c8102e');break;
    case 'TR':b=R(0,0,30,20,'#e30a17')+'<circle cx="11" cy="10" r="5" fill="#fff"/><circle cx="12.3" cy="10" r="4" fill="#e30a17"/><circle cx="17.5" cy="10" r="1.6" fill="#fff"/>';break;
    case 'ES':b=R(0,0,30,5,'#aa151b')+R(0,5,30,10,'#f1bf00')+R(0,15,30,5,'#aa151b');break;case 'CH':b=R(0,0,30,20,'#d52b1e')+R(13,4,4,12,'#fff')+R(9,8,12,4,'#fff');break;
    case 'IL':b=R(0,0,30,20,'#fff')+R(0,2,30,2.5,'#0038b8')+R(0,15.5,30,2.5,'#0038b8')+'<path d="M15 6.5 L18.2 12 L11.8 12 Z M15 13.5 L11.8 8 L18.2 8 Z" fill="none" stroke="#0038b8" stroke-width=".9"/>';break;
    case 'KR':b=R(0,0,30,20,'#fff')+'<circle cx="15" cy="10" r="4.2" fill="#cd2e3a"/><path d="M10.8 10 A4.2 4.2 0 0 0 19.2 10 A2.1 2.1 0 0 0 15 10 A2.1 2.1 0 0 1 10.8 10" fill="#0047a0"/>';break;
    case 'PT':b=R(0,0,12,20,'#006600')+R(12,0,18,20,'#ff0000')+'<circle cx="12" cy="10" r="3.2" fill="#ffcc00"/>';break;
    case 'BY':b=R(0,0,30,13,'#c8313e')+R(0,13,30,7,'#4aa657')+R(0,0,3.5,20,'#fff');break;case 'KP':b=R(0,0,30,20,'#024fa2')+R(0,3,30,14,'#fff')+R(0,4,30,12,'#ed1c27')+'<circle cx="10" cy="10" r="3.6" fill="#fff"/>';break;
    case 'SU':b=R(0,0,30,20,'#cc0000')+'<path d="M6 2.2 L6.6 3.6 L8.1 3.6 L6.9 4.5 L7.3 5.9 L6 5.1 L4.7 5.9 L5.1 4.5 L3.9 3.6 L5.4 3.6 Z" fill="none" stroke="#ffd700" stroke-width=".45"/><path d="M4.2 10.5 L8.4 6.4 M4.6 7.3 Q4.4 10.4 7.6 10.6 Q9.2 9.6 8.6 8" fill="none" stroke="#ffd700" stroke-width=".9"/>';break;
    default:b=R(0,0,30,20,'#777');}
  return `<svg class="oflag" viewBox="0 0 30 20" width="18" height="12" role="img" aria-label="${FLAG_N[c]||c}">${b}</svg>`;}
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
/* Дані гаража: перелік техніки (з довідника EasyWAR), ТТХ із відкритих джерел (округлено), риги з src/ref-rig-data.js. */
let GV_CATS=[['all','Усі'],['tank','Танки'],['ifv','ББМ · БТР'],['art','Артилерія · РСЗВ'],['ad','ППО'],['eng','Вантажні · інженерні']];
let GV_ORDER=['t64bv','t72av','t80bv','t84','pt91','leo1','leo2a4','leo2a6','chal2','abrams','bmp1','bmp2','btr4','btr80','bradley','marder','cv90','ypr765','m113','mtlb','stryker','amx10rc','brdm2','kozak2','novator','cougar','matv','bushm','humvee','gvozdika','akatsiya','pion','msta','pzh2000','krab','m109','as90','bohdana','caesar','archer','dana','zuzana','m777','d30','d20','grad','uragan','smerch','rm70','himars','m270','vilkha','sapsan','patriot','sampt','iris','nasams','s300','buk','hawk','osa','crotale','strela10','avenger','tunguska','gepard','skynex','zu23','kraz6322','ural','hemtt','m984','hemttlhs','fmtv','m1084','het','m1150','ur77','imr2','dachs','brem1','berge','mtu72','biber'];
// r: [вогнева міць ★, захищеність ★, швидкість 0..1, прохідність 0..1, запас ходу 0..1]
const GV={
 cv90:{org:'Швеція',cat:'ifv',origin:'SE',n:'CV90',cls:'Бойова машина піхоти',wauto:'trk',mk:{s:[[.45,.6,.5]],f:[[.5,0,.4]],r:[[.5,0,.45]]},file:'cv90',tint:[.5,.48,.42],tf:{R:[[0,0,1],[0,1,0],[-1,0,0]],s:1,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 6,6',W:'≈ 3,1',H:'≈ 2,7',mass:'≈ 28–35',v:'≈ 70',rng:'≈ 600',
   fire:null,crew:'3 + 8 десанту',arm:'40 мм Bofors (CV9040C) · 7,62 мм кулемет',r:[4,3.5,.7,.8,.6],ic:'ifv',exh:[-1.5,1.4,-1.2]},
 ypr765:{org:'Нідерланди',cat:'ifv',origin:'NL',n:'YPR-765',cls:'Бойова машина піхоти (на базі M113)',wauto:'trk',mk:{s:[[.45,.6,.5]],f:[[.5,0,.4]],r:[[.5,0,.45]]},file:'ypr765',tf:{R:[[0,0,-1],[0,1,0],[1,0,0]],s:23.9,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 5,3',W:'≈ 2,8',H:'≈ 2,8',mass:'≈ 13,7',v:'≈ 61',rng:'≈ 490',
   fire:null,crew:'3 + 7 десанту',arm:'25 мм Oerlikon KBA · 7,62 мм FN MAG',r:[2.5,2,.6,.75,.5],ic:'ifv',exh:[-1.5,1.4,-1.2]},
 m113:{org:'США',cat:'ifv',origin:'US',n:'M113',cls:'Бронетранспортер',wauto:'trk',mk:{s:[[.45,.6,.5]],f:[[.5,0,.4]],r:[[.5,0,.45]]},file:'m113',tf:{R:[[0,0,1],[0,1,0],[-1,0,0]],s:0.00175,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 4,9',W:'≈ 2,7',H:'≈ 2,5',mass:'≈ 12,3',v:'≈ 64',rng:'≈ 480',
   fire:null,crew:'2 + 11 десанту',arm:'12,7 мм M2HB',r:[1.5,1.5,.6,.75,.5],ic:'tracked',exh:[-1.5,1.4,-1.2]},
 mtlb:{org:'СРСР',cat:'ifv',origin:'SU',n:'МТ-ЛБ',cls:'Багатоцільовий легкоброньований тягач',wauto:'trk',mk:{s:[[.45,.78,.5]],f:[[.5,0,.4]],r:[[.5,0,.45]]},file:'mtlb',tf:{R:[[0,0,1],[0,1,0],[-1,0,0]],s:0.0384,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 6,45',W:'≈ 2,85',H:'≈ 1,9',mass:'≈ 11,9',v:'≈ 61 (5 на плаву)',rng:'≈ 500',
   fire:null,crew:'2 + 11 десанту',arm:'7,62 мм ПКТ',r:[1,1,.6,.85,.55],ic:'tracked',exh:[-1.5,1.4,-1.2]},
 stryker:{org:'США',cat:'ifv',origin:'US',n:'M1126 Stryker',cls:'Бронетранспортер 8×8',wauto:'whl',mk:{s:[[.45,.6,.5]],f:[[.5,0,.4]],r:[[.5,0,.45]]},file:'stryker',tint:[.85,.62,.48],tf:{R:[[0,0,-1],[0,1,0],[1,0,0]],s:0.38,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 6,95',W:'≈ 2,7',H:'≈ 2,6',mass:'≈ 16,5',v:'≈ 100',rng:'≈ 500',
   fire:null,crew:'2 + 9 десанту',arm:'ДУМ: 12,7 мм M2 або 40 мм Mk 19',r:[2,2.5,.8,.7,.6],ic:'apc8',exh:[-1.5,1.4,-1.2]},
 amx10rc:{org:'Франція',cat:'ifv',origin:'FR',n:'AMX-10RC',cls:'Колісний розвідувальний танк 6×6',wauto:'whl',mk:{s:[[.45,.6,.5]],f:[[.5,0,.4]],r:[[.5,0,.45]]},file:'amx10rc',tf:{R:[[0,0,1],[0,1,0],[-1,0,0]],s:1,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 9,2 зі стволом',W:'≈ 2,95',H:'≈ 2,7',mass:'≈ 15,9',v:'≈ 85',rng:'≈ 800',
   fire:null,crew:'4',arm:'105 мм F2 · 7,62 мм кулемет',r:[4,1.5,.8,.7,.75],ic:'whtank',exh:[-1.5,1.4,-1.2]},
 brdm2:{org:'СРСР',cat:'ifv',origin:'SU',n:'БРДМ-2',cls:'Бронерозвідувальна машина 4×4',wauto:'whl',mk:{s:[[.45,.6,.5]],f:[[.5,0,.4]],r:[[.5,0,.45]]},file:'brdm2',tf:{R:[[0,0,-1],[0,1,0],[1,0,0]],s:1.07,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 5,75',W:'≈ 2,35',H:'≈ 2,3',mass:'≈ 7',v:'≈ 95 (10 на плаву)',rng:'≈ 750',
   fire:null,crew:'4',arm:'14,5 мм КПВТ · 7,62 мм ПКТ',r:[2,1,.8,.75,.7],ic:'car4',exh:[-1.5,1.4,-1.2]},
 kozak2:{org:'Україна',cat:'ifv',origin:'UA',n:'Козак-2М1',cls:'Бронеавтомобіль 4×4',wauto:'whl',mk:{s:[],f:[],r:[]},file:'kozak2',tf:{R:[[0,0,-1],[0,1,0],[1,0,0]],s:0.78,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 5,6',W:'≈ 2,4',H:'≈ 2,4',mass:'≈ 9',v:'≈ 120',rng:'≈ 600',
   fire:null,crew:'2 + 8',arm:'кулемет 7,62 / 12,7 мм на турелі',r:[1,2,.85,.75,.65],ic:'car4',exh:[-1.5,1.4,-1.2]},
 novator:{org:'Україна',cat:'ifv',origin:'UA',n:'«Новатор»',cls:'Бронеавтомобіль 4×4 (варіант із ПТРК)',wauto:'whl',mk:{s:[],f:[],r:[]},file:'novator',tf:{R:[[0,0,-1],[0,1,0],[1,0,0]],s:0.85,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 5,9',W:'≈ 2,5',H:'≈ 2,4',mass:'≈ 8',v:'≈ 110',rng:'≈ 600',
   fire:null,crew:'2 + 6',arm:'ПТРК «Стугна-П» · кулемет',r:[2.5,2,.85,.75,.65],ic:'car4',exh:[-1.5,1.4,-1.2]},
 cougar:{org:'Україна',cat:'ifv',origin:'UA',n:'КрАЗ «Кугуар»',cls:'Бронеавтомобіль 4×4',wauto:'whl',mk:{s:[[.45,.6,.5]],f:[[.5,0,.4]],r:[[.5,0,.45]]},file:'cougar',tf:{R:[[0,0,-1],[0,1,0],[1,0,0]],s:0.92,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 5,6',W:'≈ 2,3',H:'≈ 2,4',mass:'≈ 7',v:'≈ 110',rng:'≈ 600',
   fire:null,crew:'2 + 6',arm:'кулемет на турелі',r:[1,1.5,.85,.7,.65],ic:'car4',exh:[-1.5,1.4,-1.2]},
 matv:{org:'США',cat:'ifv',origin:'US',n:'Oshkosh M-ATV',cls:'Броньована машина MRAP 4×4',wauto:'whl',mk:{s:[],f:[],r:[]},file:'matv',tf:{R:[[-1,0,0],[0,1,0],[0,0,-1]],s:0.261,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 6,2',W:'≈ 2,5',H:'≈ 2,7',mass:'≈ 12,5',v:'≈ 105',rng:'≈ 515',
   fire:null,crew:'4 + 1',arm:'12,7 мм M2 або 40 мм Mk 19',r:[1.5,3,.8,.8,.6],ic:'car4',exh:[-1.5,1.4,-1.2]},
 bushm:{org:'Австралія',cat:'ifv',origin:'AU',n:'Bushmaster PMV',cls:'Захищена машина піхоти 4×4',wauto:'whl',mk:{s:[[.45,.6,.5]],f:[[.5,0,.4]],r:[[.5,0,.45]]},file:'bushm',tf:{R:[[0,0,-1],[0,1,0],[1,0,0]],s:0.0958,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 7,2',W:'≈ 2,5',H:'≈ 2,65',mass:'≈ 12,4–15',v:'≈ 100',rng:'≈ 800',
   fire:null,crew:'1 + 9',arm:'кулемет 7,62 / 12,7 мм',r:[1,3,.8,.7,.8],ic:'car4',exh:[-1.5,1.4,-1.2]},
 humvee:{org:'США',cat:'ifv',origin:'US',n:'HMMWV (М1151) з Mk 19',cls:'Броньований автомобіль 4×4',wauto:'whl',mk:{s:[[.45,.6,.5]],f:[[.5,0,.4]],r:[[.5,0,.45]]},file:'humvee',tf:{R:[[-1,0,0],[0,1,0],[0,0,-1]],s:.148,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 4,9',W:'≈ 2,3',H:'≈ 1,9',mass:'≈ 5,5',v:'≈ 113',rng:'≈ 440',
   fire:null,crew:'4–5',arm:'40 мм АГ Mk 19 на турелі',r:[1,1,.85,.8,.55],ic:'car4',exh:[-1.5,1.4,-1.2]},
 gvozdika:{tint:[.58,.6,.78],org:'СРСР',cat:'art',origin:'SU',n:'2С1 «Гвоздика»',cls:'Самохідна гаубиця 122 мм',wauto:'trk',mk:{s:[[.45,.6,.5]],f:[[.5,0,.4]],r:[[.5,0,.45]]},file:'gvozdika',tf:{R:[[0,0,1],[0,1,0],[-1,0,0]],s:0.985,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 7,3',W:'≈ 2,85',H:'≈ 2,7',mass:'≈ 15,7',v:'≈ 60 (4,5 на плаву)',rng:'≈ 500',
   fire:'до ≈ 15,3 км (ОФ) · ≈ 21,9 км (АР)',crew:'4',arm:'122 мм гаубиця 2А31 · 40 пострілів',r:[3, 1.5, 0.75, 0.8, 0.6],ic:'spg'},
 akatsiya:{org:'СРСР',cat:'art',origin:'SU',n:'2С3 «Акація»',cls:'Самохідна гаубиця 152 мм',wauto:'trk',mk:{s:[[.45,.6,.5]],f:[[.5,0,.4]],r:[[.5,0,.45]]},file:'akatsiya',tf:{R:[[0,0,-1],[0,1,0],[1,0,0]],s:0.21,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 8,4',W:'≈ 3,25',H:'≈ 3,05',mass:'≈ 27,5',v:'≈ 60',rng:'≈ 500',
   fire:'до ≈ 18,5 км (ОФ) · ≈ 24 км (АР)',crew:'4',arm:'152 мм гаубиця 2А33 · 7,62 мм ПКТ',r:[3.5, 2, 0.75, 0.7, 0.6],ic:'spg'},
 pion:{wauto:'trk',nospin:1,org:'СРСР',cat:'art',origin:'SU',n:'2С7 «Піон»',cls:'Самохідна гармата 203 мм',mk:{s:[[.45,.6,.5]],f:[[.5,0,.4]],r:[[.5,0,.45]]},file:'pion',tf:{R:[[0,0,1],[0,1,0],[-1,0,0]],s:1,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 13,1',W:'≈ 3,4',H:'≈ 3,0',mass:'≈ 46,5',v:'≈ 50',rng:'≈ 650',
   fire:'до ≈ 37,5 км (ОФ) · ≈ 47,5 км (АР)',crew:'7',arm:'203 мм гармата 2А44',r:[4.5, 1, 0.6, 0.6, 0.7],ic:'spg'},
 msta:{org:'СРСР',cat:'art',origin:'SU',n:'2С19 «Мста-С»',cls:'Самохідна гаубиця 152 мм',wauto:'trk',mk:{s:[[.45,.6,.5]],f:[[.5,0,.4]],r:[[.5,0,.45]]},file:'msta',tf:{R:[[0,0,-1],[0,1,0],[1,0,0]],s:1,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 11,9',W:'≈ 3,6',H:'≈ 3,0',mass:'≈ 42',v:'≈ 60',rng:'≈ 500',
   fire:'до ≈ 24,7 км (ОФ) · ≈ 29 км (АР)',crew:'5',arm:'152 мм гаубиця 2А64 · 12,7 мм НСВТ',r:[4, 2, 0.75, 0.7, 0.6],ic:'spg'},
 pzh2000:{org:'Німеччина',cat:'art',origin:'DE',n:'PzH 2000',cls:'Самохідна гаубиця 155 мм',wauto:'trk',mk:{s:[[.45,.6,.5]],f:[[.5,0,.4]],r:[[.5,0,.45]]},file:'pzh2000',tf:{R:[[0,0,1],[0,1,0],[-1,0,0]],s:1,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 11,7',W:'≈ 3,6',H:'≈ 3,4',mass:'≈ 55,8',v:'≈ 60',rng:'≈ 420',
   fire:'до ≈ 30 км (ОФ) · ≈ 40 км (V-LAP)',crew:'5',arm:'155 мм L52 · 7,62 мм MG3 · 60 пострілів',r:[5, 3, 0.75, 0.7, 0.5],ic:'spg'},
 krab:{org:'Польща',cat:'art',origin:'PL',n:'AHS Krab',cls:'Самохідна гаубиця 155 мм',wauto:'trk',mk:{s:[[.45,.6,.5]],f:[[.5,0,.4]],r:[[.5,0,.45]]},file:'krab',tf:{R:[[0,0,1],[0,1,0],[-1,0,0]],s:1,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 12,0',W:'≈ 3,6',H:'≈ 3,0',mass:'≈ 48',v:'≈ 60',rng:'≈ 400',
   fire:'до ≈ 30 км (ОФ) · ≈ 40 км (V-LAP)',crew:'5',arm:'155 мм L52 · 12,7 мм WKM-B',r:[5, 3, 0.75, 0.7, 0.5],ic:'spg'},
 m109:{org:'США',cat:'art',origin:'US',n:'M109A3',cls:'Самохідна гаубиця 155 мм',wauto:'trk',mk:{s:[[.45,.6,.5]],f:[[.5,0,.4]],r:[[.5,0,.45]]},file:'m109',tf:{R:[[1,0,0],[0,1,0],[0,0,1]],s:0.185,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 9,1',W:'≈ 3,15',H:'≈ 3,3',mass:'≈ 25',v:'≈ 56',rng:'≈ 350',
   fire:'до ≈ 18 км (ОФ) · ≈ 24 км (АР)',crew:'6',arm:'155 мм M185 · 12,7 мм M2',r:[3.5, 2, 0.7, 0.7, 0.45],ic:'spg'},
 as90:{org:'Велика Британія',cat:'art',origin:'GB',n:'AS-90',cls:'Самохідна гаубиця 155 мм',wauto:'trk',mk:{s:[[.45,.6,.5]],f:[[.5,0,.4]],r:[[.5,0,.45]]},file:'as90',tf:{R:[[0,0,1],[0,1,0],[-1,0,0]],s:1,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 9,9',W:'≈ 3,5',H:'≈ 3,0',mass:'≈ 45',v:'≈ 53',rng:'≈ 370',
   fire:'до ≈ 24,7 км (ОФ) · ≈ 30 км (АР)',crew:'5',arm:'155 мм L31 · 7,62 мм L7',r:[4.5, 3, 0.7, 0.7, 0.45],ic:'spg'},
 bohdana:{rig:{wheels:{y:.42,z:1.05,r:.62,hw:.22,axles:[3.57,-2.56,-4.43]}},org:'Україна',cat:'art',origin:'UA',n:'2С22 «Богдана»',cls:'Колісна САУ 155 мм 6×6',mk:{s:[[.55,.6,.5]],f:[[.5,0,.4]],r:[[.5,0,.45]]},file:'bohdana',tf:{R:[[0,0,-1],[0,1,0],[1,0,0]],s:0.0225,t:[0,0,-.815]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:null,W:null,H:null,mass:'≈ 28',v:'≈ 80',rng:null,
   fire:'до ≈ 40 км і більше (залежно від снаряда)',crew:'5',arm:'155 мм гармата L52 (стандарт NATO)',r:[4.5, 1, 0.85, 0.7, 0.6],ic:'truck6'},
 caesar:{tint:[.7,.8,.6],org:'Франція',cat:'art',origin:'FR',n:'CAESAR',cls:'Колісна САУ 155 мм 6×6',wauto:'whl',mk:{s:[[.55,.6,.5]],f:[[.5,0,.4]],r:[[.5,0,.45]]},file:'caesar',tf:{R:[[0,0,-1],[0,1,0],[1,0,0]],s:100,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 10,0',W:'≈ 2,55',H:'≈ 3,7',mass:'≈ 17,7',v:'≈ 100',rng:'≈ 600',
   fire:'до ≈ 42 км (ERFB-BB)',crew:'5',arm:'155 мм гармата L52 · 18 пострілів',r:[4.5, 1, 0.9, 0.7, 0.7],ic:'truck6'},
 archer:{org:'Швеція',cat:'art',origin:'SE',n:'Archer (FH77 BW L52)',cls:'Колісна САУ 155 мм 6×6',wauto:'whl',mk:{s:[[.55,.6,.5]],f:[[.5,0,.4]],r:[[.5,0,.45]]},file:'archer',tf:{R:[[0,0,1],[0,1,0],[-1,0,0]],s:1,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 14,1',W:'≈ 3,0',H:'≈ 3,9',mass:'≈ 33,5',v:'≈ 70',rng:'≈ 500',
   fire:'до ≈ 40 км (ERFB-BB) · ≈ 50 км (Excalibur)',crew:'3–4',arm:'155 мм L52 · 21 постріл в автомат. заряджанні',r:[5, 2, 0.85, 0.8, 0.6],ic:'truck6'},
 dana:{org:'Чехія',cat:'art',origin:'CZ',n:'ShKH vz.77 «Дана»',cls:'Колісна САУ 152 мм 8×8',wauto:'whl',mk:{s:[[.55,.6,.5]],f:[[.5,0,.4]],r:[[.5,0,.45]]},file:'dana',tf:{R:[[0,0,1],[0,1,0],[-1,0,0]],s:0.9,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 11,2',W:'≈ 3,0',H:'≈ 2,85',mass:'≈ 29,3',v:'≈ 80',rng:'≈ 740',
   fire:'до ≈ 18,7 км (ОФ)',crew:'4–5',arm:'152 мм гармата-гаубиця vz.77 · 12,7 мм',r:[3.5, 1.5, 0.85, 0.75, 0.75],ic:'truck8'},
 zuzana:{tint:[.62,.78,.55],hideMat:['ShKHvz77_Turret','Dshk','TankCloth'],kb:'zuzana',org:'Словаччина',cat:'art',origin:'SK',n:'Zuzana 2',cls:'Колісна САУ 155 мм 8×8',wauto:'whl',mk:{s:[[.55,.6,.5]],f:[[.5,0,.4]],r:[[.5,0,.45]]},file:'dana',tf:{R:[[0,0,1],[0,1,0],[-1,0,0]],s:1,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 14,2',W:'≈ 3,1',H:'≈ 3,6',mass:'≈ 33,8',v:'≈ 90',rng:'≈ 600',
   fire:'до ≈ 41 км (ERFB-BB) · понад 50 км (V-LAP)',crew:'4',arm:'155 мм L52 · автомат заряджання, 40 пострілів · 12,7 мм',r:[5,2,.9,.75,.6],ic:'truck8'},
 m777:{noocc:1,tint:[.36,.39,.27],org:'США',cat:'art',origin:'US',n:'M777',cls:'Буксирувана гаубиця 155 мм',mk:{s:[[.6,.55,.6]],f:[],r:[]},file:'m777',tf:{R:[[-1,0,0],[0,1,0],[0,0,-1]],s:0.047,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 10,7 (похідне)',W:'≈ 2,8',H:'≈ 2,3',mass:'≈ 4,2',v:'≈ 88',rng:null,
   fire:'до ≈ 24,7 км (ОФ) · ≈ 30 км (АР) · ≈ 40 км (Excalibur)',crew:'8',arm:'155 мм M776 (L39)',r:[4.5, 0.3, 0.4, 0.4, 0.0],ic:'towed'},
 d30:{org:'СРСР',cat:'art',origin:'SU',n:'Д-30 (2А18)',cls:'Буксирувана гаубиця 122 мм',mk:{s:[[.5,.6,.6]],f:[],r:[]},file:'d30',tf:{R:[[0,0,-1],[0,1,0],[1,0,0]],s:0.277,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 5,4 (похідне)',W:'≈ 1,95',H:'≈ 1,6',mass:'≈ 3,2',v:'≈ 60',rng:null,
   fire:'до ≈ 15,4 км (ОФ) · ≈ 21,9 км (АР)',crew:'7',arm:'122 мм 2А18 · кругове наведення 360°',r:[3, 0.3, 0.4, 0.4, 0.0],ic:'towed'},
 d20:{hideMat:['Material_4800'],kb:'d20',kbBox:[8.85,1.9,4.3],org:'СРСР',cat:'art',origin:'SU',n:'Д-20',cls:'Буксирувана гармата-гаубиця 152 мм',mk:{s:[],f:[],r:[]},file:'d30',tf:{R:[[0,0,-1],[0,1,0],[1,0,0]],s:0.277,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 8,7 (похідне)',W:'≈ 2,3',H:'≈ 1,9',mass:'≈ 5,7',v:'≈ 60',rng:null,
   fire:'до ≈ 17,4 км (ОФ) · ≈ 24 км (АР)',crew:'10',arm:'152 мм гармата-гаубиця Д-20 (L/34) · 5–6 постр./хв',r:[3.5,.3,.4,.4,0],ic:'towed'},
 grad:{tint:[.72,.72,.58],org:'СРСР',cat:'art',origin:'SU',n:'БМ-21 «Град»',cls:'РСЗВ 122 мм · колісна 6×6',wauto:'whl',mk:{s:[[.55,.6,.5]],f:[[.5,0,.4]],r:[[.5,0,.45]]},file:'grad',tf:{R:[[0,0,1],[0,1,0],[-1,0,0]],s:1,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 7,35',W:'≈ 2,4',H:'≈ 3,1',mass:'≈ 13,7',v:'≈ 75',rng:'≈ 750',
   fire:'до ≈ 20,4 км (до ≈ 40 км з новими ракетами)',crew:'3',arm:'40 труб 122 мм',r:[4, 1, 0.85, 0.75, 0.75],ic:'truck6'},
 uragan:{org:'СРСР',cat:'art',origin:'SU',n:'БМ-27 «Ураган»',cls:'РСЗВ 220 мм · колісна 8×8',wauto:'whl',mk:{s:[],f:[],r:[]},file:'uragan',tf:{R:[[0,0,-1],[0,1,0],[1,0,0]],s:0.97,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 9,6',W:'≈ 2,8',H:'≈ 3,2',mass:'≈ 20',v:'≈ 65',rng:'≈ 500',
   fire:'до ≈ 35,8 км',crew:'4',arm:'16 труб 220 мм',r:[4.5, 1, 0.75, 0.7, 0.6],ic:'truck8'},
 smerch:{tint:[.8,.8,.68],org:'СРСР',cat:'art',origin:'SU',n:'БМ-30 «Смерч»',cls:'РСЗВ 300 мм · колісна 8×8',wauto:'whl',mk:{s:[[.55,.6,.5]],f:[[.5,0,.4]],r:[[.5,0,.45]]},file:'smerch',tf:{R:[[0,0,-1],[0,1,0],[1,0,0]],s:1.6,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 12,1',W:'≈ 3,05',H:'≈ 3,05',mass:'≈ 43,7',v:'≈ 60',rng:'≈ 850',
   fire:'до ≈ 70 км (до ≈ 90 км з новими ракетами)',crew:'4',arm:'12 труб 300 мм',r:[5, 1, 0.7, 0.6, 0.8],ic:'truck8'},
 rm70:{tint:[.72,.85,.58],org:'Чехія',cat:'art',origin:'CZ',n:'RM-70',cls:'РСЗВ 122 мм · колісна 8×8',wauto:'whl',mk:{s:[[.55,.6,.5]],f:[[.5,0,.4]],r:[[.5,0,.45]]},file:'rm70',tf:{R:[[1,0,0],[0,1,0],[0,0,1]],s:0.123,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 8,75',W:'≈ 2,55',H:'≈ 2,96',mass:'≈ 33,7',v:'≈ 85',rng:'≈ 1000',
   fire:'до ≈ 20,4 км',crew:'6',arm:'40 труб 122 мм + 40 ракет на перезаряджання',r:[4, 1.5, 0.85, 0.75, 0.9],ic:'truck8'},
 himars:{cat:'art',origin:'US',n:'M142 HIMARS',cls:'РСЗВ · колісна 6×6',org:'США',mk:{s:[[.13,.5,.55],[.62,.55,.65]],f:[[.45,0,.45]],r:[[.4,0,.5]],fl:[[.05,.62,.4]]},file:'himars',L:'≈ 7,0',W:'2,4',H:'3,0',mass:'16,3',v:'85–95',rng:'480',
   fire:'GMLRS 15–90 км · ATACMS до 300 км',crew:'3',arm:'Пакет: 6 × GMLRS 227 мм або 1 × ATACMS',r:[4.5,1.5,.85,.6,.7],ic:'truck6',
   rig:{wheels:{y:.53,z:.99,r:.5,axles:[2.31,-1.18,-2.47]}},combat:'clip',clip:{raise:[5,0]},reload:true,exh:[1.2,2.6,-1.15]},
 m270:{cat:'art',origin:'US',n:'M270 MLRS',cls:'РСЗВ · гусенична',org:'США',mk:{s:[[.18,.4,.55],[.8,.35,.5]],f:[[.35,0,.45]],r:[[.35,0,.5]]},file:'m270',L:'≈ 7,0',W:'3,0',H:'2,6',mass:'25',v:'64',rng:'480',
   fire:'GMLRS 15–90 км · ATACMS до 300 км',crew:'3',arm:'2 пакети: до 12 × GMLRS або 2 × ATACMS',r:[5,2.5,.6,.85,.7],ic:'tracked',
   rig:{tracked:[[-2.05,.405,.335],[-1.27,.405,.335],[-.49,.405,.335],[.29,.405,.335],[1.07,.405,.335],[1.85,.405,.335],[-3,.48,.36],[2.95,.58,.36],[-1.6,.86,.08],[-.3,.86,.08],[1,.86,.08]]},
   combat:'hand',arm3d:{node:'launcher',elev:52},reload:true,exh:[1.6,1.9,-1.35]},
 vilkha:{cat:'art',origin:'UA',n:'Р-624 «Вільха»',cls:'РСЗВ 300 мм · колісна 8×8',org:'Україна',mk:{s:[[.08,.5,.55],[.45,.3,.5]],f:[[.4,0,.45]],r:[[.4,0,.5]],fl:[[.03,.65,.35]]},file:'vilkha2',bright:1.15,metal:.2,L:'≈ 11',W:'2,5',H:null,mass:null,v:null,rng:null,
   fire:'до ≈ 70 км · «Вільха-М» до ≈ 130 км',crew:'3–4',arm:'12 труб 300 мм для керованих ракет',r:[5,1.5,.6,.55,.6],ic:'truck8',
   rig:{wheels:{y:.79,z:1.2,r:.79,hw:.36,axles:[2.79,.84,-2.51,-4.41]}},combat:'tel',tel:{node:'housing',pivot:[-5.2,2.05],elev:50},exh:[2.4,2.6,-1.25]},
 sapsan:{wauto:'whl',cat:'art',origin:'UA',n:'ОТРК «Сапсан»',cls:'Оперативно-тактичний ракетний комплекс · 10×10',org:'Україна',mk:{s:[[.19,.55,.75],[.62,.62]],f:[[.33,0,.55]],r:[[.55,0]],fl:[[.07,.5,.5]]},scrub:[[.1,.3,.35,.75,'red']],file:'sapsan2',tf:{R:[[0,0,1],[0,1,0],[-1,0,0]],s:1,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 12,9',W:'≈ 3,3',H:'≈ 3,7',mass:null,v:null,rng:null,
   fire:'≈ 280 км (експорт) · понад 300 км',crew:'3',arm:'2 балістичні ракети в ТПК · БЧ ≈ 480 кг',r:[5,1.5,.6,.6,.6],ic:'truck10',exh:[2.8,2.5,-1.2]},
 kraz6322:{bright:1.7,wauto:'whl',cat:'eng',origin:'UA',n:'КрАЗ-6322',cls:'Вантажівка підвищеної прохідності 6×6',org:'Україна',mk:{s:[[.25,.5,.5]],f:[[.42,.1,.4]],r:[[.4,.2,.45]]},file:'kraz6322',tf:{R:[[-1,0,0],[0,1,0],[0,0,-1]],s:45,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 9,0',W:'≈ 2,7',H:'≈ 3,4',mass:'≈ 12,5',pay:'≈ 10',v:'≈ 85',rng:null,
   fire:null,crew:'1 + 2',arm:'Бортова платформа з тентом · дизель ЯМЗ-238 · лебідка',eqk:'Обладнання',r:[0,.5,.8,.85,.6],ic:'truck6'},
 ural:{wauto:'whl',cat:'eng',origin:'SU',n:'Урал-4320',cls:'Вантажівка підвищеної прохідності 6×6',org:'СРСР',mk:{s:[[.25,.5,.5]],f:[[.42,.1,.4]],r:[[.4,.2,.45]]},file:'ural',tf:{R:[[0,0,1],[0,1,0],[-1,0,0]],s:.93,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 7,4',W:'≈ 2,5',H:'≈ 2,9',mass:'≈ 8,6',pay:'≈ 6',v:'≈ 85',rng:null,
   fire:null,crew:'1 + 2',arm:'Бортова платформа з тентом · лебідка',eqk:'Обладнання',r:[0,.5,.8,.85,.6],ic:'truck6'},
 m1150:{wauto:'trk',cat:'eng',origin:'US',n:'M1150 ABV',cls:'Машина розмінування на шасі M1 Abrams',org:'США',mk:{s:[[.45,.55,.45]],f:[],r:[[.5,.3,.4]]},file:'m1150',tf:{R:[[0,0,-1],[0,1,0],[1,0,0]],s:.000109,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 9,9 (з тралом)',W:'≈ 3,7',H:'≈ 3,0',mass:'≈ 65',v:'≈ 65',rng:null,
   fire:null,crew:'2',arm:'Мінний трал-плуг · 2 ПУ подовжених зарядів M58 MICLIC · 12,7 мм',eqk:'Обладнання',r:[1.5,4.5,.6,.5,.4],ic:'tracked'},
 ur77:{tint:[.62,.66,.5],wauto:'trk',cat:'eng',origin:'SU',n:'УР-77 «Метеорит»',cls:'Установка розмінування на гусеничному шасі',org:'СРСР',mk:{s:[[.5,.5,.4]],f:[],r:[]},file:'ur77',tf:{R:[[1,0,0],[0,1,0],[0,0,1]],s:.2036,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 7,3',W:'≈ 2,85',H:'≈ 2,6',mass:'≈ 15,5',v:'≈ 61',rng:'≈ 500',
   fire:null,crew:'2',arm:'2 подовжені заряди розмінування УЗП-83 · прохід ≈ 90 × 6 м',eqk:'Обладнання',r:[1,1.2,.6,.8,.5],ic:'tracked'},
 imr2:{hideMat:['chassis.2','misc_a.2','misc_a.3','misc_b.0'],kb:'imr2',wauto:'trk',cat:'eng',origin:'SU',n:'ІМР-2',cls:'Інженерна машина розгородження на шасі Т-72',org:'СРСР',mk:{s:[[.6,.42,.4]],f:[],r:[[.5,.3,.4]]},file:'t72av',bright:2.0,tf:{R:[[0,0,-1],[0,1,0],[1,0,0]],s:.93,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 9,55',W:'≈ 4,35 (з відвалом)',H:'≈ 3,7',mass:'≈ 44,5',v:'≈ 59',rng:'≈ 500',
   fire:null,crew:'2',arm:'Універсальний бульдозерний відвал · телескопічна стріла з маніпулятором · мінний трал · 7,62 мм ПКТ',eqk:'Обладнання',r:[1,3.5,.6,.7,.5],ic:'tracked'},
 dachs:{kb:'dachs',wauto:'trk',org:'Німеччина',cat:'eng',origin:'DE',n:'Pionierpanzer 2 Dachs',cls:'Інженерна машина на шасі Leopard 1',mk:{s:[[.62,.45,.4]],f:[],r:[[.5,.3,.45]]},file:'leo1_hull',bright:1.2,tf:{R:[[0,0,1],[0,1,0],[-1,0,0]],s:1,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 9,0',W:'≈ 3,75 (відвал)',H:'≈ 2,95',mass:'≈ 43',v:'≈ 62',rng:'≈ 550',
   fire:null,crew:'3',arm:'Телескопічна стріла-екскаватор · бульдозерний відвал 3,75 м · лебідка 35 т · 7,62 мм MG3',eqk:'Обладнання',r:[1,3,.65,.65,.55],ic:'tracked'},
 brem1:{hideMat:['chassis.2','misc_a.2','misc_a.3','misc_b.0'],kb:'brem1',wauto:'trk',cat:'eng',origin:'SU',n:'БРЕМ-1',cls:'Броньована ремонтно-евакуаційна машина на шасі Т-72',org:'СРСР',mk:{s:[[.6,.42,.4]],f:[],r:[[.5,.3,.4]]},file:'t72av',bright:2.0,tf:{R:[[0,0,-1],[0,1,0],[1,0,0]],s:.93,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 8,0',W:'≈ 3,5',H:'≈ 2,9 (з краном)',mass:'≈ 41',v:'≈ 60',rng:'≈ 700',
   fire:null,crew:'3',arm:'Кран 12 т · основна лебідка 25 т · бульдозерний відвал · 12,7 мм НСВТ',eqk:'Обладнання',r:[1,3.5,.6,.7,.6],ic:'tracked'},
 mtu72:{hideMat:['chassis.2','misc_a.2','misc_a.3','misc_b.0'],kb:'mtu72',wauto:'trk',cat:'eng',origin:'SU',n:'МТУ-72',cls:'Танковий мостоукладач на шасі Т-72',org:'СРСР',mk:{s:[[.6,.35,.4]],f:[],r:[]},file:'t72av',bright:2.0,tf:{R:[[0,0,-1],[0,1,0],[1,0,0]],s:.93,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 11,6 (з мостом)',W:'≈ 3,5',H:'≈ 3,4',mass:'≈ 40',v:'≈ 60',rng:'≈ 500',
   fire:null,crew:'2',arm:'Колійний міст 20 м · перекриває до 18 м · вантажопідйомність 50 т · наведення ≈ 3 хв',eqk:'Обладнання',r:[0,3.5,.6,.7,.5],ic:'bridge'},
 biber:{kb:'biber',wauto:'trk',org:'Німеччина',cat:'eng',origin:'DE',n:'Biber',cls:'Мостоукладач на шасі Leopard 1',mk:{s:[[.62,.35,.4]],f:[],r:[]},file:'leo1_hull',bright:1.2,tf:{R:[[0,0,1],[0,1,0],[-1,0,0]],s:1,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 11,8 (з мостом)',W:'≈ 4,0 (міст)',H:'≈ 3,5',mass:'≈ 45,3',v:'≈ 62',rng:'≈ 550',
   fire:null,crew:'2',arm:'Двосекційний розсувний міст 22 м · перекриває до 20 м · MLC 50',eqk:'Обладнання',r:[0,3,.65,.65,.55],ic:'bridge'},
 hemtt:{wauto:'whl',cat:'eng',origin:'US',n:'HEMTT M978',cls:'Паливозаправник HEMTT 8×8',org:'США',mk:{s:[[.6,.76,.6]],f:[[.42,0,.5]],r:[[.4,0,.5]],fl:[[.08,.62,.4]]},scrub:[[.04,.12,.38,.58,'red'],[.38,.78,.66,.97,'ink']],file:'hemtt978',tf:{R:[[0,0,1],[0,1,0],[-1,0,0]],s:9.27,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 10,2',W:'2,4',H:'≈ 2,9',mass:'≈ 28',v:'≈ 90',rng:null,
   fire:null,crew:'2',arm:'Цистерна ≈ 9 500 л · насос і роздавальні рукави',eqk:'Обладнання',r:[0,1.5,.85,.75,.7],ic:'truck8',exh:[3.0,3.1,-1.1]},
 m984:{wauto:'whl',org:'США',cat:'eng',origin:'US',n:'M984A2',cls:'Евакуаційний тягач HEMTT 8×8',kb:'m984',mk:{s:[[.55,.62,.55]],f:[[.42,0,.5]],r:[[.4,0,.5]],fl:[[.08,.62,.4]]},scrub:[[.04,.12,.38,.58,'red']],file:'hemtt_ch',tf:{R:[[0,0,1],[0,1,0],[-1,0,0]],s:9.27,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 10',W:'2,4',H:'≈ 3,0',mass:'≈ 27',v:'≈ 90',rng:null,
   fire:null,crew:'2',arm:'Поворотна кран-стріла · підхват (андерліфт) · 2 лебідки',eqk:'Обладнання',r:[0,1.5,.85,.75,.7],ic:'truck8',exh:[3.0,3.1,-1.1]},
 hemttlhs:{wauto:'whl',org:'США',cat:'eng',origin:'US',n:'HEMTT LHS',cls:'Вантажівка з гаковим навантажувачем 8×8 · M1120',kb:'lhs',mk:{s:[[.62,.6,.55]],f:[[.42,0,.5]],r:[[.3,0,.5]],fl:[[.08,.62,.4]]},scrub:[[.04,.12,.38,.58,'red']],file:'hemtt_ch',tf:{R:[[0,0,1],[0,1,0],[-1,0,0]],s:9.27,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 10,5',W:'2,4',H:'≈ 3,0',mass:null,pay:'≈ 11',v:'≈ 90',rng:null,
   fire:null,crew:'2',arm:'Гаковий навантажувач · платформа-флетрек з ящиками БК',eqk:'Вантаж',r:[0,1.5,.85,.75,.7],ic:'truck8',exh:[3.0,3.1,-1.1]},
 fmtv:{glass:{f:[[.8,-.4,.7,.46],[.8,.4,.7,.46]],s:[[.1,.79,.5,.4]]},wauto:'whl',cat:'eng',origin:'US',n:'M1083 FMTV',cls:'Вантажівка 6×6 · 5 т',org:'США',mk:{s:[[.2,.5,.55],[.62,.45]],f:[[.42,0,.45]],r:[[.4,0,.5]],fl:[[.08,.62,.4]]},file:'fmtv1083',flat:1,tf:{R:[[1,0,0],[0,1,0],[0,0,1]],s:.198,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 6,9',W:'2,4',H:'≈ 2,8',mass:'≈ 9',pay:'≈ 4,5',v:'≈ 94',rng:null,
   fire:null,crew:'2–3',arm:'Бортова платформа з тентом · бронекабіна',eqk:'Обладнання',r:[0,1.5,.95,.7,.75],ic:'truck6',exh:[2.3,2.9,-1.1]},
 m1084:{glass:{f:[[.8,-.4,.7,.46],[.8,.4,.7,.46]],s:[[.1,.79,.5,.4]]},wauto:'whl',org:'США',cat:'eng',origin:'US',n:'M1084A1P2',cls:'Вантажівка FMTV 6×6 з краном',kb:'m1084',flat:1,mk:{s:[[.2,.5,.55],[.6,.45]],f:[[.42,0,.45]],r:[[.4,0,.5]],fl:[[.08,.62,.4]]},file:'fmtv1083',tf:{R:[[1,0,0],[0,1,0],[0,0,1]],s:.198,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 6,9',W:'2,4',H:'≈ 2,8',mass:null,pay:'≈ 4,5',v:'≈ 94',rng:null,note:'у моделі — база M1083',
   fire:null,crew:'2–3',arm:'Кран-маніпулятор у кормі · відкидні борти · бронекабіна',eqk:'Обладнання',r:[0,1.5,.95,.7,.75],ic:'truck6',exh:[2.3,2.9,-1.1]},
 het:{wauto:'whl',wr:[.3,.72],cat:'eng',origin:'US',n:'Oshkosh M1070 HET',cls:'Танковоз 8×8 + напівпричіп M1000',org:'США',mk:{s:[[.13,.55,.6]],f:[[.45,0,.5]],r:[[.25,0,.5]],fl:[[.07,.68,.4]]},file:'het1070',tf:{R:[[1,0,0],[0,1,0],[0,0,1]],s:29,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 9,1 (тягач)',W:'2,6',H:'≈ 3,7',mass:'≈ 19',pay:'≈ 70',v:'≈ 72',rng:null,
   fire:null,crew:'2 (+4)',arm:'Перевезення танків до 70 т · 2 лебідки по 25 т',eqk:'Вантаж',r:[0,1,.75,.6,.7],ic:'trailer',exh:[3.0,3.1,-1.1]},
 t64bv:{org:'СРСР / Україна',cat:'tank',origin:'SU',n:'Т-64БВ',cls:'Основний бойовий танк',wauto:'trk',mk:{s:[[.55,.78,.55],[.8,.42,.45]],f:[[.4,0,.45]],r:[[.5,0,.5]]},file:'t64bv',bright:2.1,tf:{R:[[0,0,1],[0,1,0],[-1,0,0]],s:1,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 9,2 зі стволом',W:'≈ 3,4',H:'≈ 2,2',mass:'≈ 42,4',v:'≈ 60',rng:'≈ 500',
   fire:null,crew:'3',arm:'125 мм 2А46М-1 · 12,7 мм НСВТ · 7,62 мм ПКТ · ДЗ «Контакт-1»',r:[4,3,.62,.75,.6],ic:'tank',exh:[-2.6,1.1,-1.5]},
 t72av:{org:'СРСР',cat:'tank',origin:'SU',n:'Т-72АВ',cls:'Основний бойовий танк',wauto:'trk',mk:{s:[[.55,.78,.55],[.8,.42,.45]],f:[[.4,0,.45]],r:[[.5,0,.5]]},file:'t72av',bright:2.0,tf:{R:[[0,0,-1],[0,1,0],[1,0,0]],s:0.93,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 9,5 зі стволом',W:'≈ 3,6',H:'≈ 2,2',mass:'≈ 41,5',v:'≈ 60',rng:'≈ 500',
   fire:null,crew:'3',arm:'125 мм 2А46 · 12,7 мм НСВТ · 7,62 мм ПКТ · ДЗ «Контакт-1»',r:[4,3,.62,.75,.6],ic:'tank',exh:[-2.6,1.1,-1.6]},
 t80bv:{org:'СРСР',cat:'tank',origin:'SU',n:'Т-80БВ',cls:'Основний бойовий танк · газотурбінний',wauto:'trk',mk:{s:[[.55,.78,.55],[.8,.42,.45]],f:[[.4,0,.45]],r:[[.5,0,.5]]},file:'t80bv',bright:2.0,tf:{R:[[0,0,-1],[0,1,0],[1,0,0]],s:1,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 9,7 зі стволом',W:'≈ 3,6',H:'≈ 2,2',mass:'≈ 43,7',v:'≈ 70',rng:'≈ 500',
   fire:null,crew:'3',arm:'125 мм 2А46М-1 · КУВ 9К112 «Кобра» · 12,7 мм НСВТ · 7,62 мм ПКТ',r:[4,3,.8,.8,.55],ic:'tank',exh:[-3.2,1.2,0]},
 t84:{org:'Україна',cat:'tank',origin:'UA',n:'Т-84 «Оплот»',cls:'Основний бойовий танк',wauto:'trk',mk:{s:[[.55,.78,.55],[.8,.42,.45]],f:[[.4,0,.45]],r:[[.5,0,.5]]},file:'t84',tf:{R:[[0,0,-1],[0,1,0],[1,0,0]],s:0.0886,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 9,7 зі стволом',W:'≈ 3,8',H:'≈ 2,2',mass:'≈ 48',v:'≈ 65',rng:'≈ 540',
   fire:null,crew:'3',arm:'125 мм КБА-3 · КУВ «Комбат» · 12,7 мм КТ-12,7 · 7,62 мм ПКТ · ДЗ «Ніж»',r:[4.5,4,.72,.8,.6],ic:'tank',exh:[-3.2,1.2,0]},
 pt91:{org:'Польща',cat:'tank',origin:'PL',n:'PT-91 Twardy',cls:'Основний бойовий танк (модернізація Т-72)',wauto:'trk',mk:{s:[[.55,.78,.55],[.8,.42,.45]],f:[[.4,0,.45]],r:[[.5,0,.5]]},file:'pt91',tf:{R:[[0,0,-1],[0,1,0],[1,0,0]],s:0.97,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 9,7 зі стволом',W:'≈ 3,6',H:'≈ 2,2',mass:'≈ 45,3',v:'≈ 60',rng:'≈ 650',
   fire:null,crew:'3',arm:'125 мм 2А46 · 12,7 мм НСВТ · 7,62 мм ПКТ · ДЗ ERAWA',r:[4,3.5,.62,.75,.7],ic:'tank',exh:[-2.6,1.1,-1.6]},
 leo1:{wauto:'trk',cat:'tank',origin:'DE',n:'Leopard 1A5',cls:'Основний бойовий танк',org:'Німеччина',mk:{s:[[.52,.72,.6],[.78,.42,.45]],f:[[.4,0,.45]],r:[[.5,0,.5]]},file:'leo1a5',bright:1.2,tf:{R:[[0,0,1],[0,1,0],[-1,0,0]],s:1,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 9,5 зі стволом',W:'≈ 3,4',H:'≈ 2,6',mass:'≈ 42',v:'≈ 65',rng:'≈ 600',
   fire:null,crew:'4',arm:'105 мм L7A3 · 2 × 7,62 мм MG3',r:[4,3,.75,.8,.65],ic:'tank',exh:[-2.6,1.9,-1.2]},
 leo2a4:{org:'Німеччина',cat:'tank',origin:'DE',n:'Leopard 2A4',cls:'Основний бойовий танк',wauto:'trk',mk:{s:[[.55,.78,.55],[.8,.42,.45]],f:[[.4,0,.45]],r:[[.5,0,.5]]},file:'leo2a4',tf:{R:[[1,0,0],[0,1,0],[0,0,1]],s:1,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 9,7 зі стволом',W:'≈ 3,7',H:'≈ 2,8',mass:'≈ 55',v:'≈ 68',rng:'≈ 470',
   fire:null,crew:'4',arm:'120 мм Rh-120 L/44 · 2 × 7,62 мм MG3',r:[4.5,4,.75,.8,.55],ic:'tank',exh:[-3.4,1.4,0]},
 leo2a6:{org:'Німеччина',cat:'tank',origin:'DE',n:'Leopard 2A6',cls:'Основний бойовий танк',wauto:'trk',mk:{s:[[.55,.78,.55],[.8,.42,.45]],f:[[.4,0,.45]],r:[[.5,0,.5]]},file:'leo2a6',tf:{R:[[0,0,1],[0,1,0],[-1,0,0]],s:1,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 11 зі стволом',W:'≈ 3,8',H:'≈ 3,0',mass:'≈ 62',v:'≈ 68',rng:'≈ 470',
   fire:null,crew:'4',arm:'120 мм Rh-120 L/55 · 2 × 7,62 мм MG3',r:[5,4.5,.75,.8,.55],ic:'tank',exh:[-3.4,1.4,0]},
 chal2:{org:'Велика Британія',cat:'tank',origin:'GB',n:'Challenger 2',cls:'Основний бойовий танк',wauto:'trk',mk:{s:[[.55,.78,.55],[.8,.42,.45]],f:[[.4,0,.45]],r:[[.5,0,.5]]},file:'chal2',tf:{R:[[0,0,1],[0,1,0],[-1,0,0]],s:1,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 11,5 зі стволом',W:'≈ 3,5',H:'≈ 2,5',mass:'≈ 62,5',v:'≈ 59',rng:'≈ 450',
   fire:null,crew:'4',arm:'120 мм L30A1 (нарізна) · 7,62 мм L94A1 · 7,62 мм L37A2',r:[4.5,5,.62,.7,.5],ic:'tank',exh:[-3.6,1.4,0]},
 berge:{wauto:'trk',org:'Німеччина',cat:'eng',origin:'DE',n:'Bergepanzer 2',cls:'БРЕМ на шасі Leopard 1',kb:'berge',mk:{s:[[.38,.75,.55],[.8,.45,.5]],f:[[.55,.2,.4]],r:[[.5,0,.5]]},file:'leo1_hull',bright:1.2,tf:{R:[[0,0,1],[0,1,0],[-1,0,0]],s:1,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 7,6',W:'3,25',H:'≈ 2,7',mass:'≈ 40',v:'≈ 62',rng:null,
   fire:null,crew:'4',arm:'Кран ≈ 20 т · відвал · основна лебідка ≈ 35 т',eqk:'Обладнання',r:[.5,3.5,.6,.85,.6],ic:'tracked',exh:[-2.6,1.9,-1.2]},
 bmp1:{org:'СРСР',cat:'ifv',origin:'SU',n:'БМП-1',cls:'Бойова машина піхоти',wauto:'trk',mk:{s:[[.45,.6,.5]],f:[[.5,0,.4]],r:[[.5,0,.45]]},file:'bmp1',tf:{R:[[0,0,1],[0,1,0],[-1,0,0]],s:1,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 6,7',W:'≈ 2,9',H:'≈ 2,1',mass:'≈ 13,3',v:'≈ 65 (7 на плаву)',rng:'≈ 600',
   fire:null,crew:'3 + 8 десанту',arm:'73 мм 2А28 «Грім» · ПТКР 9М14 «Малютка» · 7,62 мм ПКТ',r:[2.5,1.5,.65,.8,.6],ic:'ifv',exh:[-1.5,1.4,-1.2]},
 bmp2:{org:'СРСР',cat:'ifv',origin:'SU',n:'БМП-2',cls:'Бойова машина піхоти',wauto:'trk',mk:{s:[[.45,.6,.5]],f:[[.5,0,.4]],r:[[.5,0,.45]]},file:'bmp2',tf:{R:[[0,0,1],[0,1,0],[-1,0,0]],s:1,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 6,7',W:'≈ 3,15',H:'≈ 2,45',mass:'≈ 14,3',v:'≈ 65 (7 на плаву)',rng:'≈ 600',
   fire:null,crew:'3 + 7 десанту',arm:'30 мм 2А42 · ПТКР 9М113 «Конкурс» · 7,62 мм ПКТ',r:[3,1.5,.65,.8,.6],ic:'ifv',exh:[-1.5,1.4,-1.2]},
 btr4:{org:'Україна',cat:'ifv',origin:'UA',n:'БТР-4Е «Буцефал»',cls:'Бронетранспортер 8×8',wauto:'whl',mk:{s:[[.45,.6,.5]],f:[[.5,0,.4]],r:[[.5,0,.45]]},file:'btr4',tf:{R:[[0,0,1],[0,1,0],[-1,0,0]],s:0.65,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 7,8',W:'≈ 2,9',H:'≈ 2,9',mass:'≈ 17,5–21',v:'≈ 110',rng:'≈ 690',
   fire:null,crew:'3 + 7 десанту',arm:'БМ-7 «Парус»: 30 мм ЗТМ-1 · 30 мм АГ · 7,62 мм КТ · ПТКР «Бар’єр»',r:[3.5,2,.85,.75,.7],ic:'apc8',exh:[-1.5,1.4,-1.2]},
 btr80:{org:'СРСР',cat:'ifv',origin:'SU',n:'БТР-80',cls:'Бронетранспортер 8×8',wauto:'whl',mk:{s:[[.45,.6,.5]],f:[[.5,0,.4]],r:[[.5,0,.45]]},file:'btr80',tf:{R:[[1,0,0],[0,1,0],[0,0,1]],s:0.176,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 7,65',W:'≈ 2,9',H:'≈ 2,4',mass:'≈ 13,6',v:'≈ 80 (9 на плаву)',rng:'≈ 600',
   fire:null,crew:'3 + 7 десанту',arm:'14,5 мм КПВТ · 7,62 мм ПКТ',r:[2,1.5,.75,.75,.6],ic:'apc8',exh:[-1.5,1.4,-1.2]},
 bradley:{cat:'ifv',origin:'US',n:'M2A3 Bradley',cls:'Бойова машина піхоти',org:'США',mk:{s:[],f:[],r:[]},file:'bradley',rig:{tracked:[-2.14,-1.30,-.40,.46,1.35,2.23].map(x=>[x,0.4,0.22])},trackZ:1.32,trackHW:.2,tf:{R:[[0,0,-1],[0,1,0],[1,0,0]],s:265,t:[0,2.0,0]},L:'≈ 6,6',W:'≈ 3,6',H:'≈ 3,4',mass:'≈ 30',v:'≈ 60',rng:'≈ 400',
   fire:null,crew:'3 + 6 десанту',arm:'25 мм M242 · ПТРК TOW · 7,62 мм M240C',r:[3.5,3.5,.65,.8,.55],ic:'ifv',exh:[1.6,1.9,1.4]},
 marder:{cat:'ifv',origin:'DE',n:'Marder 1A3',cls:'Бойова машина піхоти',org:'Німеччина',mk:{s:[],f:[],r:[]},file:'marder',rig:{tracked:[-2.37,-1.37,-.34,.71,1.76,2.82].map(x=>[x,0.52,0.33])},trackZ:1.32,trackHW:.24,tf:{R:[[0,0,1],[0,1,0],[-1,0,0]],s:1,t:[0,.021,0]},L:'≈ 6,8',W:'≈ 3,2',H:'≈ 3,0',mass:'≈ 35',v:'≈ 65',rng:'≈ 520',
   fire:null,crew:'3 + 6 десанту',arm:'20 мм Rh 202 · ПТРК Milan · 7,62 мм MG3',r:[3,3.5,.7,.8,.65],ic:'ifv',exh:[1.0,1.9,-1.5]},
 abrams:{cat:'tank',origin:'US',n:'M1 Abrams',cls:'Основний бойовий танк',org:'США',mk:{s:[[.45,.75,.6],[.75,.45,.5]],f:[[.4,0,.45]],r:[[.5,0,.5]]},file:'abrams',rig:{tracked:[-3.89,-2.91,-1.91,-.91,.07,1.06,2.09].map(x=>[x,0.42,0.31])},trackZ:1.42,trackHW:.24,tf:{R:[[0,0,1],[0,1,0],[-1,0,0]],s:1,t:[0,.013,0]},L:'≈ 9,8 зі стволом',W:'≈ 3,7',H:'≈ 2,4',mass:'≈ 62–63',v:'≈ 67',rng:'≈ 425',
   fire:null,crew:'4',arm:'120 мм M256 · 12,7 мм M2 · 2 × 7,62 мм M240',r:[5,5,.7,.75,.45],ic:'tank',note:'у ЗСУ — M1A1 SA',exh:[-3.4,1.4,0]},
 sampt:{tint:[.74,.84,.62],wauto:'whl',cat:'ad',origin:'FR',n:'SAMP/T',cls:'ЗРК великої дальності · ПУ на шасі 8×8',org:'Франція · Італія',mk:{s:[[.2,.45,.45]],f:[[.5,.25,.35]],r:[[.5,.3,.4]]},file:'sampt',tf:{R:[[0,0,1],[0,1,0],[-1,0,0]],s:5.8,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 11',W:'≈ 2,55',H:'≈ 3,6 (по-похідному)',mass:null,v:'≈ 80',rng:null,
   fire:'Aster 30 до ≈ 100–120 км · висота до ≈ 20 км',crew:null,arm:'8 ракет Aster 30 у вертикальних ТПК',r:[4.5,1,.6,.5,.5],ic:'truck8'},
 iris:{wauto:'whl',cat:'ad',origin:'DE',n:'IRIS-T SLM',cls:'ЗРК середньої дальності · шасі MAN 8×8',org:'Німеччина',mk:{s:[[.15,.5,.4]],f:[[.5,.3,.35]],r:[[.5,.3,.4]]},file:'iris',tf:{R:[[0,0,1],[0,1,0],[-1,0,0]],s:1,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 11',W:'≈ 2,55',H:'≈ 4 (по-похідному)',mass:null,v:'≈ 90',rng:null,
   fire:'до 40 км · висота до 20 км',crew:'3',arm:'8 ракет IRIS-T SL',r:[4,1,.85,.6,.6],ic:'truck8'},
 nasams:{wauto:'whl',cat:'ad',origin:'NO',n:'NASAMS',cls:'ЗРК середньої дальності · ПУ на шасі 6×6',org:'Норвегія · США',mk:{s:[[.15,.45,.4]],f:[[.5,.3,.35]],r:[[.5,.3,.4]]},file:'nasams',tf:{R:[[0,0,1],[0,1,0],[-1,0,0]],s:1,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 8,2',W:'≈ 2,5',H:'≈ 3,3 (по-похідному)',mass:null,v:'≈ 90',rng:null,
   fire:'AIM-120 до ≈ 30 км · AMRAAM-ER до ≈ 50 км',crew:null,arm:'6 ракет AIM-120 AMRAAM / AIM-9X / AMRAAM-ER',r:[4,1,.85,.6,.6],ic:'truck6'},
 s300:{wauto:'whl',cat:'ad',origin:'SU',n:'С-300ПС',cls:'ЗРК великої дальності · ПУ 5П85С на МАЗ-543',org:'СРСР',mk:{s:[[.12,.45,.4]],f:[[.5,.3,.3]],r:[[.5,.25,.35]]},file:'s300',tf:{R:[[0,0,-1],[0,1,0],[1,0,0]],s:1,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 13',W:'≈ 3,05',H:'≈ 3,8',mass:'≈ 43',v:'≈ 60',rng:'≈ 650',
   fire:'до ≈ 75–90 км (5В55Р) · висота до 27 км',crew:'3',arm:'4 ракети 5В55 у ТПК',r:[4.5,1,.6,.5,.55],ic:'truck8'},
 buk:{wauto:'trk',cat:'ad',origin:'SU',n:'Бук-М1',cls:'ЗРК середньої дальності · СОУ 9А310М1',org:'СРСР',mk:{s:[[.3,.4,.45]],f:[[.5,.35,.3]],r:[[.5,.35,.35]]},file:'buk',tf:{R:[[0,0,1],[0,1,0],[-1,0,0]],s:.98,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 9,3',W:'≈ 3,25',H:'≈ 3,8',mass:'≈ 35',v:'≈ 65',rng:'≈ 500',
   fire:'до 35 км · висота до 22 км',crew:'4',arm:'4 ракети 9М38М1 · РЛС супроводу 9С35',r:[4,2,.65,.7,.5],ic:'tracked'},
 hawk:{tint:[.72,.8,.62],cat:'ad',origin:'US',n:'MIM-23 Hawk',cls:'ЗРК середньої дальності · буксирувана ПУ M192',org:'США',mk:{s:[],f:[],r:[]},noocc:1,file:'hawk',tf:{R:[[0,0,-1],[0,1,0],[1,0,0]],s:.0125,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 5,9 (з ракетами)',W:'≈ 4,6 (розгорнута)',H:'≈ 3,4',mass:null,v:null,rng:null,
   fire:'MIM-23B до ≈ 40 км · висота до ≈ 18 км',crew:null,arm:'3 ракети MIM-23B',r:[3.5,.3,.4,.4,0],ic:'trailer'},
 osa:{wauto:'whl',cat:'ad',origin:'SU',n:'Оса-АКМ',cls:'Самохідний ЗРК малої дальності 6×6 (плаваючий)',org:'СРСР',mk:{s:[[.3,.45,.4]],f:[[.5,.3,.3]],r:[[.5,.3,.35]]},file:'osa',tf:{R:[[0,0,1],[0,1,0],[-1,0,0]],s:.977,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 9,1',W:'≈ 2,8',H:'≈ 4,2 (з антеною)',mass:'≈ 17,5',v:'≈ 75',rng:'≈ 500',
   fire:'до 10 км · висота до 5 км',crew:'5',arm:'6 ракет 9М33М3 · РЛС виявлення та супроводу',r:[3,1.5,.75,.8,.5],ic:'apc8'},
 crotale:{kb:'crotale',wauto:'whl',cat:'ad',origin:'FR',n:'Crotale',cls:'ЗРК малої дальності · бойова машина 4×4',org:'Франція',mk:{s:[[.4,.45,.4]],f:[[.5,.35,.3]],r:[[.5,.35,.35]]},file:'crotale',tf:{R:[[1,0,0],[0,1,0],[0,0,1]],s:.091,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 6,2',W:'≈ 2,7',H:'≈ 3,3',mass:'≈ 15',v:'≈ 70',rng:'≈ 500',
   fire:'R440 до ≈ 10 км · висота до ≈ 5 км',crew:'3',arm:'4 ракети R440',r:[3,1.2,.7,.75,.5],ic:'car4'},
 strela10:{wauto:'trk',cat:'ad',origin:'SU',n:'Стріла-10М',cls:'ЗРК ближньої дії на шасі МТ-ЛБ',org:'СРСР',mk:{s:[[.25,.45,.35]],f:[[.5,.35,.3]],r:[[.5,.35,.35]]},file:'strela10',tf:{R:[[0,0,-1],[0,1,0],[1,0,0]],s:1,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 6,6',W:'≈ 2,85',H:'≈ 3,8 (бойове)',mass:'≈ 12,3',v:'≈ 61',rng:'≈ 500',
   fire:'до 5 км · висота до 3,5 км',crew:'3',arm:'4 ракети 9М37М (+4 у боєукладці) · 7,62 мм ПКТ',r:[2.5,1.5,.6,.8,.5],ic:'tracked'},
 avenger:{tint:[.6,.65,.55],wauto:'whl',cat:'ad',origin:'US',n:'AN/TWQ-1 Avenger',cls:'ЗРК ближньої дії на HMMWV',org:'США',mk:{s:[[.3,.45,.35]],f:[[.5,.3,.3]],r:[[.5,.3,.3]]},file:'avenger',tf:{R:[[0,0,1],[0,1,0],[-1,0,0]],s:9.3,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 4,95',W:'≈ 2,2',H:'≈ 2,6',mass:'≈ 3,9',v:'≈ 105',rng:'≈ 440',
   fire:'до ≈ 8 км · висота до ≈ 3,8 км',crew:'2',arm:'8 ракет FIM-92 Stinger · 12,7 мм M3P',r:[2.5,.5,1,.85,.45],ic:'car4'},
 tunguska:{wauto:'trk',cat:'ad',origin:'SU',n:'2К22 «Тунгуска»',cls:'Зенітний гарматно-ракетний комплекс',org:'СРСР',mk:{s:[[.3,.4,.4]],f:[[.5,.35,.3]],r:[[.5,.35,.35]]},file:'tunguska',tf:{R:[[0,0,1],[0,1,0],[-1,0,0]],s:.98,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 7,9',W:'≈ 3,25',H:'≈ 4,0 (з РЛС)',mass:'≈ 34',v:'≈ 65',rng:'≈ 500',
   fire:'гармати до 4 км · ракети до 8–10 км',crew:'4',arm:'2×2 30 мм 2А38 · 8 ракет 9М311',r:[4,2,.65,.7,.5],ic:'spaag'},
 gepard:{wauto:'trk',cat:'ad',origin:'DE',n:'Gepard 1A2',cls:'Зенітна самохідна установка',org:'Німеччина',mk:{s:[[.3,.45,.4]],f:[[.5,.35,.3]],r:[[.5,.35,.35]]},file:'gepard',tf:{R:[[0,0,1],[0,1,0],[-1,0,0]],s:.96,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 7,7',W:'≈ 3,3',H:'≈ 4,0 (з РЛС)',mass:'≈ 47,5',v:'≈ 65',rng:'≈ 550',
   fire:'до ≈ 3,5–4 км',crew:'3',arm:'2 × 35 мм Oerlikon KDA · РЛС пошуку та супроводу',r:[3.5,2.5,.65,.6,.55],ic:'spaag'},
 skynex:{hideMat:['Material_4800'],kb:'skynex',kbBox:[10.95,4.1,4.2],noocc:1,cat:'ad',origin:'DE',n:'Skynex',cls:'Зенітний артилерійський комплекс · гармата Revolver Gun Mk3',org:'Німеччина · Швейцарія',mk:{s:[],f:[],r:[]},file:'d30',tf:{R:[[0,0,-1],[0,1,0],[1,0,0]],s:.277,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 10,9 (на причепі)',W:'≈ 2,5',H:'≈ 3,7 (на причепі)',mass:null,v:null,rng:null,
   fire:'до ≈ 4 км (AHEAD)',crew:'дистанційно',arm:'35 мм Revolver Gun Mk3 · 1000 постр./хв · 252 постріли AHEAD',r:[3.5,.8,0,.3,0],ic:'aagun'},
 zu23:{tint:[.74,.8,.62],wauto:'whl',cat:'ad',origin:'SU',n:'ЗУ-23-2 на пікапі',cls:'Зенітна установка 23 мм · «технічка» 4×4',org:'СРСР',mk:{s:[[.45,.5,.3]],f:[],r:[[.5,.4,.3]]},file:'zu23',tf:{R:[[1,0,0],[0,1,0],[0,0,1]],s:1,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},L:'≈ 4,9',W:'≈ 1,9',H:'≈ 2,2',mass:'≈ 2,8',v:'≈ 120',rng:'≈ 600',
   fire:'до ≈ 2,5 км (повітряні цілі)',crew:'3',arm:'2 × 23 мм 2А14 · 2000 постр./хв',r:[2.5,.2,1,.9,.6],ic:'car4'},
 patriot:{wauto:'whl',cat:'ad',origin:'US',n:'MIM-104 Patriot',cls:'ЗРК великої дальності · ПУ на шасі MAN 8×8',org:'США',mk:{s:[[.12,.5,.6],[.6,.45,.6]],f:[[.4,0,.5]],r:[[.5,0,.6]],fl:[[.05,.62,.45]]},scrub:[[.3,1,.3,1,'white']],file:'patriot2',tf:{R:[[0,0,-1],[0,1,0],[1,0,0]],s:1,t:[0,0,0]},kit:{hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},combat:'clip',clip:{raise:[0,18]},zoomC:1,L:'≈ 13 (ПУ)',W:'≈ 2,6',H:'≈ 4 (по-похідному)',mass:null,v:null,rng:null,
   fire:'PAC-2 GEM-T до ≈ 160 км · PAC-3 до ≈ 40 км',crew:null,arm:'4 ракети PAC-2 або до 16 PAC-3 MSE',r:[4.5,1,.6,.45,.5],ic:'truck8',exh:[-4.5,3.2,-1.1]}};
const GV_ICON={
 bridge:'M6 40 L12 32 L80 32 L88 40 L82 46 L12 46 Z M8 30 L92 22 L94 26 L10 34 Z M20 28 L20 18 L34 18 L36 28 Z',
 spaag:'M8 36 L16 28 L84 28 L94 36 L86 46 L14 46 Z M34 28 L38 16 L68 16 L72 28 Z M36 20 L2 16 L2 19 L36 23 Z M60 16 L60 6 L70 6 L70 16 Z',
 aagun:'M10 46 L20 34 L80 34 L90 46 Z M30 34 L34 20 L70 20 L74 34 Z M34 24 L2 12 L2 15 L34 28 Z M54 20 L54 12 L64 12 L64 20 Z',
 apc8:'M6 36 L14 24 L84 22 L94 30 L92 40 L8 40 Z M44 22 L48 15 L62 15 L64 22 Z M60 17 L82 16 L82 18 L60 19 Z M18 45 m-5 0 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0 M34 45 m-5 0 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0 M62 45 m-5 0 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0 M78 45 m-5 0 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0',
 car4:'M6 40 L6 28 L18 26 L28 14 L84 14 L92 26 L92 40 Z M50 14 L52 8 L62 8 L64 14 Z M22 44 m-7 0 a7 7 0 1 0 14 0 a7 7 0 1 0 -14 0 M76 44 m-7 0 a7 7 0 1 0 14 0 a7 7 0 1 0 -14 0',
 whtank:'M6 36 L14 26 L86 26 L94 34 L90 40 L8 40 Z M36 26 L42 17 L66 17 L70 26 Z M40 20 L2 19 L2 22 L40 23 Z M22 45 m-6 0 a6 6 0 1 0 12 0 a6 6 0 1 0 -12 0 M50 45 m-6 0 a6 6 0 1 0 12 0 a6 6 0 1 0 -12 0 M78 45 m-6 0 a6 6 0 1 0 12 0 a6 6 0 1 0 -12 0',
 truck6:'M8 40 L8 26 L20 26 L20 16 L34 16 L38 26 L92 26 L92 40 Z M14 46 m-6 0 a6 6 0 1 0 12 0 a6 6 0 1 0 -12 0 M66 46 m-6 0 a6 6 0 1 0 12 0 a6 6 0 1 0 -12 0 M82 46 m-6 0 a6 6 0 1 0 12 0 a6 6 0 1 0 -12 0 M44 24 L88 12 L90 18 L46 28 Z',
 truck8:'M6 40 L6 22 L22 22 L22 16 L94 18 L94 40 Z M13 46 m-5 0 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0 M27 46 m-5 0 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0 M66 46 m-5 0 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0 M80 46 m-5 0 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0',
 truck10:'M4 40 L4 22 L20 22 L20 14 L96 14 L96 40 Z M10 46 m-5 0 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0 M24 46 m-5 0 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0 M50 46 m-5 0 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0 M68 46 m-5 0 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0 M86 46 m-5 0 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0',
 tracked:'M10 34 L16 24 L84 24 L92 34 L86 46 L14 46 Z M40 22 L84 10 L88 18 L44 26 Z M22 24 L22 14 L36 14 L38 24 Z',
 tank:'M8 36 L16 28 L84 28 L94 36 L86 46 L14 46 Z M34 28 L40 18 L66 18 L70 28 Z M62 21 L98 19 L98 22 L62 24 Z',
 spg:'M8 38 L14 28 L84 28 L92 38 L86 46 L14 46 Z M30 28 L34 16 L70 16 L72 28 Z M34 18 L2 12 L2 15 L34 22 Z',
 towed:'M4 44 L30 34 L34 38 L10 46 Z M30 30 L96 14 L97 17 L34 34 Z M26 38 m-8 0 a8 8 0 1 0 16 0 a8 8 0 1 0 -16 0 M28 26 L44 26 L44 38 L28 38 Z',
 ifv:'M8 38 L16 22 L86 22 L94 38 L86 46 L14 46 Z M40 22 L44 14 L62 14 L64 22 Z M60 16 L86 15 L86 17 L60 18 Z',
 trailer:'M4 40 L4 26 L14 26 L14 18 L26 18 L28 26 L96 26 L96 40 Z M42 24 L88 8 L92 14 L46 28 Z M10 46 m-5 0 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0 M26 46 m-5 0 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0 M80 46 m-5 0 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0 M92 46 m-4 0 a4 4 0 1 0 8 0 a4 4 0 1 0 -8 0'};
const GV_RELOAD={himars:[[0,'пускова опускається'],[2,'модуль розвертається дулами назад'],[5,'завантажувач висувається'],[8.7,'знімає порожній контейнер'],[13.2,'піднімає повний контейнер'],[17.9,'завантажувач складається'],[22,'модуль розвертається'],[25.2,'пускова піднімається']],
 m270:[[0,'платформа повертається боком'],[3,'установка опускається'],[4.3,'направляючі висуваються'],[6,'правий пакет знімається'],[9,'правий пакет піднято'],[12.4,'лівий пакет знімається'],[15.4,'лівий пакет піднято'],[19,'направляючі складаються'],[20.7,'установка піднімається'],[22.4,'платформа повертається']]};
/* ---------- вкладка «Ворог»: техніка ЗС РФ (ТТХ — округлені відкриті дані). Знаки Z / V / O — як на фото з фронту. ---------- */
const UA_ORDER=GV_ORDER.slice(),UA_CATS=GV_CATS.slice();
const EN_CATS=[['all','Усі'],['tank','Танки'],['ifv','ББМ · БТР'],['art','Артилерія · РСЗВ · ОТРК'],['ad','ППО'],['eng','Вантажні · інженерні']];
const PZ=[[0,0,1],[0,1,0],[-1,0,0]],MZ=[[0,0,-1],[0,1,0],[1,0,0]],ID=[[1,0,0],[0,1,0],[0,0,1]],MX=[[-1,0,0],[0,1,0],[0,0,-1]];
const RY=d=>{const a=d*Math.PI/180,c=Math.cos(a),s=Math.sin(a);return [[c,0,s],[0,1,0],[-s,0,c]];};
const K0={hl:0,tl:0,hook:0,ant:0,mir:0,jer:0},NOMK={s:[],f:[],r:[]};
const EN=(id,o)=>{GV[id]=Object.assign({enemy:1,note:'ЗС РФ',kit:K0,mk:{s:[[.5,.55,.5]],f:[[.5,0,.4]],r:[[.5,0,.45]]}},o);};
const ENR=(id,base,o)=>{GV[id]=Object.assign({},GV[base],{enemy:1,note:'ЗС РФ',tint:GV[base].tint},o||{});};
/* танки */
EN('rt62m',{org:'СРСР',cat:'tank',origin:'SU',n:'Т-62М',cls:'Середній танк (модернізація 1983 р.) · з баз зберігання',wauto:'trk',zl:'Z',mk:{s:[[.55,.62,.5]],f:[],r:[[.5,0,.5]]},file:'t62m',tf:{R:MZ,s:.2025,t:[0,0,0]},
  L:'≈ 9,3 зі стволом',W:'≈ 3,3',H:'≈ 2,4',mass:'≈ 41,5',v:'≈ 50',rng:'≈ 450',fire:null,crew:'4',arm:'115 мм У-5ТС · 12,7 мм ДШКМ · 7,62 мм ПКТ · ДЗ / «мангал»',r:[3,2.5,.5,.6,.55],ic:'tank'});
EN('rt72b3',{org:'Росія',cat:'tank',origin:'RU',n:'Т-72Б3',cls:'Основний бойовий танк (модернізація Т-72Б)',wauto:'trk',mk:NOMK,file:'t72b3',tf:{R:PZ,s:.964,t:[0,0,0]},
  L:'≈ 9,5 зі стволом',W:'≈ 3,6',H:'≈ 2,2',mass:'≈ 46',v:'≈ 60',rng:'≈ 500',fire:null,crew:'3',arm:'125 мм 2А46М-5 · 12,7 мм «Корд» · 7,62 мм ПКТ · ДЗ «Контакт-5»',r:[4,3.5,.62,.75,.6],ic:'tank'});
EN('rt72b3m',{org:'Росія',cat:'tank',origin:'RU',n:'Т-72Б3М',cls:'Основний бойовий танк (зразка 2022 р.)',wauto:'trk',zl:'Z',mk:{s:[[.42,.55,.45]],f:[],r:[[.5,0,.5]]},file:'t72b3m',tf:{R:MZ,s:.93,t:[0,0,0]},
  L:'≈ 9,5 зі стволом',W:'≈ 3,6',H:'≈ 2,2',mass:'≈ 46,5',v:'≈ 60',rng:'≈ 500',fire:null,crew:'3',arm:'125 мм 2А46М-5 · 12,7 мм «Корд» · 7,62 мм ПКТ · ДЗ «Реликт»',r:[4,4,.65,.75,.6],ic:'tank'});
EN('rt80bvm',{org:'Росія',cat:'tank',origin:'RU',n:'Т-80БВМ',cls:'Основний бойовий танк з газотурбінним двигуном',wauto:'trk',zl:'V',mk:{s:[[.45,.6,.45]],f:[],r:[[.5,0,.5]]},tint:[.55,.68,.45],file:'t80bvm',tf:{R:PZ,s:.99,t:[0,0,0]},
  L:'≈ 9,7 зі стволом',W:'≈ 3,6',H:'≈ 2,2',mass:'≈ 46',v:'≈ 70',rng:'≈ 335',fire:null,crew:'3',arm:'125 мм 2А46М-4 · 12,7 мм «Корд» · 7,62 мм ПКТ · ДЗ «Реликт»',r:[4,4,.78,.75,.45],ic:'tank'});
EN('rt90m',{org:'Росія',cat:'tank',origin:'RU',n:'Т-90М «Прорив»',cls:'Основний бойовий танк',wauto:'trk',zl:'Z',mk:{s:[[.42,.55,.45]],f:[],r:[[.5,0,.5]]},tint:[.62,.7,.5],file:'t90m',tf:{R:PZ,s:.974,t:[0,0,0]},
  L:'≈ 9,6 зі стволом',W:'≈ 3,8',H:'≈ 2,2',mass:'≈ 48',v:'≈ 60',rng:'≈ 550',fire:null,crew:'3',arm:'125 мм 2А46М-4 · 12,7 мм «Корд» (ДУМ) · 7,62 мм ПКТМ · ДЗ «Реликт»',r:[4.5,4.5,.62,.75,.65],ic:'tank'});
EN('rbmpt',{org:'Росія',cat:'tank',origin:'RU',n:'БМПТ «Термінатор»',cls:'Бойова машина підтримки танків (шасі Т-72)',wauto:'trk',zl:'Z',mk:{s:[[.6,.45,.4]],f:[],r:[[.5,0,.45]]},file:'bmpt',tf:{R:PZ,s:.69,t:[0,0,0]},
  L:'≈ 7,1',W:'≈ 3,4',H:'≈ 3,4',mass:'≈ 44',v:'≈ 60',rng:'≈ 500',fire:null,crew:'5',arm:'2 × 30 мм 2А42 · 4 ПТКР «Атака» · 7,62 мм ПКТМ',r:[4.5,3.5,.62,.75,.6],ic:'tank'});
/* ББМ */
ENR('rbmp1','bmp1',{zl:'V'});
EN('rbmp2m',{org:'Росія',cat:'ifv',origin:'RU',n:'БМП-2М «Бережок»',cls:'Бойова машина піхоти (модернізація БМП-2)',wauto:'trk',zl:'Z',mk:{s:[[.5,.5,.42]],f:[],r:[[.5,0,.45]]},tint:[.36,.54,.3],bright:.7,file:'bmp2m',tf:{R:PZ,s:.984,t:[0,0,0]},
  L:'≈ 6,7',W:'≈ 3,15',H:'≈ 2,45',mass:'≈ 14,5',v:'≈ 65 (7 на плаву)',rng:'≈ 600',fire:null,crew:'3 + 7 десанту',arm:'30 мм 2А42 · 30 мм АГ-30 · 4 ПТКР «Корнет» · 7,62 мм ПКТМ',r:[4,2,.7,.8,.6],ic:'ifv'});
EN('rbmp3',{org:'СРСР · Росія',cat:'ifv',origin:'RU',n:'БМП-3',cls:'Бойова машина піхоти',wauto:'trk',zl:'Z',mk:{s:[[.55,.5,.42]],f:[],r:[[.5,0,.45]]},file:'bmp3',tf:{R:PZ,s:1.357,t:[0,0,0]},
  L:'≈ 7,1',W:'≈ 3,15',H:'≈ 2,45',mass:'≈ 18,7',v:'≈ 70 (10 на плаву)',rng:'≈ 600',fire:null,crew:'3 + 7 десанту',arm:'100 мм 2А70 (ПТКР 9М117) · 30 мм 2А72 · 3 × 7,62 мм ПКТ',r:[4.5,2,.7,.8,.6],ic:'ifv'});
EN('rbmd2m',{org:'Росія',cat:'ifv',origin:'RU',n:'БМД-2М',cls:'Бойова машина десанту',wauto:'trk',mk:NOMK,file:'bmd2m',tf:{R:MX,s:.194,t:[0,0,0]},
  L:'≈ 5,4',W:'≈ 2,6',H:'≈ 2,0',mass:'≈ 8,2',v:'≈ 60 (10 на плаву)',rng:'≈ 500',fire:null,crew:'3 + 4 десанту',arm:'30 мм 2А42 · ПТКР «Корнет» · 7,62 мм ПКТ',r:[3.5,1.5,.65,.8,.55],ic:'ifv'});
EN('rbmd4m',{org:'Росія',cat:'ifv',origin:'RU',n:'БМД-4М',cls:'Бойова машина десанту',wauto:'trk',mk:NOMK,file:'bmd4m',tf:{R:ID,s:.2114,t:[0,0,0]},
  L:'≈ 6,1',W:'≈ 3,1',H:'≈ 2,2',mass:'≈ 13,5',v:'≈ 70 (10 на плаву)',rng:'≈ 500',fire:null,crew:'3 + 5 десанту',arm:'100 мм 2А70 · 30 мм 2А72 · 7,62 мм ПКТМ (модуль «Бахча-У»)',r:[4.5,2,.72,.8,.55],ic:'ifv'});
ENR('rbtr80','btr80',{zl:'Z'});
EN('rbtr82a',{org:'Росія',cat:'ifv',origin:'RU',n:'БТР-82А',cls:'Бронетранспортер 8×8',wauto:'whl',zl:'Z',mk:{s:[[.5,.55,.42]],f:[],r:[[.5,0,.45]]},file:'btr82a',tf:{R:MZ,s:.994,t:[0,0,0]},
  L:'≈ 7,65',W:'≈ 2,9',H:'≈ 2,8',mass:'≈ 15,4',v:'≈ 100 (10 на плаву)',rng:'≈ 600',fire:null,crew:'3 + 7 десанту',arm:'30 мм 2А72 · 7,62 мм ПКТМ',r:[3.5,2,.85,.7,.65],ic:'apc8'});
ENR('rmtlb','mtlb',{zl:'V'});ENR('rbrdm2','brdm2',{zl:'Z',solid:0x131a0d});
EN('rtyphoon',{org:'Росія',cat:'ifv',origin:'RU',n:'К-53949 «Тайфун-К»',cls:'Броньований автомобіль 4×4 (MRAP)',wauto:'whl',mk:NOMK,file:'typhoon',tf:{R:PZ,s:3.38,t:[0,0,0]},
  L:'≈ 6,8',W:'≈ 2,5',H:'≈ 2,8',mass:'≈ 14',v:'≈ 105',rng:'≈ 1000',fire:null,crew:'2 + 8 десанту',arm:'кулемет 7,62 / 12,7 мм (залежно від версії)',r:[1.5,2.5,.9,.65,.85],ic:'car4'});
/* артилерія, РСЗВ, ОТРК */
ENR('rgvozdika','gvozdika',{zl:'Z'});ENR('rakatsiya','akatsiya',{zl:'V'});ENR('rmsta','msta',{zl:'Z',solid:0x131a0d});ENR('rmalka','pion',{zl:'Z',n:'2С7М «Малка»',cls:'САУ 203 мм (модернізація 2С7 «Піон»)',org:'СРСР · Росія'});
EN('rmalva',{org:'Росія',cat:'art',origin:'RU',n:'2С43 «Мальва»',cls:'Колісна САУ 152 мм (шасі БАЗ-6610 8×8)',wauto:'whl',solid:0x131a0d,zl:'Z',mk:{s:[[.85,.55,.45]],f:[],r:[]},file:'malva',tf:{R:MZ,s:.81,t:[0,0,0]},
  L:'≈ 13',W:'≈ 2,75',H:'≈ 3,1',mass:'≈ 32',v:'≈ 80',rng:'≈ 1000',fire:'до ≈ 24,5 км',crew:'5',arm:'152 мм 2А64 · 30 пострілів',r:[4,1.5,.8,.65,.85],ic:'truck8'});
EN('rkoal',{org:'Росія',cat:'art',origin:'RU',n:'2С35 «Коаліція-СВ»',cls:'САУ 152 мм',wauto:'trk',zl:'Z',mk:{s:[[.45,.4,.4]],f:[],r:[[.5,0,.45]]},file:'koal',tf:{R:PZ,s:.0217,t:[0,0,0]},
  L:'≈ 13 зі стволом',W:'≈ 3,6',H:'≈ 3,4',mass:'≈ 48',v:'≈ 60',rng:'≈ 500',fire:'до ≈ 40 км (заявлено до ≈ 70 км)',crew:'3',arm:'152 мм 2А88 · 12,7 мм «Корд» (ДУМ)',r:[5,3.5,.62,.75,.6],ic:'spg'});
ENR('rd30','d30',{zl:'Z'});ENR('rgrad','grad',{zl:'Z'});ENR('rsmerch','smerch',{zl:'V'});
EN('rtos1a',{org:'Росія',cat:'art',origin:'RU',n:'ТОС-1А «Солнцепьок»',cls:'Важка вогнеметна система · 24 × 220 мм (шасі Т-72)',wauto:'trk',zl:'Z',mk:{s:[[.25,.35,.4]],f:[],r:[[.5,0,.45]]},file:'tos1a',tf:{R:PZ,s:.92,t:[0,0,0]},
  L:'≈ 6,9 (корпус)',W:'≈ 3,5',H:'≈ 2,8',mass:'≈ 45',v:'≈ 60',rng:'≈ 550',fire:'до ≈ 6 км (≈ 10 км ракетами МО.1.01.04М)',crew:'3',arm:'24 направляючі 220 мм · термобаричні та запалювальні ракети',r:[5,3,.62,.75,.6],ic:'tracked'});
EN('riskander',{org:'Росія',cat:'art',origin:'RU',n:'9К720 «Іскандер-М»',cls:'Оперативно-тактичний ракетний комплекс · ПУ 9П78-1 (МЗКТ-7930)',wauto:'whl',zl:'Z',tint:[.42,.52,.34],bright:.75,flat:1,mk:{s:[[.85,.5,.4]],f:[],r:[]},file:'iskb2',tf:{R:MX,s:1.067,t:[0,0,0]},
  L:'≈ 13',W:'≈ 3,1',H:'≈ 3,3',mass:'≈ 42',v:'≈ 70',rng:'≈ 1000',fire:'до ≈ 500 км',crew:'3',arm:'2 балістичні ракети 9М723 (або крилаті 9М728)',r:[5,1.5,.75,.65,.85],ic:'truck8'});
/* ППО */
EN('rs400',{org:'Росія',cat:'ad',origin:'RU',n:'С-400 «Тріумф»',cls:'ЗРС великої дальності · самохідна ПУ на шасі МАЗ-543М',wauto:'whl',zl:'Z',mk:{s:[[.85,.4,.4]],f:[],r:[]},file:'s400',tf:{R:PZ,s:6.67,t:[0,0,0]},
  L:'≈ 13',W:'≈ 3,05',H:null,mass:null,v:'≈ 60',rng:'≈ 650',fire:'до ≈ 250 км (48Н6ДМ) · до ≈ 380 км (40Н6)',crew:null,arm:'4 ТПК з ракетами 48Н6 / 40Н6',r:[5,1.5,.6,.6,.6],ic:'truck8'});
ENR('rs300','s300',{zl:'Z'});ENR('rbuk','buk',{zl:'Z'});
EN('rtor',{org:'Росія',cat:'ad',origin:'RU',n:'Тор-М2',cls:'ЗРК малої дальності · бойова машина 9А331М',wauto:'trk',zl:'Z',mk:{s:[[.3,.35,.4]],f:[],r:[[.5,0,.4]]},file:'torm2',tf:{R:MZ,s:3.95,t:[0,0,0]},
  L:'≈ 7,5',W:'≈ 3,3',H:'≈ 5,1 (з антеною)',mass:'≈ 34',v:'≈ 65',rng:'≈ 500',fire:'до ≈ 15 км · висота до ≈ 10 км',crew:'3',arm:'ракети 9М331 / 9М338 (8–16 залежно від модифікації)',r:[4,2,.65,.7,.5],ic:'tracked'});
EN('rpantsir',{org:'Росія',cat:'ad',origin:'RU',n:'Панцир-С1',cls:'Зенітний ракетно-гарматний комплекс (КамАЗ-6560 8×8)',wauto:'whl',mk:NOMK,file:'pantsir',tf:{R:PZ,s:1,t:[0,0,0]},
  L:'≈ 10,4',W:'≈ 3,2',H:null,mass:'≈ 30',v:'≈ 90',rng:'≈ 500',fire:'ракети до ≈ 20 км · гармати до ≈ 4 км',crew:'3',arm:'12 ракет 57Е6 · 2 × 30 мм 2А38М',r:[4,1.5,.8,.65,.7],ic:'truck8'});
EN('rtung',{org:'СРСР · Росія',cat:'ad',origin:'SU',n:'2К22 «Тунгуска»',cls:'Зенітний гарматно-ракетний комплекс',wauto:'trk',zl:'V',mk:{s:[[.3,.38,.4]],f:[],r:[[.5,0,.45]]},tint:[.58,.7,.48],file:'tungru',tf:{R:PZ,s:.978,t:[0,0,0]},
  L:'≈ 7,9',W:'≈ 3,25',H:'≈ 4,0 (з РЛС)',mass:'≈ 34',v:'≈ 65',rng:'≈ 500',fire:'ракети до ≈ 8–10 км · гармати до ≈ 4 км',crew:'4',arm:'2 × 2 30 мм 2А38 · 8 ракет 9М311',r:[4,2,.65,.7,.5],ic:'spaag'});
ENR('rosa','osa',{zl:'Z'});ENR('rstrela10','strela10',{zl:'V'});
EN('rgibka',{org:'Росія',cat:'ad',origin:'RU',n:'«Гибка-С»',cls:'Бойова машина ПЗРК на шасі ГАЗ «Тигр-М»',wauto:'whl',zl:'Z',mk:{s:[[.45,.45,.35]],f:[],r:[]},file:'tigr',tf:{R:RY(35),s:.93,t:[0,0,0]},
  L:'≈ 5,7',W:'≈ 2,4',H:'≈ 2,4 (кузов)',mass:'≈ 7,8',v:'≈ 125',rng:'≈ 1000',fire:'до ≈ 6 км · висота до ≈ 4,5 км («Верба»)',crew:null,arm:'пусковий модуль ПЗРК «Верба» / «Ігла-С»',r:[2.5,2,.9,.65,.85],ic:'car4'});
/* вантажні, інженерні */
EN('rkamaz',{org:'Росія',cat:'eng',origin:'RU',n:'КамАЗ-5350',cls:'Вантажівка 6×6 (Росгвардія)',wauto:'whl',mk:NOMK,file:'kamaz',tf:{R:PZ,s:.89,t:[0,0,0]},
  L:'≈ 8,8',W:'≈ 2,55',H:'≈ 3,5',mass:'≈ 9,5',pay:'≈ 6',v:'≈ 90',rng:'≈ 1000',fire:null,crew:'1 + 2',arm:'Бортова платформа з тентом',eqk:'Обладнання',r:[0,1,.85,.75,.85],ic:'truck6'});
ENR('rural','ural',{zl:'Z'});ENR('rur77','ur77',{zl:'V'});
const EN_ORDER=['rt62m','rt72b3','rt72b3m','rt80bvm','rt90m','rbmpt','rbmp1','rbmp2m','rbmp3','rbmd2m','rbmd4m','rbtr80','rbtr82a','rmtlb','rbrdm2','rtyphoon',
  'rgvozdika','rakatsiya','rmsta','rmalka','rmalva','rkoal','rd30','rgrad','rsmerch','rtos1a','riskander','rs400','rs300','rbuk','rtor','rpantsir','rtung','rosa','rstrela10','rgibka','rkamaz','rural','rur77'];
/* =========================================================
   ГАРАЖ · бокс парку бойових машин (окрема сцена, той самий HUD)
   Вісь x — уздовж машини (ніс у +x, до воріт), y — вгору, z — поперек. 1 од. = 1 м.
   ========================================================= */
(()=>{
const T=THREE,PI=Math.PI,$=s=>document.querySelector(s);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),ease=(c,t,k,dt)=>c+(t-c)*(1-Math.exp(-k*dt)),rnd=(a,b)=>a+Math.random()*(b-a);
const stage=$('#gStage');
const G={built:false,on:false,cur:null,models:{},mode:'park',lamps:false,holo:true,t:0,yaw:-.78,el:.07,zoom:1,yawV:0,drag:false,
  drive:{x:0,v:0,phase:0,t:0},eng:0,engOn:false,combat:0,combatWant:0,reload:null};
window.GAR=G;
let renderer,scene,camera,W=1,H=1;
function cv(w,h,fn){const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d');fn(x,w,h);return c;}
function tex(c,rep,srgb=true){const t=new T.CanvasTexture(c);t.anisotropy=8;if(srgb)t.encoding=T.sRGBEncoding;if(rep){t.wrapS=t.wrapT=T.RepeatWrapping;t.repeat.set(rep[0],rep[1]);}return t;}
function speck(x,w,h,n,a,c0,c1,s0=1,s1=3){for(let i=0;i<n;i++){const v=c0+Math.random()*(c1-c0)|0;x.fillStyle=`rgba(${v},${v},${v},${a})`;const s=s0+Math.random()*(s1-s0);x.fillRect(Math.random()*w,Math.random()*h,s,s);}}
function blot(x,w,h,n,col,r0,r1){for(let i=0;i<n;i++){const cx=Math.random()*w,cy=Math.random()*h,r=r0+Math.random()*(r1-r0);const g=x.createRadialGradient(cx,cy,0,cx,cy,r);g.addColorStop(0,col);g.addColorStop(1,'rgba(0,0,0,0)');x.fillStyle=g;x.fillRect(cx-r,cy-r,r*2,r*2);}}
const FONT='"Exo 2","IBM Plex Sans",sans-serif';
function stencil(x,txt,px,py,size,col,align='left',w=700){x.font=`${w} ${size}px ${FONT}`;x.textAlign=align;x.fillStyle=col;x.fillText(txt,px,py);}
function hazard(x,X,Y,w,h,step=40,ang=-1){x.save();x.beginPath();x.rect(X,Y,w,h);x.clip();x.fillStyle='#16140f';x.fillRect(X,Y,w,h);x.fillStyle='#d8a51c';
  for(let i=-h*2;i<w+h*2;i+=step*2){x.beginPath();x.moveTo(X+i,Y+h);x.lineTo(X+i+step,Y+h);x.lineTo(X+i+step-ang*h,Y);x.lineTo(X+i-ang*h,Y);x.closePath();x.fill();}
  x.restore();}
function wear(x,w,h,n=400){x.globalCompositeOperation='destination-out';for(let i=0;i<n;i++){x.fillStyle=`rgba(0,0,0,${rnd(.2,.9)})`;const s=rnd(1,7);x.fillRect(Math.random()*w,Math.random()*h,s,s*rnd(.3,1));}x.globalCompositeOperation='source-over';}
const HW=17,HL=40,WH=12.6;
const mats={};
function M(g,m,cast=true,recv=true){const o=new T.Mesh(g,m);o.castShadow=cast;o.receiveShadow=recv;return o;}
function std(o){return new T.MeshStandardMaterial(o);}
function add(o,p,r){if(p)o.position.set(...p);if(r)o.rotation.set(...r);G.root.add(o);return o;}
function build(){
  renderer=new T.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.75));renderer.outputEncoding=T.sRGBEncoding;
  renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=.86;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
  stage.prepend(renderer.domElement);
  scene=new T.Scene();scene.background=new T.Color(0x07090a);scene.fog=new T.FogExp2(0x090c0d,.021);
  camera=new T.PerspectiveCamera(36,16/9,.1,400);
  G.root=new T.Group();scene.add(G.root);G.scene=scene;G.renderer=renderer;G.camera=camera;
  buildHall();buildProps();buildLights();
  const pm=new T.PMREMGenerator(renderer);const rt=pm.fromScene(envScene(),.03);scene.environment=rt.texture;pm.dispose();
  buildFx();
  G.aoTex=tex(cv(256,256,(x,w,h)=>{const g=x.createRadialGradient(w/2,h/2,0,w/2,h/2,w/2);g.addColorStop(0,'rgba(0,0,0,.85)');g.addColorStop(.55,'rgba(0,0,0,.5)');g.addColorStop(1,'rgba(0,0,0,0)');x.fillStyle=g;x.fillRect(0,0,w,h);}),null,false);
  new ResizeObserver(resize).observe(stage);resize();
  input();G.built=true;}
function envScene(){const e=new T.Scene();const room=new T.Mesh(new T.BoxGeometry(80,14,34),new T.MeshBasicMaterial({color:0x15181a,side:T.BackSide}));room.position.y=6;e.add(room);
  const fl=new T.Mesh(new T.PlaneGeometry(80,34),new T.MeshBasicMaterial({color:0x2a2b29}));fl.rotation.x=-PI/2;fl.position.y=-.9;e.add(fl);
  const lm=new T.MeshBasicMaterial({color:new T.Color(1.6,1.45,1.25)});for(let x=-32;x<=32;x+=8)[-6.5,6.5].forEach(z=>{const b=new T.Mesh(new T.CircleGeometry(.8,16),lm);b.rotation.x=PI/2;b.position.set(x,12.5,z);e.add(b);});
  const sk=new T.MeshBasicMaterial({color:new T.Color(.55,.62,.68)});[-1,1].forEach(s=>{const w=new T.Mesh(new T.PlaneGeometry(76,1.6),sk);w.position.set(0,11.2,s*16.9);w.rotation.y=s>0?PI:0;e.add(w);});
  const gt=new T.Mesh(new T.PlaneGeometry(30,9),new T.MeshBasicMaterial({color:new T.Color(1.3,1.4,1.5)}));gt.position.set(39.9,4.5,0);gt.rotation.y=-PI/2;e.add(gt);return e;}
function resize(){if(!renderer)return;const r=stage.getBoundingClientRect();W=Math.max(1,r.width);H=Math.max(1,r.height);renderer.setSize(W,H,false);camera.aspect=W/H;camera.setViewOffset(W,H,0,H*.13,W,H);camera.updateProjectionMatrix();}
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
/* ---------- завантаження техніки ---------- */
function dequant(g){for(const k in g.attributes){const a=g.attributes[k];const arr=a.isInterleavedBufferAttribute?a.data.array:a.array;
  if(arr instanceof Float32Array&&!a.isInterleavedBufferAttribute&&!a.normalized)continue;const n=a.count,s=a.itemSize,o=new Float32Array(n*s);
  const div=a.normalized?(arr instanceof Int8Array?127:arr instanceof Uint8Array?255:arr instanceof Int16Array?32767:arr instanceof Uint16Array?65535:1):1;
  const get=[a.getX,a.getY,a.getZ,a.getW];for(let i=0;i<n;i++)for(let j=0;j<s;j++){const v=get[j].call(a,i);o[i*s+j]=a.normalized?Math.max(v/div,-1):v;}
  g.setAttribute(k,new T.BufferAttribute(o,s));}
  if(g.attributes.normal&&k0(g))g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();}
function k0(){return false;}
function b64buf(b){const s=atob(b),u=new Uint8Array(s.length);for(let i=0;i<s.length;i++)u[i]=s.charCodeAt(i);return u.buffer;}
function loadGlb(file){return new Promise((res,rej)=>{const L=new T.GLTFLoader();L.setMeshoptDecoder(MeshoptDecoder);
  const src=window.__GLB&&window.__GLB['g:'+file];
  if(src){L.parse(b64buf(src),'',res,rej);return;}
  const key='g_'+file,D0=window.__GLBD||{};const go=()=>{const s=(window.__GLBD||{})[key];if(s){L.parse(b64buf(s),'',res,rej);delete window.__GLBD[key];}else rej(new Error('model '+file));};
  if(D0[key]){go();return;}const sc=document.createElement('script');sc.src='models/'+key+'.js';sc.onload=go;sc.onerror=()=>L.load('glb/'+file+'.glb',res,undefined,rej);document.head.append(sc);});}
function camoTex(base){return tex(cv(512,512,(x,w,h)=>{const c=new T.Color(base);x.fillStyle='#'+c.getHexString();x.fillRect(0,0,w,h);
  const cols=['rgba(40,44,28,.55)','rgba(98,92,62,.45)','rgba(24,26,18,.5)'];for(let i=0;i<34;i++){x.fillStyle=cols[i%3];x.beginPath();const cx=rnd(0,w),cy=rnd(0,h),r=rnd(30,90);
    for(let a=0;a<6.28;a+=.5){const rr=r*rnd(.55,1.1);x.lineTo(cx+Math.cos(a)*rr,cy+Math.sin(a)*rr*.6);}x.fill();}speck(x,w,h,9000,.12,0,160);blot(x,w,h,12,'rgba(70,58,40,.35)',20,70);}),[2,2]);}
const WRE=/tyre|tire|wheel|rim|bolt|hub|road|idler|sprock|колес/i;
function splitWheels(seat,model,centers){seat.updateMatrixWorld(true);const out=[];const inv=new T.Matrix4().copy(seat.matrixWorld).invert();
  const groups=centers.map(c=>{const g=new T.Group();g.position.copy(c.p);model.parent.add(g);out.push({g,r:c.r});return g;});
  const meshes=[];model.traverse(o=>{if(o.isMesh&&!o.isSkinnedMesh&&o.geometry&&!o.morphTargetInfluences)meshes.push(o);});
  const named=meshes.filter(o=>WRE.test(o.name)||WRE.test(o.parent&&o.parent.name||''));const list=named.length?named:meshes;
  const m=new T.Matrix4(),nm=new T.Matrix3(),va=new T.Vector3(),vb=new T.Vector3(),vc=new T.Vector3(),ce=new T.Vector3();
  list.forEach(o=>{let g=o.geometry;if(g.index)g=g.toNonIndexed();m.multiplyMatrices(inv,o.matrixWorld);const P=g.attributes.position,n=P.count/3;
    const own=new Int16Array(n).fill(-1);let any=0;
    for(let t=0;t<n;t++){va.fromBufferAttribute(P,t*3).applyMatrix4(m);vb.fromBufferAttribute(P,t*3+1).applyMatrix4(m);vc.fromBufferAttribute(P,t*3+2).applyMatrix4(m);ce.copy(va).add(vb).add(vc).multiplyScalar(1/3);
      for(let w=0;w<centers.length;w++){const c=centers[w];if(Math.abs(ce.z-c.p.z)<c.hw&&Math.hypot(ce.x-c.p.x,ce.y-c.p.y)<c.r*1.04){if(c.trk){const lim=c.r*.96;if(Math.hypot(va.x-c.p.x,va.y-c.p.y)>lim||Math.hypot(vb.x-c.p.x,vb.y-c.p.y)>lim||Math.hypot(vc.x-c.p.x,vc.y-c.p.y)>lim)continue;}own[t]=w;any++;break;}}}
    if(!any)return;
    const keys=Object.keys(g.attributes);const mk=(sel)=>{const ng=new T.BufferGeometry();let cnt=0;for(let t=0;t<n;t++)if(sel(own[t]))cnt++;if(!cnt)return null;
      keys.forEach(k=>{const a=g.attributes[k],s=a.itemSize,src=a.array,dst=new src.constructor(cnt*3*s);let j=0;for(let t=0;t<n;t++)if(sel(own[t])){dst.set(src.subarray(t*3*s,t*3*s+3*s),j);j+=3*s;}ng.setAttribute(k,new T.BufferAttribute(dst,s,a.normalized));});return ng;};
    const rest=mk(w=>w<0);
    for(let w=0;w<centers.length;w++){const ng=mk(q=>q===w);if(!ng)continue;nm.getNormalMatrix(m);ng.applyMatrix4(m);ng.translate(-centers[w].p.x,-centers[w].p.y,-centers[w].p.z);
      const wm=new T.Mesh(ng,o.material);wm.castShadow=wm.receiveShadow=true;groups[w].add(wm);}
    if(rest){rest.computeBoundingBox();o.geometry=rest;}else o.visible=false;});
  return out.filter(w=>w.g.children.length);}
function wheelIslands(seat,model,A){seat.updateMatrixWorld(true);const inv=new T.Matrix4().copy(seat.matrixWorld).invert(),m=new T.Matrix4(),v=new T.Vector3();const C=[];let y0=1e9,zmn=1e9,zmx=-1e9;
  const meshes=[];model.traverse(o=>{if(o.isMesh&&o.geometry&&o.visible)meshes.push(o);});
  meshes.forEach(o=>{m.multiplyMatrices(inv,o.matrixWorld);const g=o.geometry,a=g.attributes.position,nv=a.count;const X=new Float32Array(nv*3);for(let i=0;i<nv;i++){v.fromBufferAttribute(a,i).applyMatrix4(m);X[i*3]=v.x;X[i*3+1]=v.y;X[i*3+2]=v.z;if(v.y<y0)y0=v.y;if(v.z<zmn)zmn=v.z;if(v.z>zmx)zmx=v.z;}
    // weld by position then union-find over triangles
    const key=new Map(),rep=new Int32Array(nv);for(let i=0;i<nv;i++){const k=Math.round(X[i*3]*500)+','+Math.round(X[i*3+1]*500)+','+Math.round(X[i*3+2]*500);let r=key.get(k);if(r===undefined){r=i;key.set(k,i);}rep[i]=r;}
    const par=new Int32Array(nv);for(let i=0;i<nv;i++)par[i]=i;const f=x=>{while(par[x]!==x){par[x]=par[par[x]];x=par[x];}return x;};const u=(a,b)=>{a=f(a);b=f(b);if(a!==b)par[a]=b;};
    const idx=g.index?g.index.array:null,nt=idx?idx.length/3:nv/3;for(let t=0;t<nt;t++){const a0=rep[idx?idx[t*3]:t*3],a1=rep[idx?idx[t*3+1]:t*3+1],a2=rep[idx?idx[t*3+2]:t*3+2];u(a0,a1);u(a1,a2);}
    const bb=new Map();for(let i=0;i<nv;i++){const r=f(rep[i]);let b=bb.get(r);if(!b){b=[1e9,1e9,1e9,-1e9,-1e9,-1e9,0];bb.set(r,b);}for(let k=0;k<3;k++){const q=X[i*3+k];if(q<b[k])b[k]=q;if(q>b[k+3])b[k+3]=q;}b[6]++;}
    bb.forEach(b=>C.push(b));});
  const W=zmx-zmn,cz=(zmn+zmx)/2,cand=[];
  C.forEach(b=>{const dx=b[3]-b[0],dy=b[4]-b[1],dz=b[5]-b[2],d=Math.max(dx,dy);if(b[6]<12||d<2*A.r0||d>2*A.r1||Math.abs(dx-dy)>.12*d||dz>Math.max(.55,d*.9))return;const x=(b[0]+b[3])/2,y=(b[1]+b[4])/2,z=(b[2]+b[5])/2;
    if(Math.abs(z-cz)<W*.22||y>y0+A.r1*1.7)return;cand.push({x,y,z,r:d/2,dz,za:b[2],zb:b[5]});});
  // cluster concentric islands, keep the largest per cluster
  const cl=[];cand.sort((a,b)=>b.r-a.r).forEach(c=>{const q=cl.find(q=>Math.abs(q.x-c.x)<.08&&Math.abs(q.y-c.y)<.08&&Math.sign(q.z-cz)===Math.sign(c.z-cz));if(q){q.za=Math.min(q.za,c.za);q.zb=Math.max(q.zb,c.zb);q.n++;}else cl.push(Object.assign({n:1},c));});
  return {y0,cz,W,cl};}
/* auto wheel finder: Hough circles on the side silhouette vertices (seat frame, front +x) */
function autoWheels(seat,model,D){const A=D.wauto==='trk'?{r0:.22,r1:.46,tk:1}:{r0:.38,r1:.72,tk:0};if(D.wr)Object.assign(A,{r0:D.wr[0],r1:D.wr[1]});
  {const I=wheelIslands(seat,model,window.__WDBG?{r0:.12,r1:.7}:A);if(window.__WDBG)D.__isl=I.cl.filter(q=>q.z>I.cz).sort((a,b)=>a.x-b.x).map(q=>[q.x,q.y,q.r,q.n,q.za,q.zb].map(x=>+x.toFixed(2)).join(' '));const side=I.cl.filter(q=>q.z>I.cz);if(side.length>=2){const rs=side.map(q=>q.r).sort((a,b)=>a-b);const low0=side.filter(q=>q.r>=A.r0&&q.r<=A.r1&&q.y-q.r<I.y0+.6);const base=low0.length?Math.min(...low0.map(q=>q.y-q.r)):0;const low=low0.filter(q=>q.y-q.r<base+(A.tk?.15:.045));const cnt=q=>low.filter(p=>Math.abs(p.r-q.r)<=Math.max(.03,q.r*.1)).length;const rm=low.length?low.slice().sort((a,b)=>cnt(b)-cnt(a)||b.r-a.r)[0].r:0;
    let L=low.filter(q=>Math.abs(q.r-rm)<=Math.max(.05,rm*.18)||(!A.tk&&cnt(q)>=2)).sort((a,b)=>a.x-b.x);L=L.filter((q,i)=>!L.some((p,j)=>j<i&&Math.abs(p.x-q.x)<p.r));
    if(L.length>=2){const zc=L.reduce((a,q)=>a+(q.za+q.zb)/2,0)/L.length-I.cz,hw=Math.min(.6,Math.max(.12,L.reduce((a,q)=>a+(q.zb-q.za)/2,0)/L.length+.05));
      D.__wh={src:'isl',y0:I.y0,list:L.map(q=>[+q.x.toFixed(3),+q.y.toFixed(3),+q.r.toFixed(3)]),zc:+zc.toFixed(3),hw:+hw.toFixed(3)};const out=[];
      L.forEach(q=>[-1,1].forEach(s=>out.push({p:new T.Vector3(q.x,q.y,I.cz+s*zc),r:q.r*1.03,hw,trk:A.tk})));return out;}}}
  seat.updateMatrixWorld(true);const inv=new T.Matrix4().copy(seat.matrixWorld).invert(),m=new T.Matrix4(),v=new T.Vector3();const P=[];let y0=1e9,zmx=-1e9,zmn=1e9;
  model.traverse(o=>{if(!o.isMesh||!o.geometry)return;m.multiplyMatrices(inv,o.matrixWorld);const a=o.geometry.attributes.position;const st=Math.max(1,Math.floor(a.count/60000));for(let i=0;i<a.count;i+=st){v.fromBufferAttribute(a,i).applyMatrix4(m);P.push(v.x,v.y,v.z);if(v.y<y0)y0=v.y;}});
  const n=P.length/3;const zs=[];for(let i=0;i<n;i++)if(P[i*3+1]<y0+1.2)zs.push(P[i*3+2]);zs.sort((a,b)=>a-b);zmn=zs[Math.floor(zs.length*.005)];zmx=zs[Math.floor(zs.length*.995)];const W=zmx-zmn;
  const res=.02,R=[];for(let r=A.r0;r<=A.r1+1e-6;r+=.02)R.push(r);const CY=[0,.03,.06,.09,.12,.15];
  let xmn=1e9,xmx=-1e9;const pts=[];for(let i=0;i<n;i++){const x=P[i*3],y=P[i*3+1],z=P[i*3+2];if(z<zmx-W*.3||y>y0+A.r1*2.3)continue;pts.push(x,y,z);if(x<xmn)xmn=x;if(x>xmx)xmx=x;}
  if(pts.length<60)return null;const NX=Math.ceil((xmx-xmn)/res)+2;
  const acc=new Float32Array(NX*R.length*CY.length);
  for(let i=0;i<pts.length;i+=3){const px=pts[i],py=pts[i+1];for(let ri=0;ri<R.length;ri++){const r=R[ri];for(let ci=0;ci<CY.length;ci++){const cy=y0+r+CY[ci],dy=py-cy;if(Math.abs(dy)>r)continue;const dx=Math.sqrt(r*r-dy*dy);
      for(const cx of [px-dx,px+dx]){const xi=Math.round((cx-xmn)/res);if(xi<0||xi>=NX)continue;acc[(ri*CY.length+ci)*NX+xi]+=1/r;}}}}
  // smooth along x, collapse cy by max
  const best=new Float32Array(NX),bri=new Int16Array(NX),bci=new Int16Array(NX);
  for(let ri=0;ri<R.length;ri++)for(let ci=0;ci<CY.length;ci++){const o=(ri*CY.length+ci)*NX;for(let x=1;x<NX-1;x++){const s=acc[o+x-1]*.5+acc[o+x]+acc[o+x+1]*.5;if(s>best[x]){best[x]=s;bri[x]=ri;bci[x]=ci;}}}
  let mx=0;for(let x=0;x<NX;x++)if(best[x]>mx)mx=best[x];const pk=[];
  const ord=[...best.keys()].sort((a,b)=>best[b]-best[a]);
  for(const x of ord){if(best[x]<mx*(D.wth||.42))break;const r=R[bri[x]],cx=xmn+x*res;if(pk.some(q=>Math.abs(q.x-cx)<(q.r+r)*.92))continue;pk.push({x:cx,y:y0+r+CY[bci[x]],r,s:best[x]});}
  if(!pk.length)return null;
  // keep the dominant radius family
  const rs=pk.slice(0,3).map(q=>q.r).sort((a,b)=>a-b),rm=rs[Math.floor(rs.length/2)];let W2=pk.filter(q=>Math.abs(q.r-rm)<=rm*.2);
  if(!A.tk)W2=W2.filter(q=>q.s>mx*.5);W2.sort((a,b)=>a.x-b.x);
  // side z of the wheel discs
  let zs2=[];for(let i=0;i<pts.length;i+=3){if(W2.some(q=>Math.hypot(pts[i]-q.x,pts[i+1]-q.y)<q.r*.95))zs2.push(pts[i+2]);}zs2.sort((a,b)=>a-b);
  const za=zs2.length?zs2[Math.floor(zs2.length*.05)]:zmx-W*.15,zb=zs2.length?zs2[Math.floor(zs2.length*.95)]:zmx;const zc=(za+zb)/2-(zmn+zmx)/2,hw=Math.max(.12,(zb-za)/2+.04);
  D.__wh={y0,W,list:W2.map(q=>[+q.x.toFixed(3),+q.y.toFixed(3),+q.r.toFixed(3)]),zc:+zc.toFixed(3),hw:+hw.toFixed(3)};
  const cz=(zmn+zmx)/2,out=[];W2.forEach(q=>[-1,1].forEach(s=>out.push({p:new T.Vector3(q.x,q.y,cz+s*zc),r:q.r*(A.tk?1:1.03),hw,trk:A.tk})));return out;}
function nodeBy(root,name){let f=null;root.traverse(o=>{if(!f&&o.name===name)f=o;});return f;}
G.pend={};function getModel(id){if(G.models[id])return Promise.resolve(G.models[id]);return G.pend[id]||(G.pend[id]=mkModel(id).finally(()=>delete G.pend[id]));}
async function mkModel(id){const D=GV[id];const gl=await loadGlb(D.file);
  const veh=new T.Group(),seat=new T.Group(),model=new T.Group();veh.add(seat);seat.add(model);model.add(gl.scene);
  if(D.hideMat){const rm=[];gl.scene.traverse(o=>{if(o.isMesh&&o.material&&D.hideMat.includes(o.material.name))rm.push(o);});rm.forEach(o=>o.parent.remove(o));}
  {const sk=[];gl.scene.updateMatrixWorld(true);gl.scene.traverse(o=>{if(o.isSkinnedMesh)sk.push(o);});sk.forEach(o=>{try{o.skeleton.update();const g=o.geometry.clone(),P=g.attributes.position,v=new T.Vector3();const np=new Float32Array(P.count*3);for(let i=0;i<P.count;i++){o.boneTransform(i,v);np[i*3]=v.x;np[i*3+1]=v.y;np[i*3+2]=v.z;}
    g.setAttribute('position',new T.BufferAttribute(np,3));g.deleteAttribute('skinIndex');g.deleteAttribute('skinWeight');g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();const bs=g.boundingSphere;if(!isFinite(bs.radius)||bs.radius*o.matrixWorld.getMaxScaleOnAxis()>50){o.parent.remove(o);return;}const m=new T.Mesh(g,o.material);m.name=o.name;m.position.copy(o.position);m.quaternion.copy(o.quaternion);m.scale.copy(o.scale);o.parent.add(m);o.parent.remove(o);}catch(e){console.warn('unskin',e);}});}
  if(D.tf){const R=D.tf.R,s=D.tf.s,t=D.tf.t;const m4=new T.Matrix4().set(R[0][0]*s,R[0][1]*s,R[0][2]*s,t[0],R[1][0]*s,R[1][1]*s,R[1][2]*s,t[1],R[2][0]*s,R[2][1]*s,R[2][2]*s,t[2],0,0,0,1);model.applyMatrix4(m4);}
  if(D.scale)model.scale.multiplyScalar(D.scale);
  const camo=D.paint?camoTex(D.paint):null,dark=std({color:0x1b1c1a,roughness:.85,metalness:.2});
  gl.scene.traverse(o=>{if(!o.isMesh)return;dequant(o.geometry);if(!o.geometry.attributes.normal)o.geometry.computeVertexNormals();if(D.flat)(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>{m.flatShading=true;m.needsUpdate=true;});o.castShadow=o.receiveShadow=true;
    if(camo){const big=(o.geometry.boundingSphere||{radius:1}).radius;o.material=/tyre|tire|wheel|rubber/i.test(o.name)?dark:std({map:camo,color:0xffffff,roughness:.72,metalness:.25});if(!o.geometry.attributes.uv)boxUV(o);}
    const ms=Array.isArray(o.material)?o.material:[o.material];ms.forEach(mm=>{if(!mm.isMeshStandardMaterial)return;mm.envMapIntensity=.85;if((D.bright||D.tint)&&!mm.__br){mm.__br=1;if(D.bright)mm.color.multiplyScalar(D.bright);if(D.tint)mm.color.multiply(new T.Color(D.tint[0],D.tint[1],D.tint[2]));}if(D.solid&&mm.map&&!mm.__sd){mm.__sd=1;mm.map=null;mm.color.setHex(D.solid);mm.needsUpdate=true;}if(D.nomip&&mm.map&&!mm.map.__nm){mm.map.__nm=1;mm.map.generateMipmaps=false;mm.map.minFilter=T.LinearFilter;mm.map.needsUpdate=true;}if(D.metal!=null&&mm.metalnessMap){mm.metalnessMap=null;mm.roughnessMap=null;mm.metalness=D.metal;mm.roughness=.72;mm.needsUpdate=true;}if(mm.roughness<.35&&!mm.transparent)mm.roughness=.45;if(mm.map)mm.map.anisotropy=8;});});
  veh.updateMatrixWorld(true);
  if(D.kb){try{const kg=kbBuild(D,seat,model);if(D.kbBox&&kg){model.attach(kg);veh.updateMatrixWorld(true);}}catch(e){console.warn('kb',id,e);}}
  let wheels=[];const rig=D.rig||{};const cs=[];
  if(rig.wheels){const w=rig.wheels;w.axles.forEach(x=>[-1,1].forEach(s=>cs.push({p:new T.Vector3(x,w.y,s*w.z),r:w.r,hw:(w.hw||.42)})));}
  if(rig.tracked)rig.tracked.forEach(([x,y,r])=>{const zz=D.trackZ||1.2;[-1,1].forEach(s=>cs.push({p:new T.Vector3(x,y,s*zz),r,hw:D.trackHW||.55,trk:1}));});
  if(!cs.length&&D.wauto&&!D.nospin){try{const aw=autoWheels(seat,model,D);if(aw)cs.push(...aw);}catch(e){console.warn('autoWheels',id,e);}}
  if(cs.length){try{wheels=splitWheels(seat,model,cs);}catch(e){console.warn('wheels',id,e);}}
  const box=new T.Box3().setFromObject(model);const c=box.getCenter(new T.Vector3());seat.rotation.y=PI;seat.position.set(c.x,-box.min.y,c.z);veh.updateMatrixWorld(true);const wbox=new T.Box3().setFromObject(seat);
  const S={id,D,veh,seat,model,wheels,box,wbox,L:Math.max(box.max.x-box.min.x,D.kb?wbox.max.x-wbox.min.x:0),W:Math.max(box.max.z-box.min.z,D.kb?wbox.max.z-wbox.min.z:0),H:Math.max(box.max.y-box.min.y,D.kb?wbox.max.y-wbox.min.y:0)};S.cOff=(wbox.min.x+wbox.max.x)/2-veh.position.x;S.cZ=(wbox.min.z+wbox.max.z)/2;try{kit(S);}catch(e){console.warn('kit',id,e);}try{gvMarks(S);}catch(e){console.warn('mk',id,e);}
  if(gl.animations&&gl.animations.length){S.mixer=new T.AnimationMixer(gl.scene);S.clip=gl.animations[0];S.act=S.mixer.clipAction(S.clip);S.act.clampWhenFinished=true;S.act.setLoop(T.LoopOnce,1);S.rest=[];gl.scene.traverse(o=>S.rest.push([o,o.position.clone(),o.quaternion.clone(),o.scale.clone()]));if(D.combat!=='hand'){S.act.play();S.act.paused=true;}
    S.park=D.clip?D.clip.raise[0]:0;if(D.combat!=='hand'){S.act.time=S.park;S.mixer.update(0);}}
  const tn=D.tel?nodeBy(gl.scene,D.tel.node):D.arm3d?nodeBy(gl.scene,D.arm3d.node):null;
  if(tn){tn.updateMatrixWorld(true);S.tel={n:tn,q:tn.quaternion.clone(),p:tn.position.clone(),pv:D.tel?new T.Vector3(D.tel.pivot[0],D.tel.pivot[1],tn.position.z):tn.position.clone(),elev:(D.tel?D.tel.elev:D.arm3d.elev)*PI/180};}
  const ao=new T.Mesh(new T.PlaneGeometry(1,1),new T.MeshBasicMaterial({map:G.aoTex,transparent:true,depthWrite:false,opacity:.9}));ao.rotation.x=-PI/2;ao.scale.set(S.L*1.25,S.W*1.7,1);ao.position.y=.015;ao.renderOrder=-1;veh.add(ao);
  G.models[id]=S;return S;}
/* ---------- HUD ---------- */
const gh={el:{},box:new T.Box3(),bt:0},gsvg=$('#gHolo svg'),SVGN='http://www.w3.org/2000/svg';
['dim','mass','spd','rng','eng','arm'].forEach(k=>{const d=document.createElement('div');d.className='hc hc-'+(k==='arm'?'eng hc-arm':k);$('#gHolo').append(d);const pl=document.createElementNS(SVGN,'polyline'),c=document.createElementNS(SVGN,'circle');c.setAttribute('r','3');gsvg.append(pl,c);gh.el[k]={d,pl,c,x:null,y:null};});gh.dimP=coDimG(gsvg);
function stars(v){let h='';for(let i=1;i<=5;i++)h+=`<i class="${v>=i?'f':v>=i-.5?'h':''}">★</i>`;return h;}
const ND='<i style="font:500 12px/1 var(--hx-ui);font-style:normal;color:#8fa3a8">н/д</i>';
function hudSet(id){const D=GV[id];
  $('#gName').firstChild.textContent=D.n.toUpperCase()+' ';{const nm=$('#gName');let f=$('#gFlag');if(!f){f=document.createElement('span');f.id='gFlag';f.className='nflag';nm.parentNode.insertBefore(f,nm);}f.innerHTML=flagSVG(D.origin);}$('#gTtl').textContent=D.note||'ЗСУ';
  $('#gCls').innerHTML='<i>▸</i>'+D.cls;$('#gOrg').innerHTML='<i>✓</i>'+flagSVG(D.origin)+D.org;
  $('#gFire').innerHTML=stars(D.r[0]);$('#gProt').innerHTML=stars(D.r[1]);['#gSpd','#gXc','#gRng'].forEach((s,i)=>$(s).style.width=Math.round(D.r[2+i]*100)+'%');
  $('#gIcon').innerHTML=`<path d="${GV_ICON[D.ic]}" fill="#7dff8a" fill-opacity=".85" stroke="#d9ffe0" stroke-width="1" fill-rule="evenodd"/>`;
  const i=GV_ORDER.indexOf(id),n=GV_ORDER.length;{const a=GV[GV_ORDER[(i+n-1)%n]],b=GV[GV_ORDER[(i+1)%n]];$('#gPrev').innerHTML=flagSVG(a.origin)+a.n;$('#gNext').innerHTML=flagSVG(b.origin)+b.n;}
  const E=gh.el,row=(k,v,u)=>`<span class="k">${k}</span><b>${v?v.replace(/^≈ /,'≈'):'—'}</b><i>${v?u:''}</i>`;
  E.dim.d.innerHTML=row('Довжина',D.L,'м')+row('Ширина',D.W,'м')+row('Висота',D.H,'м');
  E.mass.d.innerHTML=D.mass?`<span class="v">МАСА</span><div><b>${D.mass}<i class="u">т</i></b><small>${D.pay?'вантаж '+D.pay+' т':'бойова / спорядження'}</small></div>`:D.pay?`<span class="v">ВАНТАЖ</span><div><b>${D.pay}<i class="u">т</i></b><small>вантажопідйомність</small></div>`:'';
  E.spd.d.innerHTML=D.v?`<div class="t"><span>Макс.</span><span>швидкість</span></div><b>${D.v}<i>км/год</i></b>`:'';
  E.rng.d.innerHTML=(!D.rng&&!D.fire)?'':(!D.rng&&D.fire)?`<small>Дальність ураження</small><em>${D.fire}</em>`:`<small>Запас ходу, км</small>${D.rng||ND}`+(D.fire?`<em>Дальність ураження: ${D.fire}</em>`:'');
  E.eng.d.innerHTML=D.crew?`<div class="box"><span class="k">Екіпаж</span><b>${D.crew}</b></div>`:'';E.arm.d.innerHTML=`<div class="arm"><span class="k">${D.eqk||'Озброєння'}</span>${D.arm}</div>`;
  Object.values(E).forEach(o=>{o.d.style.display=o.d.innerHTML?'':'none';});gh.bt=0;}
const hv=new T.Vector3();
function proj(v,out){hv.copy(v);hv.project(camera);out.x=(hv.x*.5+.5)*W;out.y=(-hv.y*.5+.5)*H;out.z=hv.z;return out;}
function hudFrame(dt){const S=G.models[G.cur];const on=G.holo&&S&&$('#gLoad').hidden&&G.mode!=='reload'&&G.mode!=='drive';$('#gHolo').classList.toggle('off',!on);if(!on)return;
  if(G.mode==='park'){S.age=(S.age||0)+dt;const pa=S.ancN||0;if((pa===0&&S.age>.6)||(pa===1&&S.age>2.2)){S.ancN=pa+1;try{ancInit(S);}catch(e){console.warn('anc',e);}}}if(!S.anc){for(const k in gh.el){const o=gh.el[k];o.d.style.opacity=0;o.pl.style.opacity=o.c.style.opacity=0;}gh.dimP.style.opacity=0;return;}
  const vx=S.veh.position.x,side=camera.position.z>=S.cZ?1:-1,si=side>0?0:1;const pj=v=>proj(v.clone().add(new T.Vector3(vx,0,0)),{});
  const B0=(S.abox||S.wbox).clone();const c0=pj(new T.Vector3((B0.min.x+B0.max.x)/2,B0.max.y*.5,(B0.min.z+B0.max.z)/2));const dl=S.D||{};const dm=coDims(gh.dimP,pj,B0,side,1,[dl.L,dl.W,dl.H].map(v=>{const m=v==null?null:String(v).match(/^[≈~]?\s*[\d.,–-]+/);return m?m[0].replace(/\s/g,''):'';}),c0.x,c0.y);
  gh.ot=(gh.ot||0)-dt;const doOcc=gh.ot<=0;if(doOcc)gh.ot=.2;gh.occ=gh.occ||{};
  const items=[];for(const k of ['eng','arm','mass','spd','rng','dim']){const o=gh.el[k];if(!o.d.innerHTML){o.d.style.opacity=0;o.pl.style.opacity=o.c.style.opacity=0;continue;}
    let P,vis=true;if(k==='dim'){P=dm;}else{const cs=S.anc[k]&&S.anc[k][si];if(!cs){o.d.style.opacity=0;o.pl.style.opacity=o.c.style.opacity=0;continue;}gh.occ[k+si]=gh.occ[k+si]||{i:0,h:false};const st=gh.occ[k+si];
      if(doOcc&&S.D.noocc){st.i=0;st.h=false;}else if(doOcc){st.h=true;for(let i=0;i<cs.length;i++){const w=coW(cs[i]),rc=new T.Raycaster(),d=w.clone().sub(camera.position),dl=d.length();rc.set(camera.position,d.normalize());rc.far=dl;const h=rc.intersectObject(S.seat,true).filter(coVis);if(!(h.length&&h[0].distance<dl-.35)){st.i=i;st.h=false;break;}}}
      if(st.i>=cs.length)st.i=0;P=proj(coW(cs[st.i]),{});vis=!st.h;}
    vis=vis&&P.z<1&&P.x>0&&P.x<W&&P.y>0&&P.y<H;items.push({k,o,P,vis,fix:k==='dim'?'L':null});}
  const c=proj(new T.Vector3(vx+(S.cOff||0),B0.max.y*.5,S.cZ||0),{});
  window.__GW=[W,H,items.map(i=>i.k+':'+i.o.d.offsetWidth+'x'+i.o.d.offsetHeight+'@'+Math.round(i.P.x)+','+Math.round(i.P.y)+(i.vis?'':'H')).join(' ')];let rx=72;const tl=stage.querySelector('.ui-tools')||document.querySelector('#gFig .ui-tools');if(tl&&tl.offsetParent){const a=tl.getBoundingClientRect(),b=stage.getBoundingClientRect();if(a.width&&a.left>b.left+b.width*.5)rx=Math.max(rx,b.right-a.left+14);}
  coLayout(items,{W,H,cx:c.x,top:140,bot:H*.645,lx:22,rx,dt});window.__GW.push(items.map(i=>i.k+'='+i.o.d.style.transform+(i.o.left?'L':'R')).join(' '));}
let toastT=0;function status(s){$('#gStatus').textContent=s;}
function toast(s){const e=$('#gStatus');e.textContent=s;e.classList.add('toast');toastT=2;}
function cap(s){const e=$('#gCap');if(s){e.textContent=s;e.classList.add('on');}else e.classList.remove('on');}
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
/* ---------- керування ---------- */
const VKEYS=['Q','W','E','R','T','Y','U','I','O','P','[',']'],VCODES=['KeyQ','KeyW','KeyE','KeyR','KeyT','KeyY','KeyU','KeyI','KeyO','KeyP','BracketLeft','BracketRight'];
const MODES=[['park','Стоянка'],['orbit','Огляд'],['engine','Запуск двигуна'],['drive','Виїзд'],['combat','Бойове положення'],['reload','Заряджання']];
function chip(k,label){const b=document.createElement('button');b.type='button';b.className='chip';b.innerHTML=`<kbd>${k}</kbd><span>${label}</span>`;return b;}
function buildChips(){const rv=$('#gRowV'),rm=$('#gRowM');rv.innerHTML=rm.innerHTML='';{const oc=$('#gCats');if(oc)oc.remove();}G.vChips={};G.mChips={};
  GV_ORDER.forEach((id,i)=>{const b=chip(VKEYS[i]||String(i+1),flagSVG(GV[id].origin)+GV[id].n);b.onclick=()=>setVehicle(id);rv.append(b);G.vChips[id]=b;});
  {const cb=document.createElement('div');cb.className='g-cats';cb.id='gCats';GV_CATS.forEach(([k,l])=>{const b=document.createElement('button');b.type='button';b.dataset.cat=k;const n=k==='all'?GV_ORDER.length:GV_ORDER.filter(i=>GV[i].cat===k).length;b.innerHTML=`${l}<i>${n}</i>`;b.disabled=!n;b.onclick=()=>setCat(k);cb.append(b);});rv.before(cb);setCat('all',true);}
  MODES.forEach(([m,l],i)=>{const b=chip(i+1,l);b.onclick=()=>setMode(m);rm.append(b);G.mChips[m]=b;});}
function modeOk(m){const D=GV[G.cur];if(m==='combat')return !!D.combat;if(m==='reload')return !!D.reload;return true;}
function syncChips(){for(const id in G.vChips)G.vChips[id].classList.toggle('on',id===G.cur);
  for(const m in G.mChips){const ok=modeOk(m);G.mChips[m].classList.toggle('on',m===G.mode);G.mChips[m].disabled=!ok;G.mChips[m].style.opacity=ok?'':.35;G.mChips[m].title=ok?'':'Недоступно для цієї машини';}}
const MLABEL={park:'Стоянка',orbit:'Огляд · автообертання',engine:'Двигун запущено',drive:'Виїзд з боксу заднім ходом',combat:'Бойове положення',reload:'Заряджання'};
function setMode(m){if(!G.cur||!modeOk(m)){toast('Режим недоступний для цієї машини');return;}const S=G.models[G.cur];
  if(G.mode==='drive'&&m!=='drive'){G.drive.phase=0;}
  G.mode=m;G.engOn=(m==='engine'||m==='drive');G.combatWant=(m==='combat'||m==='reload')?1:0;
  if(m==='drive'){G.drive={x:S?S.veh.position.x:0,v:0,phase:1,t:0};}
  if(m==='reload'&&S&&S.act){const D=GV[G.cur];if(D.combat==='clip'){G.combat=1;applyCombat(S,1);}else{G.combat=G.combatWant=0;applyCombat(S,0);S.act.reset();S.act.play();}S.act.paused=false;S.act.time=0;S.act.timeScale=1;G.reload={t:0,dur:S.clip.duration};}
  else if(G.reload){G.reload=null;cap('');if(S&&S.D.combat==='hand')restRig(S);else if(S&&S.act){S.act.paused=true;applyCombat(S,G.combat);}}
  if(m!=='drive'&&S){S.veh.position.x=0;}
  status(MLABEL[m]);syncChips();}
async function setVehicle(id){if(!GV[id])return;G.want=id;$('#gLoad').hidden=false;G.ready=false;let S;
  try{S=await getModel(id);}catch(e){console.error('garage load',id,e);$('#gLoad').hidden=true;toast('Не вдалося завантажити модель');return;}
  if(G.want!==id)return;for(const k in G.models)if(G.models[k]!==S&&G.models[k].veh.parent)G.root.remove(G.models[k].veh);G.cur=id;G.root.add(S.veh);S.veh.position.x=0;
  resetState(S);hudSet(id);$('#gLoad').hidden=true;if(!modeOk(G.mode)||G.mode==='drive'||G.mode==='reload')G.mode='park';setMode(G.mode);
  G.camD=null;G.yaw=S.L>12?-(PI-.32):-(PI-.52);G.el=.07;placeLamps(S);G.ready=true;}
function restRig(S){if(!S.rest)return;S.act.stop();S.rest.forEach(([o,p,q,sc])=>{o.position.copy(p);o.quaternion.copy(q);o.scale.copy(sc);});}
function resetState(S){if(S.D.combat==='hand')restRig(S);else if(S.act){S.act.paused=true;S.act.time=S.park;S.mixer.update(0);}G.combat=G.combatWant=0;G.reload=null;cap('');applyCombat(S,0);S.wheels.forEach(w=>w.g.rotation.z=0);G.drive={x:0,v:0,phase:0,t:0};}
function applyCombat(S,k){const D=S.D;const e=k<.5?2*k*k:1-Math.pow(-2*k+2,2)/2;
  if(D.combat==='clip'&&S.act&&!G.reload){S.act.time=D.clip.raise[0]+(D.clip.raise[1]-D.clip.raise[0])*e;S.mixer.update(0);}
  if(S.tel){const a=S.tel.elev*e,q=new T.Quaternion().setFromAxisAngle(new T.Vector3(0,0,1),a);S.tel.n.quaternion.copy(q).multiply(S.tel.q);
    const d=S.tel.p.clone().sub(S.tel.pv).applyQuaternion(q).add(S.tel.pv);S.tel.n.position.copy(d);}}
function placeLamps(S){if(!G.hl){G.hl=[-1,1].map(s=>{const l=new T.SpotLight(0xfff0d0,0,40,.45,.5,1.2);G.root.add(l,l.target);return l;});
    G.hlGlow=new T.Points(new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute([0,0,0,0,0,0],3)),new T.PointsMaterial({map:G.glowTex,size:1.6,transparent:true,depthWrite:false,blending:T.AdditiveBlending,color:0xfff2cc,opacity:0}));G.root.add(G.hlGlow);}}
function input(){const cvs=renderer.domElement;let px=0,py=0;
  cvs.addEventListener('pointerdown',e=>{G.drag=true;px=e.clientX;py=e.clientY;cvs.setPointerCapture(e.pointerId);cvs.classList.add('drag');});
  cvs.addEventListener('pointermove',e=>{if(!G.drag)return;const dx=e.clientX-px,dy=e.clientY-py;px=e.clientX;py=e.clientY;G.yaw+=dx*.006;G.el=clamp(G.el+dy*.004,-.02,.95);G.yawV=dx*.006;if(G.mode==='orbit'){}});
  const up=()=>{G.drag=false;cvs.classList.remove('drag');};cvs.addEventListener('pointerup',up);cvs.addEventListener('pointercancel',up);
  cvs.addEventListener('wheel',e=>{e.preventDefault();G.zoom=clamp(G.zoom*(1+Math.sign(e.deltaY)*.08),.55,1.6);},{passive:false});
  const rel=d=>{const L=gvList(),i=L.indexOf(G.cur),n=L.length;if(!n)return;setVehicle(L[(i<0?(d>0?-1:0):i+d+n)%n]);};
  $('#gL').onclick=$('#gPrev').onclick=$('#gkL').onclick=()=>rel(-1);$('#gR').onclick=$('#gNext').onclick=$('#gkR').onclick=()=>rel(1);
  const holo=()=>{G.holo=!G.holo;$('#gkHolo').classList.toggle('on',G.holo);toast(G.holo?'ТТХ: показано':'ТТХ: приховано');};
  const lamp=()=>{G.lamps=!G.lamps;$('#gkLamp').classList.toggle('on',G.lamps);toast(G.lamps?'Фари: увімкнено':'Фари: вимкнено');};
  $('#gkHolo').onclick=holo;$('#gkLamp').onclick=lamp;
  addEventListener('keydown',e=>{if(!G.on||e.ctrlKey||e.metaKey||e.altKey||/INPUT|TEXTAREA/.test(document.activeElement&&document.activeElement.tagName))return;
    const vi=VCODES.indexOf(e.code);if(vi>=0&&GV_ORDER[vi]){setVehicle(GV_ORDER[vi]);e.preventDefault();return;}
    const mi=/^Digit([1-6])$/.exec(e.code);if(mi){setMode(MODES[+mi[1]-1][0]);e.preventDefault();return;}
    if(e.code==='ArrowLeft'){rel(-1);e.preventDefault();}else if(e.code==='ArrowRight'){rel(1);e.preventDefault();}else if(e.code==='Period'){holo();}else if(e.code==='KeyL'){lamp();}});
  buildChips();}
/* ---------- цикл ---------- */
const tgt=new T.Vector3(),cpos=new T.Vector3(),ex=new T.Vector3();let last=0,raf=0;
function step(dt){G.t+=dt;const S=G.models[G.cur];
  if(toastT>0){toastT-=dt;if(toastT<=0){$('#gStatus').classList.remove('toast');status(MLABEL[G.mode]);}}
  if(G.shafts)G.shafts.forEach(m=>m.material.uniforms.uT.value=G.t);
  if(G.dust){G.dust.rotation.y=Math.sin(G.t*.05)*.02;G.dust.position.y=Math.sin(G.t*.2)*.15;}
  if(G.hook)G.hook.position.y=-3.0+Math.sin(G.t*.4)*.04;
  updPuffs(dt);
  if(!S){return;}
  if(S.mixer&&G.reload){G.reload.t+=dt;S.mixer.update(dt);const L=GV_RELOAD[G.cur]||[];let c='';for(const [t,s] of L)if(G.reload.t>=t)c=s;
    cap(c?`Заряджання · ${c} · ${Math.min(100,Math.round(G.reload.t/G.reload.dur*100))}%`:'');if(G.reload.t>=G.reload.dur){G.reload=null;cap('');if(S.D.combat==='hand')restRig(S);G.mode=S.D.combat==='clip'?'combat':'park';G.combatWant=G.mode==='combat'?1:0;status('Заряджено');syncChips();}}
  else{const k=ease(G.combat,G.combatWant,1.4,dt);if(Math.abs(k-G.combat)>1e-4){G.combat=k;applyCombat(S,k);}}
  // рух
  let v=0;if(G.mode==='drive'){const d=G.drive;d.t+=dt;const xOut=HL+6-S.L*.5+S.L;
    if(d.phase===1){if(d.t>1.6){d.phase=2;d.t=0;}}else if(d.phase===2){d.v=Math.min(6,d.v+dt*2.2);d.x+=d.v*dt;if(d.x>xOut){d.phase=3;d.t=0;}}
    else if(d.phase===3){d.v=Math.max(0,d.v-dt*5);d.x+=d.v*dt;if(d.t>2.6){d.phase=4;d.t=0;}}
    else if(d.phase===4){const rem=d.x;d.v=-Math.min(3.2,Math.max(.4,rem*.7));d.x=Math.max(0,d.x+d.v*dt);if(d.x<=0){d.phase=5;d.t=0;d.v=0;}}
    else if(d.phase===5&&d.t>1){G.mode='park';G.engOn=false;status('Заїхала в бокс · стоянка');syncChips();}
    v=(d.phase===2||d.phase===3||d.phase===4)?d.v:0;S.veh.position.x=d.x;}
  S.wheels.forEach(w=>{w.g.rotation.z+=v*dt/w.r;});
  // двигун
  G.eng=ease(G.eng,G.engOn?1:0,2,dt);
  S.seat.position.y=-S.box.min.y+(G.eng>.05?Math.sin(G.t*61)*.004*G.eng+Math.sin(G.t*23)*.003*G.eng:0);
  if(G.eng>.1&&S.D.exh){const e=S.D.exh;ex.set(e[0],e[1],e[2]);S.seat.localToWorld(ex);
    if(Math.random()<dt*(18+Math.abs(v)*8)*G.eng)puff(ex,new T.Vector3(rnd(-.2,.2)-v*.3,rnd(.6,1.1),e[2]<0?-rnd(.2,.5):rnd(.2,.5)),.7*G.eng,.35,rnd(1.8,3),rnd(1.6,2.6),G.engOn&&G.eng<.6?0x2a2a28:0x8a8c8e);}
  // фари
  const hlOn=(G.lamps||G.engOn)?1:0;if(S.kit){S.kit.hlM.emissiveIntensity=ease(S.kit.hlM.emissiveIntensity,.15+hlOn*3.2,6,dt);S.kit.tlM.emissiveIntensity=.35+hlOn*1.6;}if(G.hl){const kh=S.kit&&S.kit.hl.length===2?S.kit.hl:null;const fx=(kh?kh[0][0]:S.wbox.min.x+.1)+S.veh.position.x,hy=kh?kh[0][1]:Math.min(1.4,S.H*.4);
    G.hl.forEach((l,i)=>{const s=i?1:-1;l.intensity=ease(l.intensity,hlOn*2.2,6,dt);l.position.set(fx,hy,kh?kh[i][2]:s*S.W*.32);l.target.position.set(fx-12,0,s*S.W*.4);});
    const p=G.hlGlow.geometry.attributes.position;p.setXYZ(0,fx-.05,hy,kh?kh[0][2]:-S.W*.32);p.setXYZ(1,fx-.05,hy,kh?kh[1][2]:S.W*.32);p.needsUpdate=true;G.hlGlow.material.opacity=G.hl[0].intensity/2.2*.9;}
  // камера
  if(G.mode==='orbit'&&!G.drag)G.yaw+=dt*.12;else if(!G.drag){G.yaw+=G.yawV;G.yawV*=Math.pow(.02,dt);}
  const hfv=2*Math.atan(Math.tan(camera.fov*PI/360)*camera.aspect),Rr=.5*Math.hypot(S.L,S.W);const R3=.5*Math.hypot(S.L,S.W,S.H),fit=R3/Math.sin(Math.min(hfv,camera.fov*PI/180)/2)*1.08;const base0=S.L>12?Rr/Math.tan(hfv/2)*1.38+Rr*.5:Math.max(S.L*1.05,S.H*2.2,7)+4.5;const base=(S.D.kb||S.H>3.2||S.L>9)?Math.max(base0,fit):base0;const tl=(S.D.tel||S.D.zoomC)?G.combat:0;G.camD=ease(G.camD||base*G.zoom,base*G.zoom*(1+.28*tl),4,dt);
  const vx=S.veh.position.x;const bc=vx+(S.cOff||0)-S.L*.12,bz=S.cZ||0;tgt.set(ease(tgt.x,bc,3,dt),S.H*.42+tl*2.2,ease(tgt.z,bz,3,dt));
  const d=G.camD;cpos.set(tgt.x+d*Math.cos(G.el)*Math.cos(G.yaw),tgt.y+d*Math.sin(G.el)+.8,tgt.z+d*Math.cos(G.el)*Math.sin(G.yaw));
  cpos.x=clamp(cpos.x,-HL+1.5,HL+20);cpos.z=clamp(cpos.z,-HW+1.2,HW-1.2);cpos.y=clamp(cpos.y,.5,WH-1.5);
  camera.position.copy(cpos);camera.lookAt(tgt);
  {const sc=vx+(S.cOff||0),R2=Math.max(S.L,S.W)*1.0+3;if(G.spot){G.spot.position.x=S.cOff||0;G.spot.scale.set(R2,R2,1);}if(G.top){G.top.position.set(sc,11.5,0);G.top.target.position.set(sc,0,0);G.top.angle=Math.min(.95,Math.atan((R2*.5)/11.5)*1.15);}}G.key.target.position.set(vx,.6,0);G.key2.target.position.set(vx,.6,0);G.key.position.set(vx-5,10,-6.5);G.key2.position.set(vx+4.5,10,6.5);
  hudFrame(dt);}
function loop(t){if(!G.on){raf=0;return;}raf=requestAnimationFrame(loop);const dt=Math.min(.05,(t-(last||t))/1000);last=t;step(dt);renderer.render(scene,camera);}
G.show=()=>{$('#gFig').hidden=false;if(!G.built)build();try{enLight();}catch(e){}G.on=true;resize();last=0;if(!raf)raf=requestAnimationFrame(loop);if(!G.cur&&!G.want)setVehicle(GV_ORDER[0]);};
G.hide=()=>{G.on=false;$('#gFig').hidden=true;};
G.set=setVehicle;G.setMode=setMode;G.step=(n=30,dt=1/30)=>{for(let i=0;i<n;i++)step(dt);renderer.render(scene,camera);};
function gvList(){return GV_ORDER.filter(i=>!G.cat||G.cat==='all'||GV[i].cat===G.cat);}
function setCat(k,quiet){G.cat=k;document.querySelectorAll('#gCats button').forEach(b=>b.classList.toggle('on',b.dataset.cat===k));
  for(const id in G.vChips){const c=G.vChips[id];c.hidden=!(k==='all'||GV[id].cat===k);}
  if(!quiet){const L=gvList();if(L.length&&!L.includes(G.cur))setVehicle(L[0]);toast('Категорія: '+(GV_CATS.find(c=>c[0]===k)||[,''])[1]);}}
G.setCat=setCat;
G.side='ua';
function setSide(sd){if(G.side===sd)return;G.side=sd;GV_ORDER=sd==='en'?EN_ORDER:UA_ORDER;GV_CATS=sd==='en'?EN_CATS:UA_CATS;document.body.classList.toggle('enemy',sd==='en');
  if(G.built){enLight();buildChips();syncChips();setVehicle(GV_ORDER[0]);}else{G.cur=null;}}
G.setSide=setSide;
function enLight(){const T=THREE;if(!G.scene)return;if(!G.enL){G.enL=new T.PointLight(0xff2a24,0,34,2);G.enL.position.set(-6,5.5,-7);G.scene.add(G.enL);G.enL2=new T.PointLight(0xff3a30,0,26,2);G.enL2.position.set(8,3,6);G.scene.add(G.enL2);}
  const on=G.side==='en';G.enL.intensity=on?1.4:0;G.enL2.intensity=on?.5:0;if(G.key){G.key.color.setHex(on?0xffd2c4:0xffe4c2);}}
})();
