/* Borrar: dos pasos, borrado diferido mientras se ve el aviso y «Deshacer»
   sin perder nada (mismo id, fecha y marcas de todos). */
const E = require("./entorno");

module.exports = async function () {
  const k = E.contador("borrar");
  const ESPERA_AVISO = 7000;   // lo que dura el aviso con acción en avisar()

  function botonEliminar(t) {
    return [...t.tarjeta("Casa Dani").querySelectorAll(".card-actions button")]
      .find((b) => /Eliminar|Seguro/i.test(b.textContent));
  }
  async function eliminarConfirmando(t) {
    botonEliminar(t).click(); await E.espera(20);
    botonEliminar(t).click(); await E.espera(30);
  }

  // 1. Un toque no borra; el «¿Seguro?» caduca solo
  {
    const t = await E.montar([E.fila()]);
    botonEliminar(t).click(); await E.espera(30);
    k.c(!!t.tarjeta("Casa Dani"), "1: un toque no borra");
    k.c(/Seguro/.test(botonEliminar(t).textContent), "1: pide confirmación");
    await E.espera(5300);
    k.c(!/Seguro/.test(botonEliminar(t).textContent), "1: la confirmación caduca a los 5 s");
    botonEliminar(t).click(); await E.espera(30);
    k.c(!!t.tarjeta("Casa Dani"), "1: tras caducar, un toque vuelve a no borrar");
  }

  // 2. Confirmar y deshacer: no toca el servidor y las marcas siguen
  {
    const t = await E.montar([E.fila()], { marcas: [{ restaurante_id: "r1", user_id: "hermano", estado: "visitado" }] });
    await eliminarConfirmando(t);
    k.c(!t.tarjeta("Casa Dani"), "2: desaparece al momento");
    k.c(!t.registro.some((r) => r.op === "delete"), "2: aún no se borra en Supabase");
    const upd = t.oyentes.find((o) => o.filtro && o.filtro.event === "UPDATE" && o.filtro.table === "restaurantes");
    upd.fn({ eventType: "UPDATE", new: E.fila({ flag: "cambiado por otro" }) }); await E.espera(10);
    k.c(!t.tarjeta("Casa Dani"), "2: un cambio en tiempo real no lo resucita");
    t.d.getElementById("toast-action").click(); await E.espera(30);
    k.c(!!t.tarjeta("Casa Dani"), "2: «Deshacer» lo devuelve");
    k.c(!t.registro.some((r) => r.op === "delete" || r.op === "insert"), "2: sin borrar ni recrear nada");
    k.c(t.tablas.marcas.length === 1, "2: las marcas de los demás siguen");
    await E.espera(ESPERA_AVISO + 500);
    k.c(!t.registro.some((r) => r.op === "delete"), "2: tras deshacer, no se borra después");
  }

  // 3. Sin deshacer: se borra cuando se va el aviso
  {
    const t = await E.montar([E.fila()]);
    await eliminarConfirmando(t);
    await E.espera(ESPERA_AVISO - 500);
    k.c(!t.registro.some((r) => r.op === "delete"), "3: con el aviso a la vista aún no se borra");
    await E.espera(1000);
    const del = t.registro.find((r) => r.op === "delete");
    k.c(del && del.filtros[0][1] === "r1", "3: al irse el aviso se borra en Supabase");
  }

  // 4. App al fondo: se borra ya; «Deshacer» después recrea con mismo id y fecha
  {
    const t = await E.montar([E.fila()]);
    await eliminarConfirmando(t);
    Object.defineProperty(t.d, "visibilityState", { get: () => "hidden", configurable: true });
    t.d.dispatchEvent(new t.w.Event("visibilitychange")); await E.espera(20);
    k.c(t.registro.some((r) => r.op === "delete"), "4: al ir al fondo se borra al momento");
    Object.defineProperty(t.d, "visibilityState", { get: () => "visible", configurable: true });
    t.d.getElementById("toast-action").click(); await E.espera(30);
    const ins = t.registro.find((r) => r.op === "insert");
    k.c(ins && ins.cuerpo.id === "r1" && ins.cuerpo.created_at === "2026-01-01T00:00:00.000Z",
        "4: recrea con el mismo id y la misma fecha: " + JSON.stringify(ins && { id: ins.cuerpo.id, c: ins.cuerpo.created_at }));
    k.c(!!t.tarjeta("Casa Dani"), "4: vuelve a la lista");
    k.c(t.errores.length === 0, "sin errores: " + t.errores.join(" | "));
  }

  return k.fin();
};
