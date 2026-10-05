/* Gorditos — service worker
   ---------------------------------------------------------------
   Objetivo: que la app enseñe SIEMPRE la última versión publicada
   cuando hay red, y que siga abriendo sin cobertura.

   - La página y los archivos propios (config.js, manifest, icono):
     primero la red, saltándose la caché HTTP de GitHub Pages. Si la
     red no contesta en unos segundos (metro, cobertura mala) se sirve
     la copia guardada y, cuando llega la nueva, se guarda y se avisa.
   - Librerías externas (Supabase, Leaflet, fuentes): la copia guardada
     al instante y se refresca por detrás. Cambian poco y pesan mucho.

   Al publicar cambios sube CACHE una versión: al activarse borra las
   cachés antiguas.                                                  */

var CACHE = "gorditos-v27";

// Cuánto se espera a la red antes de tirar de la copia guardada.
var ESPERA_RED_MS = 4000;

/* Solo lo que se puede nombrar de antemano. La página en sí no está
   aquí a propósito: se cachea sola en la primera visita, bajo la ruta
   real en la que esté publicada, así que da igual cómo se llame el
   archivo o en qué subcarpeta viva. */
var PRECARGA = [
  "./manifest.webmanifest",
  "./icon-512.png"
];

// Orígenes externos que se guardan para poder abrir la app sin red:
// las fuentes y las librerías (Supabase y Leaflet vienen de jsDelivr).
// Las teselas del mapa y Nominatim NO: la política de OpenStreetMap
// desaconseja cachearlas en masa, y sin red tampoco servirían de mucho.
var FUENTES = ["https://fonts.googleapis.com", "https://fonts.gstatic.com", "https://cdn.jsdelivr.net"];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(PRECARGA); })
      .catch(function () { /* si algo falla, la app sigue online */ })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (claves) {
        return Promise.all(claves.map(function (k) {
          return k === CACHE ? null : caches.delete(k);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  // La página pide así su propia versión para ver si hay una nueva:
  // eso tiene que ir directo a la red, sin pasar por aquí.
  if (req.cache === "no-store") return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }

  var propio = url.origin === self.location.origin;
  var fuente = FUENTES.indexOf(url.origin) !== -1;

  // Todo lo demás (mapas, webs de los restaurantes, Supabase) se deja
  // pasar sin tocar: son destinos externos, no parte de la app.
  if (!propio && !fuente) return;

  if (req.mode === "navigate") {
    e.respondWith(servirPagina(e, req));
  } else if (propio) {
    e.respondWith(servirPropio(e, req));
  } else {
    e.respondWith(servirLibreria(e, req));
  }
});

// Pide a la red sin caché HTTP. GitHub Pages manda max-age=600, así
// que sin esto el iPhone podía seguir recibiendo la versión anterior
// durante diez minutos aunque ya estuviese publicada la nueva.
function pedirFresco(url) {
  return fetch(url, { cache: "no-store", credentials: "same-origin", redirect: "follow" });
}

// Resuelve con lo primero que pase: la promesa o el plazo (a null).
function conPlazo(promesa, ms) {
  return new Promise(function (resolver) {
    var hecho = false;
    var t = setTimeout(function () { if (!hecho) { hecho = true; resolver(null); } }, ms);
    promesa.then(function (v) {
      if (!hecho) { hecho = true; clearTimeout(t); resolver(v); }
    }, function () {
      if (!hecho) { hecho = true; clearTimeout(t); resolver(null); }
    });
  });
}

function respuestaHtml(texto) {
  // Siempre una respuesta nueva, nunca la original: si el servidor
  // redirigió (barra final, index.html…), Safari se niega a mostrar una
  // respuesta marcada como «redirected» en una navegación.
  return new Response(texto, {
    status: 200,
    statusText: "OK",
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
}

function servirPagina(e, req) {
  var clave = req.url.split("#")[0];
  return caches.open(CACHE).then(function (cache) {
    return cache.match(clave, { ignoreSearch: true }).then(function (guardada) {

      var red = pedirFresco(clave).then(function (res) {
        if (!res || !res.ok) return { res: res };
        return res.text().then(function (texto) { return { res: res, texto: texto }; });
      }).catch(function () { return { res: null }; });

      // Se guarda la versión nueva en cuanto llega, se sirva o no.
      var guardado = red.then(function (r) {
        if (!r.texto) return;
        return cache.put(clave, respuestaHtml(r.texto));
      }).catch(function () { /* sin espacio: no pasa nada */ });
      e.waitUntil(guardado);

      if (!guardada) {
        return red.then(function (r) {
          if (r.texto) return respuestaHtml(r.texto);
          return r.res || new Response(
            "Gorditos no está disponible sin conexión todavía. Ábrelo una vez con datos y se guardará.",
            { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }
          );
        });
      }

      return conPlazo(red, ESPERA_RED_MS).then(function (r) {
        if (r && r.texto) return respuestaHtml(r.texto);

        // Red lenta o caída: se enseña la copia guardada, y si luego
        // llega una versión distinta se avisa para recargar.
        e.waitUntil(Promise.all([red, guardada.clone().text()]).then(function (par) {
          var nueva = par[0], vieja = par[1];
          if (nueva.texto && nueva.texto !== vieja) return avisarClientes();
        }).catch(function () {}));
        return guardada;
      });
    });
  });
}

function servirPropio(e, req) {
  // Se pide con su ?v= (para no recibir nada viejo), pero se guarda sin él:
  // una sola copia por archivo, la última, que es la que sirve sin red.
  var url = req.url.split("#")[0];
  var clave = url.split("?")[0];
  return caches.open(CACHE).then(function (cache) {
    return cache.match(clave).then(function (guardada) {
      var red = pedirFresco(url).then(function (res) {
        if (res && res.ok) {
          return cache.put(clave, res.clone()).catch(function () {}).then(function () { return res; });
        }
        return guardada || res;
      }).catch(function () { return null; });
      e.waitUntil(red);

      if (!guardada) return red.then(function (res) { return res || Response.error(); });
      return conPlazo(red, ESPERA_RED_MS).then(function (res) { return res || guardada; });
    });
  });
}

function servirLibreria(e, req) {
  return caches.open(CACHE).then(function (cache) {
    return cache.match(req).then(function (guardada) {
      // Una copia opaca (de una petición no-cors) no vale para una petición
      // cors, p. ej. <script crossorigin integrity>: el navegador la rechaza.
      if (guardada && guardada.type === "opaque" && req.mode !== "no-cors") guardada = null;

      // Solo respuestas completas (200): una 206 parcial haría fallar a put().
      var red = fetch(req).then(function (res) {
        if (res && (res.status === 200 || (res.type === "opaque" && req.mode === "no-cors"))) {
          return cache.put(req, res.clone()).catch(function () {}).then(function () { return res; });
        }
        return res;
      }).catch(function () { return null; });

      e.waitUntil(red);

      if (guardada) return guardada;
      return red.then(function (res) { return res || Response.error(); });
    });
  });
}

function avisarClientes() {
  return self.clients.matchAll({ type: "window" }).then(function (cs) {
    cs.forEach(function (c) { c.postMessage({ tipo: "actualizacion" }); });
  });
}
