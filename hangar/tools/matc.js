const p=require('puppeteer-core');
(async()=>{const b=await p.launch({executablePath:'/usr/bin/google-chrome',headless:'new',protocolTimeout:600000,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const pg=await b.newPage();await pg.goto('http://localhost:8799/EasyWAR_hangar.html#garage',{timeout:180000});
for(const id of process.argv[2].split(',')){await pg.evaluate(i=>GAR.set(i),id);await pg.waitForFunction(i=>GAR.ready&&GAR.cur===i,{timeout:120000},id);
console.log(id,JSON.stringify(await pg.evaluate(()=>{const S=GAR.models[GAR.cur];const o={};GAR.scene.traverse(m=>{if(m.isMesh&&m.material&&m.material.color&&GAR.models[GAR.cur].seat&&(()=>{let p=m;while(p){if(p===GAR.models[GAR.cur].seat)return 1;p=p.parent;}})()){const k=m.material.type+' '+m.material.color.getHexString()+' em'+(m.material.emissive?m.material.emissive.getHexString():'')+' mt'+m.material.metalness+' r'+m.material.roughness+(m.material.emissiveMap?' emap':'');o[k]=(o[k]||0)+1;}});return o;})));}
await b.close();})();
