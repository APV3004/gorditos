/* Valoraciones (M3): puntuación y nota al marcar «Ya he ido», visibles para
   la lista, sin borrarse sin avisar, y la app igual que antes sin la migración. */
const E = require("./entorno");

module.exports = async function () {
  const k = E.contador("valoraciones");
  const miembros = [{ lista_id: E.LISTA, user_id: "u1", rol: "admin", email: "yo@x.com" },
                    { lista_id: E.LISTA, user_id: "u2", rol: "miembro", email: "ana@x.com" }];
  async function montar(marcas, o) {
    const t = await E.montar([E.fila(), E.fila({ id: "r2", nombre: "Bar Pepe", direccion: "Calle Luna, 2" })], Object.assign({ marcas, miembros }, o || {}));
    return t;
  }
  const btnMarca = (t, nombre, estado) => t.tarjeta(nombre).querySelector(".marca-btn." + estado);
  const aviso = (t) => { const x = t.d.getElementById("toast"); return x && !x.hidden ? t.d.getElementById("toast-text").textContent : ""; };
  const ultimo = (t, op) => t.registro.filter((r) => r.tabla === "marcas" && r.op === op).pop();

  // 1. Marcar «Ya he ido» ofrece «Valorar»; la hoja guarda puntuación y nota
  {
    const t = await montar([]);
    k.c(!!t.registro && t.d.querySelector('#sort option[value="valoracion"]').hidden === false, "1: con la migración se ofrece «Mejor valorados»");
    btnMarca(t, "Casa Dani", "visitado").click(); await E.espera(20);
    const acc = t.d.getElementById("toast-action");
    k.c(!acc.hidden && acc.textContent === "Valorar", "1: el aviso ofrece «Valorar»");
    acc.click(); await E.espera(20);
    const hoja = t.d.getElementById("panel-valorar");
    k.c(!hoja.hidden, "1: se abre la hoja de valorar");
    t.d.querySelectorAll("#pv-estrellas .estrella")[3].click();
    t.d.getElementById("pv-nota").value = "  pedir el cachopo ";
    t.d.getElementById("pv-guardar").click(); await E.espera(30);
    const up = ultimo(t, "upsert");
    k.c(up && up.cuerpo.estado === "visitado" && up.cuerpo.puntuacion === 4 && up.cuerpo.nota === "pedir el cachopo", "1: guarda 4 y la nota: " + JSON.stringify(up && up.cuerpo));
    const linea = t.tarjeta("Casa Dani").querySelector(".card-valoracion");
    k.c(linea && linea.textContent === "★ 4 · pedir el cachopo", "1: la tarjeta lo enseña al momento: " + (linea && linea.textContent));
    k.c(!t.errores.length, "1: sin errores: " + t.errores.join(" | "));
  }

  // 2. Las de los demás se ven (puntuación y nota) y llegan por tiempo real
  {
    const t = await montar([{ restaurante_id: "r1", user_id: "u2", estado: "visitado", puntuacion: 5, nota: "la terraza es ruidosa" }]);
    const ins = t.oyentes.find((o) => o.filtro && o.filtro.table === "marcas");
    const txt = [...t.tarjeta("Casa Dani").querySelectorAll(".card-otros")].map((p) => p.textContent).join(" | ");
    k.c(/Ya ha ido: ana ★5/.test(txt), "2: se ve su puntuación: " + txt);
    k.c(/ana: «la terraza es ruidosa»/.test(txt), "2: se ve su nota: " + txt);
    k.c(!t.tarjeta("Casa Dani").querySelector(".card-valoracion"), "2: su valoración no es la tuya (no se puede cambiar)");
    ins.fn({ eventType: "UPDATE", new: { restaurante_id: "r2", user_id: "u2", estado: "visitado", puntuacion: 2, nota: null } }); await E.espera(10);
    k.c(/ana ★2/.test(t.tarjeta("Bar Pepe").textContent), "2: una valoración nueva llega por tiempo real");
    // Orden «Mejor valorados»
    const sel = t.d.getElementById("sort");
    sel.value = "valoracion"; sel.dispatchEvent(new t.w.Event("change", { bubbles: true })); await E.espera(20);
    const orden = [...t.d.querySelectorAll("li.card")].map((li) => li.textContent.includes("Casa Dani") ? "Casa Dani" : "Bar Pepe");
    k.c(orden[0] === "Casa Dani" && orden[1] === "Bar Pepe", "2: «Mejor valorados» pone primero el de 5: " + orden.join(", "));
  }

  // 3. Desmarcar con valoración pide confirmación; sin confirmar, no se borra
  {
    const t = await montar([{ restaurante_id: "r1", user_id: "u1", estado: "visitado", puntuacion: 3, nota: "bien" }]);
    btnMarca(t, "Casa Dani", "visitado").click(); await E.espera(20);
    k.c(!ultimo(t, "delete"), "3: un toque no borra la marca");
    k.c(/borra tu valoración/.test(aviso(t)), "3: avisa: " + aviso(t));
    k.c(/★ 3/.test(t.tarjeta("Casa Dani").textContent), "3: la valoración sigue a la vista");
    t.d.getElementById("toast-action").click(); await E.espera(20);
    k.c(!!ultimo(t, "delete"), "3: confirmando, se quita");
    k.c(!t.tarjeta("Casa Dani").querySelector(".card-valoracion"), "3: y desaparece de la tarjeta");
  }

  // 4. Pasar a «Quiero ir» con valoración: también pide confirmar, y luego la borra
  {
    const t = await montar([{ restaurante_id: "r1", user_id: "u1", estado: "visitado", puntuacion: 3, nota: "" }]);
    btnMarca(t, "Casa Dani", "quiero").click(); await E.espera(20);
    k.c(!ultimo(t, "upsert"), "4: no cambia sin confirmar");
    t.d.getElementById("toast-action").click(); await E.espera(20);
    const up = ultimo(t, "upsert");
    k.c(up && up.cuerpo.estado === "quiero" && up.cuerpo.puntuacion === null && up.cuerpo.nota === null, "4: pasa a «Quiero ir» sin valoración: " + JSON.stringify(up && up.cuerpo));
  }

  // 5. Sin la migración: las marcas funcionan como hoy y no se ofrece valorar
  {
    const sinColumnas = (tabla, cols) => tabla === "marcas" && /puntuacion|nota/.test(cols) ? { code: "42703", message: "column marcas.puntuacion does not exist" } : null;
    const t = await montar([{ restaurante_id: "r1", user_id: "u1", estado: "quiero" }], { errorSelect: sinColumnas });
    k.c(!!btnMarca(t, "Casa Dani", "visitado"), "5: los botones de marcas siguen");
    k.c(t.d.querySelector('#sort option[value="valoracion"]').hidden, "5: no se ofrece «Mejor valorados»");
    btnMarca(t, "Bar Pepe", "visitado").click(); await E.espera(20);
    const up = ultimo(t, "upsert");
    k.c(up && !("puntuacion" in up.cuerpo) && !("nota" in up.cuerpo), "5: no manda columnas que no existen: " + JSON.stringify(up && up.cuerpo));
    k.c(t.d.getElementById("toast-action").hidden || t.d.getElementById("toast").hidden, "5: no ofrece «Valorar»");
    k.c(!t.tarjeta("Bar Pepe").querySelector(".card-valoracion"), "5: sin línea de valoración");
    k.c(!t.errores.length, "5: sin errores: " + t.errores.join(" | "));
  }

  return k.fin();
};
