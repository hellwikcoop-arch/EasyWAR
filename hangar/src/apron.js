// розмітка підлоги ангара (замість перону), тло прозоре — під нею мокрий бетон
TEX.apron=groundTex(x=>{x.clearRect(0,0,2048,2048);
  x.strokeStyle='rgba(226,180,48,.85)';x.lineWidth=.16*K;x.beginPath();x.moveTo(PX(-GR),PY(0));x.lineTo(PX(7.4),PY(0));x.stroke();
  x.lineWidth=.32*K;x.beginPath();x.moveTo(PX(7.6),PY(-1.6));x.lineTo(PX(7.6),PY(1.6));x.stroke();
  x.strokeStyle='rgba(226,232,236,.38)';x.lineWidth=.12*K;[-10,10].forEach(z=>{x.beginPath();x.moveTo(0,PY(z));x.lineTo(2048,PY(z));x.stroke();});
  const haz=(x0,z0,w,h)=>{x.save();x.beginPath();x.rect(PX(x0),PY(z0),w*K,h*K);x.clip();for(let i=-20;i<40;i++){x.fillStyle=i%2?'rgba(20,20,20,.9)':'rgba(226,180,48,.85)';x.beginPath();const a=PX(x0)+i*.45*K;x.moveTo(a,PY(z0));x.lineTo(a+.45*K,PY(z0));x.lineTo(a+.45*K-h*K,PY(z0)+h*K);x.lineTo(a-h*K,PY(z0)+h*K);x.fill();}x.restore();};
  haz(-11.5,-10.6,7,.6);haz(4.5,9.9,7,.6);
  x.save();x.translate(PX(9.6),PY(0));x.rotate(PI/2);x.fillStyle='rgba(226,180,48,.55)';x.font=`700 ${2.2*K}px "Exo 2","IBM Plex Mono",monospace`;x.textAlign='center';x.fillText('05',0,0);x.restore();
  x.strokeStyle='rgba(200,70,55,.5)';x.lineWidth=.1*K;x.strokeRect(PX(-11),PY(6.2),4.2*K,2.4*K);for(let i=0;i<8;i++){x.beginPath();x.moveTo(PX(-11+i*.5),PY(8.6));x.lineTo(PX(-11+i*.5+1.1),PY(6.2));x.stroke();}});
TEX.apron.needsUpdate=true;
