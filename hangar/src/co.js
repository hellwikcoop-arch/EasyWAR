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
