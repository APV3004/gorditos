/* Ejecuta todas las pruebas. Sale con código 1 si alguna falla, para que
   GitHub Actions no publique. Uso: node pruebas/ejecutar.js
   (GORDITOS_DIR=/otra/carpeta para probar otra copia de la web). */
const pruebas = ["basicas", "sw", "horarios", "actualizaciones", "formulario", "borrar", "compartir", "valoraciones"];

(async () => {
  let fallos = 0;
  for (const nombre of pruebas) {
    try {
      fallos += await require("./" + nombre + ".prueba.js")();
    } catch (e) {
      fallos++;
      console.log(nombre + ": se rompió la prueba —", e && e.stack || e);
    }
  }
  console.log(fallos ? "\n✗ " + fallos + " fallos" : "\n✓ Todo bien");
  process.exit(fallos ? 1 : 0);
})();
