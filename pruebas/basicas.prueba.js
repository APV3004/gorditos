/* Comprobaciones rápidas que ya han dado guerra alguna vez. */
const acorn = require("acorn");
const E = require("./entorno");

module.exports = async function () {
  const k = E.contador("básicas");
  const html = E.leer("index.html"), sw = E.leer("sw.js"), app = E.leer("app.js");

  // Sintaxis antigua: así funciona en iPhones con iOS no tan reciente
  let sintaxis = "";
  try { acorn.parse(app, { ecmaVersion: 2017 }); } catch (e) { sintaxis = e.message; }
  k.c(!sintaxis, "app.js usa sintaxis posterior a ES2017: " + sintaxis);

  // El mismo número de versión en index.html y en sw.js
  const vHtml = (/src="app\.js\?v=(\d+)"/.exec(html) || [])[1];
  const vSw = (/var CACHE = "gorditos-v(\d+)"/.exec(sw) || [])[1];
  k.c(vHtml && vHtml === vSw, "versión distinta: index.html v=" + vHtml + " y sw.js v" + vSw);

  // index.html es la app, no otro archivo pegado encima
  k.c(/^<!DOCTYPE html>/i.test(html.trim()), "index.html no empieza por <!DOCTYPE html>");

  // CSP estricta: nada de scripts en línea ni manejadores on…=
  const sinSrc = (html.match(/<script(?![^>]*\bsrc=)[^>]*>/gi) || []);
  k.c(sinSrc.length === 0, "hay <script> en línea, que la CSP bloquearía: " + sinSrc.join(" "));
  k.c(!/\son[a-z]+\s*=\s*["']/i.test(html), "hay manejadores on…= en el HTML");

  // Las librerías de jsDelivr llevan versión fija e integridad
  const cdn = html.match(/<(script|link)[^>]+cdn\.jsdelivr\.net[^>]*>/gi) || [];
  cdn.forEach((t) => k.c(/integrity="sha384-/.test(t) && /@\d+\.\d+\.\d+\//.test(t), "librería sin versión fija o sin integrity: " + t.slice(0, 120)));

  // Ningún secreto de servidor en lo público
  const config = E.leer("config.js");
  k.c(!/service_role|GEMINI|AIza[0-9A-Za-z_-]{20,}/.test(config + app + html), "parece haber una clave privada en config.js, app.js o index.html");

  return k.fin();
};
