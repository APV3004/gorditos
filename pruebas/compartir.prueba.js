/* Compartir desde el menú de mantener pulsado: hoja del sistema, copia sin
   ella, cancelar sin error, y cadenas con todos sus locales. */
const E = require("./entorno");

module.exports = async function () {
  const k = E.contador("compartir");

  async function pulsarLargo(t, nombre) {
    const li = t.tarjeta(nombre);
    const ev = new t.w.Event("pointerdown", { bubbles: true });
    Object.assign(ev, { pointerType: "touch", clientX: 50, clientY: 50 });
    li.dispatchEvent(ev);
    await E.espera(400);
    const menu = t.d.getElementById("menu-contextual");
    return [...menu.querySelectorAll(".menu-item")].find((b) => b.textContent.trim() === "Compartir");
  }
  const aviso = (t) => { const x = t.d.getElementById("toast"); return x && !x.hidden ? t.d.getElementById("toast-text").textContent : ""; };

  // 1. Con navigator.share: todo en el texto y cada enlace con su etiqueta
  {
    const t = await E.montar([E.fila({ carta: "https://casadani.es/carta", reserva: "91 575 02 20" })]);
    let datos = null;
    t.w.navigator.share = (d) => { datos = d; return Promise.resolve(); };
    const b = await pulsarLargo(t, "Casa Dani");
    k.c(!!b, "1: el menú tiene «Compartir»");
    b.click(); await E.espera(30);
    k.c(datos && datos.title === "Casa Dani", "1: título = nombre");
    k.c(datos && /Española · Salamanca · €€/.test(datos.text), "1: tipo · zona · precio: " + (datos && datos.text));
    k.c(datos && datos.text.startsWith("🍽️ Casa Dani\n"), "1: empieza por el nombre");
    k.c(datos && datos.text.includes("📍 Calle Ayala, 28"), "1: con la dirección");
    k.c(datos && datos.text.includes("📖 Carta: https://casadani.es/carta"), "1: la carta, etiquetada");
    k.c(datos && datos.text.includes("📞 Reservas: 91 575 02 20"), "1: el teléfono de reservas, etiquetado");
    const llegar = datos && (datos.text.match(/🗺️ Cómo llegar: (\S+)/) || [])[1];
    k.c(llegar && /maps\.apple\.com|google\.com\/maps/.test(llegar) && llegar.includes(encodeURIComponent("Calle Ayala, 28")), "1: «Cómo llegar» con su enlace de mapa");
    k.c(datos && !datos.url, "1: sin url suelta, que saldría sin etiqueta");
    k.c(datos && !/^https?:/m.test(datos.text), "1: ninguna línea es un enlace sin etiqueta:\n" + (datos && datos.text));
    k.c(!t.errores.length, "1: sin errores: " + t.errores.join(" | "));
  }

  // 2. Cancelar la hoja (AbortError) no avisa ni copia
  {
    const t = await E.montar([E.fila()]);
    let copiado = null;
    t.w.navigator.share = () => Promise.reject(Object.assign(new Error("x"), { name: "AbortError" }));
    Object.defineProperty(t.w.navigator, "clipboard", { value: { writeText: (s) => { copiado = s; return Promise.resolve(); } }, configurable: true });
    (await pulsarLargo(t, "Casa Dani")).click(); await E.espera(30);
    k.c(copiado === null, "2: cancelar no copia");
    k.c(aviso(t) === "", "2: cancelar no avisa: " + aviso(t));
  }

  // 3. Sin navigator.share: copia texto + enlace y avisa «Copiado»
  {
    const t = await E.montar([E.fila()]);
    let copiado = null;
    delete t.w.navigator.share;
    Object.defineProperty(t.w.navigator, "clipboard", { value: { writeText: (s) => { copiado = s; return Promise.resolve(); } }, configurable: true });
    (await pulsarLargo(t, "Casa Dani")).click(); await E.espera(30);
    k.c(copiado && copiado.startsWith("🍽️ Casa Dani\n") && /Cómo llegar: \S*(maps\.apple\.com|google\.com\/maps)/.test(copiado), "3: copia el texto con el enlace: " + copiado);
    k.c(aviso(t) === "Copiado", "3: avisa «Copiado»: " + aviso(t));
  }

  // 4. Cadena: desde la tarjeta, todos los locales con su dirección y su mapa
  {
    const t = await E.montar([E.fila({ id: "r2", nombre: "Cadena", direccion: "", sedes: [
      { nombre: "Sol", zona: "Centro", direccion: "Calle Mayor 1", carta: "", reserva: "", geo: null, horario: null },
      { nombre: "Retiro", zona: "Retiro", direccion: "Calle Ibiza 3", carta: "", reserva: "", geo: null, horario: null }] })]);
    let datos = null;
    t.w.navigator.share = (d) => { datos = d; return Promise.resolve(); };
    (await pulsarLargo(t, "Cadena")).click(); await E.espera(30);
    k.c(datos && datos.text.includes("📍 Sol: Calle Mayor 1") && datos.text.includes("📍 Retiro: Calle Ibiza 3"), "4: lista los locales: " + (datos && datos.text));
    k.c(datos && (datos.text.match(/Cómo llegar: /g) || []).length === 2, "4: un «Cómo llegar» por local");
    k.c(datos && datos.text.includes("2 locales"), "4: dice cuántos locales");
  }

  return k.fin();
};
