/* Service worker: red primero para lo propio, copia sin red, librerías con SRI. */
const fs = require("fs"), vm = require("vm"), path = require("path");
const { RAIZ } = require("./entorno");
let ok = 0, fallos = 0;
function comprobar(c, msg) { if (c) ok++; else { fallos++; console.log("  FALLA:", msg); } }

class Resp {
  constructor(body, init = {}) { this.body = body == null ? "" : String(body); this.status = init.status == null ? 200 : init.status; this.ok = this.status >= 200 && this.status < 300; this.headers = init.headers || {}; this.redirected = !!init.redirected; this.type = init.type || "basic"; }
  text() { return Promise.resolve(this.body); }
  clone() { return new Resp(this.body, { status: this.status, headers: this.headers, redirected: this.redirected, type: this.type }); }
  static error() { const r = new Resp("", { status: 0 }); r.type = "error"; return r; }
}

function montar(opts) {
  const almacen = {};            // nombreCache -> Map(url -> Resp)
  const avisos = [];
  const pedidas = [];
  const oyentes = {};
  function cacheDe(n) {
    almacen[n] = almacen[n] || new Map();
    const m = almacen[n];
    const clave = (u, o) => { u = typeof u === "string" ? u : u.url; if (o && o.ignoreSearch) u = u.split("?")[0]; return u; };
    return {
      match(u, o) { const k = clave(u, o); for (const [kk, v] of m) { if ((o && o.ignoreSearch ? kk.split("?")[0] : kk) === k) return Promise.resolve(v.clone()); } return Promise.resolve(undefined); },
      put(u, r) { m.set(typeof u === "string" ? u : u.url, r); return Promise.resolve(); },
      addAll(l) { l.forEach(u => m.set("https://yo.github.io/gorditos/" + u.replace("./", ""), new Resp("x"))); return Promise.resolve(); }
    };
  }
  const ctx = {
    self: null, URL, Promise, setTimeout, clearTimeout, console, Response: Resp,
    caches: { open: n => Promise.resolve(cacheDe(n)), keys: () => Promise.resolve(Object.keys(almacen)), delete: n => { delete almacen[n]; return Promise.resolve(true); } },
    fetch: (u, init) => { pedidas.push({ u: typeof u === "string" ? u : u.url, init }); return opts.red(typeof u === "string" ? u : u.url, init); }
  };
  ctx.self = { location: { origin: "https://yo.github.io" }, addEventListener: (t, f) => { oyentes[t] = f; }, skipWaiting: () => Promise.resolve(), clients: { claim: () => Promise.resolve(), matchAll: () => Promise.resolve([{ postMessage: m => avisos.push(m) }]) } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(RAIZ, "sw.js"), "utf8"), ctx);
  function pedir(url, extra = {}) {
    let respuesta = null, esperas = [];
    const e = { request: Object.assign({ url, method: "GET", mode: "cors", cache: "default" }, extra), respondWith(p) { respuesta = p; }, waitUntil(p) { esperas.push(p); } };
    oyentes.fetch(e);
    return { respuesta, esperas: () => Promise.all(esperas.map(p => Promise.resolve(p).catch(() => {}))) };
  }
  return { almacen, avisos, pedidas, oyentes, pedir, cacheDe };
}
const PAG = "https://yo.github.io/gorditos/";
const espera = ms => new Promise(r => setTimeout(r, ms));
const CACHE = /var CACHE = "([^"]+)"/.exec(fs.readFileSync(path.join(RAIZ, "sw.js"), "utf8"))[1];

module.exports = async function () {
  // a) sin copia, red bien
  {
    const m = montar({ red: () => Promise.resolve(new Resp("<html>v22</html>")) });
    const p = m.pedir(PAG, { mode: "navigate" });
    const r = await p.respuesta; await p.esperas();
    comprobar(await r.text() === "<html>v22</html>", "a: sirve la red");
    comprobar(m.almacen[CACHE] && (await m.cacheDe(CACHE).match(PAG)).body === "<html>v22</html>", "a: guarda copia");
    comprobar(m.pedidas[0].init && m.pedidas[0].init.cache === "no-store", "a: salta caché HTTP");
  }
  // b) copia vieja, red nueva rápida -> sirve la NUEVA sin avisar
  {
    const m = montar({ red: () => Promise.resolve(new Resp("<html>v22</html>")) });
    await m.cacheDe(CACHE).put(PAG, new Resp("<html>v21</html>"));
    const p = m.pedir(PAG, { mode: "navigate" });
    const r = await p.respuesta; await p.esperas();
    comprobar(await r.text() === "<html>v22</html>", "b: con red sirve la versión nueva, no la guardada");
    comprobar((await m.cacheDe(CACHE).match(PAG)).body === "<html>v22</html>", "b: actualiza la copia");
    await espera(10);
    comprobar(m.avisos.length === 0, "b: no avisa (ya se está viendo la nueva)");
  }
  // c) copia vieja, red lenta (5 s) -> sirve la vieja a los 4 s, y luego avisa
  {
    const m = montar({ red: () => espera(5000).then(() => new Resp("<html>v22</html>")) });
    await m.cacheDe(CACHE).put(PAG, new Resp("<html>v21</html>"));
    const t0 = Date.now();
    const p = m.pedir(PAG, { mode: "navigate" });
    const r = await p.respuesta; const t = Date.now() - t0;
    comprobar(await r.text() === "<html>v21</html>", "c: red lenta -> copia guardada");
    comprobar(t >= 3900 && t < 4600, "c: espera ~4 s (" + t + ")");
    await p.esperas(); await espera(20);
    comprobar(m.avisos.length === 1 && m.avisos[0].tipo === "actualizacion", "c: avisa cuando llega la nueva");
    comprobar((await m.cacheDe(CACHE).match(PAG)).body === "<html>v22</html>", "c: guarda la nueva");
  }
  // c2) red lenta pero igual -> no avisa
  {
    const m = montar({ red: () => espera(4300).then(() => new Resp("<html>v21</html>")) });
    await m.cacheDe(CACHE).put(PAG, new Resp("<html>v21</html>"));
    const p = m.pedir(PAG, { mode: "navigate" });
    await p.respuesta; await p.esperas(); await espera(20);
    comprobar(m.avisos.length === 0, "c2: misma versión, sin aviso");
  }
  // d) sin red con copia -> copia inmediata
  {
    const m = montar({ red: () => Promise.reject(new TypeError("offline")) });
    await m.cacheDe(CACHE).put(PAG, new Resp("<html>v21</html>"));
    const t0 = Date.now();
    const p = m.pedir(PAG, { mode: "navigate" });
    const r = await p.respuesta;
    comprobar(await r.text() === "<html>v21</html>" && Date.now() - t0 < 200, "d: offline -> copia al momento");
  }
  // e) sin red y sin copia -> mensaje 503
  {
    const m = montar({ red: () => Promise.reject(new TypeError("offline")) });
    const r = await m.pedir(PAG, { mode: "navigate" }).respuesta;
    comprobar(r.status === 503 && /sin conexión/.test(await r.text()), "e: 503 explicativo");
  }
  // f) 404 de la red con copia -> copia
  {
    const m = montar({ red: () => Promise.resolve(new Resp("no", { status: 404 })) });
    await m.cacheDe(CACHE).put(PAG, new Resp("<html>v21</html>"));
    const r = await m.pedir(PAG, { mode: "navigate" }).respuesta;
    comprobar(await r.text() === "<html>v21</html>", "f: error del servidor -> copia");
  }
  // g) respuesta redirigida -> se sirve limpia
  {
    const m = montar({ red: () => Promise.resolve(new Resp("<html>v22</html>", { redirected: true })) });
    const r = await m.pedir(PAG + "index.html", { mode: "navigate" }).respuesta;
    comprobar(r.redirected === false && r.status === 200, "g: nunca sirve una respuesta 'redirected'");
  }
  // h) peticiones no-store -> no se interceptan
  {
    const m = montar({ red: () => Promise.resolve(new Resp("x")) });
    const p = m.pedir(PAG, { cache: "no-store" });
    comprobar(p.respuesta === null, "h: no-store pasa de largo");
  }
  // i) config.js: copia vieja, red nueva -> nueva
  {
    const m = montar({ red: () => Promise.resolve(new Resp("window.GORDITOS_CONFIG={k:'nueva'}")) });
    await m.cacheDe(CACHE).put(PAG + "config.js", new Resp("window.GORDITOS_CONFIG={k:'PEGA'}"));
    const p = m.pedir(PAG + "config.js", { mode: "no-cors" });
    const r = await p.respuesta; await p.esperas();
    comprobar(/nueva/.test(await r.text()), "i: config.js nuevo al momento");
    comprobar(/nueva/.test((await m.cacheDe(CACHE).match(PAG + "config.js")).body), "i: y se guarda");
  }
  // j) config.js sin red -> copia
  {
    const m = montar({ red: () => Promise.reject(new TypeError("offline")) });
    await m.cacheDe(CACHE).put(PAG + "config.js", new Resp("vieja"));
    const r = await m.pedir(PAG + "config.js").respuesta;
    comprobar(await r.text() === "vieja", "j: config.js offline -> copia");
  }
  // k) librería CDN con copia -> copia al instante
  {
    const m = montar({ red: () => espera(3000).then(() => new Resp("lib-nueva")) });
    const L = "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js";
    await m.cacheDe(CACHE).put(L, new Resp("lib"));
    const t0 = Date.now();
    const r = await m.pedir(L).respuesta;
    comprobar(await r.text() === "lib" && Date.now() - t0 < 200, "k: CDN desde la copia sin esperar");
  }
  // l) externos (Supabase, OSM) no se tocan
  {
    const m = montar({ red: () => Promise.resolve(new Resp("x")) });
    comprobar(m.pedir("https://abc.supabase.co/rest/v1/restaurantes").respuesta === null, "l: Supabase pasa de largo");
    comprobar(m.pedir("https://tile.openstreetmap.org/1/1/1.png").respuesta === null, "l: teselas pasan de largo");
  }
  // m) activate borra cachés antiguas
  {
    const m = montar({ red: () => Promise.resolve(new Resp("x")) });
    m.cacheDe("gorditos-v21"); m.cacheDe(CACHE);
    let p; m.oyentes.activate({ waitUntil: x => { p = x; } }); await p;
    comprobar(!m.almacen["gorditos-v21"] && m.almacen[CACHE], "m: borra gorditos-v21");
  }
  // n) copia opaca no vale para petición cors (SRI); 206 no se guarda
  {
    const L = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js";
    const m = montar({ red: () => Promise.resolve(new Resp("lib-cors")) });
    const op = new Resp("", { type: "opaque", status: 0 }); op.type = "opaque";
    await m.cacheDe(CACHE).put(L, op);
    const p = m.pedir(L, { mode: "cors" });
    const r = await p.respuesta; await p.esperas();
    comprobar(await r.text() === "lib-cors", "n: ignora la copia opaca en una petición cors");
    const m2 = montar({ red: () => Promise.resolve(new Resp("parcial", { status: 206 })) });
    const p2 = m2.pedir(L); await p2.respuesta; await p2.esperas();
    comprobar(!(await m2.cacheDe(CACHE).match(L)), "n: no guarda respuestas 206");
  }
  console.log(`sw.js: ${ok} bien, ${fallos} fallos`);
  return fallos;
};
