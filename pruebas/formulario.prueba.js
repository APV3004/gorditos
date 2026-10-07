/* Formulario: campo «Horario» (manual), «Buscar en su web» y horarios por local. */
const E = require("./entorno");
const LISTA = E.LISTA;
module.exports = async function () {
  const k = E.contador("formulario y horarios");

  const filas = [
    { id: "r1", lista_id: LISTA, nombre: "Casa Dani", tipo: "Española", zona: "Salamanca", precio: 2, flag: "", carta: "https://casadani.es/carta", reserva: "", direccion: "Calle Ayala, 28",
      geo: { lat: 40.42, lng: -3.68, dir: "Calle Ayala, 28", v: 4 }, horario: { oh: "Mo-Su 09:00-17:00", t: Date.now() }, sedes: [], created_at: "2026-01-01" },
    { id: "r2", lista_id: LISTA, nombre: "Cadena", tipo: "Italiana", zona: "Centro", precio: 2, flag: "", carta: "", reserva: "", direccion: "", geo: null, horario: null,
      sedes: [{ nombre: "Sol", zona: "Centro", direccion: "Calle Mayor 1", carta: "https://cadena.es/carta", reserva: "", geo: null, horario: null }], created_at: "2026-01-02" },
  ];
  const t = await E.montar(filas, { respuestaFuncion: (b) => b.accion === "horario" ? { horario: "Tu-Su 13:00-16:00,20:00-23:30; Mo off", nota: "pie de la web", fuente: "https://www.casadani.es/" } : {} });
  const { w, d } = t;
  k.c(t.errores.length === 0, "arranca sin errores: " + t.errores.join(" | "));
  k.c(!!t.tarjeta("Casa Dani"), "pinta las tarjetas");

  // 1. editar: el horario automático se ve como pista, el campo vacío
  E.boton(t.tarjeta("Casa Dani"), "Editar").click(); await E.espera(20);
  const campo = d.getElementById("f-horario"), msg = d.getElementById("f-horario-msg");
  k.c(campo.value === "" && /OpenStreetMap: L-D 09:00-17:00/.test(msg.textContent), "muestra el automático como pista: " + msg.textContent);

  // 2. escribir mal -> no deja guardar
  t.escribir(campo, "abre por las tardes");
  k.c(/No lo entiendo/.test(msg.textContent), "avisa si no lo entiende");
  d.getElementById("panel").dispatchEvent(new w.Event("submit", { cancelable: true })); await E.espera(20);
  k.c(!t.registro.some(r => r.op === "update"), "con horario ilegible no guarda");
  k.c(campo.getAttribute("aria-invalid") === "true", "marca el campo");

  // 3. escribir bien -> guarda como manual
  t.escribir(campo, "M-D 13-16, 20-23:30; lunes cerrado");
  k.c(/^Entendido: M-D 13:00-16:00, 20:00-23:30; L cerrado/.test(msg.textContent), "previa: " + msg.textContent);
  d.getElementById("panel").dispatchEvent(new w.Event("submit", { cancelable: true })); await E.espera(30);
  let up = t.registro.filter(r => r.op === "update").pop();
  k.c(up && up.cuerpo.horario && up.cuerpo.horario.oh === "Tu-Su 13:00-16:00,20:00-23:30; Mo off" && up.cuerpo.horario.m === true, "guarda manual: " + JSON.stringify(up && up.cuerpo.horario));
  k.c(up && up.cuerpo.geo && up.cuerpo.geo.lat === 40.42, "conserva las coordenadas");

  // 4. reabrir -> el campo muestra el tuyo
  E.boton(t.tarjeta("Casa Dani"), "Editar").click(); await E.espera(20);
  k.c(campo.value === "M-D 13:00-16:00, 20:00-23:30; L cerrado", "al reabrir sale el tuyo: " + campo.value);
  // guardar sin tocar -> no cambia la fecha
  const tAntes = t.tablas.restaurantes[0].horario.t;
  d.getElementById("panel").dispatchEvent(new w.Event("submit", { cancelable: true })); await E.espera(30);
  k.c(t.tablas.restaurantes[0].horario.t === tAntes, "sin cambios conserva la fecha");

  // 5. borrar el campo -> vuelve el automático (horario null)
  E.boton(t.tarjeta("Casa Dani"), "Editar").click(); await E.espera(20);
  t.escribir(campo, "");
  d.getElementById("panel").dispatchEvent(new w.Event("submit", { cancelable: true })); await E.espera(30);
  up = t.registro.filter(r => r.op === "update").pop();
  k.c(up.cuerpo.horario === null, "al borrarlo se quita: " + JSON.stringify(up.cuerpo.horario));

  // 6. buscar en su web
  E.boton(t.tarjeta("Casa Dani"), "Editar").click(); await E.espera(20);
  d.getElementById("f-horario-web").click(); await E.espera(30);
  const llamada = t.registro.filter(r => r.funcion).pop();
  k.c(llamada && llamada.funcion.accion === "horario" && llamada.funcion.urls.indexOf("https://casadani.es/carta") !== -1, "llama a la función con su web: " + JSON.stringify(llamada && llamada.funcion));
  k.c(campo.value === "M-D 13:00-16:00, 20:00-23:30; L cerrado" && /Sacado de casadani\.es/.test(msg.textContent), "rellena el campo: " + campo.value + " | " + msg.textContent);
  d.getElementById("cancel-btn").click();

  // 7. local de una cadena
  E.boton(t.tarjeta("Cadena"), "Editar").click(); await E.espera(20);
  [...d.querySelectorAll("#sede-list .sede-editar")][0].click(); await E.espera(10);
  const cs = d.getElementById("f-sede-horario"), ms = d.getElementById("f-sede-horario-msg");
  t.escribir(cs, "L-V 12-16");
  k.c(/Entendido: L-V 12:00-16:00/.test(ms.textContent), "previa del local");
  d.getElementById("add-sede-btn").click(); await E.espera(10);
  k.c(cs.value === "", "limpia el campo del local tras guardarlo");
  d.getElementById("panel").dispatchEvent(new w.Event("submit", { cancelable: true })); await E.espera(30);
  up = t.registro.filter(r => r.op === "update").pop();
  k.c(up.cuerpo.sedes[0].horario && up.cuerpo.sedes[0].horario.oh === "Mo-Fr 12:00-16:00" && up.cuerpo.sedes[0].horario.m, "guarda el horario del local: " + JSON.stringify(up.cuerpo.sedes[0].horario));

  // 8. local con horario ilegible -> no se añade
  E.boton(t.tarjeta("Cadena"), "Editar").click(); await E.espera(20);
  [...d.querySelectorAll("#sede-list .sede-editar")][0].click(); await E.espera(10);
  k.c(cs.value === "L-V 12:00-16:00", "al editar el local sale su horario: " + cs.value);
  t.escribir(cs, "cuando le apetece");
  d.getElementById("add-sede-btn").click(); await E.espera(10);
  k.c(/No lo entiendo/.test(ms.textContent) && cs.value === "cuando le apetece", "local con horario ilegible no se guarda");
  d.getElementById("cancel-btn").click();

  // 9. sin web -> mensaje
  d.getElementById("open-add").click(); await E.espera(20);
  d.getElementById("f-horario-web").click(); await E.espera(10);
  k.c(/necesito su web/.test(msg.textContent), "sin web pide una: " + msg.textContent);

  // 10. el automático no pisa al manual
  k.c(/if \(h && h\.m\) return true;/.test(E.leer("app.js")), "horarioVigente respeta el manual");
  k.c(t.errores.length === 0, "sin errores: " + t.errores.join(" | "));
  return k.fin();
};
