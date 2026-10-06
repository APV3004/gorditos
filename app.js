(function () {
  "use strict";

  /* ============================================================
     0. Configuración de Supabase — vive en config.js, NO aquí
     ============================================================
     config.js define window.GORDITOS_CONFIG = { supabaseUrl, supabaseAnonKey }.
     Así este archivo se puede sustituir entero en cada actualización
     sin volver a pegar las claves. Sin config.js la app no tiene con
     quién hablar: enseña la última copia guardada, si la hay. */

  var CONFIG = (window.GORDITOS_CONFIG && typeof window.GORDITOS_CONFIG === "object") ? window.GORDITOS_CONFIG : {};

  // Tolerante con lo que se suele copiar mal del panel de Supabase:
  // la "API URL" con /rest/v1 al final, o una barra final de más.
  var SUPABASE_URL = texto(CONFIG.supabaseUrl).replace(/\/rest\/v1\/?$/i, "").replace(/\/+$/, "");
  var SUPABASE_ANON_KEY = texto(CONFIG.supabaseAnonKey);
  var CARTO_KEY = texto(CONFIG.cartoApiKey);     // opcional: mapas de CARTO (ver config.js)

  var SUPABASE_CONFIGURADO = /^https:\/\/[^\s]+$/.test(SUPABASE_URL) &&
                              SUPABASE_URL.indexOf("TU-PROYECTO") === -1 &&
                              SUPABASE_ANON_KEY.length > 20 &&
                              SUPABASE_ANON_KEY.indexOf("TU-CLAVE") === -1;

  /* ============================================================
     1. Almacenamiento local — ahora solo caché de lectura y prefs.
        La sesión de Supabase la gestiona su propio cliente por su
        cuenta (también en localStorage, con su propia clave).
     ============================================================ */

  var CLAVE_CACHE = "gorditos-cache-v5-";          // + id de lista: última copia vista de cada lista
  var CLAVE_LISTAS = "gorditos-listas-v1";         // tus listas y sus miembros, para poder abrir sin red
  var CLAVE_LISTA_ACTUAL = "gorditos-lista-actual-v1";
  var CLAVE_MARCAS = "gorditos-marcas-v1-";          // + id de lista: marcas vistas por última vez
  var CLAVE_FILTROS = "gorditos-filtros-v1";
  var CLAVE_TEMA = "gorditos-tema-v1";

  function leerCrudo(clave) {
    try { return localStorage.getItem(clave); } catch (e) { return null; }
  }
  function escribirCrudo(clave, valor) {
    try { localStorage.setItem(clave, valor); return true; } catch (e) { return false; }
  }
  function parsearJson(raw) {
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  /* ============================================================
     3. Utilidades
     ============================================================ */

  function $(id) { return document.getElementById(id); }

  // Safari en iOS no aplica :active si nadie escucha touchstart; sin esto
  // los botones no responden al tocar, solo al soltar.
  document.addEventListener("touchstart", function () {}, { passive: true });

  var menosMovimiento = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;

  // Lo que se despliega al pulsar baja un poco desde quien lo abre, con la
  // misma curva que los paneles. Solo se llama desde el clic: si fuera CSS
  // de entrada, se repetiría cada vez que la lista se vuelve a pintar.
  function aparecer(el) {
    if (!el || typeof el.animate !== "function") return;
    var quieto = menosMovimiento && menosMovimiento.matches;
    el.animate(quieto
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [{ opacity: 0, transform: "translateY(-6px)" }, { opacity: 1, transform: "none" }],
      { duration: 320, easing: "cubic-bezier(0.32, 0.72, 0, 1)" });
  }

  function desplazarA(el, opciones) {
    if (!el || typeof el.scrollIntoView !== "function") return;
    if (opciones && menosMovimiento && menosMovimiento.matches) opciones.behavior = "auto";
    try { el.scrollIntoView(opciones); } catch (e) { /* cosmético */ }
  }

  function texto(v) {
    if (typeof v === "string") return v.trim();
    if (v === null || v === undefined) return "";
    if (typeof v === "number" || typeof v === "boolean") return String(v).trim();
    return "";
  }

  function plano(s) {
    return texto(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  }

  function comparar(a, b) {
    return texto(a).localeCompare(texto(b), "es", { sensitivity: "base" });
  }

  function analizarUrl(valor) {
    var v = texto(valor);
    if (!v) return { href: "", valida: true, vacia: true };
    var candidata = v;
    // «www.ejemplo.com:8080/carta» es host:puerto, no un esquema: se le pone https://
    var tieneEsquema = /^[a-z][a-z0-9+.\-]*:/i.test(candidata) && !/^[^\/?#:]*:\d+(?:[\/?#]|$)/.test(candidata);
    if (!tieneEsquema) candidata = "https://" + candidata;
    try {
      var u = new URL(candidata);
      if (u.protocol !== "http:" && u.protocol !== "https:") return { href: v, valida: false };
      if (u.hostname.indexOf(".") === -1 || /\s/.test(u.hostname)) return { href: v, valida: false };
      return { href: u.href, valida: true, vacia: false };
    } catch (e) {
      return { href: v, valida: false };
    }
  }

  function analizarReserva(valor) {
    var v = texto(valor);
    if (!v) return { vacia: true, valida: true, tipo: "", href: "" };
    var digitos = v.replace(/\D/g, "");
    if (/^[+()\d\s.\-]+$/.test(v) && digitos.length >= 7 && digitos.length <= 15) {
      return { vacia: false, valida: true, tipo: "tel", href: "tel:" + v.replace(/[^\d+]/g, "") };
    }
    var an = analizarUrl(v);
    return { vacia: false, valida: an.valida, tipo: "url", href: an.href };
  }

  function esApple() {
    var ua = navigator.userAgent || "";
    var plat = navigator.platform || "";
    return /iPad|iPhone|iPod|Macintosh|Mac OS X/.test(plat + " " + ua);
  }

  function consultaMapa(d) {
    if (d.direccion) return d.direccion + ", Madrid";
    var z = texto(d.zona);
    if (/^Varias zonas/i.test(z) || /^Sin (confirmar|especificar)/i.test(z)) z = "";
    z = z.replace(/\([^)]*\)/g, " ").split("/")[0].replace(/\s+/g, " ").trim();
    return (z ? d.nombre + " " + z : d.nombre) + " Madrid";
  }

  function urlMapa(d) {
    var q = encodeURIComponent(consultaMapa(d));
    return esApple()
      ? "https://maps.apple.com/?q=" + q
      : "https://www.google.com/maps/search/?api=1&query=" + q;
  }

  /* ============================================================
     4. Normalización de registros (fila de Supabase ↔ objeto interno)
     ============================================================ */

  function normalizarRegistro(bruto) {
    var o = (bruto && typeof bruto === "object") ? bruto : {};
    var precio = parseInt(o.precio, 10);
    if (!(precio >= 1 && precio <= 3)) precio = 2;
    var carta = texto(o.carta || o.url || o.web || o.menu || o.enlace);
    var an = analizarUrl(carta);
    var res = analizarReserva(o.reserva || o.reservas || o.telefono);
    return {
      nombre: texto(o.nombre || o.name) || "Sin nombre",
      tipo: texto(o.tipo) || "Sin especificar",
      zona: texto(o.zona) || "Sin especificar",
      precio: precio,
      flag: texto(o.flag || o.nota),
      carta: an.vacia ? "" : an.href,
      reserva: res.vacia ? "" : (res.tipo === "url" && res.valida ? res.href : texto(o.reserva || o.reservas || o.telefono)),
      direccion: texto(o.direccion),
      geo: normalizarGeo(o.geo),
      horario: normalizarHorario(o.horario),
      sedes: normalizarSedes(o.sedes)
    };
  }

  /**
   * Coordenadas ya calculadas para una dirección concreta. Se guardan
   * junto con el texto de la dirección que se buscó ("dir"): si la
   * dirección cambia, las coordenadas dejan de valer solas, sin tener
   * que acordarse de borrarlas. { nf: true } = se buscó y no se encontró.
   */
  function normalizarGeo(g) {
    if (!g || typeof g !== "object") return null;
    var dir = texto(g.dir);
    if (!dir) return null;
    var extra = {};
    if (isFinite(Number(g.v)) && Number(g.v) > 0) extra.v = Number(g.v);
    if (isFinite(Number(g.t)) && Number(g.t) > 0) extra.t = Number(g.t);
    if (g.nf) return Object.assign({ dir: dir, nf: true }, extra);
    var lat = Number(g.lat), lng = Number(g.lng);
    if (!isFinite(lat) || !isFinite(lng)) return null;
    var geo = Object.assign({ lat: lat, lng: lng, dir: dir }, extra);
    if (g.aprox === "calle" || g.aprox === "nombre" || g.aprox === "dudoso") geo.aprox = g.aprox;
    if (typeof g.en === "string" && g.en.trim()) geo.en = g.en.trim().slice(0, 120);
    return geo;
  }

  // «clave»: la dirección, o «@nombre|zona» si se situó por el nombre.
  /** Horario tal como lo publica OpenStreetMap, con la fecha en que se miró. */
  function normalizarHorario(h) {
    if (!h || typeof h !== "object") return null;
    var t = Number(h.t);
    var salida = { t: isFinite(t) && t > 0 ? t : 0 };
    if (h.m) salida.m = true;              // escrito a mano: nunca lo pisa el automático
    if (h.nf) { salida.nf = true; return salida; }
    var oh = texto(h.oh);
    if (!oh) return null;
    salida.oh = oh.slice(0, 300);
    return salida;
  }

  function geoVigente(geo, clave) {
    return !!(geo && clave && geo.dir === clave);
  }

  function geoUtil(geo, clave) {
    return geoVigente(geo, clave) && !geo.nf;
  }

  /**
   * Una sede es un local físico del mismo restaurante, con su propia
   * dirección, carta y reserva. Si un restaurante tiene varias, la
   * tarjeta deja elegir a cuál ir antes de abrir cualquier enlace.
   */
  function normalizarSede(bruto) {
    var o = (bruto && typeof bruto === "object") ? bruto : {};
    var an = analizarUrl(texto(o.carta));
    var res = analizarReserva(texto(o.reserva));
    return {
      nombre: texto(o.nombre),
      zona: texto(o.zona),
      direccion: texto(o.direccion),
      carta: an.vacia ? "" : an.href,
      reserva: res.vacia ? "" : (res.tipo === "url" && res.valida ? res.href : texto(o.reserva)),
      geo: normalizarGeo(o.geo),
      horario: normalizarHorario(o.horario)
    };
  }

  function normalizarSedes(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.map(normalizarSede).filter(function (s) { return s.nombre; });
  }

  // Fila tal como la espera la tabla de Supabase (sin id: lo pone el servidor).
  function filaDesde(valores) {
    return {
      nombre: valores.nombre, tipo: valores.tipo, zona: valores.zona, precio: valores.precio,
      flag: valores.flag, carta: valores.carta, reserva: valores.reserva, direccion: valores.direccion,
      geo: valores.geo || null,
      horario: valores.horario || null,
      sedes: valores.sedes || []
    };
  }

  // Fila de Supabase → objeto interno que usa el resto de la app.
  function registroDesdeFila(fila) {
    var r = normalizarRegistro(fila);
    r.id = texto(fila.id);
    var creado = fila.created_at ? Date.parse(fila.created_at) : NaN;
    r.creado = isFinite(creado) ? creado : 0;
    r.actualizadoPor = texto(fila.updated_by);
    return r;
  }

  /* ============================================================
     6. Cliente de Supabase, sesión y sincronización
     ============================================================ */

  var sb = null;
  if (SUPABASE_CONFIGURADO && window.supabase && typeof window.supabase.createClient === "function") {
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }

  var data = [];               // restaurantes de la lista que se está viendo
  var soloLectura = false;     // sin conexión / sin sesión: no se puede escribir
  var canal = null;

  var listas = [];             // [{ id, nombre }]: las listas de las que eres miembro
  var miembros = [];           // [{ lista_id, user_id, rol, email }] de esas listas
  var listaActual = null;
  var miId = "", miEmail = "";

  // Marcas personales («quiero ir» / «ya he ido») de los restaurantes de
  // la lista actual: las tuyas y las de los demás miembros.
  var marcas = [];                 // [{ restaurante_id, user_id, estado }]
  var marcasDisponibles = false;   // falta la tabla en Supabase → no se enseñan
  var ETIQUETA_MARCA = { quiero: "Quiero ir", visitado: "Ya he ido" };

  function leerCache() {
    var arr = listaActual ? parsearJson(leerCrudo(CLAVE_CACHE + listaActual)) : null;
    return Array.isArray(arr) ? arr : [];
  }
  function guardarCache() {
    if (listaActual) escribirCrudo(CLAVE_CACHE + listaActual, JSON.stringify(data));
  }
  function guardarCacheListas() {
    escribirCrudo(CLAVE_LISTAS, JSON.stringify({ listas: listas, miembros: miembros, miId: miId }));
  }
  function leerCacheListas() {
    var c = parsearJson(leerCrudo(CLAVE_LISTAS));
    if (!c || !Array.isArray(c.listas)) return;
    listas = c.listas;
    miembros = Array.isArray(c.miembros) ? c.miembros : [];
    if (!miId && c.miId) miId = c.miId;
  }

  function upsertLocal(registro) {
    var i = data.findIndex(function (x) { return x.id === registro.id; });
    if (i === -1) data.push(registro); else data[i] = registro;
  }
  function quitarLocal(id) {
    var i = data.findIndex(function (x) { return x.id === id; });
    if (i !== -1) data.splice(i, 1);
  }

  function mostrarBanner(texto) {
    var b = $("sync-banner");
    if (!texto) { b.hidden = true; return; }
    b.textContent = texto;
    b.hidden = false;
  }

  // Toda fila nueva va a la lista que se está viendo.
  function conLista(fila) {
    return Object.assign({}, fila, { lista_id: listaActual });
  }

  /** Mantiene la lista elegida si sigue existiendo; si no, la última usada o la primera. */
  function elegirListaActual() {
    var ids = listas.map(function (l) { return l.id; });
    if (listaActual && ids.indexOf(listaActual) !== -1) return;
    var guardada = leerCrudo(CLAVE_LISTA_ACTUAL);
    listaActual = ids.indexOf(guardada) !== -1 ? guardada : (ids[0] || null);
  }

  function cargarListas() {
    return Promise.all([
      sb.from("listas").select("id,nombre").order("created_at", { ascending: true }),
      sb.from("miembros").select("lista_id,user_id,rol,email")
    ]).then(function (r) {
      if (r[0].error) throw r[0].error;
      if (r[1].error) throw r[1].error;
      listas = (r[0].data || []).map(function (l) {
        return { id: texto(l.id), nombre: texto(l.nombre) || "Sin nombre" };
      });
      miembros = (r[1].data || []).map(function (m) {
        return { lista_id: texto(m.lista_id), user_id: texto(m.user_id), rol: m.rol === "admin" ? "admin" : "miembro", email: texto(m.email) };
      });
      elegirListaActual();
      guardarCacheListas();
      pintarSelectorListas();
    });
  }

  function cargarTodo() {
    if (!listaActual) { data = []; soloLectura = false; mostrarBanner(null); return Promise.resolve(); }
    var pedida = listaActual;
    return sb.from("restaurantes").select("*").eq("lista_id", pedida).order("created_at", { ascending: true }).then(function (res) {
      if (res.error) throw res.error;
      if (pedida !== listaActual) return;       // cambiaste de lista mientras cargaba
      data = res.data.map(registroDesdeFila)
        .filter(function (d) { return !borradosPendientes[d.id]; });   // borrados aún en espera
      soloLectura = false;
      guardarCache();
      mostrarBanner(null);
      return cargarMarcas(pedida);
    });
  }

  function cargarMarcas(lista) {
    return sb.from("marcas").select("restaurante_id,user_id,estado").then(function (res) {
      if (lista !== listaActual) return;
      if (res.error) {
        // Sin la migración (tabla inexistente): la función se esconde, no falla.
        // Cualquier otro error es pasajero: se conserva lo que había.
        var c = String(res.error.code || "");
        if (res.status === 404 || c === "42P01" || c === "PGRST205" || c === "PGRST200") {
          marcasDisponibles = false;
          marcas = [];
        }
        return;
      }
      var ids = Object.create(null);
      data.forEach(function (d) { ids[d.id] = true; });
      marcas = (res.data || []).filter(function (m) { return ids[m.restaurante_id]; }).map(normalizarMarca);
      marcasDisponibles = true;
      escribirCrudo(CLAVE_MARCAS + lista, JSON.stringify(marcas));
    }).catch(function () { /* sin red ahora: se conservan las marcas que hubiera */ });
  }

  function quitarMarcaLocal(restId, userId) {
    marcas = marcas.filter(function (m) { return !(m.restaurante_id === restId && m.user_id === userId); });
  }

  function miMarca(d) {
    var m = marcas.filter(function (x) { return x.restaurante_id === d.id && x.user_id === miId; })[0];
    return m ? m.estado : "";
  }

  /** Marcas de los DEMÁS miembros actuales de la lista (alguien que ya se
   *  fue de la lista no debe seguir apareciendo). */
  function otrasMarcas(d) {
    var nombres = Object.create(null);
    miembros.forEach(function (m) {
      if (m.lista_id === listaActual && m.user_id !== miId) nombres[m.user_id] = m.email.split("@")[0] || m.email;
    });
    return marcas.filter(function (x) { return x.restaurante_id === d.id && nombres[x.user_id]; })
      .map(function (x) { return { quien: nombres[x.user_id], estado: x.estado }; });
  }

  /** Pulsar un botón ya marcado lo desmarca; si no, marca ese estado. */
  function cambiarMarca(d, estado) {
    if (requiereConexion()) return;
    var antes = miMarca(d);
    var nuevo = antes === estado ? "" : estado;
    var lista = listaActual;

    // Se ve al instante; si el servidor dice que no, se deshace.
    quitarMarcaLocal(d.id, miId);
    if (nuevo) marcas.push({ restaurante_id: d.id, user_id: miId, estado: nuevo });
    render();

    var peticion = nuevo
      ? sb.from("marcas").upsert({ restaurante_id: d.id, user_id: miId, estado: nuevo }, { onConflict: "restaurante_id,user_id" })
      : sb.from("marcas").delete().eq("restaurante_id", d.id).eq("user_id", miId);
    peticion.then(function (r) {
      if (r && r.error) throw r.error;
      escribirCrudo(CLAVE_MARCAS + listaActual, JSON.stringify(marcas));
    }).catch(function () {
      // Solo se deshace esta marca, y solo si seguimos en la misma lista.
      if (lista === listaActual) {
        quitarMarcaLocal(d.id, miId);
        if (antes) marcas.push({ restaurante_id: d.id, user_id: miId, estado: antes });
        render();
      }
      avisar("No se pudo guardar la marca. Revisa la conexión.");
    });
  }

  function normalizarMarca(m) {
    return { restaurante_id: texto(m.restaurante_id), user_id: texto(m.user_id),
             estado: m.estado === "visitado" ? "visitado" : "quiero" };
  }

  function suscribirTiempoReal() {
    if (!sb) return;
    if (canal) { sb.removeChannel(canal); canal = null; }
    if (!listaActual) return;
    var lista = listaActual;
    var filtro = "lista_id=eq." + lista;

    function alCambiar(payload) {
      if (lista !== listaActual) return;
      if (payload.eventType === "DELETE") {
        // Los borrados no pasan por las políticas ni se pueden filtrar:
        // llegan los de todas las listas, solo con el id. Si no es de
        // esta lista, no está en `data` y no pasa nada.
        quitarLocal(payload.old && payload.old.id);
      } else {
        var fila = payload.new || {};
        if (borradosPendientes[fila.id]) return;      // lo acabas de borrar: no lo resucites
        if (fila.lista_id && fila.lista_id !== lista) quitarLocal(fila.id);
        else upsertLocal(registroDesdeFila(fila));
      }
      guardarCache();
      refrescarFuentesChips();
      render();
    }

    canal = sb.channel("restaurantes-" + lista)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "restaurantes", filter: filtro }, alCambiar)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "restaurantes", filter: filtro }, alCambiar)
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "restaurantes" }, alCambiar)
      // Las marcas no tienen lista_id: las políticas ya solo mandan las de
      // tus listas, y aquí se descartan las de restaurantes que no ves.
      .on("postgres_changes", { event: "*", schema: "public", table: "marcas" }, function (payload) {
        if (lista !== listaActual || !marcasDisponibles) return;
        var fila = payload.eventType === "DELETE" ? (payload.old || {}) : (payload.new || {});
        quitarMarcaLocal(fila.restaurante_id, fila.user_id);
        if (payload.eventType !== "DELETE" && data.some(function (d) { return d.id === fila.restaurante_id; })) {
          marcas.push(normalizarMarca(fila));
        }
        escribirCrudo(CLAVE_MARCAS + lista, JSON.stringify(marcas));
        render();
      })
      .subscribe();
  }

  function modoSinConexion() {
    leerCacheListas();
    elegirListaActual();
    pintarSelectorListas();
    data = leerCache();
    var guardadas = listaActual ? parsearJson(leerCrudo(CLAVE_MARCAS + listaActual)) : null;
    marcas = Array.isArray(guardadas) ? guardadas.map(normalizarMarca) : [];
    marcasDisponibles = Array.isArray(guardadas);
    soloLectura = true;
  }

  function avisoSinListas() {
    if (!listas.length && !soloLectura) {
      mostrarBanner("Aún no estás en ninguna lista. Crea una en «Listas y ajustes» (el botón redondo de arriba), o pide a quien gestione una que te añada con tu email (" + miEmail + ").");
    }
  }

  function iniciarApp(sesion) {
    var usuario = (sesion && sesion.user) || {};
    miId = texto(usuario.id);
    miEmail = texto(usuario.email);
    $("login-screen").hidden = true;
    $("app-shell").hidden = false;

    // Lo último que se vio, al instante; si no hay nada guardado, tarjetas
    // de carga en vez de una lista vacía. Lo fresco llega después.
    leerCacheListas();
    elegirListaActual();
    pintarSelectorListas();
    data = leerCache();
    cargando = true;
    refrescarFuentesChips();
    render();

    // Solo un fallo al CARGAR cuenta como «sin conexión»; un error de pintado
    // no debe tirar los datos frescos por la copia guardada.
    cargarListas()
      .then(cargarTodo)
      .then(function () {
        cargando = false;
        suscribirTiempoReal();
        avisoSinListas();
        refrescarFuentesChips();
        render();
        procesarGeo();       // en segundo plano: cuando abras el mapa, ya estará todo situado
        procesarHorarios();
      }, function () {
        cargando = false;
        // Sin red ahora mismo: la última copia vista, sin permitir escribir.
        modoSinConexion();
        mostrarBanner(data.length
          ? "Sin conexión: viendo la última copia guardada. No se puede añadir ni editar hasta que vuelva."
          : "Sin conexión y sin ninguna copia guardada todavía. Conéctate al menos una vez.");
        refrescarFuentesChips();
        render();
      })
      .catch(function (e) { if (window.console) console.error(e); });
  }

  /** Enseña la lista actual: primero lo guardado (al instante), luego lo fresco. */
  function activarListaActual() {
    if (listaActual) escribirCrudo(CLAVE_LISTA_ACTUAL, listaActual);
    data = leerCache();
    var guardadas = listaActual ? parsearJson(leerCrudo(CLAVE_MARCAS + listaActual)) : null;
    marcas = Array.isArray(guardadas) ? guardadas.map(normalizarMarca) : [];
    if (!panel.hidden) cerrarPanel(false);
    cerrarTodasLasConfirmaciones();
    ultimoAzar = null;
    reiniciarEncuadre();
    pintarSelectorListas();
    pintarPanelListas();
    mostrarBanner(null);
    refrescarFuentesChips();
    render();
    if (!sb || soloLectura) return Promise.resolve();
    cargando = true;
    render();
    return cargarTodo().then(function () {
      cargando = false;
      suscribirTiempoReal();
      avisoSinListas();
      refrescarFuentesChips();
      render();
      procesarGeo();
    }).catch(function () { cargando = false; render(); });
  }

  function cambiarLista(id) {
    if (!id || id === listaActual) return;
    listaActual = id;
    activarListaActual();
  }

  function requiereConexion() {
    if (!soloLectura && sb && !listaActual) {
      avisar("Primero crea una lista (o pide que te añadan a una) en «Listas y ajustes».");
      return true;
    }
    if (soloLectura || !sb) {
      avisar("Sin conexión ahora mismo: no se puede guardar. Vuelve a intentarlo con red.");
      return true;
    }
    return false;
  }

  /* ============================================================
     7. Autenticación
     ============================================================ */

  function mostrarLogin(mensajeError) {
    if (hojaActiva) hojaActiva.cerrar(null, { inmediato: true });
    document.documentElement.classList.remove("titulo-compacto");
    $("app-shell").hidden = true;
    $("login-screen").hidden = false;
    var err = $("login-error");
    if (mensajeError) { err.textContent = mensajeError; err.hidden = false; }
    else { err.hidden = true; }
  }

  // Declarada como función normal (no IIFE) y llamada al final del script
  // (sección 18): necesita que `state`, las referencias del DOM y
  // render()/refrescarFuentesChips() ya estén inicializados, y esas
  // vienen en secciones posteriores de este mismo archivo.
  function conectarAuth() {
    if (!sb) {
      mostrarBanner(SUPABASE_CONFIGURADO
        ? "No se pudo cargar la conexión (revisa tu red). Viendo la última copia guardada."
        : "Falta configurar Supabase: revisa que config.js esté subido junto a index.html y tenga tu URL y tu clave.");
      $("login-screen").hidden = true;
      $("app-shell").hidden = false;
      modoSinConexion();
      refrescarFuentesChips();
      render();
      return;
    }

    $("login-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var email = $("login-email").value.trim();
      var pass = $("login-pass").value;
      var btn = $("login-btn");
      btn.disabled = true;
      sb.auth.signInWithPassword({ email: email, password: pass }).then(function (res) {
        btn.disabled = false;
        if (res.error) { mostrarLogin("No se pudo entrar: revisa el email y la contraseña."); return; }
        iniciarApp(res.data && res.data.session);
      }).catch(function () {
        btn.disabled = false;
        mostrarLogin("No se pudo conectar. Revisa tu conexión e inténtalo otra vez.");
      });
    });

    sb.auth.getSession().then(function (res) {
      if (res.data && res.data.session) iniciarApp(res.data.session);
      else mostrarLogin();
    }).catch(function () { mostrarLogin(); });
  }

  /* ============================================================
     8. Estado de la vista (filtros persistentes) — sin cambios
     ============================================================ */

  var etiquetaPrecio = { 1: "€", 2: "€€", 3: "€€€" };
  var nombrePrecio = { 1: "económico", 2: "precio medio", 3: "caro" };

  // Filtros múltiples: una lista de valores por grupo; vacía = sin filtrar.
  // Dentro de un grupo cuenta cualquiera («Chamberí o Malasaña»); entre
  // grupos, todos a la vez («…y además Italiana o Pizza»).
  var state = { search: "", zonas: [], tipos: [], precios: [], marcas: [], sort: "nombre", vista: "lista", abiertoAhora: false };

  function enFiltro(seleccion, valor) {
    return !seleccion.length || seleccion.indexOf(valor) !== -1;
  }

  (function restaurarFiltros() {
    var g = parsearJson(leerCrudo(CLAVE_FILTROS));
    if (!g || typeof g !== "object") return;
    // Acepta el formato nuevo (listas) y el antiguo (un solo valor, o «Todas»).
    function lista(nuevo, viejo, todos) {
      if (Array.isArray(nuevo)) return nuevo.filter(function (v) { return typeof v === "string" && v; });
      return typeof viejo === "string" && viejo && viejo !== todos ? [viejo] : [];
    }
    state.zonas = lista(g.zonas, g.zona, "Todas");
    state.tipos = lista(g.tipos, g.tipo, "Todos");
    state.precios = lista(g.precios, g.precio, "Todos");
    state.marcas = lista(g.marcas, null, "Todas");
    if (typeof g.sort === "string") state.sort = g.sort;
    if (g.vista === "mapa" || g.vista === "lista") state.vista = g.vista;
    state.abiertoAhora = g.abiertoAhora === true;
  })();

  function guardarFiltros() {
    escribirCrudo(CLAVE_FILTROS, JSON.stringify({
      zonas: state.zonas, tipos: state.tipos, precios: state.precios, marcas: state.marcas, sort: state.sort, vista: state.vista,
      abiertoAhora: state.abiertoAhora
    }));
  }

  var editandoId = null;
  var pendienteConfirmarDuplicado = false;
  var idsExpandidosBorrado = Object.create(null);
  var cargando = false;          // pidiendo datos frescos a Supabase
  var idsSedesAbiertas = Object.create(null);

  /* ============================================================
     9. Referencias del DOM
     ============================================================ */

  var panel = $("panel");
  var panelTitle = $("panel-title");
  var btnAbrir = $("open-add");
  var fNombre = $("f-nombre");
  var fTipo = $("f-tipo");
  var fZona = $("f-zona");
  var fPrecio = $("f-precio");
  var fCarta = $("f-carta");
  var fReserva = $("f-reserva");
  var fDireccion = $("f-direccion");
  var fNota = $("f-nota");
  var sedesDetails = $("sedes-details");
  var sedeListEl = $("sede-list");
  var fSedeNombre = $("f-sede-nombre");
  var fSedeZona = $("f-sede-zona");
  var fSedeDireccion = $("f-sede-direccion");
  var fSedeCarta = $("f-sede-carta");
  var fSedeReserva = $("f-sede-reserva");
  var fHorario = $("f-horario");
  var fSedeHorario = $("f-sede-horario");
  var msgHorario = $("f-horario-msg");
  var msgSedeHorario = $("f-sede-horario-msg");
  var errNombre = $("f-nombre-error");
  var avisoDup = $("f-dup-warn");
  var avisoCarta = $("f-carta-warn");
  var avisoReserva = $("f-reserva-warn");
  var btnGuardar = $("save-btn");
  var lista = $("list");
  var vacio = $("empty");
  var contador = $("result-count");
  var btnLimpiar = $("clear-filters");

  /* ============================================================
     10. Aviso flotante — sin cambios
     ============================================================ */

  var temporizadorToast = null;
  var temporizadorSalida = null;
  var toast, toastText, toastAction;
  function refsToast() {
    if (!toast) { toast = $("toast"); toastText = $("toast-text"); toastAction = $("toast-action"); }
    return !!(toast && toastText && toastAction);
  }
  function avisar(mensaje, accion) {
    if (!refsToast()) return;
    clearTimeout(temporizadorToast);
    toastText.textContent = mensaje;
    if (accion) {
      toastAction.textContent = accion.etiqueta;
      toastAction.hidden = false;
      toastAction.onclick = function () { ocultarToast(); accion.alPulsar(); };
    } else {
      toastAction.hidden = true;
      toastAction.onclick = null;
    }
    // Si estaba saliendo, se da la vuelta desde donde esté, sin saltos
    clearTimeout(temporizadorSalida);
    toast.classList.remove("saliendo");
    toast.hidden = false;
    temporizadorToast = setTimeout(ocultarToast, accion ? 7000 : 3200);
  }
  function ocultarToast() {
    clearTimeout(temporizadorToast);
    if (!refsToast()) return;
    toastAction.onclick = null;
    if (toast.hidden) return;
    // Sale por donde entró; se oculta del todo al acabar la transición
    toast.classList.add("saliendo");
    clearTimeout(temporizadorSalida);
    temporizadorSalida = setTimeout(function () {
      toast.hidden = true;
      toast.classList.remove("saliendo");
    }, 340);
  }


  /* ============================================================
     10 bis. Hojas inferiores
     Se abren desde abajo, siguen al dedo 1:1 y, al soltar, siguen con
     la velocidad del dedo hacia donde apunta el gesto. Las mueve un
     muelle (amortiguamiento + respuesta, como en iOS): si las agarras a
     medio camino, siguen desde donde estén, sin saltos.
     ============================================================ */

  function crearMuelle(alPintar) {
    var x = 0, v = 0, destino = 0, zeta = 1, respuesta = 0.35;
    var raf = 0, ultimo = 0, alLlegar = null;
    function paso(t) {
      var dt = Math.min(0.064, Math.max(0.001, (t - ultimo) / 1000));
      ultimo = t;
      var k = Math.pow(2 * Math.PI / respuesta, 2);   // rigidez (masa 1)
      var c = 4 * Math.PI * zeta / respuesta;         // amortiguamiento
      var n = Math.ceil(dt / 0.004), h = dt / n;
      for (var i = 0; i < n; i++) {
        v += (-k * (x - destino) - c * v) * h;
        x += v * h;
      }
      if (Math.abs(x - destino) < 0.5 && Math.abs(v) < 8) {
        x = destino; v = 0; raf = 0;
        alPintar(x);
        var f = alLlegar; alLlegar = null;
        if (f) f();
        return;
      }
      alPintar(x);
      raf = requestAnimationFrame(paso);
    }
    return {
      // Cambia el destino sin perder la velocidad que lleva
      ir: function (nuevo, opciones, fin) {
        destino = nuevo; zeta = opciones.zeta; respuesta = opciones.respuesta;
        if (typeof opciones.velocidad === "number") v = opciones.velocidad;
        alLlegar = fin || null;
        if (!raf) { ultimo = performance.now(); raf = requestAnimationFrame(paso); }
      },
      parar: function () {
        if (raf) cancelAnimationFrame(raf);
        raf = 0; alLlegar = null;
        return x;
      },
      fijar: function (valor) {
        if (raf) cancelAnimationFrame(raf);
        raf = 0; alLlegar = null; x = valor; v = 0;
        alPintar(x);
      },
      valor: function () { return x; }
    };
  }

  // Más allá del límite, el elemento sigue cada vez menos al dedo
  function gomaElastica(exceso, dimension) {
    var c = 0.55;
    return (exceso * dimension * c) / (dimension + c * Math.abs(exceso));
  }
  // Dónde acabaría lo lanzado, como la deceleración del scroll de iOS
  function proyectar(velocidad) {
    var d = 0.998;
    return (velocidad / 1000) * d / (1 - d);
  }

  var scrim = $("scrim");
  var envoltura = document.querySelector(".wrap");
  var hojaActiva = null;

  function crearHoja(el, opciones) {
    var cabeza = el.querySelector(".hoja-cabeza");
    var cuerpo = el.querySelector(".hoja-cuerpo");
    var altura = 0;
    var alCerrar = null;
    var velocidadSalida = 0;
    var fundido = null;
    var muelle = crearMuelle(pintar);
    var api;

    function quieto() { return !!(menosMovimiento && menosMovimiento.matches); }
    // Con «medio», la hoja abre a media pantalla y se sube a completa
    // arrastrando (o al escribir en ella). Posición = desplazamiento hacia abajo.
    function posMedia() {
      return opciones.medio ? Math.max(0, altura - Math.round(window.innerHeight * 0.55)) : 0;
    }

    function pintar(y) {
      el.style.transform = "translate3d(0," + y.toFixed(2) + "px,0)";
      var p = altura ? Math.max(0, Math.min(1, 1 - y / altura)) : 1;
      document.documentElement.style.setProperty("--progreso-hoja", p.toFixed(4));
    }

    function abrir() {
      if (hojaActiva && hojaActiva !== api) hojaActiva.cerrar(null, { inmediato: true });
      hojaActiva = api;
      alCerrar = null;
      if (fundido) { fundido.cancel(); fundido = null; }
      var estabaOculta = el.hidden;
      el.hidden = false;
      scrim.hidden = false;
      if (estabaOculta) {
        // El fondo se echa atrás desde el centro de lo que se está viendo
        envoltura.style.transformOrigin = "50% " +
          Math.round(window.scrollY + window.innerHeight / 2 - envoltura.offsetTop) + "px";
        cuerpo.scrollTop = 0;
        cabeza.classList.remove("con-scroll");
      }
      document.documentElement.classList.add("hoja-abierta");
      envoltura.classList.add("empujada");
      envoltura.inert = true;
      altura = el.offsetHeight;
      if (quieto()) {
        muelle.fijar(posMedia());
        if (estabaOculta && el.animate) el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
        return;
      }
      if (estabaOculta) muelle.fijar(altura);
      muelle.ir(estabaOculta ? posMedia() : Math.min(muelle.valor(), posMedia()), { zeta: 1, respuesta: 0.38 });
    }

    function terminar() {
      fundido = null;
      el.hidden = true;
      el.style.transform = "";
      el.style.top = ""; el.style.bottom = "";
      el.classList.remove("con-teclado");
      if (hojaActiva === api) {
        hojaActiva = null;
        scrim.hidden = true;
        document.documentElement.classList.remove("hoja-abierta");
        document.documentElement.style.setProperty("--progreso-hoja", "0");
        envoltura.classList.remove("empujada");
        envoltura.inert = false;
        envoltura.style.transformOrigin = "";
      }
      var f = alCerrar; alCerrar = null;
      if (f) f();
    }

    // alTerminar solo se llama si la hoja llega a cerrarse: si alguien la
    // vuelve a abrir o la agarra a medio camino, se descarta.
    function cerrar(alTerminar, op) {
      alCerrar = alTerminar || null;
      var v = velocidadSalida; velocidadSalida = 0;
      if ((op && op.inmediato) || el.hidden) { muelle.parar(); if (fundido) fundido.cancel(); terminar(); return; }
      altura = el.offsetHeight;
      if (quieto()) {
        muelle.parar();
        document.documentElement.style.setProperty("--progreso-hoja", "0");
        if (!el.animate) { terminar(); return; }
        fundido = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: "forwards" });
        fundido.onfinish = function () { if (fundido) { fundido.cancel(); terminar(); } };
        return;
      }
      muelle.ir(altura, { zeta: 1, respuesta: 0.32, velocidad: v }, terminar);
    }

    /* ---- Arrastre ---- */
    var arrastre = null;
    function empezar(y) {
      if (fundido) return;
      alCerrar = null;
      altura = el.offsetHeight;
      arrastre = { inicio: y, base: muelle.parar(), muestras: [{ y: y, t: performance.now() }] };
      el.classList.add("arrastrando");
    }
    function mover(y) {
      var bruto = arrastre.base + (y - arrastre.inicio);
      muelle.fijar(bruto < 0 ? -gomaElastica(-bruto, altura) : bruto);
      var ahora = performance.now();
      arrastre.muestras.push({ y: y, t: ahora });
      while (arrastre.muestras.length > 2 && ahora - arrastre.muestras[0].t > 100) arrastre.muestras.shift();
    }
    function soltar() {
      var m = arrastre.muestras, a = m[0], b = m[m.length - 1];
      var dt = b.t - a.t;
      var v = dt > 8 ? (b.y - a.y) / dt * 1000 : 0;     // px/s, hacia abajo positivo
      if (performance.now() - b.t > 80) v = 0;          // se paró antes de soltar
      arrastre = null;
      el.classList.remove("arrastrando");
      // Se proyecta adónde iría a parar el lanzamiento y se elige el punto
      // de anclaje más cercano a esa proyección (completa, media o cerrada)
      var proyectado = muelle.valor() + proyectar(v);
      var anclas = opciones.medio ? [0, posMedia(), altura] : [0, altura];
      var destino = anclas[0];
      for (var i = 1; i < anclas.length; i++) {
        if (Math.abs(anclas[i] - proyectado) < Math.abs(destino - proyectado)) destino = anclas[i];
      }
      if (destino === altura) {
        velocidadSalida = v;
        opciones.alDescartar();
      } else {
        // Va a su sitio con la velocidad del dedo y un leve rebote
        muelle.ir(destino, { zeta: 0.8, respuesta: 0.3, velocidad: v });
      }
    }

    // Desde la cabecera, siempre (punteros: dedo, ratón o lápiz)
    cabeza.addEventListener("pointerdown", function (e) {
      if (e.button !== 0 || e.target.closest("button, a, input, select, textarea")) return;
      try { cabeza.setPointerCapture(e.pointerId); } catch (err) {}
      empezar(e.clientY);
    });
    cabeza.addEventListener("pointermove", function (e) { if (arrastre) mover(e.clientY); });
    cabeza.addEventListener("pointerup", function () { if (arrastre) soltar(); });
    cabeza.addEventListener("pointercancel", function () { if (arrastre) soltar(); });

    // Desde el contenido, solo tirando hacia abajo cuando ya está arriba del todo
    var toque = null;
    cuerpo.addEventListener("touchstart", function (e) {
      toque = e.touches.length === 1
        ? { x: e.touches[0].clientX, y: e.touches[0].clientY, arriba: cuerpo.scrollTop <= 0, suelta: muelle.valor() > 1 }
        : null;
    }, { passive: true });
    cuerpo.addEventListener("touchmove", function (e) {
      if (!toque) return;
      var t = e.touches[0];
      if (arrastre) { e.preventDefault(); mover(t.clientY); return; }
      var dy = t.clientY - toque.y, dx = t.clientX - toque.x;
      if (toque.suelta) {                       // a media altura: subir o bajar la hoja
        if (Math.abs(dy) < 10 && Math.abs(dx) < 10) { e.preventDefault(); return; }
        if (Math.abs(dx) > Math.abs(dy)) { toque = null; return; }
        e.preventDefault();
        empezar(t.clientY);
        return;
      }
      if (!toque.arriba || cuerpo.scrollTop > 0 || dy < 0 || Math.abs(dx) > Math.abs(dy)) {
        if (Math.abs(dy) > 10 || Math.abs(dx) > 10) toque = null;
        return;
      }
      e.preventDefault();                       // que no rebote el scroll de dentro
      if (dy >= 10) empezar(t.clientY);         // umbral de 10 px antes de decidir
    }, { passive: false });
    function finToque() { toque = null; if (arrastre) soltar(); }
    cuerpo.addEventListener("touchend", finToque);
    cuerpo.addEventListener("touchcancel", finToque);

    // Borde de desplazamiento: la cabecera solo se separa si hay algo debajo
    cuerpo.addEventListener("scroll", function () {
      cabeza.classList.toggle("con-scroll", cuerpo.scrollTop > 0);
    }, { passive: true });

    el.addEventListener("focusin", function (e) {
      if (opciones.medio && !arrastre && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) && muelle.valor() > 1) {
        muelle.ir(0, { zeta: 1, respuesta: 0.35 });
      }
    });

    api = { el: el, abrir: abrir, cerrar: cerrar, descartar: function () { opciones.alDescartar(); } };
    return api;
  }

  // Con el teclado abierto, iOS no encoge la página: solo la parte visible
  // (visualViewport). La hoja se ajusta a esa parte para que el campo en
  // el que escribes no quede debajo del teclado.
  if (window.visualViewport) {
    var vv = window.visualViewport;
    var ajustarAlTeclado = function () {
      if (!hojaActiva) return;
      var el = hojaActiva.el;
      var tapado = window.innerHeight - vv.height;
      if (tapado > 120) {
        el.style.top = Math.round(vv.offsetTop + 10) + "px";
        el.style.bottom = Math.max(0, Math.round(window.innerHeight - vv.offsetTop - vv.height)) + "px";
        el.classList.add("con-teclado");
      } else if (el.classList.contains("con-teclado")) {
        el.style.top = ""; el.style.bottom = "";
        el.classList.remove("con-teclado");
      }
    };
    vv.addEventListener("resize", ajustarAlTeclado);
    vv.addEventListener("scroll", ajustarAlTeclado);
  }

  scrim.addEventListener("click", function () { if (hojaActiva) hojaActiva.descartar(); });
  scrim.addEventListener("touchmove", function (e) { e.preventDefault(); }, { passive: false });


  /* ---- Título compacto: aparece en la barra cuando el grande se va ---- */
  (function tituloCompacto() {
    var h1 = document.querySelector("header.page h1");
    var barra = $("barra-titulo");
    if (!h1 || !barra || !window.IntersectionObserver) return;
    new IntersectionObserver(function (entradas) {
      var e = entradas[0];
      var fuera = !e.isIntersecting && e.boundingClientRect.top < 0 && !$("app-shell").hidden;
      document.documentElement.classList.toggle("titulo-compacto", fuera);
    }, { rootMargin: "-44px 0px 0px 0px" }).observe(h1);
    barra.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: menosMovimiento && menosMovimiento.matches ? "auto" : "smooth" });
    });
    // Al estirar la página arriba del todo (rebote de iOS), el título
    // grande crece un poco, anclado a la izquierda, como en las apps de iOS
    var rafTitulo = 0;
    window.addEventListener("scroll", function () {
      if (rafTitulo) return;
      rafTitulo = requestAnimationFrame(function () {
        rafTitulo = 0;
        var y = window.scrollY;
        var estirar = y < 0 && !(menosMovimiento && menosMovimiento.matches);
        h1.style.transform = estirar ? "scale(" + (1 + Math.min(-y, 120) / 900).toFixed(4) + ")" : "";
      });
    }, { passive: true });
  })();

  /* ---- El aviso flotante se descarta deslizándolo hacia abajo ---- */
  (function arrastrarAviso() {
    if (!refsToast()) return;
    var muelle = crearMuelle(function (y) {
      toast.style.transform = Math.abs(y) < 0.5 ? "" : "translate(-50%," + y.toFixed(2) + "px)";
      toast.style.opacity = y > 0 ? String(Math.max(0, 1 - y / (toast.offsetHeight * 2))) : "";
    });
    var g = null;
    toast.addEventListener("pointerdown", function (e) {
      if (e.button !== 0 || e.target.closest("button")) return;
      clearTimeout(temporizadorToast);                 // mientras lo tienes agarrado, no se va
      clearTimeout(temporizadorSalida);
      toast.classList.remove("saliendo");
      toast.classList.add("arrastrando");
      g = { id: e.pointerId, y0: e.clientY, base: muelle.parar(), muestras: [{ y: e.clientY, t: performance.now() }] };
      try { toast.setPointerCapture(e.pointerId); } catch (err) {}
    });
    toast.addEventListener("pointermove", function (e) {
      if (!g || e.pointerId !== g.id) return;
      var b = g.base + e.clientY - g.y0;
      muelle.fijar(b < 0 ? -gomaElastica(-b, 60) : b);
      var ahora = performance.now();
      g.muestras.push({ y: e.clientY, t: ahora });
      while (g.muestras.length > 2 && ahora - g.muestras[0].t > 100) g.muestras.shift();
    });
    function soltar() {
      if (!g) return;
      var m = g.muestras, v = 0, ult = m[m.length - 1];
      g = null;
      if (m.length > 1 && ult.t - m[0].t > 8 && performance.now() - ult.t < 80) v = (ult.y - m[0].y) / (ult.t - m[0].t) * 1000;
      var alto = toast.offsetHeight;
      if (muelle.valor() + proyectar(v) > alto * 0.6) {
        muelle.ir(alto * 2.5, { zeta: 1, respuesta: 0.25, velocidad: v }, function () {
          toast.hidden = true;
          toastAction.onclick = null;
          toast.classList.remove("arrastrando");
          muelle.fijar(0);
        });
      } else {
        muelle.ir(0, { zeta: 0.8, respuesta: 0.3, velocidad: v }, function () { toast.classList.remove("arrastrando"); });
        temporizadorToast = setTimeout(ocultarToast, 3200);
      }
    }
    toast.addEventListener("pointerup", soltar);
    toast.addEventListener("pointercancel", soltar);
  })();

  /* ============================================================
     11. Tema claro / oscuro / automático — sin cambios
     ============================================================ */

  (function tema() {
    var botones = document.querySelectorAll("#tema-seg button");
    var metaLight = document.querySelector('meta[data-scheme="light"]');
    var metaDark = document.querySelector('meta[data-scheme="dark"]');
    var metaManual = document.querySelector('meta[data-scheme="manual"]');
    var ciclo = ["auto", "light", "dark"];
    var actual = leerCrudo(CLAVE_TEMA);
    if (ciclo.indexOf(actual) === -1) actual = "auto";

    function aplicar(t, animar) {
      if (animar) { conFundido(function () { aplicar(t, false); }); return; }
      actual = t;
      if (t === "auto") {
        document.documentElement.removeAttribute("data-theme");
        metaLight.media = "(prefers-color-scheme: light)";
        metaDark.media = "(prefers-color-scheme: dark)";
        metaManual.media = "not all";
      } else {
        document.documentElement.setAttribute("data-theme", t);
        metaLight.media = "not all";
        metaDark.media = "not all";
        metaManual.media = "all";
        metaManual.content = (t === "dark") ? "#000000" : "#F2F2F7";
      }
      if (typeof actualizarTeselas === "function") actualizarTeselas();
      for (var i = 0; i < botones.length; i++) {
        botones[i].setAttribute("aria-pressed", botones[i].getAttribute("data-tema") === t ? "true" : "false");
      }
      escribirCrudo(CLAVE_TEMA, t);
    }
    for (var i = 0; i < botones.length; i++) {
      botones[i].addEventListener("click", function () { aplicar(this.getAttribute("data-tema"), true); });
    }
    aplicar(actual);
  })();

  $("logout-btn").addEventListener("click", function () {
    confirmarBorradosPendientes();     // antes de cerrar la sesión, con permiso todavía
    if (canal && sb) { sb.removeChannel(canal); canal = null; }
    // scope global: invalida también en el servidor; sin red, la sesión local se descarta igual.
    if (sb) sb.auth.signOut({ scope: "global" }).catch(function () {});
    // Al salir no se deja nada de tus listas en este dispositivo: si otra
    // persona entra en este navegador, no debe ver tus copias guardadas.
    listas.forEach(function (l) {
      try { localStorage.removeItem(CLAVE_CACHE + l.id); localStorage.removeItem(CLAVE_MARCAS + l.id); } catch (e) {}
    });
    marcas = [];
    try { localStorage.removeItem(CLAVE_LISTAS); localStorage.removeItem(CLAVE_LISTA_ACTUAL); } catch (e) {}
    listas = []; miembros = []; data = []; listaActual = null; miId = ""; miEmail = "";
    cerrarPanelListas(false, true);
    if (!panel.hidden) cerrarPanel(false, true);
    pintarSelectorListas();
    mostrarLogin();
  });

  /* ============================================================
     12. Filtros por chips — sin cambios
     ============================================================ */

  function grupoZona(z) {
    var v = texto(z);
    if (!v) return "Sin especificar";
    if (v.indexOf("Varias zonas") === 0) return "Varias zonas";
    if (v === "Sin confirmar") return "Sin confirmar";
    return v.split(/[(\/]/)[0].trim() || "Sin especificar";
  }

  /**
   * Las zonas por las que "cuenta" un restaurante a efectos de filtro y
   * chips. Con varias sedes, una por cada una (usando la zona propia de
   * la sede, o la del restaurante si esa sede no la tiene puesta
   * todavía). Sin sedes, la de siempre.
   */
  function zonasDe(d) {
    if (d.sedes && d.sedes.length) {
      var vistos = Object.create(null);
      var salida = [];
      d.sedes.forEach(function (s) {
        var z = grupoZona(s.zona || d.zona);
        if (!vistos[z]) { vistos[z] = true; salida.push(z); }
      });
      return salida.length ? salida : [grupoZona(d.zona)];
    }
    return [grupoZona(d.zona)];
  }

  var firmasChips = {};

  /**
   * Una fila de chips de selección múltiple. El primero («Todas»/«Todos»)
   * está marcado cuando no hay nada elegido, y tocarlo limpia el grupo.
   */
  function construirChips(contenedorId, etiquetaId, todos, valores, clave) {
    var contenedor = $(contenedorId);
    // Si algo elegido ya no existe (se borró el último de esa zona), se olvida.
    state[clave] = state[clave].filter(function (v) { return valores.indexOf(v) !== -1; });

    var firma = valores.join("\u0000") + "|" + state[clave].join("\u0000");
    actualizarEtiquetaFiltro(etiquetaId, clave);
    if (firmasChips[contenedorId] === firma) return;
    firmasChips[contenedorId] = firma;

    var scroll = contenedor.scrollLeft;
    var frag = document.createDocumentFragment();

    function marcar() {
      var hijos = contenedor.children;
      for (var i = 0; i < hijos.length; i++) {
        var v = hijos[i].dataset.valor;
        var activo = v === "" ? !state[clave].length : state[clave].indexOf(v) !== -1;
        hijos[i].setAttribute("aria-pressed", activo ? "true" : "false");
      }
      firmasChips[contenedorId] = valores.join("\u0000") + "|" + state[clave].join("\u0000");
      actualizarEtiquetaFiltro(etiquetaId, clave);
    }

    [""].concat(valores).forEach(function (v) {
      var chip = document.createElement("button");
      chip.className = "chip";
      chip.type = "button";
      chip.dataset.valor = v;
      chip.textContent = v || todos;
      chip.addEventListener("click", function () {
        if (!v) {
          state[clave] = [];
        } else {
          var pos = state[clave].indexOf(v);
          if (pos === -1) state[clave].push(v); else state[clave].splice(pos, 1);
        }
        marcar();
        guardarFiltros();
        render();
      });
      frag.appendChild(chip);
    });
    contenedor.replaceChildren(frag);
    marcar();
    contenedor.scrollLeft = scroll;
    bordesChips(contenedor);
  }

  // Fundido en el lado por el que quedan chips fuera de la vista
  function bordesChips(fila) {
    var max = fila.scrollWidth - fila.clientWidth;
    fila.classList.toggle("mas-izq", fila.scrollLeft > 2);
    fila.classList.toggle("mas-der", fila.scrollLeft < max - 2);
  }
  Array.prototype.forEach.call(document.querySelectorAll(".chip-row"), function (fila) {
    fila.addEventListener("scroll", function () { bordesChips(fila); }, { passive: true });
  });
  window.addEventListener("resize", function () {
    Array.prototype.forEach.call(document.querySelectorAll(".chip-row"), bordesChips);
  });

  // «Zona · 2»: se ve de un vistazo cuántos hay marcados aunque la fila
  // de chips esté desplazada y no se vean.
  function actualizarEtiquetaFiltro(etiquetaId, clave) {
    var el = $(etiquetaId);
    if (!el) return;
    if (!el.dataset.base) el.dataset.base = el.textContent;
    var n = state[clave].length;
    el.textContent = el.dataset.base + (n ? " · " + n + (n === 1 ? " elegida" : " elegidas") : "");
    var x = $("clear-" + clave);
    if (x) x.hidden = !n;          // la ✕ solo aparece si hay algo que quitar
  }

  // ✕ de cada grupo: limpia solo ese, sin tocar los demás ni la búsqueda.
  [["zonas", "zona-chips", "lbl-zona"], ["tipos", "tipo-chips", "lbl-tipo"], ["precios", "precio-chips", "lbl-precio"],
   ["marcas", "marca-chips", "lbl-marcas"]]
    .forEach(function (g) {
      var boton = $("clear-" + g[0]);
      if (!boton) return;
      boton.addEventListener("click", function () {
        if (!state[g[0]].length) return;
        state[g[0]] = [];
        delete firmasChips[g[1]];            // fuerza a repintar los chips ya sin marcar
        guardarFiltros();
        refrescarFuentesChips();
        render();
      });
    });

  function refrescarFuentesChips() {
    var zonas = [], tipos = [];
    var vistasZ = Object.create(null), vistosT = Object.create(null);
    data.forEach(function (d) {
      zonasDe(d).forEach(function (z) {
        if (!vistasZ[z]) { vistasZ[z] = true; zonas.push(z); }
      });
      var t = d.tipo || "Sin especificar";
      if (!vistosT[t]) { vistosT[t] = true; tipos.push(t); }
    });
    zonas.sort(comparar);
    tipos.sort(comparar);
    construirChips("zona-chips", "lbl-zona", "Todas", zonas, "zonas");
    construirChips("tipo-chips", "lbl-tipo", "Todos", tipos, "tipos");
    construirChips("precio-chips", "lbl-precio", "Todos", ["€", "€€", "€€€"], "precios");
    $("marcas-bloque").hidden = !marcasDisponibles;
    if (marcasDisponibles) construirChips("marca-chips", "lbl-marcas", "Todas", ["Quiero ir", "Ya he ido", "Sin marcar"], "marcas");
    else state.marcas = [];
    rellenarDatalist("zonas-sugeridas", zonas);
    rellenarDatalist("tipos-sugeridos", tipos);
  }

  function rellenarDatalist(id, valores) {
    var dl = $(id);
    if (!dl) return;
    var frag = document.createDocumentFragment();
    valores.forEach(function (v) {
      if (!v || v === "Sin especificar") return;
      var op = document.createElement("option");
      op.value = v;
      frag.appendChild(op);
    });
    dl.replaceChildren(frag);
  }

  function hayFiltros() {
    return state.zonas.length > 0 || state.tipos.length > 0 || state.precios.length > 0 ||
           state.marcas.length > 0 || state.search !== "" || state.abiertoAhora;
  }

  $("clear-filters").addEventListener("click", function () {
    state.zonas = []; state.tipos = []; state.precios = []; state.marcas = []; state.search = ""; state.abiertoAhora = false;
    $("abierto-chip").setAttribute("aria-pressed", "false");
    $("search").value = "";
    firmasChips = {};
    guardarFiltros();
    refrescarFuentesChips();
    render();
    // El botón desaparece al no quedar filtros: el foco pasa a «Filtros»
    // (no a la búsqueda, que en el móvil abriría el teclado)
    $("filtros-btn").focus({ preventScroll: true });
  });


  /* ============================================================
     12 bis. Hoja de filtros
     Zona, tipo, precio, marcas y orden viven aquí; en la pantalla queda
     lo de cada día. Abre a media altura: detrás se ve cómo cambia la lista.
     ============================================================ */

  var panelFiltros = $("panel-filtros");
  var btnFiltros = $("filtros-btn");

  function cuantosFiltros() {
    return state.zonas.length + state.tipos.length + state.precios.length + state.marcas.length;
  }
  function pintarEstadoFiltros(visibles) {
    var n = cuantosFiltros();
    var insignia = $("filtros-n");
    insignia.textContent = n ? String(n) : "";
    insignia.hidden = !n;
    btnFiltros.classList.toggle("activo", n > 0);
    btnFiltros.setAttribute("aria-label", n ? "Filtros, " + n + (n === 1 ? " elegido" : " elegidos") : "Filtros");
    $("pf-cuenta").textContent = visibles + (visibles === 1 ? " restaurante" : " restaurantes");
    $("pf-restablecer").disabled = !n;
    Array.prototype.forEach.call(document.querySelectorAll(".chip-row"), bordesChips);
  }

  function abrirFiltros() {
    hojaFiltros.abrir();
    btnFiltros.setAttribute("aria-expanded", "true");
    try { $("pf-cerrar").focus({ preventScroll: true }); } catch (e) {}
  }
  function cerrarFiltros(devolverFoco) {
    btnFiltros.setAttribute("aria-expanded", "false");
    hojaFiltros.cerrar(function () {
      if (devolverFoco) btnFiltros.focus({ preventScroll: true });
    });
  }
  var hojaFiltros = crearHoja(panelFiltros, { medio: true, alDescartar: function () { cerrarFiltros(true); } });
  btnFiltros.addEventListener("click", abrirFiltros);
  $("pf-cerrar").addEventListener("click", function () { cerrarFiltros(true); });
  $("pf-restablecer").addEventListener("click", function () {
    state.zonas = []; state.tipos = []; state.precios = []; state.marcas = [];
    firmasChips = {};
    guardarFiltros();
    refrescarFuentesChips();
    render();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !panelFiltros.hidden) cerrarFiltros(true);
  });

  /* ============================================================
     13. Búsqueda y orden — sin cambios
     ============================================================ */

  var debounceBusqueda = null;
  $("search").addEventListener("input", function (e) {
    var v = e.target.value;
    clearTimeout(debounceBusqueda);
    debounceBusqueda = setTimeout(function () { state.search = plano(v); render(); }, 110);
  });
  $("search").addEventListener("keydown", function (e) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    // Si lo escrito no coincide con ningún nombre, se entiende como una
    // petición («italiano barato en Chamberí») y se traduce a filtros
    clearTimeout(debounceBusqueda);
    state.search = plano(e.target.value);
    render();
    if (state.search && !data.filter(coincide).length) interpretarFrase();
    e.target.blur();
  });

  var selectOrden = $("sort");
  selectOrden.value = state.sort;
  if (selectOrden.value !== state.sort) { state.sort = "nombre"; selectOrden.value = "nombre"; }
  selectOrden.addEventListener("change", function (e) {
    state.sort = e.target.value;
    guardarFiltros();
    if (state.sort === "cerca" && !miPos) {
      ubicacionDenegada = false;
      avisar("Buscando tu ubicación… Solo cuentan los restaurantes con dirección.");
    }
    render();
  });

  /* ============================================================
     14. Panel de alta y edición
     ============================================================ */

  var sedesEnEdicion = [];
  var sedeEditandoIdx = null;      // índice del local que se está modificando, o null si se está añadiendo

  function renderSedeList() {
    sedeListEl.replaceChildren();
    sedesEnEdicion.forEach(function (s, i) {
      var li = document.createElement("li");
      if (sedeEditandoIdx === i) li.className = "editandose";

      var nombre = document.createElement("span");
      var detalle = [s.zona, s.direccion].filter(Boolean).join(" — ");
      nombre.textContent = s.nombre + (detalle ? " — " + detalle : "");
      li.appendChild(nombre);

      var acciones = document.createElement("div");
      acciones.className = "sede-acciones";

      var editar = document.createElement("button");
      editar.type = "button";
      editar.className = "sede-editar";
      editar.textContent = "Editar";
      editar.setAttribute("aria-label", "Editar el local " + s.nombre);
      editar.addEventListener("click", function () { empezarEdicionSede(i); });

      var quitar = document.createElement("button");
      quitar.type = "button";
      quitar.className = "sede-quitar";
      quitar.textContent = "Quitar";
      quitar.setAttribute("aria-label", "Quitar el local " + s.nombre);
      quitar.addEventListener("click", function () {
        sedesEnEdicion.splice(i, 1);
        // Si se quita el que se estaba modificando (o uno de antes), el
        // formulario de abajo deja de apuntar a la fila correcta.
        if (sedeEditandoIdx === i) cancelarEdicionSede();
        else if (sedeEditandoIdx !== null && sedeEditandoIdx > i) sedeEditandoIdx -= 1;
        renderSedeList();
      });

      acciones.appendChild(editar);
      acciones.appendChild(quitar);
      li.appendChild(acciones);
      sedeListEl.appendChild(li);
    });
  }

  function empezarEdicionSede(i) {
    var s = sedesEnEdicion[i];
    if (!s) return;
    sedeEditandoIdx = i;
    fSedeNombre.value = s.nombre;
    fSedeZona.value = s.zona || "";
    fSedeDireccion.value = s.direccion || "";
    fSedeCarta.value = s.carta || "";
    fSedeReserva.value = s.reserva || "";
    fSedeHorario.value = horarioParaCampo(s.horario);
    previaHorario(fSedeHorario, msgSedeHorario, s.horario);
    $("add-sede-btn").textContent = "Guardar este local";
    $("cancel-sede-btn").hidden = false;
    renderSedeList();
    desplazarA(fSedeNombre, { block: "center", behavior: "smooth" });
    try { fSedeNombre.focus({ preventScroll: true }); } catch (e) { fSedeNombre.focus(); }
  }

  function cancelarEdicionSede() {
    sedeEditandoIdx = null;
    limpiarCamposSede();
    $("add-sede-btn").textContent = "Añadir este local";
    $("cancel-sede-btn").hidden = true;
  }

  $("cancel-sede-btn").addEventListener("click", function () {
    cancelarEdicionSede();
    renderSedeList();
  });

  function limpiarCamposSede() {
    fSedeNombre.value = "";
    fSedeZona.value = "";
    fSedeDireccion.value = "";
    fSedeCarta.value = "";
    fSedeReserva.value = "";
    fSedeHorario.value = "";
    fSedeHorario.removeAttribute("aria-invalid");
    decirCampo(msgSedeHorario, "");
  }

  $("add-sede-btn").addEventListener("click", function () {
    var nombre = fSedeNombre.value.trim();
    if (!nombre) { fSedeNombre.focus(); return; }
    var antes = sedeEditandoIdx !== null && sedesEnEdicion[sedeEditandoIdx] ? sedesEnEdicion[sedeEditandoIdx] : null;
    var hSede = horarioDelCampo(fSedeHorario, msgSedeHorario, antes && antes.horario);
    if (hSede.ok === false) return;
    var nueva = normalizarSede({
      nombre: nombre, zona: fSedeZona.value.trim(), direccion: fSedeDireccion.value.trim(),
      carta: fSedeCarta.value, reserva: fSedeReserva.value
    });

    if (sedeEditandoIdx !== null && sedesEnEdicion[sedeEditandoIdx]) {
      var antigua = sedesEnEdicion[sedeEditandoIdx];
      var nombreRest = fNombre.value.trim();
      // Si no cambia lo que se buscó en el mapa, se conservan las coordenadas.
      if (claveGeo(nombreRest, antigua.direccion, antigua.zona, antigua.nombre) ===
          claveGeo(nombreRest, nueva.direccion, nueva.zona, nueva.nombre)) {
        nueva.geo = antigua.geo;
        nueva.horario = antigua.horario;
      }
      if (hSede.vacio && nueva.horario && nueva.horario.m) nueva.horario = null;   // borraste el tuyo: vuelve el automático
      if (hSede.ok) nueva.horario = hSede.horario;
      sedesEnEdicion[sedeEditandoIdx] = nueva;
      cancelarEdicionSede();
    } else {
      if (hSede.ok) nueva.horario = hSede.horario;
      sedesEnEdicion.push(nueva);
      limpiarCamposSede();
    }
    renderSedeList();
    fSedeNombre.focus();
  });

  /* ---- Horario en el formulario ---- */

  var horarioPanelActual = null;   // el horario que tenía el restaurante al abrir el panel

  function decirCampo(el, mensaje, tipo) {
    el.textContent = mensaje || "";
    el.className = "msg" + (tipo === "error" ? " msg-error" : tipo === "aviso" ? " msg-ia" : "");
    el.hidden = !mensaje;
  }

  /** Enseña debajo del campo cómo se ha entendido lo escrito. */
  function previaHorario(campo, msgEl, actual) {
    var r = textoAHorario(campo.value);
    if (r.vacio) {
      if (actual && actual.oh && !actual.m) {
        decirCampo(msgEl, "Ahora sale de OpenStreetMap: " + osmATexto(actual.oh) + ". Si no es correcto, escribe aquí el bueno.");
      } else if (actual && actual.nf) {
        decirCampo(msgEl, "OpenStreetMap no tiene su horario: escríbelo tú o búscalo en su web.");
      } else {
        decirCampo(msgEl, "");
      }
      campo.removeAttribute("aria-invalid");
      return r;
    }
    if (!r.ok) {
      decirCampo(msgEl, "No lo entiendo. Escríbelo así: L-V 13-16, 20-23:30; S-D 13-24; lunes cerrado", "error");
      return r;
    }
    campo.removeAttribute("aria-invalid");
    var ahora = textoHorario(r.oh, new Date());
    decirCampo(msgEl, "Entendido: " + osmATexto(r.oh) + (ahora ? ". Ahora mismo: " + ahora : "") + ".");
    return r;
  }

  /** { vacio } | { ok:false } | { ok:true, horario } listo para guardar. */
  function horarioDelCampo(campo, msgEl, actual) {
    var r = previaHorario(campo, msgEl, actual);
    if (r.vacio) return { vacio: true };
    if (!r.ok) {
      campo.setAttribute("aria-invalid", "true");
      desplazarA(campo, { block: "center", behavior: "smooth" });
      try { campo.focus({ preventScroll: true }); } catch (e) { campo.focus(); }
      return { ok: false };
    }
    // Si no ha cambiado, se conserva tal cual (con su fecha).
    if (actual && actual.m && actual.oh === r.oh) return { ok: true, horario: actual };
    return { ok: true, horario: { oh: r.oh, m: true, t: Date.now() } };
  }

  function horarioParaCampo(h) {
    return h && h.m && h.oh ? osmATexto(h.oh) : "";
  }

  /** Webs donde buscar el horario: sin repetir y solo direcciones web válidas. */
  function websDe(valores) {
    var urls = [];
    valores.forEach(function (v) {
      v = texto(v);
      if (!v) return;
      var res = analizarReserva(v);
      if (res.tipo !== "url" || !res.valida) return;
      if (urls.indexOf(res.href) === -1) urls.push(res.href);
    });
    return urls.slice(0, 4);
  }

  function buscarHorarioEnWeb(o) {
    if (!o.urls.length) {
      decirCampo(o.msgEl, "Para buscarlo necesito su web: pon la carta o la reserva (o pega el enlace arriba del todo).", "error");
      return;
    }
    o.boton.disabled = true;
    decirCampo(o.msgEl, "Leyendo su web…");
    llamarAsistente({ accion: "horario", nombre: o.nombre, local: o.local, direccion: o.direccion, urls: o.urls })
      .then(function (r) {
        var oh = texto(r.horario);
        if (!oh || !interpretarHorario(oh).ok) {
          decirCampo(o.msgEl, "No he encontrado el horario en su web" + (r.nota ? " (" + r.nota + ")" : "") +
            ". Puedes escribirlo tú.", "error");
          return;
        }
        o.campo.value = osmATexto(oh);
        var ahora = textoHorario(oh, new Date());
        var dominio = "";
        try { dominio = new URL(r.fuente || o.urls[0]).hostname.replace(/^www\./, ""); } catch (e) {}
        decirCampo(o.msgEl, "Sacado de " + (dominio || "su web") + ": " + osmATexto(oh) +
          (ahora ? ". Ahora mismo: " + ahora : "") + ". Revísalo: puede equivocarse. Se guarda al darle a Guardar.", "aviso");
      })
      .catch(function (e) {
        var msg = (e && e.message) || "No se pudo leer su web.";
        if (/Acción desconocida/.test(msg)) msg = "Falta actualizar la función «asistente» en Supabase con el index.ts nuevo.";
        decirCampo(o.msgEl, msg, "error");
      })
      .then(function () { o.boton.disabled = false; });
  }

  fHorario.addEventListener("input", function () { previaHorario(fHorario, msgHorario, horarioPanelActual); });
  fSedeHorario.addEventListener("input", function () {
    var actual = sedeEditandoIdx !== null && sedesEnEdicion[sedeEditandoIdx] ? sedesEnEdicion[sedeEditandoIdx].horario : null;
    previaHorario(fSedeHorario, msgSedeHorario, actual);
  });

  $("f-horario-web").addEventListener("click", function () {
    buscarHorarioEnWeb({
      boton: $("f-horario-web"), campo: fHorario, msgEl: msgHorario,
      nombre: fNombre.value.trim(), local: "", direccion: fDireccion.value.trim(),
      urls: websDe([$("f-enlace").value, fCarta.value, fReserva.value])
    });
  });

  $("f-sede-horario-web").addEventListener("click", function () {
    buscarHorarioEnWeb({
      boton: $("f-sede-horario-web"), campo: fSedeHorario, msgEl: msgSedeHorario,
      nombre: fNombre.value.trim(), local: fSedeNombre.value.trim(), direccion: fSedeDireccion.value.trim(),
      urls: websDe([fSedeCarta.value, fSedeReserva.value, $("f-enlace").value, fCarta.value, fReserva.value])
    });
  });

  function limpiarAvisosFormulario() {
    errNombre.hidden = true;
    avisoDup.hidden = true;
    avisoCarta.hidden = true;
    avisoReserva.hidden = true;
    fNombre.removeAttribute("aria-invalid");
    btnGuardar.textContent = "Guardar";
    pendienteConfirmarDuplicado = false;
  }

  function abrirPanel(item) {
    if (item) {
      editandoId = item.id;
      panelTitle.textContent = "Editar restaurante";
      fNombre.value = item.nombre;
      fTipo.value = item.tipo === "Sin especificar" ? "" : item.tipo;
      fZona.value = item.zona === "Sin especificar" ? "" : item.zona;
      fPrecio.value = String(item.precio);
      fCarta.value = item.carta || "";
      fReserva.value = item.reserva || "";
      fDireccion.value = item.direccion || "";
      fNota.value = item.flag || "";
      sedesEnEdicion = (item.sedes || []).map(function (s) { return Object.assign({}, s); });
      horarioPanelActual = item.horario || null;
      fHorario.value = horarioParaCampo(item.horario);
    } else {
      editandoId = null;
      panelTitle.textContent = "Añadir restaurante";
      panel.reset();
      fPrecio.value = "2";
      sedesEnEdicion = [];
      horarioPanelActual = null;
      fHorario.value = "";
      btnGuardar.textContent = "Guardar";
    }
    fHorario.removeAttribute("aria-invalid");
    previaHorario(fHorario, msgHorario, horarioPanelActual);
    cancelarEdicionSede();
    renderSedeList();
    $("f-enlace").value = "";
    decirIA("");
    sedesDetails.open = sedesEnEdicion.length > 0;
    limpiarAvisosFormulario();
    hojaForm.abrir();
    btnAbrir.setAttribute("aria-expanded", "true");
    cerrarTodasLasConfirmaciones();
    setTimeout(function () {
      try { fNombre.focus({ preventScroll: true }); } catch (e) { fNombre.focus(); }
    }, 380);
  }

  // Lo que se limpia espera a que la hoja acabe de irse: si se agarra a
  // medio camino y vuelve, el formulario sigue intacto.
  function cerrarPanel(devolverFoco, inmediato) {
    btnAbrir.setAttribute("aria-expanded", "false");
    hojaForm.cerrar(function () {
      editandoId = null;
      sedesEnEdicion = [];
      cancelarEdicionSede();
      renderSedeList();
      sedesDetails.open = false;
      limpiarAvisosFormulario();
      if (devolverFoco) btnAbrir.focus({ preventScroll: true });
    }, { inmediato: !!inmediato });
  }
  var hojaForm = crearHoja(panel, { alDescartar: function () { cerrarPanel(true); } });

  btnAbrir.addEventListener("click", function () { abrirPanel(null); });
  $("cancel-btn").addEventListener("click", function () { cerrarPanel(true); });

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (!panel.hidden) { cerrarPanel(true); return; }
    cerrarDeslizado();
  });


  /* Validación en línea: el aviso de duplicado sale al escribir el nombre
     (no al pulsar Guardar), y los avisos de enlace se quitan en cuanto
     el texto ya es válido. */
  var temporizadorDup = null;
  function comprobarDuplicado() {
    var nombre = fNombre.value.trim();
    var dup = nombre ? buscarDuplicado(nombre, editandoId) : null;
    if (dup) {
      avisoDup.textContent = "Ya tenéis «" + dup.nombre + "» en " + dup.zona + ". Si es otro sitio, puedes guardarlo igualmente.";
      avisoDup.hidden = false;
      pendienteConfirmarDuplicado = true;      // ya avisado: Guardar no vuelve a preguntar
    } else {
      avisoDup.hidden = true;
      pendienteConfirmarDuplicado = false;
    }
  }
  fNombre.addEventListener("input", function () {
    if (fNombre.value.trim()) { errNombre.hidden = true; fNombre.removeAttribute("aria-invalid"); }
    clearTimeout(temporizadorDup);
    temporizadorDup = setTimeout(comprobarDuplicado, 350);
  });
  fNombre.addEventListener("blur", function () { clearTimeout(temporizadorDup); comprobarDuplicado(); });
  fCarta.addEventListener("input", function () {
    if (!avisoCarta.hidden && analizarUrl(fCarta.value).valida) avisoCarta.hidden = true;
  });
  fReserva.addEventListener("input", function () {
    if (!avisoReserva.hidden && analizarReserva(fReserva.value).valida) avisoReserva.hidden = true;
  });

  fCarta.addEventListener("blur", function () {
    var an = analizarUrl(fCarta.value);
    avisoCarta.hidden = an.vacia || an.valida;
    if (!avisoCarta.hidden) avisoCarta.textContent = "Eso no parece una dirección web. Se guardará igualmente, pero no aparecerá el botón de la carta hasta que lo corrijas.";
  });
  fReserva.addEventListener("blur", function () {
    var res = analizarReserva(fReserva.value);
    avisoReserva.hidden = res.vacia || res.valida;
    if (!avisoReserva.hidden) avisoReserva.textContent = "Eso no parece ni una web ni un teléfono. Se guardará igualmente, pero no aparecerá el botón de reservar hasta que lo corrijas.";
  });

  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", function () {
      var activo = document.activeElement;
      if (!activo || !hojaActiva || !hojaActiva.el.contains(activo)) return;
      setTimeout(function () { desplazarA(activo, { block: "center", behavior: "smooth" }); }, 60);
    });
  }

  function buscarDuplicado(nombre, excluirId) {
    var clave = plano(nombre);
    for (var i = 0; i < data.length; i++) {
      if (data[i].id === excluirId) continue;
      if (plano(data[i].nombre) === clave) return data[i];
    }
    return null;
  }

  panel.addEventListener("submit", function (e) {
    e.preventDefault();
    if (requiereConexion()) return;

    var nombre = fNombre.value.trim();
    if (!nombre) {
      errNombre.hidden = false;
      fNombre.setAttribute("aria-invalid", "true");
      fNombre.focus();
      return;
    }
    errNombre.hidden = true;
    fNombre.removeAttribute("aria-invalid");

    var dup = buscarDuplicado(nombre, editandoId);
    if (dup && !pendienteConfirmarDuplicado) {
      avisoDup.textContent = "Ya tenéis «" + dup.nombre + "» en " + dup.zona + ". Pulsa «Guardar» otra vez si de verdad quieres añadirlo por duplicado.";
      avisoDup.hidden = false;
      pendienteConfirmarDuplicado = true;
      // (el botón de la cabecera no cabe otro texto: lo dice el aviso)
      desplazarA(avisoDup, { block: "nearest", behavior: "smooth" });
      return;
    }

    var hRest = horarioDelCampo(fHorario, msgHorario, horarioPanelActual);
    if (hRest.ok === false) return;

    var an = analizarUrl(fCarta.value);
    var res = analizarReserva(fReserva.value);
    var valores = normalizarRegistro({
      nombre: nombre, tipo: fTipo.value.trim(), zona: fZona.value.trim(),
      precio: Number(fPrecio.value) || 2, flag: fNota.value.trim(),
      carta: fCarta.value, reserva: fReserva.value, direccion: fDireccion.value.trim(),
      sedes: sedesEnEdicion
    });

    var eraEdicion = !!editandoId;
    if (eraEdicion) {
      var original = null;
      for (var k = 0; k < data.length; k++) if (data[k].id === editandoId) { original = data[k]; break; }
      // Mismas coordenadas si no cambia lo que se buscó (dirección, o nombre y zona si se situó por el nombre).
      if (original && claveGeo(original.nombre, original.direccion, original.zona, "") ===
                      claveGeo(valores.nombre, valores.direccion, valores.zona, "")) {
        valores.geo = original.geo;
        valores.horario = original.horario;     // el horario va ligado al mismo sitio
      }
    }
    if (hRest.ok) valores.horario = hRest.horario;                                         // el tuyo manda
    else if (valores.horario && valores.horario.m) valores.horario = null;                // lo borraste: vuelve el automático
    var fila = filaDesde(valores);
    var promesa = eraEdicion
      ? sb.from("restaurantes").update(fila).eq("id", editandoId).select().single()
      : sb.from("restaurantes").insert(conLista(fila)).select().single();

    btnGuardar.disabled = true;
    promesa.then(function (resDb) {
      btnGuardar.disabled = false;
      if (resDb.error) { avisar("No se pudo guardar: " + (resDb.error.message || "inténtalo de nuevo.")); return; }
      upsertLocal(registroDesdeFila(resDb.data));
      guardarCache();
      cerrarPanel(true);
      refrescarFuentesChips();
      render();
      avisar(eraEdicion ? "Cambios guardados." : "«" + valores.nombre + "» añadido.");
      procesarGeo();
      if ((!an.vacia && !an.valida) || (!res.vacia && !res.valida)) {
        setTimeout(function () { avisar("Algún enlace no es válido, así que ese botón no se muestra en la tarjeta."); }, 1800);
      }
    }).catch(function () {
      btnGuardar.disabled = false;
      avisar("No se pudo guardar: revisa la conexión.");
    });
  });

  /* ============================================================
     15. Borrado con confirmación y deshacer
     ============================================================ */

  function cerrarTodasLasConfirmaciones() {
    idsExpandidosBorrado = Object.create(null);
    if (typeof cerrarDeslizado === "function") cerrarDeslizado();
  }

  /* Borrar como en Mail: desaparece al momento, pero en Supabase no se
     borra hasta que pasa el aviso de «Deshacer». Así deshacer no tiene que
     volver a crear nada y se conserva todo: el id, la fecha de alta y las
     marcas «Quiero ir / Ya he ido» de todos (que la base de datos borraría
     junto con el restaurante). */
  var ESPERA_BORRADO_MS = 7500;                       // algo más que el aviso (7 s)
  var borradosPendientes = Object.create(null);       // id -> { item, lista, timer, enviado }

  function restaurarLocal(p) {
    if (listaActual !== p.lista) return;
    upsertLocal(p.item);
    guardarCache();
    refrescarFuentesChips();
    render();
  }

  function confirmarBorrado(id) {
    var p = borradosPendientes[id];
    if (!p || p.enviado) return;
    clearTimeout(p.timer);
    p.enviado = true;
    Promise.resolve(sb.from("restaurantes").delete().eq("id", id)).then(function (res) {
      if (res && res.error) throw res.error;
      delete borradosPendientes[id];
    }).catch(function () {
      // No se pudo: vuelve a aparecer, que no parezca borrado sin estarlo
      delete borradosPendientes[id];
      restaurarLocal(p);
      avisar("No se pudo eliminar «" + p.item.nombre + "»: revisa la conexión.");
    });
  }

  function confirmarBorradosPendientes() {
    Object.keys(borradosPendientes).forEach(confirmarBorrado);
  }

  // Si cierras la app o la mandas al fondo durante esos segundos, se borra ya.
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") confirmarBorradosPendientes();
  });
  window.addEventListener("pagehide", confirmarBorradosPendientes);

  function eliminar(item) {
    if (requiereConexion()) return;
    cerrarTodasLasConfirmaciones();
    var p = { item: item, lista: listaActual, timer: null, enviado: false };
    borradosPendientes[item.id] = p;
    p.timer = setTimeout(function () { confirmarBorrado(item.id); }, ESPERA_BORRADO_MS);

    quitarLocal(item.id);
    guardarCache();
    refrescarFuentesChips();
    render();

    avisar("«" + item.nombre + "» eliminado.", {
      etiqueta: "Deshacer",
      alPulsar: function () {
        if (!p.enviado) {
          // Aún no se había borrado en el servidor: basta con volver a enseñarlo
          clearTimeout(p.timer);
          delete borradosPendientes[item.id];
          restaurarLocal(p);
          avisar("Restaurado.");
          return;
        }
        // Ya se había borrado (p. ej. se fue la app al fondo): se vuelve a
        // crear con el mismo id y la misma fecha. Las marcas no vuelven.
        var fila = Object.assign({}, filaDesde(item), { id: item.id, lista_id: p.lista });
        if (item.creado) fila.created_at = new Date(item.creado).toISOString();
        sb.from("restaurantes").insert(fila).select().single().then(function (r2) {
          if (r2.error) { avisar("No se pudo restaurar."); return; }
          if (listaActual !== p.lista) { avisar("Restaurado en su lista."); return; }
          upsertLocal(registroDesdeFila(r2.data));
          guardarCache();
          refrescarFuentesChips();
          render();
          avisar("Restaurado.");
        });
      }
    });
  }

  /* ============================================================
     16. Pintado de la lista — sin cambios respecto a la versión anterior
     ============================================================ */

  var svgBase = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  var ICONOS = {
    carta:   svgBase + '<path d="M5 3h14a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"></path><path d="M8 8h8M8 12h8M8 16h5"></path></svg>',
    reserva: svgBase + '<path d="M4 6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6Z"></path><path d="M8 3v4M16 3v4M4 10h16"></path><path d="m9.5 15 1.8 1.8 3.4-3.4"></path></svg>',
    tel:     svgBase + '<path d="M16.5 21A13.5 13.5 0 0 1 3 7.5 2.5 2.5 0 0 1 5.5 5h1.8a1 1 0 0 1 1 .78l.7 3.1a1 1 0 0 1-.42 1.05l-1.4.95a11 11 0 0 0 4.94 4.94l.95-1.4a1 1 0 0 1 1.05-.42l3.1.7a1 1 0 0 1 .78 1v1.8A2.5 2.5 0 0 1 16.5 21Z"></path></svg>',
    mapa:    svgBase + '<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z"></path><circle cx="12" cy="10" r="2.6"></circle></svg>',
    lapiz:   svgBase + '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z"></path><path d="m13.5 6.5 4 4"></path></svg>',
    papelera: svgBase + '<path d="M4 7h16M10 11v6M14 11v6"></path><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"></path><path d="M9 7V4.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V7"></path></svg>'
  };

  function crearPildora(etiqueta, href, icono, descripcion, externo) {
    var a = document.createElement("a");
    a.className = "card-link";
    a.href = href;
    if (externo) { a.target = "_blank"; a.rel = "noopener noreferrer"; }
    a.innerHTML = icono;
    var txt = document.createElement("span");
    txt.textContent = etiqueta;
    a.appendChild(txt);
    a.setAttribute("aria-label", descripcion);
    return a;
  }

  function coincide(d) {
    if (state.search) {
      var heno = plano(d.nombre) + " " + plano(d.tipo) + " " + plano(d.zona);
      (d.sedes || []).forEach(function (s) {
        heno += " " + plano(s.nombre) + " " + plano(s.zona) + " " + plano(s.direccion);
      });
      if (heno.indexOf(state.search) === -1) return false;
    }
    if (state.zonas.length && !zonasDe(d).some(function (z) { return state.zonas.indexOf(z) !== -1; })) return false;
    if (!enFiltro(state.tipos, d.tipo || "Sin especificar")) return false;
    if (!enFiltro(state.precios, etiquetaPrecio[d.precio])) return false;
    if (state.marcas.length && marcasDisponibles) {
      var mia = miMarca(d);
      if (!enFiltro(state.marcas, mia ? ETIQUETA_MARCA[mia] : "Sin marcar")) return false;
    }
    if (state.abiertoAhora) {
      // Basta con que uno de sus locales esté abierto. Los que no publican
      // horario no se descartan: no se sabe, y esconderlos sería peor.
      var estados = puntosDe(d, true).map(estaAbierto);
      if (estados.length && estados.every(function (e) { return e === false; })) return false;
    }
    return true;
  }

  function ordenar(items) {
    var s = state.sort;
    return items.sort(function (a, b) {
      if (s === "zona") return comparar(a.zona, b.zona) || comparar(a.nombre, b.nombre);
      if (s === "tipo") return comparar(a.tipo, b.tipo) || comparar(a.nombre, b.nombre);
      if (s === "precio") return (a.precio - b.precio) || comparar(a.nombre, b.nombre);
      if (s === "recientes") return (b.creado - a.creado) || comparar(a.nombre, b.nombre);
      if (s === "cerca") {
        // Sin ubicación o sin dirección = Infinity: al final, en orden alfabético.
        var da = distanciaMin(a), db = distanciaMin(b);
        if (da !== db) return da === Infinity ? 1 : (db === Infinity ? -1 : da - db);
        return comparar(a.nombre, b.nombre);
      }
      return comparar(a.nombre, b.nombre);
    });
  }

  /**
   * Devuelve las píldoras (carta/reservar/llamar/mapa) para un juego
   * de datos concreto. Se reutiliza igual para el restaurante entero
   * (sin sedes) que para cada sede por separado.
   */
  function construirPildoras(etiquetaBase, carta, reserva, mapaHref) {
    var frag = [];
    if (carta && analizarUrl(carta).valida) {
      frag.push(crearPildora("Carta", analizarUrl(carta).href, ICONOS.carta, "Ver la carta de " + etiquetaBase + " (se abre en Safari)", true));
    }
    var res = analizarReserva(reserva);
    if (!res.vacia && res.valida) {
      if (res.tipo === "tel") {
        frag.push(crearPildora("Llamar", res.href, ICONOS.tel, "Llamar a " + etiquetaBase + " para reservar", false));
      } else {
        frag.push(crearPildora("Reservar", res.href, ICONOS.reserva, "Reservar en " + etiquetaBase + " (se abre en Safari)", true));
      }
    }
    frag.push(crearPildora("Cómo llegar", mapaHref, ICONOS.mapa, "Cómo llegar a " + etiquetaBase + " (abre la app de mapas)", true));
    return frag;
  }

  function crearTarjeta(d) {
    var li = document.createElement("li");
    li.className = "card";
    li.dataset.id = d.id;

    var top = document.createElement("div");
    top.className = "card-top";
    var nombre = document.createElement("h3");
    nombre.className = "card-name";
    nombre.textContent = d.nombre;
    var precio = document.createElement("span");
    precio.className = "card-price";
    precio.textContent = etiquetaPrecio[d.precio] || "€€";
    precio.setAttribute("aria-hidden", "true");
    var precioSr = document.createElement("span");
    precioSr.className = "sr-only";
    precioSr.textContent = nombrePrecio[d.precio] || "precio medio";
    top.appendChild(nombre); top.appendChild(precio); top.appendChild(precioSr);
    li.appendChild(top);

    var meta = document.createElement("p");
    meta.className = "card-meta";
    var tipoEl = document.createElement("span");
    tipoEl.textContent = d.tipo || "Sin especificar";
    var sep = document.createElement("span");
    sep.className = "dot"; sep.setAttribute("aria-hidden", "true"); sep.textContent = "·";
    var zonaEl = document.createElement("span");
    zonaEl.textContent = d.zona || "Sin especificar";
    meta.appendChild(tipoEl); meta.appendChild(sep); meta.appendChild(zonaEl);
    var puntoUnico = (d.sedes && d.sedes.length) ? null : puntosDe(d, false)[0];
    var textoH = puntoUnico ? horarioDe(puntoUnico) : "";
    if (textoH) {
      var sepH = sep.cloneNode(true);
      var hEl = document.createElement("span");
      hEl.className = "card-horario " + (estaAbierto(puntoUnico) ? "abierto" : "cerrado");
      hEl.textContent = textoH;
      meta.appendChild(sepH); meta.appendChild(hEl);
    }

    var dist = formatoDistancia(distanciaMin(d));
    if (dist) {
      var sep2 = sep.cloneNode(true);
      var distEl = document.createElement("span");
      distEl.className = "card-dist";
      distEl.textContent = dist;
      meta.appendChild(sep2); meta.appendChild(distEl);
    }
    li.appendChild(meta);

    if (d.flag) {
      var nota = document.createElement("p");
      nota.className = "flag";
      nota.textContent = d.flag;
      li.appendChild(nota);
    }


    var sedes = d.sedes || [];

    // Si hay un filtro de zona puesto, solo se enseñan los locales de esa
    // zona — los demás ahora mismo no tocan.
    var sedesAMostrar = sedes;
    if (sedes.length > 1 && state.zonas.length) {
      var filtradas = sedes.filter(function (s) { return state.zonas.indexOf(grupoZona(s.zona || d.zona)) !== -1; });
      if (filtradas.length) sedesAMostrar = filtradas;
    }

    // Con tu ubicación conocida, el local más cercano va primero.
    var distanciaSede = function (s) {
      var clave = claveGeo(d.nombre, s.direccion, s.zona || d.zona, s.nombre);
      return (miPos && geoUtil(s.geo, clave)) ? distanciaM(miPos, s.geo) : Infinity;
    };
    if (miPos && sedesAMostrar.length > 1) {
      sedesAMostrar = sedesAMostrar.slice().sort(function (a, b) {
        var da = distanciaSede(a), db = distanciaSede(b);
        return da === db ? comparar(a.nombre, b.nombre) : da - db;
      });
    }

    function bloqueSede(s) {
      var bloque = document.createElement("div");
      bloque.className = "sede-block";
      var nombreSede = document.createElement("p");
      nombreSede.className = "sede-nombre";
      nombreSede.textContent = s.nombre;
      var dSede = formatoDistancia(distanciaSede(s));
      if (dSede) {
        var dist = document.createElement("span");
        dist.className = "card-dist sede-dist";
        dist.textContent = dSede;
        nombreSede.appendChild(document.createTextNode(" "));
        nombreSede.appendChild(dist);
      }
      var hSede = horarioDe(s);
      if (hSede) {
        var hs = document.createElement("span");
        hs.className = "card-horario sede-dist " + (estaAbierto(s) ? "abierto" : "cerrado");
        hs.textContent = " · " + hSede;
        nombreSede.appendChild(hs);
      }
      bloque.appendChild(nombreSede);
      var enlacesSede = document.createElement("div");
      enlacesSede.className = "card-links";
      // El nombre del local ya suele decir el barrio («Lateral Bilbao»), así
      // que no se repite la zona en la búsqueda del mapa.
      var mapaSede = urlMapa({ nombre: d.nombre + " " + s.nombre, zona: "", direccion: s.direccion });
      construirPildoras(d.nombre + " (" + s.nombre + ")", s.carta, s.reserva, mapaSede)
        .forEach(function (p) { enlacesSede.appendChild(p); });
      bloque.appendChild(enlacesSede);
      return bloque;
    }

    if (sedesAMostrar.length > 1) {
      // Varios locales: plegados, para que una cadena de 13 no ocupe media
      // pantalla. El botón dice cuántos hay y, si se sabe, cuál pilla cerca.
      var grupo = document.createElement("div");
      grupo.className = "sedes-group";
      grupo.id = "sedes-" + d.id;
      sedesAMostrar.forEach(function (s) { grupo.appendChild(bloqueSede(s)); });

      var abierto = !!idsSedesAbiertas[d.id];
      grupo.hidden = !abierto;

      var toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "sedes-toggle";
      toggle.setAttribute("aria-controls", grupo.id);

      var etiqueta = document.createElement("span");
      var pista = document.createElement("span");
      pista.className = "sedes-pista";
      var masCercano = sedesAMostrar[0];
      var dCercano = formatoDistancia(distanciaSede(masCercano));

      var pintarToggle = function () {
        etiqueta.textContent = (abierto ? "Ocultar los " : "Ver los ") + sedesAMostrar.length + " locales";
        pista.textContent = !abierto && dCercano ? "el más cercano, " + masCercano.nombre + " " + dCercano : "";
        toggle.setAttribute("aria-expanded", abierto ? "true" : "false");
        toggle.setAttribute("aria-label", (abierto ? "Ocultar los " : "Ver los ") + sedesAMostrar.length +
          " locales de " + d.nombre);
      };
      pintarToggle();

      toggle.appendChild(etiqueta);
      toggle.appendChild(pista);
      toggle.addEventListener("click", function () {
        abierto = !abierto;
        if (abierto) idsSedesAbiertas[d.id] = true; else delete idsSedesAbiertas[d.id];
        grupo.hidden = !abierto;
        if (abierto) aparecer(grupo);
        pintarToggle();
      });

      li.appendChild(toggle);
      li.appendChild(grupo);
    } else if (sedesAMostrar.length === 1 && sedes.length > 1) {
      // El filtro ha dejado un solo local: se enseña directamente, sin plegar.
      var unico = document.createElement("div");
      unico.className = "sedes-group";
      unico.appendChild(bloqueSede(sedesAMostrar[0]));
      li.appendChild(unico);
    } else {
      // Sin sedes, o una sola (que si la hay, manda sobre los campos sueltos):
      // se comporta exactamente igual que un restaurante normal.
      var unica = sedes.length === 1 ? sedes[0] : null;
      var carta = unica ? unica.carta : d.carta;
      var reserva = unica ? unica.reserva : d.reserva;
      var mapaHref = unica ? urlMapa({ nombre: d.nombre + " " + unica.nombre, zona: "", direccion: unica.direccion }) : urlMapa(d);

      var enlaces = document.createElement("div");
      enlaces.className = "card-links";
      construirPildoras(d.nombre, carta, reserva, mapaHref).forEach(function (p) { enlaces.appendChild(p); });
      li.appendChild(enlaces);
    }

    if (marcasDisponibles) {
      var otros = otrasMarcas(d);
      if (otros.length) {
        var porEstado = { quiero: [], visitado: [] };
        otros.forEach(function (o) { porEstado[o.estado].push(o.quien); });
        var frases = [];
        if (porEstado.quiero.length) frases.push((porEstado.quiero.length === 1 ? "Quiere ir: " : "Quieren ir: ") + porEstado.quiero.join(", "));
        if (porEstado.visitado.length) frases.push((porEstado.visitado.length === 1 ? "Ya ha ido: " : "Ya han ido: ") + porEstado.visitado.join(", "));
        var lineaOtros = document.createElement("p");
        lineaOtros.className = "card-otros";
        lineaOtros.textContent = frases.join(" · ");
        li.appendChild(lineaOtros);
      }

      var filaMarcas = document.createElement("div");
      filaMarcas.className = "card-marcas";
      var actual = miMarca(d);
      ["quiero", "visitado"].forEach(function (estado) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "marca-btn " + estado;
        b.textContent = ETIQUETA_MARCA[estado];
        b.setAttribute("aria-pressed", actual === estado ? "true" : "false");
        b.setAttribute("aria-label", ETIQUETA_MARCA[estado] + " a " + d.nombre);
        b.addEventListener("click", function () { cambiarMarca(d, estado); });
        filaMarcas.appendChild(b);
      });
      li.appendChild(filaMarcas);
    }

    var acciones = document.createElement("div");
    acciones.className = "card-actions";
    var btnEditar = document.createElement("button");
    btnEditar.type = "button"; btnEditar.textContent = "Editar";
    btnEditar.setAttribute("aria-label", "Editar " + d.nombre);
    btnEditar.addEventListener("click", function () { abrirPanel(d); });

    var btnBorrar = document.createElement("button");
    btnBorrar.type = "button"; btnBorrar.className = "danger"; btnBorrar.textContent = "Eliminar";
    btnBorrar.setAttribute("aria-label", "Eliminar " + d.nombre);
    // Sin «¿Seguro?»: el aviso trae «Deshacer», que es más rápido y perdona igual
    btnBorrar.addEventListener("click", function () { eliminar(d); });

    acciones.appendChild(btnEditar); acciones.appendChild(btnBorrar);
    li.appendChild(acciones);

    // Acciones que aparecen al deslizar la tarjeta a la izquierda (como en
    // Mail). Duplican los botones de arriba, así que no se anuncian ni se
    // alcanzan con el tabulador.
    var capa = document.createElement("div");
    capa.className = "card-deslizar";
    capa.setAttribute("aria-hidden", "true");
    var dEditar = document.createElement("button");
    dEditar.type = "button"; dEditar.tabIndex = -1; dEditar.className = "deslizar-editar";
    dEditar.innerHTML = ICONOS.lapiz + "<span>Editar</span>";
    dEditar.addEventListener("click", function () { cerrarDeslizado(); abrirPanel(d); });
    var dBorrar = document.createElement("button");
    dBorrar.type = "button"; dBorrar.tabIndex = -1; dBorrar.className = "deslizar-borrar";
    dBorrar.innerHTML = ICONOS.papelera + "<span>Eliminar</span>";
    dBorrar.addEventListener("click", function () { borrarDeslizando(li, d, 0); });
    capa.appendChild(dEditar); capa.appendChild(dBorrar);
    li.appendChild(capa);

    return li;
  }

  function render() {
    var items = ordenar(data.filter(coincide));
    $("actualizando").hidden = !cargando;

    // Primera carga sin nada guardado: siluetas de tarjeta, no «lista vacía»
    if (cargando && !data.length && state.vista !== "mapa") {
      contador.textContent = "Cargando…";
      vacio.hidden = true;
      var siluetas = document.createDocumentFragment();
      for (var k = 0; k < 3; k++) {
        var sil = document.createElement("li");
        sil.className = "card silueta";
        sil.setAttribute("aria-hidden", "true");
        sil.innerHTML = '<span class="sil-linea larga"></span><span class="sil-linea"></span><span class="sil-pildoras"><span></span><span></span></span>';
        siluetas.appendChild(sil);
      }
      lista.replaceChildren(siluetas);
      return;
    }

    contador.replaceChildren();
    var fuerte = document.createElement("span");
    fuerte.className = "count";
    fuerte.textContent = String(items.length);
    contador.appendChild(fuerte);
    contador.appendChild(document.createTextNode(" de " + data.length + (data.length === 1 ? " restaurante" : " restaurantes")));

    btnLimpiar.hidden = !hayFiltros();
    pintarEstadoFiltros(items.length);

    aplicarVista();

    if (state.vista === "mapa") {
      lista.replaceChildren();
      vacio.hidden = true;
      pintarMapa(items);
      return;
    }

    if (items.length === 0) {
      lista.replaceChildren();
      vacio.hidden = false;
      vacio.replaceChildren();
      var p = document.createElement("p");
      if (data.length === 0) {
        p.textContent = "La lista está vacía. Añade el primer sitio al que quieras volver.";
        var b = document.createElement("button");
        b.type = "button"; b.textContent = "Añadir un restaurante";
        b.addEventListener("click", function () { abrirPanel(null); });
        vacio.appendChild(p); vacio.appendChild(b);
      } else {
        p.textContent = "Ningún restaurante coincide con esos filtros.";
        vacio.appendChild(p);
        var frase = $("search").value.trim();
        if (frase) {
          var bi = document.createElement("button");
          bi.type = "button"; bi.textContent = "Buscar «" + frase + "» como filtros";
          bi.addEventListener("click", interpretarFrase);
          vacio.appendChild(bi);
        }
      }
      return;
    }
    vacio.hidden = true;
    var antes = medirTarjetas();
    var frag = document.createDocumentFragment();
    items.forEach(function (d) { frag.appendChild(crearTarjeta(d)); });
    lista.replaceChildren(frag);
    animarTarjetas(antes);
  }

  /* Al filtrar u ordenar, cada tarjeta que sigue se desliza desde donde
     estaba hasta su nuevo sitio (FLIP) y las nuevas aparecen fundiéndose.
     Solo se miden las que están cerca de la pantalla. */
  function medirTarjetas() {
    if (!lista.firstElementChild || !lista.animate) return null;
    var pos = Object.create(null), alto = window.innerHeight;
    for (var c = lista.firstElementChild; c; c = c.nextElementSibling) {
      var r = c.getBoundingClientRect();
      if (r.bottom > -alto && r.top < alto * 2) pos[c.dataset.id] = r.top;
    }
    return pos;
  }
  function animarTarjetas(antes) {
    if (!antes || gesto) return;
    var quieto = menosMovimiento && menosMovimiento.matches, alto = window.innerHeight;
    for (var c = lista.firstElementChild; c; c = c.nextElementSibling) {
      var r = c.getBoundingClientRect();
      if (r.bottom < 0 || r.top > alto) continue;
      var y0 = antes[c.dataset.id];
      if (y0 === undefined) {
        c.animate(quieto ? [{ opacity: 0 }, { opacity: 1 }]
                         : [{ opacity: 0, transform: "scale(0.97)" }, { opacity: 1, transform: "none" }],
                  { duration: 260, easing: "cubic-bezier(0.32, 0.72, 0, 1)" });
      } else if (!quieto && Math.abs(y0 - r.top) > 1) {
        c.animate([{ transform: "translateY(" + (y0 - r.top).toFixed(1) + "px)" }, { transform: "none" }],
                  { duration: 380, easing: "cubic-bezier(0.32, 0.72, 0, 1)" });
      }
    }
  }

  // Fundido de toda la pantalla (cambio de tema, lista ↔ mapa) donde el
  // navegador lo sabe hacer; si no, o con menos movimiento, cambio directo.
  function conFundido(fn) {
    if (!document.startViewTransition || (menosMovimiento && menosMovimiento.matches)) { fn(); return; }
    document.startViewTransition(fn);
  }

  /* ============================================================
     16 ter. Mapa, ubicación y distancias
     ============================================================ */

  var MADRID = [40.4168, -3.7038];
  var BBOX_MADRID = { latMin: 39.85, latMax: 41.2, lngMin: -4.6, lngMax: -3.0 };  // Comunidad de Madrid, con margen
  var VIEWBOX_CIUDAD = "-3.90,40.58,-3.50,40.30";   // ciudad de Madrid (lon,lat NO · lon,lat SE) para buscar por nombre
  var NOMINATIM = "https://nominatim.openstreetmap.org/search";
  // Nominatim exige como mucho 1 petición por segundo. (El gancho de
  // abajo solo lo usan las pruebas automáticas para no esperar de verdad.)
  var GEO_PAUSA_MS = typeof window.__GORDITOS_PAUSA_GEO_TEST === "number" ? window.__GORDITOS_PAUSA_GEO_TEST : 1100;
  var TIPOS_COMIDA = ["restaurant", "cafe", "bar", "pub", "fast_food", "food_court", "ice_cream", "biergarten"];

  var mapa = null, capaRest = null, capaTeselas = null, marcadorYo = null, circuloYo = null;

  /* Mapas base. Por defecto, OpenStreetMap: no necesita clave ni cuenta de
     nadie, así que no se puede romper solo. Para el tema oscuro se invierten
     sus colores por CSS, que es un apaño pero no depende de terceros.
     Si pones una clave de CARTO en config.js, se usan sus mapas, que tienen
     un claro y un oscuro de verdad. Ojo: CARTO exige clave desde agosto de
     2026 y está retirando estos mapas de imagen, así que puede volver a
     romperse; por eso no es lo predeterminado. */
  var TESELAS = {
    osm: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    cartoClaro: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=",   // el más parecido a Mapas
    cartoOscuro: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key="
  };
  var ATRIB_OSM = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
  var ATRIB_CARTO = ATRIB_OSM + ' · &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>';

  function temaOscuro() {
    var t = document.documentElement.getAttribute("data-theme");
    if (t === "dark") return true;
    if (t === "light") return false;
    return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  }

  function ponerTeselas() {
    if (!mapa || !window.L) return;
    var oscuro = temaOscuro();
    var conCarto = !!CARTO_KEY;
    var url = conCarto
      ? (oscuro ? TESELAS.cartoOscuro : TESELAS.cartoClaro) + encodeURIComponent(CARTO_KEY)
      : TESELAS.osm;

    // Sin CARTO, el oscuro se consigue invirtiendo el mapa claro.
    var contenedor = $("map");
    if (contenedor) contenedor.classList.toggle("osm-oscuro", !conCarto && oscuro);

    if (capaTeselas && capaTeselas._urlGorditos === url) return;
    if (capaTeselas && typeof mapa.removeLayer === "function") mapa.removeLayer(capaTeselas);
    capaTeselas = window.L.tileLayer(url, conCarto
      ? { maxZoom: 20, subdomains: "abcd", attribution: ATRIB_CARTO }
      : { maxZoom: 19, attribution: ATRIB_OSM });
    capaTeselas._urlGorditos = url;
    capaTeselas.addTo(mapa);
  }

  // Al cambiar el tema (botón o ajuste del sistema) cambian las imágenes.
  function actualizarTeselas() { ponerTeselas(); }
  if (window.matchMedia) {
    var consultaOscuro = window.matchMedia("(prefers-color-scheme: dark)");
    if (consultaOscuro.addEventListener) consultaOscuro.addEventListener("change", actualizarTeselas);
    else if (consultaOscuro.addListener) consultaOscuro.addListener(actualizarTeselas);
  }
  var marcadoresPorId = Object.create(null);
  var ultimosItems = [];
  var miPos = null, posRender = null, vigilancia = null;
  var ubicacionDenegada = false, esperandoCentrar = false;

  // Encuadre: se ajusta según van llegando puntos, hasta que TÚ muevas el mapa.
  var firmaAjuste = null, puntosEncuadrados = 0, usuarioMovioMapa = false, moviendoYo = false;
  function reiniciarEncuadre() { firmaAjuste = null; puntosEncuadrados = 0; usuarioMovioMapa = false; }

  function distanciaM(a, b) {
    var R = 6371000, rad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function formatoDistancia(m) {
    if (!isFinite(m)) return "";
    if (m < 1000) return "a " + Math.max(10, Math.round(m / 10) * 10) + " m";
    return "a " + (m / 1000).toLocaleString("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " km";
  }

  function zonaLimpia(z) {
    var v = texto(z);
    if (/^Varias zonas/i.test(v) || /^Sin (confirmar|especificar)/i.test(v)) return "";
    return v.replace(/\([^)]*\)/g, " ").split("/")[0].replace(/\s+/g, " ").trim();
  }

  /**
   * Qué se busca para situar un punto: su dirección si la tiene; si no,
   * el nombre del restaurante (y la zona, para elegir el local bueno).
   * Las coordenadas guardadas llevan esta clave: si cambia (nueva
   * dirección, otro nombre), se vuelven a buscar solas.
   */
  function claveGeo(nombre, direccion, zona, sede) {
    return direccion ? direccion : "@" + nombre + "|" + zonaLimpia(zona) + (sede ? "|" + sede : "");
  }

  /**
   * Los puntos físicos de un restaurante: sus sedes si las tiene, o él
   * mismo. Con un filtro de zona puesto, solo las sedes de esa zona
   * (igual que hace la tarjeta).
   */
  function puntosDe(d, respetarZona) {
    var sedes = d.sedes || [];
    if (!sedes.length) {
      return [{ sede: -1, nombreSede: "", direccion: d.direccion, zona: d.zona, geo: d.geo, carta: d.carta, reserva: d.reserva,
                horario: d.horario, clave: claveGeo(d.nombre, d.direccion, d.zona, "") }];
    }
    var puntos = sedes.map(function (s, i) {
      var zona = s.zona || d.zona;
      return { sede: i, nombreSede: sedes.length > 1 ? s.nombre : "", direccion: s.direccion, zona: zona, geo: s.geo,
               carta: s.carta, reserva: s.reserva, horario: s.horario, clave: claveGeo(d.nombre, s.direccion, zona, s.nombre) };
    });
    if (respetarZona && state.zonas.length) {
      var f = puntos.filter(function (p) { return state.zonas.indexOf(grupoZona(p.zona)) !== -1; });
      if (f.length) return f;
    }
    return puntos;
  }

  function distanciaMin(d) {
    if (!miPos) return Infinity;
    var min = Infinity;
    puntosDe(d, false).forEach(function (p) {
      if (geoUtil(p.geo, p.clave)) min = Math.min(min, distanciaM(miPos, p.geo));
    });
    return min;
  }

  /* ---- Horarios (formato de OpenStreetMap) ---- */

  var DIAS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];   // 0 = domingo, como getDay()
  var DIA_LARGO = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

  function indiceDia(d) { return DIAS.indexOf(d); }

  /**
   * Devuelve { ok:true, franjas:[{dia, desde, hasta}] } con los minutos
   * desde medianoche, o { ok:false } si hay algo que no se entiende.
   * Las franjas que cruzan medianoche se parten en dos días.
   */
  function interpretarHorario(texto) {
    var t = String(texto || "").trim();
    if (!t) return { ok: false };
    if (/24\/7/.test(t)) {
      var todo = [];
      for (var d = 0; d < 7; d++) todo.push({ dia: d, desde: 0, hasta: 1440 });
      return { ok: true, franjas: todo, siempre: true };
    }

    // Cosas fuera del subconjunto: meses, semanas, días ordinales, solar, vacaciones con horario
    if (/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|week|sunrise|sunset|dawn|dusk|easter)\b/i.test(t)) return { ok: false };
    if (/\[[^\]]*\]/.test(t)) return { ok: false };

    var franjas = [];
    var reglas = t.split(";");

    for (var i = 0; i < reglas.length; i++) {
      var regla = reglas[i].trim();
      if (!regla) continue;
      if (/^(PH|SH)\b/i.test(regla)) continue;               // festivos: se ignoran, no se inventan
      regla = regla.replace(/\b(PH|SH)\b/gi, "").trim();
      if (!regla) continue;

      // Días al principio (opcional); si no hay, vale para todos
      var dias = [];
      var resto = regla;
      var mDias = /^((?:Mo|Tu|We|Th|Fr|Sa|Su)(?:\s*-\s*(?:Mo|Tu|We|Th|Fr|Sa|Su))?(?:\s*,\s*(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:\s*-\s*(?:Mo|Tu|We|Th|Fr|Sa|Su))?)*)\s*(.*)$/.exec(regla);
      if (mDias) {
        resto = mDias[2].trim();
        var trozos = mDias[1].split(",");
        for (var j = 0; j < trozos.length; j++) {
          var trozo = trozos[j].trim();
          var rango = /^(\w\w)\s*-\s*(\w\w)$/.exec(trozo);
          if (rango) {
            var a = indiceDia(rango[1]), b = indiceDia(rango[2]);
            if (a === -1 || b === -1) return { ok: false };
            for (var k = 0; k < 7; k++) {                     // recorre en círculo (Fr-Mo)
              var d2 = (a + k) % 7;
              dias.push(d2);
              if (d2 === b) break;
            }
          } else {
            var uno = indiceDia(trozo);
            if (uno === -1) return { ok: false };
            dias.push(uno);
          }
        }
      } else {
        for (var d3 = 0; d3 < 7; d3++) dias.push(d3);
      }

      // Una regla posterior sustituye a las anteriores para esos días
      // (también la parte de madrugada que venía de una franja nocturna).
      franjas = franjas.filter(function (f) { return dias.indexOf(f.origen) === -1; });

      // Cerrado ese día
      if (/^(off|closed)$/i.test(resto)) continue;
      if (!resto) return { ok: false };

      // Franjas horarias
      var horas = resto.split(",");
      for (var h = 0; h < horas.length; h++) {
        var m = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(horas[h].trim());
        if (!m) return { ok: false };
        var desde = Number(m[1]) * 60 + Number(m[2]);
        var hasta = Number(m[3]) * 60 + Number(m[4]);
        if (desde > 1440 || hasta > 1440) return { ok: false };

        dias.forEach(function (dia) {
          if (hasta > desde) {
            franjas.push({ dia: dia, desde: desde, hasta: hasta, origen: dia });
          } else {
            // Cruza medianoche: hasta el final del día y sigue al siguiente
            franjas.push({ dia: dia, desde: desde, hasta: 1440, origen: dia });
            franjas.push({ dia: (dia + 1) % 7, desde: 0, hasta: hasta, origen: dia });
          }
        });
      }
    }

    if (!franjas.length) return { ok: false };
    return { ok: true, franjas: franjas };
  }

  /* ---- Horario escrito a mano, en español ----
     Se acepta lo natural: «L-V 13-16, 20-23:30; S-D 13-24; lunes cerrado»,
     «de lunes a viernes de 13:00 a 16:00», «todos los días 12-24»… y
     también el formato de OpenStreetMap tal cual. Se guarda siempre en
     formato OpenStreetMap, que es lo que entiende el resto de la app. */

  var DIA_ES = {
    l: "Mo", lu: "Mo", lun: "Mo", lunes: "Mo", mo: "Mo",
    m: "Tu", ma: "Tu", mar: "Tu", martes: "Tu", tu: "Tu",
    x: "We", mi: "We", mie: "We", miercoles: "We", we: "We",
    j: "Th", ju: "Th", jue: "Th", jueves: "Th", th: "Th",
    v: "Fr", vi: "Fr", vie: "Fr", viernes: "Fr", fr: "Fr",
    s: "Sa", sa: "Sa", sab: "Sa", sabado: "Sa", sabados: "Sa",
    d: "Su", "do": "Su", dom: "Su", domingo: "Su", domingos: "Su", su: "Su"
  };

  function horaEs(t) {
    var m = /^(\d{1,2})(?:[:.h](\d{2}))?h?$/.exec(t);
    if (!m) return null;
    var h = Number(m[1]), mi = m[2] ? Number(m[2]) : 0;
    if (h > 24 || mi > 59 || (h === 24 && mi > 0)) return null;
    return (h < 10 ? "0" : "") + h + ":" + (mi < 10 ? "0" : "") + mi;
  }

  /** Lo escrito → { vacio } | { ok:true, oh } | { ok:false } */
  function textoAHorario(txt) {
    var bruto = String(txt || "").trim();
    if (!bruto) return { vacio: true };
    if (/^24\/7$/.test(bruto)) return { ok: true, oh: "24/7" };
    // ¿Viene ya en formato OpenStreetMap? Si no se entiende así, se prueba en español.
    if (/\b(Mo|Tu|We|Th|Fr|Sa|Su)\b/.test(bruto) && interpretarHorario(bruto).ok) return { ok: true, oh: bruto };

    var t = bruto.toLowerCase();
    if (t.normalize) t = t.normalize("NFD").replace(/[̀-ͯ]/g, "");
    t = t.replace(/[–—]/g, "-")
         .replace(/\b(todos los dias|todos|cada dia|a diario|diario|toda la semana)\b/g, " l-d ")
         .replace(/\b(cerrados?|cierra|closed|descansa|descanso)\b/g, " off ")
         .replace(/\b24 ?(h|horas)\b/g, " 00:00-24:00 ")
         .replace(/\b(de|del|desde|las|los|el)\b/g, " ")
         .replace(/\s+(a|al|hasta)\s+/g, "-")
         .replace(/\s+y\s+/g, ",")
         .replace(/\s*-\s*/g, "-")
         .replace(/\s*,\s*/g, ",")
         .replace(/[ \t]+/g, " ");

    var abiertas = [], cerradas = [];
    var reglas = t.split(/;|\n|\.\s+(?=[a-z])/);
    for (var i = 0; i < reglas.length; i++) {
      var r = reglas[i].replace(/\.$/, "").trim();
      if (!r) continue;
      if (/^festivos?\b/.test(r)) continue;                  // festivos: no se guardan

      var dias = "Mo-Su", resto = r;
      var m = /^([a-z]+(?:[-,][a-z]+)*)\s*:?\s*(.*)$/.exec(r);
      if (m) {
        var trozos = m[1].split(","), partes = [], todosDias = true;
        for (var j = 0; j < trozos.length && todosDias; j++) {
          var rango = trozos[j].split("-");
          if (rango.length > 2) { todosDias = false; break; }
          var a = DIA_ES[rango[0]], b = rango.length === 2 ? DIA_ES[rango[1]] : null;
          if (!a || (rango.length === 2 && !b)) { todosDias = false; break; }
          partes.push(b ? a + "-" + b : a);
        }
        if (todosDias) { dias = partes.join(","); resto = m[2].trim(); }
      }

      if (resto === "off") { cerradas.push(dias + " off"); continue; }
      if (!resto) return { ok: false };
      var franjas = resto.split(",");
      var salida = [];
      for (var k = 0; k < franjas.length; k++) {
        var ab = franjas[k].trim().split("-");
        if (ab.length !== 2) return { ok: false };
        var desde = horaEs(ab[0]), hasta = horaEs(ab[1]);
        if (!desde || !hasta) return { ok: false };
        if (hasta === "00:00") hasta = "24:00";
        salida.push(desde + "-" + hasta);
      }
      abiertas.push(dias + " " + salida.join(","));
    }
    // Los días cerrados van al final: en este formato, la última regla manda.
    var oh = abiertas.concat(cerradas).join("; ");
    return interpretarHorario(oh).ok ? { ok: true, oh: oh } : { ok: false };
  }

  /** Formato OpenStreetMap → como se escribe en español (para editarlo). */
  function osmATexto(oh) {
    var MAPA = { Mo: "L", Tu: "M", We: "X", Th: "J", Fr: "V", Sa: "S", Su: "D" };
    return String(oh || "").split(";").map(function (r) { return r.trim(); })
      .filter(function (r) { return r && !/^(PH|SH)\b/i.test(r); })
      .map(function (r) {
        return r.replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su)\b/g, function (x) { return MAPA[x]; })
                .replace(/\b(off|closed)\b/gi, "cerrado")
                .replace(/,(?=\d)/g, ", ");
      }).join("; ");
  }

  /** Estado ahora mismo: { abierto, cierra } o { abierto:false, abre } */
  function estadoHorario(horario, ahora) {
    var info = interpretarHorario(horario);
    if (!info.ok) return null;
    var dia = ahora.getDay(), minuto = ahora.getHours() * 60 + ahora.getMinutes();

    if (info.siempre) return { abierto: true, siempre: true };

    var dentro = info.franjas.filter(function (f) { return f.dia === dia && minuto >= f.desde && minuto < f.hasta; })[0];
    if (dentro) {
      // Si otra franja empieza justo cuando acaba esta, se considera continuo
      // También al pasar la medianoche: «Fr 20:00-02:00» cierra a las 02:00.
      var cierre = dentro.hasta, diaCierre = dia, saltos = 0;
      function seguir(d, c) {
        for (var i = 0; i < info.franjas.length; i++) {
          var f = info.franjas[i];
          if (f.dia === d && f.desde === c && f.hasta > c) return f.hasta;
        }
        return null;
      }
      for (;;) {
        var sig = seguir(diaCierre, cierre);
        if (sig !== null) { cierre = sig; continue; }
        if (cierre === 1440 && saltos < 7) {
          var sig2 = seguir((diaCierre + 1) % 7, 0);
          if (sig2 !== null) { diaCierre = (diaCierre + 1) % 7; cierre = sig2; saltos++; continue; }
        }
        break;
      }
      return { abierto: true, cierra: cierre, cierraDia: diaCierre };
    }

    // Próxima apertura, mirando hasta 7 días por delante
    for (var salto = 0; salto < 8; salto++) {
      var d = (dia + salto) % 7;
      var candidatas = info.franjas.filter(function (f) {
        return f.dia === d && (salto > 0 || f.desde > minuto) && f.desde > 0;
      }).sort(function (a, b) { return a.desde - b.desde; });
      if (candidatas.length) return { abierto: false, abre: candidatas[0].desde, abreDia: d, abreEn: salto };
    }
    return { abierto: false };
  }

  function hhmm(min) {
    var h = Math.floor(min / 60) % 24, m = min % 60;
    return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m;
  }

  /** Texto corto para la tarjeta. Devuelve "" si el horario no se entiende. */
  function textoHorario(horario, ahora) {
    var e = estadoHorario(horario, ahora || new Date());
    if (!e) return "";
    if (e.siempre) return "Abierto siempre";
    if (e.abierto) return "Abierto · cierra a las " + hhmm(e.cierra);
    if (e.abre === undefined) return "Cerrado";
    if (e.abreEn === 0) return "Cerrado · abre a las " + hhmm(e.abre);
    if (e.abreEn === 1) return "Cerrado · abre mañana a las " + hhmm(e.abre);
    return "Cerrado · abre el " + DIA_LARGO[e.abreDia] + " a las " + hhmm(e.abre);
  }

  var HORARIO_REINTENTO_MS = 30 * 24 * 3600 * 1000;   // se vuelve a mirar al mes
  var OVERPASS = "https://overpass-api.de/api/interpreter";
  // Overpass es más pesado que un geocodificador: se le pide más despacio.
  // (El gancho es solo para las pruebas automáticas, como en Nominatim.)
  var OVERPASS_PAUSA_MS = typeof window.__GORDITOS_PAUSA_GEO_TEST === "number" ? window.__GORDITOS_PAUSA_GEO_TEST : 2200;

  function horarioVigente(h) {
    if (h && h.m) return true;               // el tuyo no caduca
    return !!(h && h.t && Date.now() - h.t < HORARIO_REINTENTO_MS);
  }

  /** Texto para la tarjeta, o "" si no hay horario o no se entiende. */
  function horarioDe(p) {
    if (!p.horario || p.horario.nf || !p.horario.oh) return "";
    return textoHorario(p.horario.oh, new Date());
  }

  function estaAbierto(p) {
    if (!p.horario || p.horario.nf || !p.horario.oh) return null;   // null = no se sabe
    var e = estadoHorario(p.horario.oh, new Date());
    return e ? !!e.abierto : null;
  }

  /* ---- Direcciones y nombres → coordenadas ---- */

  // Sube cuando cambia la forma de buscar: lo situado con una versión
  // anterior se revisa solo (sin quitarlo del mapa mientras tanto).
  var GEO_VERSION = 4;
  var NF_REINTENTO_MS = 30 * 24 * 3600 * 1000;    // «no encontrada» se reintenta al mes

  function geoCaducada(geo) {
    if (!geo) return true;
    if ((geo.v || 1) < GEO_VERSION) return true;
    return !!geo.nf && (!geo.t || Date.now() - geo.t > NF_REINTENTO_MS);
  }

  var ABREVIATURAS = [
    [/(^|[\s,])(?:c\/|c\.\/|cl\.|cll\.|c\.)\s*/gi, "$1Calle "],
    [/(^|[\s,])(?:avda\.?|avd\.|av\.)\s*/gi, "$1Avenida "],
    [/(^|[\s,])(?:pza\.?|plza\.?|pl\.)\s*/gi, "$1Plaza "],
    [/(^|[\s,])(?:gta\.?|glta\.?)\s*/gi, "$1Glorieta "],
    [/(^|[\s,])(?:p\.?\s?[º°]\.?|pso\.)\s*/gi, "$1Paseo "],
    [/(^|[\s,])ctra\.?\s*/gi, "$1Carretera "],
    [/(^|[\s,])rda\.\s*/gi, "$1Ronda "],
    [/(^|[\s,])(?:trav\.|tv\.)\s*/gi, "$1Travesía "],
    [/(^|[\s,])gral\.?\s+/gi, "$1General "],
    [/(^|[\s,])sta\.?\s+/gi, "$1Santa "],
    [/(^|[\s,])sto\.?\s+/gi, "$1Santo "],
    [/(^|[\s,])[sS]\.\s+(?=[A-ZÁÉÍÓÚÑ])/g, "$1San "],
    [/(^|[\s,])fco\.?\s+/gi, "$1Francisco "],
    [/(^|[\s,])ppe\.?\s+/gi, "$1Príncipe "],
    [/(^|[\s,])(?:prta|pta)\.?\s+/gi, "$1Puerta "],
    [/(^|[\s,])dra\.?\s+/gi, "$1Doctora "],
    [/(^|[\s,])dr\.?\s+/gi, "$1Doctor "],
    [/(^|[\s,])mtro\.?\s+/gi, "$1Maestro "],
    [/(^|[\s,])hnos\.?\s+/gi, "$1Hermanos "],
    [/(^|[\s,])ntra\.?\s+sra\.?\s+/gi, "$1Nuestra Señora "],
    [/(^|[\s,])pque\.?\s+/gi, "$1Parque "]
  ];
  var MUNICIPIOS = ["pozuelo de alarcon", "pozuelo", "majadahonda", "alcobendas", "la moraleja", "las rozas",
    "boadilla del monte", "san sebastian de los reyes", "tres cantos", "getafe", "leganes", "alcorcon",
    "mostoles", "fuenlabrada", "rivas-vaciamadrid", "rivas"];
  var SIN_PESO = ["calle", "avenida", "plaza", "paseo", "glorieta", "carretera", "ronda", "travesia", "callejon", "parque",
    "camino", "pasaje", "costanilla", "cuesta", "de", "del", "la", "las", "el", "los", "y", "madrid"];

  /** Limpia una dirección escrita a mano y prepara lo que se le pregunta al buscador. */
  function prepararDireccion(dir, zona) {
    var s = texto(dir);
    s = s.replace(/[,\s]+(?:s\/n|s\.\s?n\.?|sin n[uú]mero)(?=[\s,.]|$)\.?/gi, "");        // «s/n»
    s = s.replace(/\s+[-–—]\s+/g, ", ").replace(/\s*[–—]\s*/g, ", ");                 // «7 – Madrid», «Moncloa - Aravaca»
    s = s.replace(/\([^)]*\)?/g, " ").replace(/\)/g, " ");                          // «(Pez tortilla Cara B)»
    s = s.replace(/(^|[\s,])(?:c\.\s?c\.|cco|cc|centro comercial)\b[^,]*/gi, "$1");  // centros comerciales
    s = s.replace(/[,\s]+(?:bajo|bajos|local|lc|piso|planta|esquina|esq)\b.*$/i, ""); // piso, local, esquina…
    ABREVIATURAS.forEach(function (r) { s = s.replace(r[0], r[1]); });
    s = s.replace(/\bn\.?\s?[º°]\.?\s*/gi, "");                                      // «nº 25»
    s = s.replace(/[,\s]+\d+\s?[º°ª].*$/, "");                                       // «2º izq.»
    s = s.replace(/\b(Calle|Avenida|Plaza|Paseo|Glorieta)\s+\1\b/gi, "$1");           // «C/ Calle …»
    s = s.replace(/\s+/g, " ").replace(/\s*,\s*/g, ", ").replace(/^[,\s]+|[,\s]+$/g, "").replace(/(, )+/g, ", ");

    // Municipio: el que va tras el código postal, o la zona si es un municipio. Si no, Madrid.
    // Si la dirección lo dice («28023 Madrid», «28222 Majadahonda»), manda eso; si no, se
    // deduce de la zona cuando la zona es un municipio (y entonces se prueba también Madrid).
    var municipio = "Madrid", municipioDeducido = false;
    var trasCp = /\b\d{5}\s+([^,]+)/.exec(s);
    if (trasCp) municipio = plano(trasCp[1]).trim() === "madrid" ? "Madrid" : trasCp[1].trim();
    else if (MUNICIPIOS.indexOf(plano(zona).trim()) !== -1) { municipio = texto(zona); municipioDeducido = true; }

    // Núcleo: la calle y su número, sin barrio, código postal ni segunda calle de esquina.
    var partes = s.replace(/\b\d{5}\b.*$/, "").split(",").map(texto).filter(Boolean);
    var calle = partes[0] || "", numero = "";
    var pegado = /^(.*?\D)\s+(\d+[a-zA-Z]?)(?:-\d+)?$/.exec(calle);                // «Avenida Felipe II 16»
    if (pegado) { calle = pegado[1].trim(); numero = pegado[2]; }
    else {
      for (var i = 1; i < Math.min(partes.length, 3); i++) {
        var n = /^(\d+[a-zA-Z]?)(?:[-\s].*)?$/.exec(partes[i]);
        if (n) { numero = n[1]; break; }
      }
    }
    // Sin el tipo de vía: «Callejón de Puigcerdà» → «Puigcerdà». Google y el
    // callejero oficial discrepan a menudo (calle/callejón/travesía), y el
    // buscador falla si se le pide un tipo que no es el suyo.
    var sinTipo = calle.replace(
      /^(?:calle|callej[oó]n|avenida|plaza|paseo|glorieta|carretera|ronda|traves[ií]a|camino|pasaje|costanilla|cuesta|bulevar)\s+(?:de\s+las|de\s+los|de\s+la|del|de|las|los|la|el)?\s*/i, "").trim();
    if (sinTipo.length < 3 || plano(sinTipo) === plano(calle)) sinTipo = "";

    var claves = clavesCalle(calle);

    var cp = (/\b(\d{5})\b/.exec(s) || [])[1] || "";

    return {
      limpia: s,
      calle: calle,
      cp: cp,
      municipio: municipio,
      nucleo: calle ? calle + (numero ? ", " + numero : "") + ", " + municipio : "",
      completa: /madrid/i.test(s) ? s : s + ", " + municipio,
      soloCalle: calle ? calle + ", " + municipio : "",
      nucleoMadrid: municipioDeducido && calle ? calle + (numero ? ", " + numero : "") + ", Madrid" : "",
      nucleoSinTipo: sinTipo ? sinTipo + (numero ? ", " + numero : "") + ", " + municipio : "",
      numero: numero,
      claves: claves
    };
  }

  function dentroDeMadrid(lat, lng) {
    return isFinite(lat) && isFinite(lng) &&
           lat >= BBOX_MADRID.latMin && lat <= BBOX_MADRID.latMax &&
           lng >= BBOX_MADRID.lngMin && lng <= BBOX_MADRID.lngMax;
  }

  function nombreLimpio(s) { return plano(s).replace(/[^a-z0-9]+/g, " ").trim(); }
  function nombreCoincide(a, b) {
    a = nombreLimpio(a); b = nombreLimpio(b);
    if (!a || !b) return false;
    // Por palabras enteras: «Fass» no debe casar con «Fassbinder».
    return (" " + a + " ").indexOf(" " + b + " ") !== -1 || (" " + b + " ").indexOf(" " + a + " ") !== -1;
  }

  /** Las palabras que distinguen una calle: sin tipo de vía, artículos ni números. */
  function clavesCalle(nombre) {
    return plano(nombre).replace(/[^a-z0-9]+/g, " ").split(" ")
      .filter(function (w) { return w.length >= 3 && SIN_PESO.indexOf(w) === -1 && !/^\d+$/.test(w); });
  }

  /** El nombre de la calle en la que ha caído un resultado del buscador. */
  function calleDeResultado(r) {
    var a = r.address || {};
    if (typeof a === "object") {
      var via = a.road || a.pedestrian || a.square || a.footway || a.path || a.cycleway;
      if (via) return String(via);
    }
    var cat = String(r.category || r["class"] || "");
    if (r.name && (cat === "highway" || cat === "place" || cat === "leisure")) return String(r.name);
    // Último recurso: el primer trozo con letras de la dirección completa.
    var trozos = String(r.display_name || (typeof r.address === "string" ? r.address : "")).split(",");
    for (var i = 0; i < trozos.length; i++) if (/[a-zA-ZÀ-ÿ]/.test(trozos[i])) return trozos[i].trim();
    return "";
  }

  /**
   * ¿El resultado está EN la calle que se pidió? Se compara el nombre de
   * la calle en los dos sentidos: que estén tus palabras y que no sobren
   * otras. Así «Calle del Príncipe» no acepta «Calle del Príncipe Carlos»,
   * aunque la contenga. Con 3 palabras o más se tolera una diferencia
   * (una errata, una palabra de menos).
   */
  function calleCoincide(calleResultado, claves) {
    if (!claves.length) return true;
    var suyas = clavesCalle(calleResultado);
    if (!suyas.length) return false;
    var faltan = claves.filter(function (c) { return suyas.indexOf(c) === -1; }).length;
    var sobran = suyas.filter(function (c) { return claves.indexOf(c) === -1; }).length;
    if (faltan === 0 && sobran === 0) return true;
    return claves.length >= 3 && faltan + sobran <= 1;
  }

  function coincideCalle(r, claves) {
    return calleCoincide(calleDeResultado(r), claves);
  }

  /** «Calle del Príncipe, 10»: dónde ha caído de verdad, para enseñarlo en el globo. */
  function etiquetaResultado(r) {
    var calle = calleDeResultado(r);
    var a = (r.address && typeof r.address === "object") ? r.address : {};
    var numero = a.house_number || r.portalNumber || "";
    return (calle + (numero ? ", " + numero : "")).slice(0, 120);
  }

  // Todas las peticiones pasan por aquí: respeta el ritmo de Nominatim
  // aunque se pidan varias a la vez.
  var ultimaPeticionGeo = 0;
  function esperarTurno(pausa) {
    var espera = Math.max(0, ultimaPeticionGeo + (pausa || GEO_PAUSA_MS) - Date.now());
    ultimaPeticionGeo = Date.now() + espera;
    return new Promise(function (r) { setTimeout(r, espera); });
  }

  /* ---- CartoCiudad (IGN): el callejero oficial, con los portales del
     Catastro y Correos. Se usa primero para las direcciones; si el
     navegador no deja llamarlo, se sigue con OpenStreetMap y ya está. ---- */

  var CARTOCIUDAD = "https://www.cartociudad.es/geocoder/api/geocoder/find";
  var TIPOS_CC = ["portal", "callejero", "carretera", "punto kilometrico"];
  var ccDisponible = true, ccFallos = 0;

  function pedirCartoCiudad(q) {
    if (!ccDisponible || typeof fetch !== "function") return Promise.resolve(null);
    return esperarTurno().then(function () {
      return fetch(CARTOCIUDAD + "?q=" + encodeURIComponent(q), { headers: { "Accept": "application/json" } });
    }).then(function (r) {
      if (!r.ok) throw new Error("http " + r.status);
      return r.json();
    }).then(function (j) {
      ccFallos = 0;
      return j;
    }).catch(function () {
      ccFallos += 1;
      // Si el navegador bloquea las llamadas (CORS), fallan todas por igual:
      // tras dos seguidas se deja de intentar durante esta sesión.
      if (ccFallos >= 2) ccDisponible = false;
      return null;
    });
  }

  /**
   * Traduce la respuesta de CartoCiudad. Su campo «state» dice con qué
   * exactitud ha respondido: 1 portal exacto; 2 y 3, el par o impar más
   * cercano de esa misma calle; 5 y 10, sin portales (queda aproximado).
   */
  function geoDesdeCartoCiudad(r, t, prep) {
    if (!r || typeof r !== "object") return null;
    var lat = Number(r.lat), lng = Number(r.lng);
    if (!isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0)) return null;
    if (!dentroDeMadrid(lat, lng)) return null;

    var tipo = plano(r.type || "");
    if (TIPOS_CC.indexOf(tipo) === -1) return null;                  // municipio, provincia…: demasiado grueso
    var calleCC = String(r.address || "").split(",")[0].replace(/\s+\d.*$/, "").trim();
    if (prep && !calleCoincide(calleCC, prep.claves)) return null;

    var estado = Number(r.state);
    var geo = { lat: lat, lng: lng, dir: t.clave, v: GEO_VERSION };
    if (calleCC) geo.en = (calleCC + (r.portalNumber ? ", " + r.portalNumber : "")).slice(0, 120);
    if (estado === 5 || estado === 10 || (tipo === "callejero" && prep && prep.numero)) geo.aprox = "calle";
    return geo;
  }

  function pedirNominatim(params) {
    if (typeof fetch !== "function") return Promise.reject(new Error("sin fetch"));
    return esperarTurno().then(function () {
      var qs = Object.keys(params).map(function (k) { return k + "=" + encodeURIComponent(params[k]); }).join("&");
      return fetch(NOMINATIM + "?format=jsonv2&countrycodes=es&accept-language=es&" + qs, { headers: { "Accept": "application/json" } });
    }).then(function (r) {
      if (!r.ok) throw new Error("http " + r.status);
      return r.json();
    }).then(function (arr) { return Array.isArray(arr) ? arr : []; });
  }

  /**
   * Busca un punto por pasos, del más preciso al menos, y solo acepta un
   * resultado si de verdad está en la calle que se pidió:
   *   1. la dirección en CartoCiudad (IGN), que tiene los portales
   *      oficiales del Catastro y Correos;
   *   2. la misma dirección en OpenStreetMap, en texto y en campos sueltos;
   *   3. el nombre del restaurante, solo en Madrid, solo si es un local
   *      de comida con ese nombre;
   *   4. la calle sin número: pin aproximado.
   * Si CartoCiudad solo sabe la calle, se guarda como respaldo y se sigue
   * buscando el portal exacto en OpenStreetMap antes de conformarse.
   * Devuelve las coordenadas, { nf: true } si no hay manera, o null si
   * falló la red (entonces no se guarda nada y se reintenta otro día).
   */
  function buscarCoordenadas(t) {
    var prep = t.direccion ? prepararDireccion(t.direccion, t.zona) : null;
    var claves = prep ? prep.claves : [];
    var pasos = [];
    if (prep && prep.nucleo) pasos.push({ q: prep.nucleo, motor: "cc" });
    if (prep && prep.nucleoSinTipo) pasos.push({ q: prep.nucleoSinTipo, motor: "cc" });
    if (prep && prep.nucleoMadrid) pasos.push({ q: prep.nucleoMadrid, motor: "cc" });
    if (prep && prep.nucleo) pasos.push({ q: prep.nucleo, conNumero: !!prep.numero });
    if (prep && prep.nucleoSinTipo) pasos.push({ q: prep.nucleoSinTipo, conNumero: !!prep.numero });
    if (prep && prep.nucleoMadrid) pasos.push({ q: prep.nucleoMadrid, conNumero: !!prep.numero });
    // Con el portal y la ciudad por separado, el buscador acierta en
    // direcciones españolas donde el texto seguido no le vale.
    if (prep && prep.numero && prep.calle) {
      var estructurada = { street: prep.numero + " " + prep.calle, city: prep.municipio };
      if (prep.cp) estructurada.postalcode = prep.cp;
      pasos.push({ params: estructurada, conNumero: true });
    }
    if (t.nombre && t.nombre !== "Sin nombre") pasos.push({ q: t.nombre, porNombre: true });
    if (prep && prep.soloCalle && prep.numero) pasos.push({ q: prep.soloCalle, aprox: "calle" });

    function elegir(paso, resultados) {
      var validos = resultados.filter(function (r) {
        if (!dentroDeMadrid(Number(r.lat), Number(r.lon))) return false;
        if (!paso.porNombre) return prep ? coincideCalle(r, claves) : true;
        var tipo = String(r.type || ""), cat = String(r.category || r["class"] || "");
        return cat === "amenity" && TIPOS_COMIDA.indexOf(tipo) !== -1 && nombreCoincide(r.name, t.nombre);
      });
      if (!validos.length) return null;
      if (paso.porNombre && validos.length > 1) {
        // Varios locales con el mismo nombre (una cadena): se prefiere el de
        // la calle indicada; si no, el de la zona. La calle aquí orienta, no
        // descarta: si el número está mal, el sitio se encuentra igualmente.
        var enCalle = prep && validos.filter(function (r) { return coincideCalle(r, claves); })[0];
        if (enCalle) return enCalle;
        var z = nombreLimpio(zonaLimpia(t.zona));
        var enZona = z && validos.filter(function (r) { return nombreLimpio(r.display_name).indexOf(z) !== -1; })[0];
        if (enZona) return enZona;
      }
      return validos[0];
    }

    var respaldo = null;      // lo mejor que se tenga si nada resulta exacto

    return (function probar(i) {
      if (i >= pasos.length) {
        return Promise.resolve(respaldo || { dir: t.clave, nf: true, v: GEO_VERSION, t: Date.now() });
      }
      var paso = pasos[i];

      if (paso.motor === "cc") {
        return pedirCartoCiudad(paso.q).then(function (res) {
          var geo = geoDesdeCartoCiudad(res, t, prep);
          if (!geo) return probar(i + 1);
          if (geo.aprox && !respaldo) respaldo = geo;       // solo sabe la calle: se sigue buscando el portal
          return geo.aprox ? probar(i + 1) : geo;
        });
      }

      var params = Object.assign({ limit: paso.porNombre ? 10 : 3, viewbox: VIEWBOX_CIUDAD, addressdetails: 1 },
                                 paso.params || { q: paso.q });
      if (paso.porNombre) params.bounded = 1;
      return pedirNominatim(params).then(function (res) {
        var r = elegir(paso, res);
        if (!r) return probar(i + 1);
        var geo = { lat: Number(r.lat), lng: Number(r.lon), dir: t.clave, v: GEO_VERSION };
        if (!paso.porNombre) { var en = etiquetaResultado(r); if (en) geo.en = en; }
        var cat = String(r.category || r["class"] || "");
        var aprox = paso.aprox || (paso.porNombre ? "nombre" : (paso.conNumero && cat === "highway" ? "calle" : ""));
        if (aprox) geo.aprox = aprox;
        if (aprox && !respaldo) { respaldo = geo; return probar(i + 1); }
        return geo;
      });
    })(0).catch(function () { return null; });
  }

  var geoEnMarcha = false, geoPendientesTotal = 0, geoHechas = 0, geoRevisando = false;
  var geoIntentadas = Object.create(null);
  var geoSinGuardar = false;       // falta la columna «geo» en Supabase: se sitúa, pero solo en memoria

  function tareasGeo() {
    var conDireccion = [], porNombre = [], revisiones = [];
    data.forEach(function (d) {
      puntosDe(d, false).forEach(function (p) {
        var vigente = geoVigente(p.geo, p.clave);
        if (vigente && !geoCaducada(p.geo)) return;
        if (geoIntentadas[d.id + "|" + p.sede + "|" + p.clave]) return;
        var t = { id: d.id, sede: p.sede, clave: p.clave, direccion: p.direccion, nombre: d.nombre, zona: p.zona,
                  revision: vigente && !p.geo.nf };
        (t.revision ? revisiones : p.direccion ? conDireccion : porNombre).push(t);
      });
    });
    // Primero lo que no sale en el mapa; al final, revisar lo que ya sale.
    return conDireccion.concat(porNombre, revisiones);
  }

  function procesarGeo() {
    if (geoEnMarcha || soloLectura || !sb) return;
    var tareas = tareasGeo();
    if (!tareas.length) return;
    geoEnMarcha = true;
    geoPendientesTotal = tareas.length;
    geoHechas = 0;
    geoRevisando = tareas.some(function (t) { return t.revision; });
    actualizarNotaMapa();

    (function siguiente(i) {
      if (i >= tareas.length) {
        geoEnMarcha = false;
        actualizarNotaMapa();
        procesarGeo();                           // por si se añadió algo mientras tanto
        procesarHorarios();                      // y después, los horarios
        return;
      }
      var t = tareas[i];
      // Si ya no está cargado (cambio de lista), ni se marca ni se gasta la pausa.
      if (!data.some(function (d) { return d.id === t.id; })) { siguiente(i + 1); return; }
      geoIntentadas[t.id + "|" + t.sede + "|" + t.clave] = true;
      buscarCoordenadas(t)
        .then(function (geo) { return geo ? guardarGeo(t, geo) : null; })
        .catch(function () {})
        .then(function () { geoHechas++; actualizarNotaMapa(); siguiente(i + 1); });
    })(0);
  }

  /* ---- Horarios desde OpenStreetMap (Overpass) ---- */

  var horEnMarcha = false, horIntentados = Object.create(null), horTotal = 0, horHechos = 0;

  function tareasHorario() {
    var tareas = [];
    data.forEach(function (d) {
      puntosDe(d, false).forEach(function (p) {
        if (!geoUtil(p.geo, p.clave)) return;                    // sin ubicación no se puede preguntar
        if (horarioVigente(p.horario)) return;
        if (horIntentados[d.id + "|" + p.sede]) return;
        tareas.push({ id: d.id, sede: p.sede, lat: p.geo.lat, lng: p.geo.lng,
                      nombre: d.nombre, nombreSede: p.nombreSede });
      });
    });
    return tareas;
  }

  /** Pregunta a Overpass por locales de comida junto a ese punto y se queda
   *  con el que se llame igual que el restaurante. */
  function buscarHorario(t) {
    if (typeof fetch !== "function") return Promise.resolve(null);
    var consulta = "[out:json][timeout:20];nwr(around:80," + t.lat + "," + t.lng + ")" +
      '["amenity"~"^(restaurant|cafe|bar|pub|fast_food|food_court|ice_cream|biergarten)$"]["name"];out tags center 20;';
    return esperarTurno(OVERPASS_PAUSA_MS).then(function () {
      return fetch(OVERPASS, { method: "POST", body: "data=" + encodeURIComponent(consulta),
                               headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    }).then(function (r) {
      if (!r.ok) throw new Error("http " + r.status);
      return r.json();
    }).then(function (j) {
      var elementos = (j && j.elements) || [];
      var conNombre = elementos.filter(function (e) {
        return e.tags && e.tags.name && (nombreCoincide(e.tags.name, t.nombre) ||
               (t.nombreSede && nombreCoincide(e.tags.name, t.nombre + " " + t.nombreSede)));
      });
      var conHorario = conNombre.filter(function (e) { return e.tags.opening_hours; })[0];
      if (conHorario) return { oh: String(conHorario.tags.opening_hours), t: Date.now() };
      return { nf: true, t: Date.now() };      // no está, o no publica horario
    }).catch(function () { return null; });    // error de red: se reintenta otro día
  }

  function procesarHorarios() {
    if (horEnMarcha || geoEnMarcha || soloLectura || !sb) return;
    var tareas = tareasHorario();
    if (!tareas.length) return;
    horEnMarcha = true;
    horTotal = tareas.length;
    horHechos = 0;
    actualizarNotaMapa();

    // Si Overpass no responde varias veces seguidas, se para: no tiene sentido
    // seguir llamando uno a uno. Se reintentará en la próxima carga.
    var fallosSeguidos = 0;
    (function siguiente(i) {
      if (i >= tareas.length || fallosSeguidos >= 3) { horEnMarcha = false; actualizarNotaMapa(); return; }
      var t = tareas[i];
      if (!data.some(function (d) { return d.id === t.id; })) { siguiente(i + 1); return; }
      horIntentados[t.id + "|" + t.sede] = true;
      buscarHorario(t)
        .then(function (h) { fallosSeguidos = h ? 0 : fallosSeguidos + 1; return h ? guardarHorario(t, h) : null; })
        .catch(function () {})
        .then(function () { horHechos++; actualizarNotaMapa(); siguiente(i + 1); });
    })(0);
  }

  function guardarHorario(t, horario) {
    var d = null;
    for (var i = 0; i < data.length; i++) if (data[i].id === t.id) { d = data[i]; break; }
    if (!d) return null;

    var cambio;
    if (t.sede === -1) cambio = { horario: horario };
    else {
      if (!d.sedes || !d.sedes[t.sede]) return null;
      var sedes = d.sedes.map(function (s) { return Object.assign({}, s); });
      sedes[t.sede].horario = horario;
      cambio = { sedes: sedes };
    }

    return sb.from("restaurantes").update(cambio).eq("id", d.id).select().single().then(function (res) {
      if (res.error) {
        if (t.sede === -1) d.horario = horario;
        else d.sedes[t.sede].horario = horario;
        render();
        return;
      }
      upsertLocal(registroDesdeFila(res.data));
      guardarCache();
      render();
    });
  }

  function aplicarGeoLocal(d, t, geo) {
    if (t.sede === -1) d.geo = geo;
    else if (d.sedes && d.sedes[t.sede]) d.sedes[t.sede].geo = geo;
  }

  function guardarGeo(t, geo) {
    var d = null;
    for (var i = 0; i < data.length; i++) if (data[i].id === t.id) { d = data[i]; break; }
    if (!d) return null;
    // ¿Sigue siendo lo mismo lo que se buscó? (dirección o nombre pueden haber cambiado)
    var actual = puntosDe(d, false).filter(function (p) { return p.sede === t.sede; })[0];
    if (!actual || actual.clave !== t.clave) return null;
    // Revisión de un pin antiguo que el buscador nuevo no encuentra: mejor
    // conservarlo (marcado como revisado) que dejar el restaurante sin mapa.
    if (geo.nf && geoUtil(actual.geo, actual.clave)) {
      // No se borra (podría estar bien), pero se marca: el globo y la nota
      // te piden comprobarlo, en vez de dar por bueno algo sin confirmar.
      geo = Object.assign({}, actual.geo, { v: GEO_VERSION, aprox: "dudoso" });
      delete geo.en;
    }

    if (geoSinGuardar) { aplicarGeoLocal(d, t, geo); render(); return null; }

    var cambio;
    if (t.sede === -1) {
      cambio = { geo: geo };
    } else {
      var sedes = d.sedes.map(function (s) { return Object.assign({}, s); });
      sedes[t.sede].geo = geo;
      cambio = { sedes: sedes };
    }

    return sb.from("restaurantes").update(cambio).eq("id", d.id).select().single().then(function (res) {
      if (res.error) {
        var e = res.error, texto_ = String(e.message || "");
        if (e.code === "PGRST204" || e.code === "42703" || /column/i.test(texto_) && /geo/i.test(texto_)) {
          geoSinGuardar = true;
          mostrarBanner("El mapa funciona, pero no puede guardar las ubicaciones: falta ejecutar supabase-migracion-mapa.sql en Supabase. Hasta entonces se vuelven a buscar cada vez que abres la app.");
        }
        aplicarGeoLocal(d, t, geo);             // que se vea ya, aunque no se haya podido guardar
        render();
        return;
      }
      upsertLocal(registroDesdeFila(res.data));
      guardarCache();
      render();
    });
  }

  /* ---- Ubicación ---- */

  function necesitaUbicacion() {
    return !document.hidden && !ubicacionDenegada && (state.vista === "mapa" || state.sort === "cerca");
  }

  function gestionarUbicacion() {
    if (!navigator.geolocation) return;
    if (necesitaUbicacion()) {
      if (vigilancia !== null) return;
      vigilancia = navigator.geolocation.watchPosition(alUbicar, alFallarUbicacion,
        { enableHighAccuracy: true, maximumAge: 30000, timeout: 20000 });
    } else if (vigilancia !== null) {
      // Fuera del mapa y sin ordenar por cercanía: el GPS se apaga.
      navigator.geolocation.clearWatch(vigilancia);
      vigilancia = null;
    }
  }

  function alUbicar(pos) {
    miPos = { lat: pos.coords.latitude, lng: pos.coords.longitude, precision: pos.coords.accuracy || 0 };
    pintarYo();
    if (esperandoCentrar && mapa) {
      esperandoCentrar = false;
      moverMapa(function () { mapa.setView([miPos.lat, miPos.lng], 15); });
    }
    // Solo se repinta si te has movido algo apreciable.
    if (!posRender || distanciaM(posRender, miPos) > 40) {
      posRender = miPos;
      render();
    }
  }

  function alFallarUbicacion(err) {
    if (err && err.code === 1) {
      ubicacionDenegada = true;
      if (vigilancia !== null) { navigator.geolocation.clearWatch(vigilancia); vigilancia = null; }
      if (state.sort === "cerca") avisar("Sin permiso de ubicación: no se puede ordenar por cercanía.");
    }
    actualizarNotaMapa();
  }

  document.addEventListener("visibilitychange", gestionarUbicacion);

  /* ---- Mapa ---- */

  function moverMapa(fn) {
    moviendoYo = true;
    fn();
    setTimeout(function () { moviendoYo = false; }, 800);
  }

  function asegurarMapa() {
    if (mapa) return true;
    var L = window.L;
    if (!L || typeof L.map !== "function") return false;
    mapa = L.map("map", { zoomControl: true }).setView(MADRID, 12);
    ponerTeselas();
    capaRest = L.layerGroup().addTo(mapa);
    if (typeof mapa.on === "function") {
      mapa.on("dragstart", function () { usuarioMovioMapa = true; });
      mapa.on("click", function () { cerrarFicha(false); });   // tocar el mapa suelta la ficha
      mapa.on("zoomstart", function () { if (!moviendoYo) usuarioMovioMapa = true; });
    }
    return true;
  }

  function pintarYo() {
    if (!mapa || !miPos) return;
    var L = window.L, ll = [miPos.lat, miPos.lng];
    if (!marcadorYo) {
      circuloYo = L.circle(ll, { radius: miPos.precision, weight: 1, fillOpacity: 0.12, interactive: false, className: "precision-yo" }).addTo(mapa);
      marcadorYo = L.circleMarker(ll, { radius: 7, weight: 3, fillOpacity: 1, className: "marcador-yo" }).addTo(mapa);
      marcadorYo.bindPopup("Estás aquí");
    } else {
      marcadorYo.setLatLng(ll);
      circuloYo.setLatLng(ll);
      circuloYo.setRadius(miPos.precision);
    }
  }

  function crearPopup(d, p) {
    var caja = document.createElement("div");
    caja.className = "popup";

    var nombre = document.createElement("p");
    nombre.className = "popup-nombre";
    nombre.textContent = d.nombre;                     // textContent: nada de HTML inyectado
    caja.appendChild(nombre);

    var partes = [];
    if (p.nombreSede) partes.push(p.nombreSede);
    partes.push(d.tipo || "Sin especificar");
    if (miPos) partes.push(formatoDistancia(distanciaM(miPos, p.geo)));
    var sub = document.createElement("p");
    sub.className = "popup-sub";
    sub.textContent = partes.join(" · ");
    caja.appendChild(sub);

    if (p.geo.en) {
      var en = document.createElement("p");
      en.className = "popup-sub";
      en.textContent = "Situado en " + p.geo.en;
      caja.appendChild(en);
    }

    if (p.geo.aprox) {
      var aviso = document.createElement("p");
      aviso.className = "popup-aprox";
      aviso.textContent = p.geo.aprox === "calle" ? "Ubicación aproximada: no se encontró el número, solo la calle."
        : p.geo.aprox === "dudoso" ? "No he podido confirmar esta ubicación con la dirección escrita: comprueba que el pin esté en su sitio."
        : "Situado por su nombre: si no es aquí, ponle la dirección.";
      caja.appendChild(aviso);
    }

    var enlaces = document.createElement("div");
    enlaces.className = "card-links";
    var etiqueta = d.nombre + (p.nombreSede ? " (" + p.nombreSede + ")" : "");
    var destino = p.direccion ? { nombre: d.nombre, zona: "", direccion: p.direccion } : { nombre: d.nombre, zona: p.zona, direccion: "" };
    construirPildoras(etiqueta, p.carta, p.reserva, urlMapa(destino)).forEach(function (x) { enlaces.appendChild(x); });
    caja.appendChild(enlaces);
    return caja;
  }

  function pintarMapa(items) {
    ultimosItems = items;
    if (!asegurarMapa()) { actualizarNotaMapa(); return; }
    var L = window.L;

    capaRest.clearLayers();
    marcadoresPorId = Object.create(null);
    var puntos = [];

    items.forEach(function (d) {
      puntosDe(d, true).forEach(function (p) {
        if (!geoUtil(p.geo, p.clave)) return;
        var ll = [p.geo.lat, p.geo.lng];
        var m = L.circleMarker(ll, { radius: 9, weight: 2, fillOpacity: 0.95, bubblingMouseEvents: false,
                                     className: "marcador-rest" + (p.geo.aprox ? " marcador-aprox" : "") });
        m.on("click", function () { abrirFicha(d, p, m); });
        m.addTo(capaRest);
        if (!marcadoresPorId[d.id]) marcadoresPorId[d.id] = { marcador: m, ll: ll, d: d, p: p };
        puntos.push(ll);
      });
    });

    pintarYo();
    refrescarFicha();

    // Cambiar de filtro vuelve a encuadrar. Mientras llegan puntos nuevos
    // (búsqueda en curso) también, salvo que tú hayas movido el mapa.
    var firma = [state.zonas.join(","), state.tipos.join(","), state.precios.join(","), state.search].join("|");
    if (firma !== firmaAjuste) { firmaAjuste = firma; puntosEncuadrados = 0; usuarioMovioMapa = false; }
    if (puntos.length && !usuarioMovioMapa && puntos.length > puntosEncuadrados) {
      var limites = L.latLngBounds(puntos.slice());
      if (miPos && distanciaM(miPos, { lat: MADRID[0], lng: MADRID[1] }) < 30000) limites.extend([miPos.lat, miPos.lng]);
      moverMapa(function () { mapa.fitBounds(limites, { padding: [30, 30], maxZoom: 16 }); });
      puntosEncuadrados = puntos.length;
    }

    actualizarNotaMapa();
  }

  function actualizarNotaMapa() {
    var nota = $("mapa-nota");
    if (!nota) return;
    var items = ultimosItems;
    var frases = [];

    if (!window.L || typeof window.L.map !== "function") {
      frases.push("No se pudo cargar el mapa (¿sin conexión?). La lista sigue funcionando.");
    } else if (!items.length) {
      frases.push(data.length ? "Ningún restaurante coincide con esos filtros." : "La lista está vacía.");
    } else {
      var enMapa = 0, aproxCalle = 0, aproxNombre = 0, dudosos = [], pendientes = 0, dirNoHallada = [], sinDirNoHallado = [];
      items.forEach(function (d) {
        var ps = puntosDe(d, true);
        var utiles = ps.filter(function (p) { return geoUtil(p.geo, p.clave); });
        if (utiles.length) enMapa++;
        if (utiles.some(function (p) { return p.geo.aprox === "calle"; })) aproxCalle++;
        if (utiles.some(function (p) { return p.geo.aprox === "nombre"; })) aproxNombre++;
        utiles.forEach(function (p) {
          if (p.geo.aprox === "dudoso") dudosos.push(d.nombre + (p.nombreSede ? " (" + p.nombreSede + ")" : ""));
        });
        ps.forEach(function (p) {
          var etiqueta = d.nombre + (p.nombreSede ? " (" + p.nombreSede + ")" : "");
          if (!geoVigente(p.geo, p.clave)) pendientes++;
          else if (p.geo.nf) (p.direccion ? dirNoHallada : sinDirNoHallado).push(etiqueta);
        });
      });
      frases.push(enMapa + " de " + items.length + " en el mapa.");
      if (geoEnMarcha) {
        frases.push((geoRevisando ? "Revisando ubicaciones con el buscador mejorado (solo esta vez): " : "Buscando ubicaciones: ") +
          Math.min(geoHechas + 1, geoPendientesTotal) + " de " + geoPendientesTotal + "…");
      } else if (pendientes) {
        frases.push(pendientes + " sin situar todavía (se reintentará con conexión).");
      }
      if (aproxCalle) {
        frases.push(aproxCalle + (aproxCalle === 1 ? " está" : " están") +
          " en su calle pero sin el portal exacto: el mapa no tiene ese número.");
      }
      if (aproxNombre) {
        frases.push(aproxNombre + (aproxNombre === 1 ? " se ha situado" : " se han situado") +
          " por su nombre: comprueba que el pin sea el sitio.");
      }
      var resumir = function (l) { return l.slice(0, 8).join(", ") + (l.length > 8 ? " y " + (l.length - 8) + " más" : ""); };
      if (dudosos.length) {
        frases.push("Sin confirmar: " + resumir(dudosos) + ". Comprueba que su pin esté en su sitio (o revisa cómo está escrita la dirección).");
      }
      if (dirNoHallada.length) {
        frases.push("No se pudo situar la dirección de: " + resumir(dirNoHallada) +
          ". Revisa cómo está escrita: una sola calle con su número, sin paréntesis ni nombres de centros comerciales.");
      }
      if (sinDirNoHallado.length) {
        frases.push("Sin dirección y no encontrados por su nombre: " + resumir(sinDirNoHallado) + ". Ponles la dirección en Editar.");
      }
    }

    if (!ccDisponible) {
      frases.push("El callejero oficial del IGN no responde desde este navegador: se está usando solo OpenStreetMap, que tiene menos portales.");
    }
    if (ubicacionDenegada) frases.push("Sin permiso de ubicación: actívalo en los ajustes del navegador para ver lo que tienes cerca.");
    nota.textContent = frases.join(" ");
  }

  function aplicarVista() {
    var esMapa = state.vista === "mapa";
    $("mapa-wrap").hidden = !esMapa;
    lista.hidden = esMapa;
    $("vista-lista").setAttribute("aria-pressed", esMapa ? "false" : "true");
    $("vista-mapa").setAttribute("aria-pressed", esMapa ? "true" : "false");
    gestionarUbicacion();
  }

  function cambiarVista(v) {
    if (state.vista === v) return;
    state.vista = v;
    if (v === "mapa") reiniciarEncuadre();       // al abrir el mapa, siempre encuadrado en todo
    else cerrarFicha(true);
    guardarFiltros();
    conFundido(render);
    // Leaflet calcula su tamaño al crearse: si el contenedor estuvo oculto,
    // hay que avisarle de que ya se ve.
    if (v === "mapa" && mapa) setTimeout(function () { mapa.invalidateSize(); }, 0);
  }

  $("vista-lista").addEventListener("click", function () { cambiarVista("lista"); });
  $("vista-mapa").addEventListener("click", function () { cambiarVista("mapa"); });

  $("centrar-btn").addEventListener("click", function () {
    if (!navigator.geolocation) { avisar("Este navegador no da la ubicación."); return; }
    if (miPos && mapa) { moverMapa(function () { mapa.setView([miPos.lat, miPos.lng], 15); }); return; }
    ubicacionDenegada = false;
    esperandoCentrar = true;
    avisar("Buscando tu ubicación…");
    gestionarUbicacion();
  });



  /* ============================================================
     17 bis. Ficha del mapa
     Sustituye al globo de Leaflet: una tarjeta translúcida que sube
     desde abajo (muelle), se descarta deslizándola hacia abajo y marca
     la chincheta elegida.
     ============================================================ */

  var ficha = $("ficha-mapa");
  var fichaContenido = $("ficha-contenido");
  var fichaActual = null;          // { id, marcador }
  var muelleFicha = crearMuelle(function (y) {
    ficha.style.transform = Math.abs(y) < 0.5 ? "" : "translate3d(0," + y.toFixed(2) + "px,0)";
  });

  function marcarElegido(m, si) {
    if (!m || !m.setRadius) return;
    m.setRadius(si ? 12 : 9);
    var el = m.getElement && m.getElement();
    if (el) el.classList.toggle("marcador-elegido", si);
    if (si && m.bringToFront) m.bringToFront();
  }

  function abrirFicha(d, p, m) {
    if (fichaActual) marcarElegido(fichaActual.marcador, false);
    fichaActual = { id: d.id, marcador: m };
    marcarElegido(m, true);
    fichaContenido.replaceChildren(crearPopup(d, p));
    var estabaOculta = ficha.hidden;
    ficha.hidden = false;
    if (menosMovimiento && menosMovimiento.matches) {
      muelleFicha.fijar(0);
      if (estabaOculta && ficha.animate) ficha.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
      asomarElegido(m);
      return;
    }
    if (estabaOculta) muelleFicha.fijar(ficha.offsetHeight + 16);
    muelleFicha.ir(0, { zeta: 1, respuesta: 0.35 });
    asomarElegido(m);
  }

  // Si la chincheta elegida queda bajo la ficha, el mapa sube lo justo
  function asomarElegido(m) {
    if (!mapa || !m || !m.getLatLng) return;
    var pt = mapa.latLngToContainerPoint(m.getLatLng());
    var limite = mapa.getSize().y - ficha.offsetHeight - 36;
    if (pt.y > limite) {
      moverMapa(function () {
        mapa.panBy([0, pt.y - limite], { animate: !(menosMovimiento && menosMovimiento.matches) });
      });
    }
  }

  function cerrarFicha(inmediato, velocidad) {
    if (!fichaActual) return;
    marcarElegido(fichaActual.marcador, false);
    fichaActual = null;
    function fin() { ficha.hidden = true; muelleFicha.fijar(0); fichaContenido.replaceChildren(); }
    if (inmediato || (menosMovimiento && menosMovimiento.matches)) { muelleFicha.parar(); fin(); return; }
    muelleFicha.ir(ficha.offsetHeight + 16, { zeta: 1, respuesta: 0.3, velocidad: velocidad || 0 }, fin);
  }

  // Al repintar el mapa los marcadores se rehacen: la ficha sigue al nuevo
  function refrescarFicha() {
    if (!fichaActual) return;
    var e = marcadoresPorId[fichaActual.id];
    if (!e) { cerrarFicha(true); return; }
    fichaActual.marcador = e.marcador;
    marcarElegido(e.marcador, true);
    fichaContenido.replaceChildren(crearPopup(e.d, e.p));
  }

  $("ficha-cerrar").addEventListener("click", function () { cerrarFicha(false); });

  (function arrastrarFicha() {
    var g = null;
    ficha.addEventListener("pointerdown", function (e) {
      if (e.button !== 0 || e.target.closest("#ficha-cerrar")) return;
      g = { id: e.pointerId, y0: e.clientY, movido: false, base: 0, muestras: [] };
    });
    ficha.addEventListener("pointermove", function (e) {
      if (!g || e.pointerId !== g.id) return;
      var dy = e.clientY - g.y0;
      if (!g.movido) {
        if (Math.abs(dy) < 6) return;
        g.movido = true;
        g.base = muelleFicha.parar() - dy;
        try { ficha.setPointerCapture(e.pointerId); } catch (err) {}
      }
      var b = g.base + dy;
      muelleFicha.fijar(b < 0 ? -gomaElastica(-b, 80) : b);   // hacia arriba resiste
      var ahora = performance.now();
      g.muestras.push({ y: e.clientY, t: ahora });
      while (g.muestras.length > 2 && ahora - g.muestras[0].t > 100) g.muestras.shift();
    });
    function soltar() {
      if (!g) return;
      var h = g; g = null;
      if (!h.movido) return;
      suprimirClic();
      var m = h.muestras, v = 0, ult = m[m.length - 1];
      if (m.length > 1 && ult.t - m[0].t > 8 && performance.now() - ult.t < 80) v = (ult.y - m[0].y) / (ult.t - m[0].t) * 1000;
      var y = muelleFicha.valor();
      var cerrar = Math.abs(v) > 300 ? v > 0 : y + proyectar(v) > ficha.offsetHeight * 0.5;
      if (cerrar) cerrarFicha(false, v);
      else muelleFicha.ir(0, { zeta: 0.8, respuesta: 0.3, velocidad: v });
    }
    ficha.addEventListener("pointerup", soltar);
    ficha.addEventListener("pointercancel", soltar);
  })();

  /* ============================================================
     16 bis bis. Deslizar una tarjeta
     Sigue al dedo en horizontal (tras 10 px que deciden si es scroll o
     deslizar). Al soltar, el sentido del lanzamiento decide si se queda
     abierta; pasado el 60 % del ancho, borra.
     ============================================================ */

  var ANCHO_ACCIONES = 168;      // dos botones de 80 + hueco
  var deslizada = null;
  var gesto = null;

  function muelleDe(li) {
    if (!li._muelle) {
      li._muelle = crearMuelle(function (x) {
        li.style.transform = Math.abs(x) < 0.5 ? "" : "translate3d(" + x.toFixed(2) + "px,0,0)";
        var capa = li.querySelector(".card-deslizar");
        if (capa) {
          capa.style.width = Math.max(ANCHO_ACCIONES, -x - 8) + "px";
          capa.classList.toggle("todo", -x > li.offsetWidth * 0.6);
        }
      });
    }
    return li._muelle;
  }

  function cerrarDeslizado() {
    if (!deslizada) return;
    muelleDe(deslizada).ir(0, { zeta: 1, respuesta: 0.3 });
    deslizada = null;
  }

  // Tras un arrastre, el navegador manda un clic al soltar: se descarta
  function suprimirClic() {
    function parar(e) { e.stopPropagation(); e.preventDefault(); }
    document.addEventListener("click", parar, true);
    setTimeout(function () { document.removeEventListener("click", parar, true); }, 0);
  }

  function borrarDeslizando(li, d, velocidad) {
    if (deslizada === li) deslizada = null;
    if (requiereConexion()) { muelleDe(li).ir(0, { zeta: 1, respuesta: 0.3 }); return; }
    var quieto = menosMovimiento && menosMovimiento.matches;
    if (quieto || !li.animate) { eliminar(d); return; }
    muelleDe(li).ir(-li.offsetWidth * 1.4, { zeta: 1, respuesta: 0.25, velocidad: velocidad }, function () {
      // La fila se cierra antes de que conteste el servidor: sin saltos
      var cs = getComputedStyle(li);
      li.style.overflow = "hidden";
      var an = li.animate([
        { height: li.offsetHeight + "px", marginTop: "0px", paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom },
        { height: "0px", marginTop: "-0.75rem", paddingTop: "0px", paddingBottom: "0px" }
      ], { duration: 260, easing: "cubic-bezier(0.32, 0.72, 0, 1)", fill: "forwards" });
      an.onfinish = function () { eliminar(d); };
    });
  }

  lista.addEventListener("pointerdown", function (e) {
    var li = e.target.closest("li.card:not(.silueta)");
    if (deslizada && deslizada !== li) cerrarDeslizado();
    if (e.pointerType === "mouse" || !li || e.target.closest(".card-deslizar")) return;
    gesto = { li: li, id: e.pointerId, x0: e.clientX, y0: e.clientY, decidido: false,
              tocarParaCerrar: deslizada === li, muestras: [] };
  });
  lista.addEventListener("pointermove", function (e) {
    if (!gesto || e.pointerId !== gesto.id) return;
    var dx = e.clientX - gesto.x0, dy = e.clientY - gesto.y0;
    if (!gesto.decidido) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      if (Math.abs(dy) >= Math.abs(dx)) { gesto = null; return; }   // es scroll
      gesto.decidido = true;
      try { gesto.li.setPointerCapture(e.pointerId); } catch (err) {}
      gesto.base = muelleDe(gesto.li).parar() - dx;                  // sigue desde donde esté
      gesto.li.classList.add("deslizando");
      deslizada = gesto.li;
    }
    var bruto = gesto.base + dx;
    // A la derecha no hay nada: resiste como una goma
    muelleDe(gesto.li).fijar(bruto > 0 ? gomaElastica(bruto, 120) : bruto);
    var ahora = performance.now();
    gesto.muestras.push({ x: e.clientX, t: ahora });
    while (gesto.muestras.length > 2 && ahora - gesto.muestras[0].t > 100) gesto.muestras.shift();
  });
  function soltarGesto() {
    if (!gesto) return;
    var g = gesto; gesto = null;
    if (!g.decidido) {
      if (g.tocarParaCerrar) { cerrarDeslizado(); suprimirClic(); }
      return;
    }
    g.li.classList.remove("deslizando");
    suprimirClic();
    var m = g.muestras, v = 0, ult = m[m.length - 1];
    if (m.length > 1 && ult.t - m[0].t > 8 && performance.now() - ult.t < 80) {
      v = (ult.x - m[0].x) / (ult.t - m[0].t) * 1000;
    }
    var muelle = muelleDe(g.li), x = muelle.valor();
    if (-x > g.li.offsetWidth * 0.6 && v < 300) {
      var id = g.li.dataset.id;
      for (var i = 0; i < data.length; i++) {
        if (String(data[i].id) === id) { borrarDeslizando(g.li, data[i], v); return; }
      }
    }
    var abrir = Math.abs(v) > 300 ? v < 0 : x + proyectar(v) < -ANCHO_ACCIONES / 2;
    deslizada = abrir ? g.li : null;
    muelle.ir(abrir ? -ANCHO_ACCIONES : 0, { zeta: abrir ? 0.85 : 1, respuesta: 0.3, velocidad: v });
  }
  lista.addEventListener("pointerup", soltarGesto);
  lista.addEventListener("pointercancel", soltarGesto);
  window.addEventListener("scroll", function () { if (deslizada && !gesto) cerrarDeslizado(); }, { passive: true });


  /* ============================================================
     16 bis ter. Menú contextual de una tarjeta
     Mantener pulsada (o clic derecho): la tarjeta se alza, el fondo se
     difumina y sale un menú que nace del punto donde has pulsado.
     ============================================================ */

  var menuCapa = $("menu-capa");
  var menuEl = $("menu-contextual");
  var menuTarjeta = null;
  var temporizadorMenu = null;
  var inicioMenu = null;

  function itemMenu(texto, icono, accion, opciones) {
    opciones = opciones || {};
    var el = document.createElement(opciones.href ? "a" : "button");
    el.className = "menu-item" + (opciones.peligro ? " peligro" : "");
    el.setAttribute("role", "menuitem");
    if (opciones.href) {
      el.href = opciones.href;
      if (opciones.externo) { el.target = "_blank"; el.rel = "noopener noreferrer"; }
    } else {
      el.type = "button";
    }
    var t = document.createElement("span");
    t.textContent = texto;
    el.appendChild(t);
    el.insertAdjacentHTML("beforeend", icono);
    el.addEventListener("click", function () { cerrarMenu(); if (accion) accion(); });
    return el;
  }

  function abrirMenu(li, x, y) {
    var d = null;
    for (var i = 0; i < data.length; i++) if (String(data[i].id) === li.dataset.id) { d = data[i]; break; }
    if (!d) return;
    cerrarDeslizado();
    menuTarjeta = li;

    var items = [itemMenu("Editar", ICONOS.lapiz, function () { abrirPanel(d); })];
    if (!(d.sedes && d.sedes.length > 1)) {
      var p = puntosDe(d, false)[0] || {};
      var destino = p.direccion ? { nombre: d.nombre, zona: "", direccion: p.direccion } : { nombre: d.nombre, zona: d.zona, direccion: "" };
      items.push(itemMenu("Cómo llegar", ICONOS.mapa, null, { href: urlMapa(destino), externo: true }));
      if (p.carta && analizarUrl(p.carta).valida) {
        items.push(itemMenu("Ver la carta", ICONOS.carta, null, { href: analizarUrl(p.carta).href, externo: true }));
      }
      var res = analizarReserva(p.reserva);
      if (!res.vacia && res.valida) {
        items.push(res.tipo === "tel"
          ? itemMenu("Llamar", ICONOS.tel, null, { href: res.href })
          : itemMenu("Reservar", ICONOS.reserva, null, { href: res.href, externo: true }));
      }
    }
    var sep = document.createElement("div");
    sep.className = "menu-sep"; sep.setAttribute("role", "separator");
    items.push(sep);
    items.push(itemMenu("Eliminar", ICONOS.papelera, function () { eliminar(d); }, { peligro: true }));
    menuEl.replaceChildren.apply(menuEl, items);
    menuEl.setAttribute("aria-label", "Acciones para " + d.nombre);

    menuCapa.hidden = false;
    menuEl.hidden = false;
    li.classList.add("alzada");

    // Junto a la tarjeta (debajo si cabe, si no encima), sin salirse
    var r = li.getBoundingClientRect();
    var w = menuEl.offsetWidth, h = menuEl.offsetHeight, m = 12;
    var izq = Math.min(Math.max(m, x - w / 2), window.innerWidth - w - m);
    var arriba = r.bottom + 8 + h < window.innerHeight - m ? r.bottom + 8
               : r.top - 8 - h > m ? r.top - 8 - h
               : Math.min(Math.max(m, y - h / 2), window.innerHeight - h - m);
    menuEl.style.left = Math.round(izq) + "px";
    menuEl.style.top = Math.round(arriba) + "px";
    menuEl.style.transformOrigin = Math.round(x - izq) + "px " + Math.round(y - arriba) + "px";

    var quieto = menosMovimiento && menosMovimiento.matches;
    if (menuEl.animate) {
      menuEl.animate(quieto ? [{ opacity: 0 }, { opacity: 1 }]
                            : [{ opacity: 0, transform: "scale(0.5)" }, { opacity: 1, transform: "none" }],
                     { duration: 340, easing: "cubic-bezier(0.32, 0.72, 0, 1)" });
      menuCapa.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220 });
    }
    var primero = menuEl.querySelector(".menu-item");
    if (primero) try { primero.focus({ preventScroll: true }); } catch (e) {}
  }

  function cerrarMenu() {
    if (menuEl.hidden) return;
    var li = menuTarjeta; menuTarjeta = null;
    if (li) li.classList.remove("alzada");
    function fin() { menuEl.hidden = true; menuCapa.hidden = true; menuEl.replaceChildren(); }
    if (!menuEl.animate || (menosMovimiento && menosMovimiento.matches)) { fin(); return; }
    menuCapa.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, fill: "forwards" });
    var an = menuEl.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(0.8)" }],
                            { duration: 180, easing: "ease-in", fill: "forwards" });
    an.onfinish = function () { an.cancel(); menuCapa.getAnimations().forEach(function (a) { a.cancel(); }); fin(); };
  }

  menuCapa.addEventListener("click", cerrarMenu);
  menuCapa.addEventListener("touchmove", function (e) { e.preventDefault(); }, { passive: false });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") cerrarMenu(); });
  window.addEventListener("resize", cerrarMenu);

  // Mantener pulsado medio segundo sin moverse (dedo o lápiz)
  lista.addEventListener("pointerdown", function (e) {
    clearTimeout(temporizadorMenu);
    var li = e.target.closest("li.card:not(.silueta)");
    if (!li || e.pointerType === "mouse" || e.target.closest(".card-deslizar")) return;
    inicioMenu = { x: e.clientX, y: e.clientY };
    temporizadorMenu = setTimeout(function () {
      gesto = null;                           // ya no es un deslizamiento
      suprimirClic();
      abrirMenu(li, inicioMenu.x, inicioMenu.y);
    }, 500);
  });
  lista.addEventListener("pointermove", function (e) {
    if (inicioMenu && (Math.abs(e.clientX - inicioMenu.x) > 10 || Math.abs(e.clientY - inicioMenu.y) > 10)) {
      clearTimeout(temporizadorMenu); inicioMenu = null;
    }
  });
  ["pointerup", "pointercancel"].forEach(function (t) {
    lista.addEventListener(t, function () {
      // Si el menú se abrió con esta pulsación, el clic al soltar no cuenta
      if (!menuEl.hidden && inicioMenu) suprimirClic();
      clearTimeout(temporizadorMenu); inicioMenu = null;
    });
  });
  // Clic derecho (y la pulsación larga de Android, que llega como contextmenu)
  lista.addEventListener("contextmenu", function (e) {
    var li = e.target.closest("li.card:not(.silueta)");
    if (!li) return;
    e.preventDefault();
    clearTimeout(temporizadorMenu);
    if (menuEl.hidden) abrirMenu(li, e.clientX, e.clientY);
  });

  /* ============================================================
     16 bis. «Sorpréndeme»
     ============================================================ */

  var ultimoAzar = null;
  var tempDestacada = null;

  function destacar(d) {
    var hijos = lista.children;
    var li = null;
    for (var i = 0; i < hijos.length; i++) {
      hijos[i].classList.remove("destacada");
      if (hijos[i].dataset.id === d.id) li = hijos[i];
    }
    if (!li) return;
    li.classList.add("destacada");
    li.setAttribute("tabindex", "-1");
    desplazarA(li, { behavior: "smooth", block: "center" });
    setTimeout(function () {
      try { li.focus({ preventScroll: true }); } catch (e) { li.focus(); }
    }, 320);
    clearTimeout(tempDestacada);
    tempDestacada = setTimeout(function () { li.classList.remove("destacada"); }, 4500);
  }

  (function chipAbierto() {
    var chip = $("abierto-chip");
    function pintar() { chip.setAttribute("aria-pressed", state.abiertoAhora ? "true" : "false"); }
    chip.addEventListener("click", function () {
      state.abiertoAhora = !state.abiertoAhora;
      pintar();
      guardarFiltros();
      render();
    });
    pintar();
  })();

  $("random-btn").addEventListener("click", function () {
    var visibles = ordenar(data.filter(coincide));
    var enMapa = state.vista === "mapa";
    if (enMapa) visibles = visibles.filter(function (d) { return marcadoresPorId[d.id]; });
    if (!visibles.length) {
      avisar(!data.length ? "La lista está vacía: añade alguno primero."
           : enMapa ? "Ninguno de los que se ven tiene dirección en el mapa."
           : "Ningún restaurante coincide con esos filtros.");
      return;
    }
    var elegido;
    if (visibles.length === 1) {
      elegido = visibles[0];
    } else {
      var candidatos = visibles.filter(function (d) { return d.id !== ultimoAzar; });
      elegido = candidatos[Math.floor(Math.random() * candidatos.length)];
    }
    ultimoAzar = elegido.id;
    cerrarTodasLasConfirmaciones();
    if (enMapa) {
      var m = marcadoresPorId[elegido.id];
      moverMapa(function () { mapa.setView(m.ll, Math.max(mapa.getZoom(), 15)); });
      abrirFicha(m.d, m.p, m.marcador);
      avisar("Te toca: " + elegido.nombre + ".");
    } else {
      barajar(function () {
        destacar(elegido);
        avisar("Te toca: " + elegido.nombre + ".");
      });
    }
  });

  // Un repaso rápido por las tarjetas que se ven, cada vez más lento,
  // como un dado que se para. Menos de un segundo; con menos movimiento,
  // directo al resultado.
  function barajar(alAcabar) {
    var boton = $("random-btn");
    var alto = window.innerHeight;
    var vistas = Array.prototype.filter.call(lista.children, function (li) {
      var r = li.getBoundingClientRect();
      return r.top > 0 && r.bottom < alto;
    });
    if ((menosMovimiento && menosMovimiento.matches) || vistas.length < 2) { alAcabar(); return; }
    boton.classList.add("girando");
    var pausas = [70, 90, 120, 160, 210];
    var i = 0, anterior = null;
    (function paso() {
      if (anterior) anterior.classList.remove("barajando");
      if (i === pausas.length) { boton.classList.remove("girando"); alAcabar(); return; }
      var otras = vistas.filter(function (li) { return li !== anterior; });
      anterior = otras[Math.floor(Math.random() * otras.length)];
      anterior.classList.add("barajando");
      setTimeout(paso, pausas[i++]);
    })();
  }

  /* ============================================================
     16 quater. Listas, miembros y contraseña
     ============================================================ */

  var panelListas = $("panel-listas");

  function soyAdmin(listaId) {
    return miembros.some(function (m) { return m.lista_id === listaId && m.user_id === miId && m.rol === "admin"; });
  }
  function miembrosDe(listaId) {
    return miembros.filter(function (m) { return m.lista_id === listaId; });
  }
  function nombreLista(id) {
    for (var i = 0; i < listas.length; i++) if (listas[i].id === id) return listas[i].nombre;
    return "";
  }

  function pintarSelectorListas() {
    var bar = $("lista-bar"), sel = $("lista-sel");
    if (!bar || !sel) return;
    bar.hidden = !miId && !listas.length;
    sel.hidden = !listas.length;
    $("lista-sel-label").hidden = !listas.length;
    sel.replaceChildren();
    listas.forEach(function (l) {
      var o = document.createElement("option");
      o.value = l.id;
      o.textContent = l.nombre;
      sel.appendChild(o);
    });
    if (listaActual) sel.value = listaActual;
  }

  $("lista-sel").addEventListener("change", function (e) { cambiarLista(e.target.value); });

  function decirListas(t, error) {
    var m = $("pl-msg");
    m.textContent = t || "";
    m.className = "msg" + (error ? " msg-error" : "");
  }

  function pintarPanelListas() {
    if (!panelListas || panelListas.hidden) return;
    var hay = !!listaActual;
    var admin = hay && soyAdmin(listaActual);

    $("pl-actual").hidden = !hay;
    $("pl-titulo-lista").textContent = hay ? "Lista «" + nombreLista(listaActual) + "»" : "";
    $("pl-renombrar-bloque").hidden = !admin;
    $("pl-anadir-bloque").hidden = !admin;
    if (hay && document.activeElement !== $("pl-nombre")) $("pl-nombre").value = nombreLista(listaActual);

    var ul = $("pl-miembros");
    ul.replaceChildren();
    miembrosDe(listaActual)
      .sort(function (a, b) { return (a.user_id === miId ? -1 : 0) - (b.user_id === miId ? -1 : 0) || comparar(a.email, b.email); })
      .forEach(function (m) {
        var li = document.createElement("li");
        var esYo = m.user_id === miId;
        var t = document.createElement("span");
        t.textContent = m.email + (esYo ? " (tú)" : "") + (m.rol === "admin" ? " · gestiona" : "");
        li.appendChild(t);
        if (esYo || admin) {
          var b = document.createElement("button");
          b.type = "button";
          b.className = "sede-quitar";
          b.textContent = esYo ? "Salir" : "Quitar";
          b.setAttribute("aria-label", esYo
            ? "Salir de la lista " + nombreLista(listaActual)
            : "Quitar a " + m.email + " de la lista");
          b.addEventListener("click", function () { quitarDeLista(m); });
          li.appendChild(b);
        }
        ul.appendChild(li);
      });
  }

  function abrirPanelListas() {
    hojaListas.abrir();
    $("gestionar-btn").setAttribute("aria-expanded", "true");
    decirListas("");
    pintarPanelListas();
    try { $("pl-cerrar").focus({ preventScroll: true }); } catch (e) {}
  }
  function cerrarPanelListas(devolverFoco, inmediato) {
    $("gestionar-btn").setAttribute("aria-expanded", "false");
    hojaListas.cerrar(function () {
      if (devolverFoco) $("gestionar-btn").focus({ preventScroll: true });
    }, { inmediato: !!inmediato });
  }
  var hojaListas = crearHoja(panelListas, { medio: true, alDescartar: function () { cerrarPanelListas(true); } });
  $("gestionar-btn").addEventListener("click", abrirPanelListas);
  $("pl-cerrar").addEventListener("click", function () { cerrarPanelListas(true); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !panelListas.hidden) cerrarPanelListas(true);
  });

  var MENSAJES_GESTION = {
    sin_permiso: "Solo quien gestiona la lista puede hacer eso.",
    no_existe: "Esa persona aún no tiene cuenta. Créasela en Supabase → Authentication → Users y vuelve a añadirla aquí.",
    ultimo_admin: "Eres el único que gestiona esta lista. Antes de salir, haz gestor a otra persona (vuelve a añadirla marcando «también puede gestionar»).",
    no_es_miembro: "Esa persona ya no estaba en la lista.",
    nombre_invalido: "El nombre tiene que tener entre 1 y 60 caracteres.",
    rol_invalido: "Rol no válido."
  };

  /** Llama a una de las funciones de gestión del servidor. Devuelve su resultado, o null si falló. */
  function gestionar(fn, args) {
    if (!sb || soloLectura) { decirListas("Sin conexión: inténtalo cuando vuelva la red.", true); return Promise.resolve(null); }
    return sb.rpc(fn, args).then(function (r) {
      if (r.error) { decirListas("No se pudo: " + (r.error.message || "inténtalo de nuevo."), true); return null; }
      return r.data;
    }).catch(function () {
      decirListas("No se pudo conectar. Revisa la conexión.", true);
      return null;
    });
  }

  function recargarListas(mensajeOk) {
    return cargarListas().then(function () {
      pintarPanelListas();
      if (mensajeOk) decirListas(mensajeOk);
    }).catch(function () { decirListas("Hecho, pero no se pudo refrescar: recarga la app.", true); });
  }

  $("pl-renombrar").addEventListener("click", function () {
    var nombre = $("pl-nombre").value.trim();
    if (!nombre) { decirListas(MENSAJES_GESTION.nombre_invalido, true); return; }
    gestionar("renombrar_lista", { p_lista: listaActual, p_nombre: nombre }).then(function (r) {
      if (r === null) return;
      if (r !== "ok") { decirListas(MENSAJES_GESTION[r] || "No se pudo renombrar.", true); return; }
      recargarListas("Nombre cambiado.");
    });
  });

  $("pl-anadir").addEventListener("click", function () {
    var email = $("pl-email").value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { decirListas("Escribe un email válido.", true); $("pl-email").focus(); return; }
    var rol = $("pl-admin").checked ? "admin" : "miembro";
    gestionar("anadir_miembro", { p_lista: listaActual, p_email: email, p_rol: rol }).then(function (r) {
      if (r === null) return;
      if (r !== "ok") { decirListas(MENSAJES_GESTION[r] || "No se pudo añadir.", true); return; }
      $("pl-email").value = "";
      $("pl-admin").checked = false;
      recargarListas("Añadido. Ya puede entrar con su cuenta y ver «" + nombreLista(listaActual) + "».");
    });
  });

  $("pl-crear").addEventListener("click", function () {
    var nombre = $("pl-nueva").value.trim();
    if (!nombre || nombre.length > 60) { decirListas(MENSAJES_GESTION.nombre_invalido, true); $("pl-nueva").focus(); return; }
    gestionar("crear_lista", { p_nombre: nombre }).then(function (id) {
      if (!id) return;
      $("pl-nueva").value = "";
      return cargarListas().then(function () {
        listaActual = String(id);
        return activarListaActual();
      }).then(function () {
        pintarPanelListas();
        decirListas("Lista «" + nombre + "» creada, y ya la estás viendo: empieza vacía. Añade gente arriba.");
      }).catch(function () {
        decirListas("Lista «" + nombre + "» creada, pero no se pudo abrir: recarga la app.", true);
      });
    });
  });

  function quitarDeLista(m) {
    var esYo = m.user_id === miId;
    var nombre = nombreLista(listaActual);
    var total = miembrosDe(listaActual).length;
    var pregunta = !esYo ? "¿Quitar a " + m.email + " de «" + nombre + "»? Dejará de verla."
      : total === 1 ? "Eres la última persona en «" + nombre + "». Si sales, la lista y sus " + data.length +
                      " restaurantes se borran para siempre. ¿Salir?"
      : "¿Salir de «" + nombre + "»? Dejarás de verla hasta que alguien te vuelva a añadir.";
    if (!window.confirm(pregunta)) return;

    var listaSalida = listaActual;
    gestionar("quitar_miembro", { p_lista: listaSalida, p_user: m.user_id }).then(function (r) {
      if (r === null) return;
      if (r !== "ok") { decirListas(MENSAJES_GESTION[r] || "No se pudo.", true); return; }
      if (!esYo) { recargarListas("Quitado de la lista."); return; }
      // Te has ido: se pasa a otra de tus listas (o a ninguna).
      try { localStorage.removeItem(CLAVE_CACHE + listaSalida); } catch (e) {}
      return cargarListas().then(activarListaActual).then(function () {
        pintarPanelListas();
        decirListas("Has salido de «" + nombre + "».");
      });
    });
  }

  $("pl-pass-btn").addEventListener("click", function () {
    var p1 = $("pl-pass1").value, p2 = $("pl-pass2").value;
    if (p1.length < 8) { decirListas("La contraseña tiene que tener al menos 8 caracteres.", true); $("pl-pass1").focus(); return; }
    if (p1 !== p2) { decirListas("Las dos contraseñas no coinciden.", true); $("pl-pass2").focus(); return; }
    if (!sb || soloLectura) { decirListas("Sin conexión: inténtalo cuando vuelva la red.", true); return; }
    sb.auth.updateUser({ password: p1 }).then(function (r) {
      if (r.error) { decirListas("No se pudo cambiar: " + (r.error.message || "inténtalo de nuevo."), true); return; }
      $("pl-pass1").value = "";
      $("pl-pass2").value = "";
      decirListas("Contraseña cambiada.");
    }).catch(function () { decirListas("No se pudo conectar. Revisa la conexión.", true); });
  });

  /* ============================================================
     16 quinquies. Ayuda del asistente (rellenar y buscar)
     ============================================================
     La clave del modelo vive en el servidor, en una Edge Function de
     Supabase, no aquí. Nada de lo que propone se guarda solo: se
     rellena el formulario y lo confirmas tú.                           */

  function decirIA(mensaje, tipo) {
    var el = $("ia-msg");
    el.textContent = mensaje || "";
    el.className = "msg" + (tipo === "error" ? " msg-error" : tipo === "aviso" ? " msg-ia" : "");
    el.hidden = !mensaje;
  }

  function llamarAsistente(cuerpo) {
    if (!sb || soloLectura) return Promise.reject(new Error("Sin conexión ahora mismo."));
    if (!sb.functions || typeof sb.functions.invoke !== "function") {
      return Promise.reject(new Error("Esta versión del cliente no puede llamar al asistente."));
    }
    return sb.functions.invoke("asistente", { body: cuerpo }).then(function (r) {
      if (r.error) {
        // Si la función respondió con un error propio (502…), su motivo viene
        // en el cuerpo de la respuesta: se lee para enseñarlo tal cual.
        var ctx = r.error.context;
        if (ctx && typeof ctx.json === "function") {
          return ctx.json().then(function (j) {
            throw new Error((j && j.error) || "El asistente ha fallado (" + (ctx.status || "?") + ").");
          }, function () {
            throw new Error(ctx.status === 404
              ? "No encuentro la función «asistente» en Supabase. ¿Está desplegada con ese nombre?"
              : "El asistente ha fallado (" + (ctx.status || "?") + ").");
          });
        }
        throw new Error("No responde el asistente. ¿Está desplegada la función «asistente» en Supabase?");
      }
      if (r.data && r.data.error) throw new Error(r.data.error);
      return r.data || {};
    });
  }

  /* ---- Rellenar el formulario desde un enlace ---- */

  $("ia-extraer-btn").addEventListener("click", function () {
    var enlace = $("f-enlace").value.trim();
    if (!/^https?:\/\/[^\s]+\.[^\s]+/i.test(enlace)) {
      decirIA("Pega una dirección web completa, empezando por https://", "error");
      $("f-enlace").focus();
      return;
    }
    var boton = $("ia-extraer-btn");
    boton.disabled = true;
    decirIA("Leyendo la página…");

    llamarAsistente({ accion: "extraer", url: enlace }).then(function (r) {
      var p = r.propuesta || {};
      if (!p.nombre && !p.direccion && !(p.sedes || []).length) {
        decirIA("De esa página no he sacado nada aprovechable. Prueba con la web del restaurante.", "error");
        return;
      }
      // Solo se rellena lo que esté vacío: nunca se pisa lo que ya escribiste.
      var poner = function (campo, valor) { if (valor && !campo.value.trim()) campo.value = valor; };
      poner(fNombre, p.nombre);
      poner(fTipo, p.tipo);
      poner(fZona, p.zona);
      poner(fDireccion, p.direccion);
      poner(fCarta, p.carta);
      poner(fReserva, p.reserva);
      poner(fNota, p.flag);
      if (p.precio >= 1 && p.precio <= 3) fPrecio.value = String(p.precio);
      if (p.horario && !fHorario.value.trim() && interpretarHorario(p.horario).ok) {
        fHorario.value = osmATexto(p.horario);
        previaHorario(fHorario, msgHorario, horarioPanelActual);
      }

      var añadidas = 0;
      (p.sedes || []).forEach(function (s) {
        var yaEsta = sedesEnEdicion.some(function (x) { return plano(x.nombre) === plano(s.nombre); });
        if (yaEsta) return;
        var sede = normalizarSede(s);
        // El horario de su web cuenta como tuyo: lo has revisado al guardar.
        if (typeof s.horario === "string" && interpretarHorario(s.horario).ok) sede.horario = { oh: s.horario, m: true, t: Date.now() };
        sedesEnEdicion.push(sede);
        añadidas += 1;
      });
      if (añadidas) {
        renderSedeList();
        sedesDetails.open = true;
      }

      var dominio = "";
      try { dominio = new URL(r.fuente || enlace).hostname.replace(/^www\./, ""); } catch (e) {}
      decirIA("Propuesto a partir de " + (dominio || "el enlace") +
        (añadidas ? " (" + añadidas + " locales)" : "") +
        ". Revísalo: puede equivocarse. No se guarda nada hasta que le des a Guardar.", "aviso");
      desplazarA(fNombre, { block: "center", behavior: "smooth" });
    }).catch(function (e) {
      decirIA(e.message || "No se pudo leer esa página.", "error");
    }).then(function () {
      boton.disabled = false;
    });
  });

  /* ---- Convertir una frase en filtros ---- */

  var interpretando = false;
  function interpretarFrase() {
    var frase = $("search").value.trim();
    if (!frase || interpretando) return;

    var zonas = [], tipos = [];
    data.forEach(function (d) {
      zonasDe(d).forEach(function (z) { if (zonas.indexOf(z) === -1) zonas.push(z); });
      var t = d.tipo || "Sin especificar";
      if (tipos.indexOf(t) === -1) tipos.push(t);
    });

    interpretando = true;
    avisar("Interpretando «" + frase + "»…");

    llamarAsistente({ accion: "buscar", texto: frase, zonas: zonas, tipos: tipos, marcas: marcasDisponibles }).then(function (r) {
      var f = r.filtros || {};
      // Solo se aplican valores que existen de verdad: el servidor ya los
      // filtra y aquí se vuelve a comprobar.
      state.zonas = (f.zonas || []).filter(function (z) { return zonas.indexOf(z) !== -1; });
      state.tipos = (f.tipos || []).filter(function (t) { return tipos.indexOf(t) !== -1; });
      state.precios = (f.precios || []).filter(function (p) { return ["€", "€€", "€€€"].indexOf(p) !== -1; });
      state.abiertoAhora = f.abiertoAhora === true;
      state.marcas = marcasDisponibles ? (f.marcas || []).filter(function (m) {
        return ["Quiero ir", "Ya he ido", "Sin marcar"].indexOf(m) !== -1;
      }) : [];
      if (f.sort && ["nombre", "zona", "tipo", "precio", "recientes", "cerca"].indexOf(f.sort) !== -1) {
        state.sort = f.sort;
        $("sort").value = f.sort;
      }
      state.search = plano(f.texto || "");
      $("search").value = f.texto || "";
      $("abierto-chip").setAttribute("aria-pressed", state.abiertoAhora ? "true" : "false");

      firmasChips = {};
      guardarFiltros();
      refrescarFuentesChips();
      render();

      var puestos = state.zonas.concat(state.tipos, state.precios, state.marcas);
      if (state.abiertoAhora) puestos.push("abierto ahora");
      avisar(puestos.length ? "Filtrado por " + puestos.join(", ") + "." : "No he sabido traducir eso a filtros.");
    }).catch(function (e) {
      avisar(e.message || "No se pudo interpretar la frase.");
    }).then(function () {
      interpretando = false;
    });
  }

  /* ============================================================
     17. Copia de seguridad: exportar / restaurar (contra Supabase)
     ============================================================ */

  (function copias() {
    var caja = $("backup-box");
    var msg = $("tools-msg");
    function decir(t, error) { msg.textContent = t; msg.className = "msg" + (error ? " msg-error" : ""); }

    $("export-btn").addEventListener("click", function () {
      caja.value = JSON.stringify({ v: 4, guardado: Date.now(), items: data }, null, 2);
      decir("Copia creada abajo. Cópiala y guárdala en Notas, en un correo o donde prefieras.");
    });

    $("copy-btn").addEventListener("click", function () {
      if (!caja.value) { decir("Primero pulsa «Crear copia».", true); return; }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(caja.value).then(function () { decir("Copiado al portapapeles."); },
          function () { caja.select(); decir("No se pudo copiar solo: el texto está seleccionado, cópialo a mano.", true); });
      } else {
        caja.select();
        decir("El texto está seleccionado, cópialo a mano.");
      }
    });

    $("import-btn").addEventListener("click", function () {
      if (requiereConexion()) return;
      var entrada = parsearJson(caja.value.trim());
      var brutos = Array.isArray(entrada) ? entrada : (entrada && Array.isArray(entrada.items) ? entrada.items : null);
      if (!brutos) { decir("Eso no parece una copia válida. Pega el texto completo que generó «Crear copia».", true); return; }

      var porId = Object.create(null);
      data.forEach(function (d) { porId[d.id] = d; });

      brutos = brutos.filter(function (b) { return b && typeof b === "object"; });
      if (!brutos.length) { decir("La copia no tiene ningún restaurante.", true); return; }

      var operaciones = brutos.map(function (bruto) {
        var v = normalizarRegistro(bruto);
        var existente = bruto.id && porId[bruto.id];
        var op = existente
          ? sb.from("restaurantes").update(filaDesde(v)).eq("id", existente.id).select().single()
          : sb.from("restaurantes").insert(conLista(filaDesde(v))).select().single();
        // Un fallo de red en una fila cuenta como «fallida», no rompe el resto.
        return Promise.resolve(op).catch(function (e) { return { error: e || true }; });
      });

      Promise.all(operaciones).then(function (resultados) {
        var nuevos = 0, actualizados = 0, fallidos = 0;
        resultados.forEach(function (r, i) {
          if (r.error) { fallidos++; return; }
          upsertLocal(registroDesdeFila(r.data));
          if (brutos[i].id && porId[brutos[i].id]) actualizados++; else nuevos++;
        });
        guardarCache();
        refrescarFuentesChips();
        render();
        decir("Restaurado: " + nuevos + " nuevos, " + actualizados + " actualizados" + (fallidos ? ", " + fallidos + " fallidos" : "") + ".");
        avisar("Copia restaurada.");
      }).catch(function () {
        decir("No se pudo restaurar la copia. Revisa la conexión.", true);
      });
    });
  })();

  /* ============================================================
     18. Arranque
     ============================================================ */

  conectarAuth();

  /* Actualizaciones.
     En el iPhone, la app de la pantalla de inicio no se recarga al
     abrirla: vuelve tal cual estaba en memoria, a veces durante días.
     Así que, cada vez que vuelve a primer plano, se pregunta a GitHub
     qué versión hay publicada (el ?v= de app.js en index.html). Si es otra,
     se recarga sola cuando no hay nada a medio escribir; si lo hay, se
     ofrece con un aviso. */
  (function () {
    var RE_VERSION = /<script\s+src="app\.js\?v=([^"&]+)"/;
    var scriptApp = document.querySelector('script[src^="app.js?v="]');
    var VERSION = "";
    if (scriptApp) {
      var mv = /[?&]v=([^&]+)/.exec(scriptApp.getAttribute("src"));
      VERSION = mv ? mv[1] : "";
    }
    var registro = null;
    var recargando = false;
    var pendiente = false;
    var ultimaComprobacion = 0;

    function puedeRecargarSolo() {
      var a = document.activeElement;
      var escribiendo = !!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
      return !hojaActiva && !escribiendo;
    }

    function recargar() {
      if (recargando) return;
      recargando = true;
      location.reload();
    }

    function hayVersionNueva() {
      if (recargando) return;
      pendiente = true;
      if (document.visibilityState !== "hidden" && puedeRecargarSolo()) { recargar(); return; }
      avisar("Hay una versión nueva de la app.", { etiqueta: "Actualizar", alPulsar: recargar });
    }

    function versionPublicada() {
      // cache: "no-store" se salta tanto la caché del navegador como el
      // service worker, que deja pasar estas peticiones sin tocarlas.
      var url = location.href.split("#")[0].split("?")[0];
      return fetch(url, { cache: "no-store", credentials: "same-origin" })
        .then(function (r) { return r.ok ? r.text() : ""; })
        .then(function (t) {
          var m = RE_VERSION.exec(t);
          return m ? m[1] : "";
        });
    }

    function comprobar() {
      if (recargando || !navigator.onLine) return;
      var ahora = Date.now();
      if (ahora - ultimaComprobacion < 30000) return;
      ultimaComprobacion = ahora;
      if (registro) registro.update().catch(function () {});
      if (!VERSION) return;
      versionPublicada().then(function (v) {
        if (v && v !== VERSION) hayVersionNueva();
      }).catch(function () { /* sin red: ya se mirará */ });
    }

    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState !== "visible") return;
      if (pendiente && puedeRecargarSolo()) { recargar(); return; }
      comprobar();
    });
    window.addEventListener("pageshow", function (e) { if (e.persisted) comprobar(); });
    window.addEventListener("online", comprobar);

    if (!("serviceWorker" in navigator)) return;

    // Si la página ya la servía un service worker, que cambie significa
    // que se ha instalado uno nuevo. En la primera visita no: ahí solo
    // está tomando el control por primera vez.
    var teniaControlador = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (!teniaControlador) { teniaControlador = true; return; }
      hayVersionNueva();
    });
    navigator.serviceWorker.addEventListener("message", function (e) {
      if (!e.data || e.data.tipo !== "actualizacion") return;
      hayVersionNueva();
    });
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js", { updateViaCache: "none" })
        .then(function (r) { registro = r; })
        .catch(function () {});
    });
  })();
})();
