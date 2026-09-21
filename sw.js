/* Gorditos — service worker
   ---------------------------------------------------------------
   Objetivo: que la app abra al instante y siga funcionando sin
   cobertura, sin quedarse nunca congelada en una versión vieja.

   Estrategia: stale-while-revalidate. Se sirve lo que hay en caché
   (arranque inmediato, offline garantizado) y en paralelo se pide a
   la red. Si lo que llega es distinto, se guarda y se avisa a la
   página, que ofrece recargar.

   Al publicar cambios sube CACHE una versión: al activarse borra las
   cachés antiguas.                                                  */

var CACHE = "gorditos-v5";

/* Solo lo que se puede nombrar de antemano. La página en sí no está
   aquí a propósito: se cachea sola en la primera visita, bajo la ruta
   real en la que esté publicada, así que da igual cómo se llame el
   archivo o en qué subcarpeta viva. */
var PRECARGA = [
  "./manifest.webmanifest",
  "./icon-512.png"
];

var FUENTES = ["https://fonts.googleapis.com", "https://fonts.gstatic.com"];

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

  var url;
  try { url = new URL(req.url); } catch (err) { return; }

  var propio = url.origin === self.location.origin;
  var fuente = FUENTES.indexOf(url.origin) !== -1;

  // Todo lo demás (mapas, webs de los restaurantes, tel:) se deja pasar
  // sin tocar: son destinos externos, no parte de la app.
  if (!propio && !fuente) return;

  if (req.mode === "navigate") {
    e.respondWith(servirPagina(e, req));
  } else {
    e.respondWith(servirRecurso(e, req));
  }
});

function servirPagina(e, req) {
  return caches.open(CACHE).then(function (cache) {
    return cache.match(req, { ignoreSearch: true }).then(function (guardada) {

      var red = fetch(req).then(function (res) {
        if (!res || !res.ok) return { res: res };
        // Se lee el cuerpo una sola vez: sirve para comparar y para guardar.
        return res.clone().text().then(function (texto) {
          return { res: res, texto: texto };
        });
      }).catch(function () { return { res: null }; });

      var trabajo = red.then(function (r) {
        if (!r.texto) return;
        return Promise.resolve(guardada ? guardada.clone().text() : null).then(function (viejo) {
          if (viejo !== null && viejo !== r.texto) avisarClientes();
          // Se guarda una respuesta nueva en vez de la original: si el
          // servidor redirigió (barra final, www…), una respuesta marcada
          // como "redirected" no se puede servir después a una navegación.
          return cache.put(req, new Response(r.texto, {
            status: 200,
            statusText: "OK",
            headers: { "Content-Type": "text/html; charset=utf-8" }
          }));
        });
      }).catch(function () { /* sin red o sin espacio: se sigue sirviendo la copia */ });

      e.waitUntil(trabajo);

      if (guardada) return guardada;

      return red.then(function (r) {
        return r.res || new Response(
          "Gorditos no está disponible sin conexión todavía. Ábrelo una vez con datos y se guardará.",
          { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }
        );
      });
    });
  });
}

function servirRecurso(e, req) {
  return caches.open(CACHE).then(function (cache) {
    return cache.match(req).then(function (guardada) {
      var red = fetch(req).then(function (res) {
        if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone());
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
