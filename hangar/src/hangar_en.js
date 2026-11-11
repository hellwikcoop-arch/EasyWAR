/* ---------- вкладка «Ворог» · авіація ПКС РФ / армійська авіація (статичні моделі, ліниве завантаження) ---------- */
const EN_ST=(()=>{const A=(file,name,len,H,nose,o)=>Object.assign({file:'aircraft-3d/'+file+'.glb',name,len,nose,cock:[len*.3,H*.5],top:[-len*.12,H*.62],en:1},o||{});
 return {
  esu25:A('a_su25','Су-25СМ3',15.53,4.8,'-x'),
  esu34:A('a_su34','Су-34',23.34,6.09,'+z'),
  esu35:A('a_su35','Су-35С',21.9,5.9,'-z'),
  esu30:A('a_su30','Су-30СМ',21.94,6.36,'+z'),
  esu27:A('a_su27','Су-27',21.94,5.93,'-z'),
  emig31:A('a_mig31','МіГ-31К',22.69,6.15,'+z'),
  etu22:A('a_tu22','Ту-22М3',42.46,11.05,'+z'),
  etu95:A('a_tu95r','Ту-95МС',49.13,13.3,'-x'),
  etu160:A('a_tu160','Ту-160',54.1,13.1,'+z'),
  ea50:A('a_a50','А-50У',46.59,14.76,'+z'),
  eil76:A('a_il76r','Іл-76МД',46.59,14.76,'-x'),
  emi28:A('a_mi28b','Мі-28Н',21.2,4.7,'+z',{heli:1,cock:[5.5,2.2],top:[-2,3.8]}),
  emi8:A('a_mi8','Мі-8АМТШ',25.24,5.65,'+z',{heli:1,cock:[6.5,2.4],top:[-2.5,4.6]}),
  emi35:A('a_mi35','Мі-35М',21.35,6.5,'-z',{heli:1,cock:[5.5,2.2],top:[-2,4.2]})};})();
Object.assign(ST_DEF,EN_ST);
Object.keys(EN_ST).forEach(k=>{MODELS[k]={root:null,canopy:null,mats:[],pick:[],ready:false,loading:false};LAY[k]=LAY.su;RIG[k]=[];});
