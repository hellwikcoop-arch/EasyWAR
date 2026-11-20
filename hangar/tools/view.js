const p=require('puppeteer-core');const {createCanvas}=(()=>{try{return require('canvas')}catch(e){return {}}})();
(async()=>{const b=await p.launch({executablePath:'/usr/bin/google-chrome',headless:'new',args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
for(const a of process.argv.slice(2)){const [k,r,s,an]=a.split(':');const pg=await b.newPage();await pg.setViewport({width:1500,height:900});pg.on('console',m=>{if(/rror/.test(m.text()))console.log(k,m.text())});
await pg.goto(`http://localhost:8799/view.html?k=${k}&r=${r||'id'}&s=${s||1}${an?'&a='+an:''}`);await pg.waitForFunction('window.DONE',{timeout:120000});
// overlay grid in fractions: for side views x fraction from nose (+x is nose): u=0 at nose
await pg.evaluate(()=>{const cv=document.getElementById('c');const o=document.createElement('canvas');o.width=1500;o.height=900;o.style.cssText='position:absolute;left:0;top:0';document.body.append(o);const x=o.getContext('2d');x.font='12px sans-serif';
 const S=window.SIZE;for(const l of LAB){const L=l.ah==='x'?S[0]:S[2];const px=v=>l.x0+l.w/2+v/l.hw*l.w/2;const py=v=>l.y0+l.h/2-(v-S[1]/2)/l.hh*l.h/2;
  x.fillStyle='#fff';x.fillText(l.n,l.x0+6,l.y0+16);
  for(let i=0;i<=10;i++){const f=i/10;let wx=l.ah==='x'?(l.n==='L'?L/2-f*L:L/2-f*L):(-L/2+f*L);// L view: camera at -z looking +z: screen right = -x? handled by mirror below
   x.strokeStyle='rgba(255,255,0,.35)';x.beginPath();let sx=px(wx);if(l.n==='L')sx=l.x0+l.w-(sx-l.x0);if(l.n==='B')sx=l.x0+l.w-(sx-l.x0);x.moveTo(sx,l.y0);x.lineTo(sx,l.y0+l.h);x.stroke();x.fillStyle='#ff0';x.fillText(f.toFixed(1),sx+2,l.y0+l.h-4);
   const sy=py(f*S[1]);x.strokeStyle='rgba(0,255,255,.3)';x.beginPath();x.moveTo(l.x0,sy);x.lineTo(l.x0+l.w,sy);x.stroke();x.fillStyle='#0ff';x.fillText(f.toFixed(1),l.x0+2,sy-2);}}});
await pg.screenshot({path:`/tmp/v_${k}.png`});console.log(k,await pg.title());await pg.close();}
await b.close();})();
