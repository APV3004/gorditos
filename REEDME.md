# Gorditos

Guía personal de restaurantes en Madrid. Un HTML, sin backend, sin build.
Ahora también funciona sin conexión.

## Archivos

| Archivo | Para qué |
|---|---|
| `restaurantes-madrid.html` | La app entera: CSS y JS incluidos |
| `sw.js` | Service worker: arranque instantáneo y uso sin cobertura |
| `manifest.webmanifest` | Nombre, icono y modo pantalla completa |
| `icon-512.png` | El icono de siempre, ahora como archivo |

Los cuatro van en la **misma carpeta**. Nada más.

## Publicar

Súbelos tal cual a cualquier hosting estático: GitHub Pages, Netlify,
Cloudflare Pages, Vercel, o una carpeta de tu propio servidor.

**Tiene que ser `https://`.** Los service workers no se registran por
`http://` ni abriendo el archivo con doble clic (`file://`). Si lo abres
así la app funciona igual, pero sin la parte de offline.

Para probar en local:

```bash
python3 -m http.server 8000
# luego abre http://localhost:8000/restaurantes-madrid.html
```

`localhost` es la única excepción a lo del https.

## Instalar en el iPhone

1. Abre la URL en **Safari** (no vale Chrome: en iOS solo Safari puede
   añadir a la pantalla de inicio).
2. Compartir → **Añadir a pantalla de inicio**.
3. Ábrela una vez con datos para que se guarde la copia local. A partir
   de ahí arranca sin conexión.

Si ya la tenías añadida y la URL no cambia, no hace falta volver a
añadirla: los restaurantes guardados siguen ahí.

## Al publicar cambios

Sube la versión en la primera línea útil de `sw.js`:

```js
var CACHE = "gorditos-v1";   // -> "gorditos-v2"
```

Al activarse borra las cachés antiguas. La app detecta sola que el HTML
ha cambiado y ofrece un botón «Actualizar».

## Los datos

Siguen en `localStorage`, en este dispositivo y solo en este. El service
worker guarda la *app*, no tus restaurantes: son cosas distintas.

La copia de seguridad está en el pie de la página. Úsala de vez en
cuando: si borras los datos de Safari para este sitio, se pierden.
