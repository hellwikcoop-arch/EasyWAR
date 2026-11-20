const {NodeIO}=require('@gltf-transform/core');const {ALL_EXTENSIONS}=require('@gltf-transform/extensions');const {MeshoptDecoder}=require('meshoptimizer');
(async()=>{await MeshoptDecoder.ready;const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder});
for(const f of process.argv.slice(2)){const d=await io.read(f);const r=d.getRoot();
console.log(f,'nodes:',r.listNodes().map(n=>n.getName()).join(',').slice(0,600));console.log('  mats:',r.listMaterials().map(m=>m.getName()+(m.getBaseColorTexture()?'[T]':'')).join(',').slice(0,300));}})();
