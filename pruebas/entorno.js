/* Entorno común de las pruebas: carga index.html + app.js en jsdom con un
   Supabase simulado que guarda en memoria y apunta cada operación en
   `registro`, para poder comprobar qué se habría enviado al servidor.
   Sin red: nada sale de la máquina. */
const fs = require("fs"), path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const RAIZ = process.env.GORDITOS_DIR || path.join(__dirname, "..");
const leer = (f) => fs.readFileSync(path.join(RAIZ, f), "utf8");
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const LISTA = "11111111-1111-1111-1111-111111111111";

function contador(nombre) {
  let ok = 0, f = 0;
  return {
    c(x, msg) { if (x) ok++; else { f++; console.log("  FALLA:", msg); } },
    fin() { console.log(`${nombre}: ${ok} bien, ${f} fallos`); return f; }
  };
}

function crearSb(tablas, registro, respuestaFuncion, oyentes) {
  function consulta(tabla) {
    const q = { op: "select", filtros: [], cuerpo: null, unico: false };
    const api = {
      select() { return api; }, order() { return api; }, single() { q.unico = true; return api; },
      eq(k, v) { q.filtros.push([k, v]); return api; },
      update(b) { q.op = "update"; q.cuerpo = b; return api; },
      insert(b) { q.op = "insert"; q.cuerpo = b; return api; },
      upsert(b) { q.op = "upsert"; q.cuerpo = b; return api; },
      delete() { q.op = "delete"; return api; },
      then(bien, mal) {
        const filas = tablas[tabla] || (tablas[tabla] = []);
        const casa = (r) => q.filtros.every(([k, v]) => r[k] === v);
        let res;
        if (q.op === "select") res = { data: filas.filter(casa), error: null };
        else if (q.op === "update") {
          registro.push({ tabla, op: "update", cuerpo: JSON.parse(JSON.stringify(q.cuerpo)) });
          const fila = filas.find(casa);
          Object.assign(fila, JSON.parse(JSON.stringify(q.cuerpo)));
          res = { data: q.unico ? fila : [fila], error: null };
        } else if (q.op === "insert" || q.op === "upsert") {
          registro.push({ tabla, op: q.op, cuerpo: JSON.parse(JSON.stringify(q.cuerpo)) });
          const fila = Object.assign({ id: "nuevo-" + filas.length, created_at: new Date().toISOString() }, q.cuerpo);
          filas.push(fila); res = { data: fila, error: null };
        } else if (q.op === "delete") {
          registro.push({ tabla, op: "delete", filtros: q.filtros });
          for (let i = filas.length - 1; i >= 0; i--) if (casa(filas[i])) filas.splice(i, 1);
          res = { data: null, error: null };
        } else res = { data: null, error: null };
        return Promise.resolve(res).then(bien, mal);
      }
    };
    return api;
  }
  const canal = { on(ev, filtro, fn) { oyentes.push({ filtro, fn }); return canal; }, subscribe() { return canal; } };
  return {
    auth: {
      getSession: () => Promise.resolve({ data: { session: { user: { id: "u1", email: "yo@x.com" } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signInWithPassword: () => Promise.resolve({ data: {}, error: null }),
      signOut: () => Promise.resolve({})
    },
    from: consulta, channel: () => canal, removeChannel() {},
    rpc: () => Promise.resolve({ data: null, error: null }),
    functions: { invoke: (n, o) => { registro.push({ funcion: o.body }); return Promise.resolve({ data: respuestaFuncion(o.body), error: null }); } }
  };
}

/** Arranca la app con esas filas. Opciones:
 *  - respuestaFuncion(cuerpo): lo que devuelve la función «asistente».
 *  - versionPublicada: si se da, fetch(no-store) devuelve un index con ese ?v=.
 *  - marcas: filas de la tabla «marcas». */
async function montar(filas, o = {}) {
  const errores = [], registro = [], oyentes = [];
  const vc = new VirtualConsole(); vc.on("jsdomError", (e) => errores.push(e.message));
  const dom = new JSDOM(leer("index.html"), { url: "https://yo.github.io/gorditos/", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window;
  w.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {}, removeEventListener() {} });
  w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = function () {};
  w.__recargas = 0; w.__recargar = () => { w.__recargas++; };
  w.fetch = (u, op) => (o.versionPublicada && op && op.cache === "no-store")
    ? Promise.resolve({ ok: true, text: () => Promise.resolve('<script src="app.js?v=' + o.versionPublicada + '"></script>') })
    : Promise.reject(new Error("sin red en la prueba"));
  w.GORDITOS_CONFIG = { supabaseUrl: "https://abc.supabase.co", supabaseAnonKey: "sb_publishable_clave_de_prueba_larga" };
  const tablas = { listas: [{ id: LISTA, nombre: "Familia" }], miembros: [{ lista_id: LISTA, user_id: "u1", rol: "admin", email: "yo@x.com" }],
                   restaurantes: filas, marcas: o.marcas || [] };
  w.supabase = { createClient: () => crearSb(tablas, registro, o.respuestaFuncion || (() => ({})), oyentes) };
  // location.reload() no existe en jsdom: se cuenta en su lugar
  const app = leer("app.js").replace(/location\.reload\(\)/g, "window.__recargar()");
  try { w.eval(app); } catch (e) { errores.push("eval: " + e.message); }
  await espera(80);
  const d = w.document;
  return {
    w, d, registro, errores, tablas, oyentes,
    tarjeta: (nombre) => [...d.querySelectorAll("li.card")].find((li) => li.textContent.includes(nombre)),
    escribir(el, v) { el.value = v; el.dispatchEvent(new w.Event("input", { bubbles: true })); },
    async volverAPrimerPlano() {
      Object.defineProperty(d, "visibilityState", { get: () => "hidden", configurable: true });
      d.dispatchEvent(new w.Event("visibilitychange"));
      Object.defineProperty(d, "visibilityState", { get: () => "visible", configurable: true });
      d.dispatchEvent(new w.Event("visibilitychange"));
      await espera(40);
    }
  };
}

function boton(li, texto) { return [...li.querySelectorAll("button")].find((b) => b.textContent.trim() === texto); }

function fila(extra) {
  return Object.assign({ id: "r1", lista_id: LISTA, nombre: "Casa Dani", tipo: "Española", zona: "Salamanca", precio: 2, flag: "",
    carta: "", reserva: "", direccion: "Calle Ayala, 28", geo: null, horario: null, sedes: [], created_at: "2026-01-01T00:00:00Z" }, extra || {});
}

module.exports = { RAIZ, leer, espera, LISTA, contador, montar, boton, fila };
