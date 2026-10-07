/* Horarios escritos en español → formato OpenStreetMap, y su estado. */
const { leer } = require("./entorno");
module.exports = async function () {
const src=leer("app.js");
const ini=src.indexOf("  var DIAS = [\"Su\"");
const fin=src.indexOf("  function hhmm(");
const fin2=src.indexOf("  var HORARIO_REINTENTO_MS");
const codigo=src.slice(ini,fin2)+"\nmodule.exports={textoAHorario,osmATexto,textoHorario,interpretarHorario};";
const m={exports:{}}; new Function("module",codigo)(m);
const {textoAHorario,osmATexto,textoHorario}=m.exports;
let ok=0,f=0; const c=(x,msg)=>{if(x)ok++;else{f++;console.log("  FALLA:",msg)}};
const casos=[
 ["L-V 13-16, 20-23:30; S-D 13-24; lunes cerrado","Mo-Fr 13:00-16:00,20:00-23:30; Sa-Su 13:00-24:00; Mo off"],
 ["de lunes a viernes de 13:00 a 16:00 y de 20:00 a 23:30","Mo-Fr 13:00-16:00,20:00-23:30"],
 ["Todos los días 12-24","Mo-Su 12:00-24:00"],
 ["Lunes cerrado. Martes a domingo de 13 a 0","Tu-Su 13:00-24:00; Mo off"],
 ["13:00-16:00","Mo-Su 13:00-16:00"],
 ["X, J y V 20h-23h30","We,Th,Fr 20:00-23:30"],
 ["Mo-Fr 12:00-16:00; PH off","Mo-Fr 12:00-16:00; PH off"],
 ["24/7","24/7"],
 ["sábados y domingos 12.30-17","Sa,Su 12:30-17:00"],
 ["L-J 13-16; V-S 13-16, 20-1:30; D cerrado","Mo-Th 13:00-16:00; Fr-Sa 13:00-16:00,20:00-01:30; Su off"],
 ["lunes a domingo 24 horas","Mo-Su 00:00-24:00"],
];
for(const [e,esp] of casos){const r=textoAHorario(e);c(r.ok&&r.oh===esp,e+" -> "+JSON.stringify(r)+" (esperado "+esp+")");}
for(const e of ["abre por las tardes","lunes","L-V 25-26","solo con reserva","lunes cerrado"]) {const r=textoAHorario(e); c(r.ok===false,"debería fallar: "+e+" -> "+JSON.stringify(r));}
c(textoAHorario("  ").vacio,"vacío");
// ida y vuelta
for(const [,oh] of casos){ if(oh.indexOf("PH")>=0) continue; const t=osmATexto(oh); const r=textoAHorario(t); c(r.ok && r.oh.replace(/ /g,"")===oh.replace(/ /g,""), "ida y vuelta "+oh+" -> "+t+" -> "+JSON.stringify(r)); }
c(osmATexto("Mo-Fr 13:00-16:00,20:00-23:30; Sa,Su 13:00-24:00; Mo off")==="L-V 13:00-16:00, 20:00-23:30; S,D 13:00-24:00; L cerrado","texto");
// estado: martes 22:00 con L-V 13-16, 20-23:30 -> abierto, cierra 23:30
c(textoHorario("Mo-Fr 13:00-16:00,20:00-23:30; Mo off", new Date(2026,9,6,22,0))==="Abierto · cierra a las 23:30","estado martes noche");
c(/^Cerrado · abre/.test(textoHorario("Mo-Fr 13:00-16:00,20:00-23:30; Mo off", new Date(2026,9,5,14,0))),"lunes cerrado");
console.log(`horarios: ${ok} bien, ${f} fallos`); return f;
};
