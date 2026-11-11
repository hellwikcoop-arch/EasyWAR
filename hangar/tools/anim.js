const {NodeIO}=require('@gltf-transform/core');const {ALL_EXTENSIONS}=require('@gltf-transform/extensions');const {MeshoptDecoder}=require('meshoptimizer');
(async()=>{await MeshoptDecoder.ready;const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder});
for(const f of process.argv.slice(2)){const d=await io.read(f);const r=d.getRoot();console.log(f,r.listAnimations().map(a=>a.getName()+':'+a.listChannels().length+' '+a.listChannels().map(c=>c.getTargetNode().getName()+'.'+c.getTargetPath()).slice(0,12).join(',')));
const pr=n=>n.listChildren().map(c=>c.getName()+(c.listChildren().length?'('+pr(c)+')':'')).join(' ');console.log('  tree:',r.listScenes()[0].listChildren().map(n=>n.getName()+'('+pr(n)+')').join(' ').slice(0,500));}})();
