/* Actualizaciones: al volver a primer plano mira el ?v= publicado y se
   recarga sola, salvo con una hoja abierta o escribiendo. */
const fs = require("fs"), path = require("path"), { JSDOM, VirtualConsole } = require("jsdom");
const E = require("./entorno");
let ok = 0, fallos = 0;
function comprobar(c, msg) { if (c) ok++; else { fallos++; console.log("  FALLA:", msg); } }
const html = E.leer("index.html");
let codigo = E.leer("app.js").replace(/location\.reload\(\)/g, "window.__recargar()");
const sinScripts = html;
const V = /src="app\.js\?v=(\d+)"/.exec(html)[1], V2 = String(+V + 1);
const espera = ms => new Promise(r => setTimeout(r, ms));

async function montar({ controlador = true, publicada = V, conSW = true } = {}) {
  const errores = [];
  const vc = new VirtualConsole(); vc.on("jsdomError", er => errores.push(er.message)); vc.on("error", er => errores.push(String(er)));
  const dom = new JSDOM(sinScripts, { url: "https://yo.github.io/gorditos/", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window;
  const r = { w, errores, recargas: 0, pedidas: [], swOyentes: {}, registrado: null, updates: 0, vis: "visible" };
  w.__recargar = () => { r.recargas++; };
  w.GORDITOS_CONFIG = {};
  w.matchMedia = w.matchMedia || (() => ({ matches: false, addEventListener() {}, addListener() {} }));
  w.scrollTo = () => {};
  Object.defineProperty(w.document, "visibilityState", { get: () => r.vis, configurable: true });
  w.fetch = (u, init) => { r.pedidas.push({ u, init }); return Promise.resolve({ ok: true, text: () => Promise.resolve('<html><body><script src="app.js?v=' + r.publicada + '"></script>') }); };
  r.publicada = publicada;
  if (conSW) {
    Object.defineProperty(w.navigator, "serviceWorker", { configurable: true, value: {
      controller: controlador ? {} : null,
      addEventListener: (t, f) => { r.swOyentes[t] = f; },
      register: (u, o) => { r.registrado = { u, o }; return Promise.resolve({ update: () => { r.updates++; return Promise.resolve(); } }); }
    }});
  }
  try { w.eval(codigo); } catch (er) { errores.push("eval: " + er.message); }
  w.dispatchEvent(new w.Event("load"));
  await espera(20);
  r.visible = async () => { r.vis = "hidden"; w.document.dispatchEvent(new w.Event("visibilitychange")); r.vis = "visible"; w.document.dispatchEvent(new w.Event("visibilitychange")); await espera(20); };
  return r;
}

module.exports = async function () {
  // 1. arranca sin errores y registra el SW sin caché HTTP
  {
    const r = await montar();
    comprobar(r.errores.length === 0, "1: sin errores al arrancar: " + r.errores.join(" | "));
    comprobar(r.registrado && r.registrado.u === "sw.js" && r.registrado.o.updateViaCache === "none", "1: registra sw.js con updateViaCache none");
  }
  // 2. vuelve a primer plano, hay versión nueva publicada, nada abierto -> recarga sola
  {
    const r = await montar({ publicada: V2 });
    await r.visible();
    const p = r.pedidas.find(x => x.init && x.init.cache === "no-store");
    comprobar(!!p && p.u === "https://yo.github.io/gorditos/", "2: pregunta la versión publicada con no-store");
    comprobar(r.updates === 1, "2: también comprueba sw.js");
    comprobar(r.recargas === 1, "2: recarga sola");
  }
  // 3. misma versión -> no recarga
  {
    const r = await montar({ publicada: V });
    await r.visible();
    comprobar(r.recargas === 0, "3: misma versión, no recarga");
  }
  // 5. escribiendo en un campo -> no recarga sola
  {
    const r = await montar({ publicada: V2 });
    r.w.document.getElementById("search").focus();
    await r.visible();
    comprobar(r.recargas === 0, "5: escribiendo, no recarga");
  }
  // 6. no pregunta más de una vez cada 30 s
  {
    const r = await montar({ publicada: V });
    await r.visible(); await r.visible(); await r.visible();
    comprobar(r.pedidas.filter(x => x.init && x.init.cache === "no-store").length === 1, "6: limita las comprobaciones");
  }
  // 7. controllerchange: con controlador previo recarga; en la primera visita no
  {
    const r = await montar({ controlador: true });
    r.swOyentes.controllerchange();
    comprobar(r.recargas === 1, "7: SW nuevo -> recarga");
    const r2 = await montar({ controlador: false });
    r2.swOyentes.controllerchange();
    comprobar(r2.recargas === 0, "7: primera visita -> no recarga");
  }
  // 8. mensaje del SW
  {
    const r = await montar();
    r.swOyentes.message({ data: { tipo: "actualizacion" } });
    comprobar(r.recargas === 1, "8: mensaje del SW -> recarga");
    r.swOyentes.message({ data: { tipo: "actualizacion" } });
    comprobar(r.recargas === 1, "8: nunca recarga dos veces");
  }
  // 9. sin service worker (navegador raro) sigue comprobando versión
  {
    const r = await montar({ conSW: false, publicada: V2 });
    comprobar(r.errores.length === 0, "9: sin SW arranca");
    await r.visible();
    comprobar(r.recargas === 1, "9: sin SW también detecta versión nueva");
  }
  // 10. HTML: supabase fijado y meta presente; redirección
  {
    comprobar(/supabase-js@2\.117\.2\/dist\/umd\/supabase\.js"\s+integrity="sha384-Rj26LVGvoeRVR6\+mwQmFfcR3QOBEwT\+ZmuCWpuiqeTzJpCs0ER4ITAWGb4Hiy3Ok"/.test(html), "10: supabase-js fijado con su hash");
    const red = E.leer("restaurantes-madrid.html");
    comprobar(/location\.replace\("\.\/"/.test(red) && /http-equiv="refresh" content="0; url=\.\/"/.test(red), "10: redirección a ./");
    const man = JSON.parse(E.leer("manifest.webmanifest"));
    comprobar(man.start_url === "./" && man.id === "./", "10: manifest start_url ./");
    const sw = E.leer("sw.js");
    const vHtml = /src="app\.js\?v=(\d+)"/.exec(html)[1], vSw = /gorditos-v(\d+)/.exec(sw)[1];
    comprobar(vHtml === vSw, "10: versión del HTML = versión del SW");
  }
  // 4 (ahora con hojas). Con la hoja de editar abierta no recarga: ofrece «Actualizar»
  {
    const t = await E.montar([E.fila()], { versionPublicada: V2 });
    E.boton(t.tarjeta("Casa Dani"), "Editar").click(); await espera(30);
    t.d.getElementById("f-nota").value = "a medio escribir";
    await t.volverAPrimerPlano();
    comprobar(t.w.__recargas === 0, "4: con la hoja abierta no recarga");
    comprobar(/versión nueva/.test(t.d.getElementById("toast-text").textContent), "4: ofrece Actualizar");
  }
  console.log(`actualizaciones: ${ok} bien, ${fallos} fallos`);
  return fallos;
};
