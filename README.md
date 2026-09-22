# Gorditos

Guía de restaurantes en Madrid, compartida entre dos personas en tiempo
real, con Supabase como backend. Funciona sin conexión en modo lectura
(última copia vista); para añadir o editar hace falta red.

## Archivos

| Archivo | Para qué |
|---|---|
| `restaurantes-madrid.html` | La app entera: CSS y JS incluidos |
| `sw.js` | Service worker: arranque instantáneo, caché de la propia app |
| `manifest.webmanifest` | Nombre, icono y modo pantalla completa |
| `icon-512.png` | El icono |
| `config.js` | Tu URL y tu clave de Supabase — se sube una vez y no se vuelve a tocar |
| `supabase.sql` | Crea la tabla, la seguridad y el tiempo real — se pega una vez en el SQL Editor de Supabase |

Los cuatro primeros van juntos en el mismo hosting. `supabase.sql` no se
sube a ningún sitio: se pega en el panel de Supabase.

## Puesta en marcha (una vez)

1. **Crea un proyecto en [supabase.com](https://supabase.com)** (gratis).
2. **SQL Editor → New query** → pega el contenido de `supabase.sql` entero → Run.
3. **Authentication → Users → Add user** → crea una cuenta para ti y otra
   para tu hermano (email + contraseña cada una).
4. **Project Settings → API** → copia el "Project URL" y la clave
   "anon public".
5. Abre `config.js` y pon tu URL y tu clave. Es el único sitio donde
   van: las actualizaciones de la app solo cambian `index.html`, así
   que no tendrás que volver a pegarlas.
6. Sube los archivos a tu hosting (GitHub Pages, como hasta ahora).

La primera vez que cualquiera de los dos entre con su cuenta, si la
tabla está vacía, la app la rellena sola con lo que ese teléfono tenía
guardado — no hace falta escribir nada a mano.

## Importante: solo funciona en GitHub Pages, no en un artifact de claude.ai

Un artifact publicado en claude.ai no puede hacer peticiones de red a
sitios externos como Supabase (solo puede hablar con Anthropic). Un
enlace de claude.ai que hayáis usado antes seguirá abriendo la app,
pero se queda como una copia local antigua, desconectada de esto. **La
URL de GitHub Pages es la única que sirve para lo compartido.** Los dos
deberíais usar siempre esa misma.

## Cómo funciona por dentro

- La tabla `restaurantes` en Supabase es la única fuente de verdad.
  Cualquier alta, edición o borrado desde cualquiera de los dos móviles
  se escribe ahí, y llega al otro al instante por el canal de tiempo
  real — sin recargar la página.
- El catálogo que había en el código (`CATALOGO`, dentro del HTML) ya
  no gobierna el día a día: solo se usa **una vez**, para poblar la
  tabla si está completamente vacía. A partir de ahí, para añadir o
  quitar restaurantes se hace desde la propia app (lo verá el otro al
  momento), no editando el HTML.
- Si dos ediciones chocan casi a la vez, gana la última en llegar al
  servidor — no hay fusión inteligente entre las dos.
- Sin conexión, la app muestra la última copia vista (guardada en este
  dispositivo) pero no deja añadir ni editar hasta que vuelva la red.

## Vuestras cuentas

Se crean y gestionan desde **Authentication → Users** en el panel de
Supabase: ahí podéis cambiar contraseñas, añadir a alguien más o
quitarlo. La app en sí no tiene pantalla de registro a propósito: solo
entráis los dos.

## Al publicar cambios de código

Sube la versión en `sw.js`:
```js
var CACHE = "gorditos-v3";   // -> "gorditos-v4"
```
Así, a quien ya la tenga instalada le sale un botón de «Actualizar».

## Los datos

Viven en Supabase, no en el teléfono. El `localStorage` de cada móvil
solo guarda una copia de lectura para cuando no hay red, más las
preferencias de tema y filtros (esas sí son solo tuyas). Copia de
seguridad manual: pie de página → Copia de seguridad → Crear copia.


## El mapa

Botón «Mapa» junto al contador. Salen los restaurantes (o cada local,
si tiene varios) que tengan **dirección** puesta, y tu posición.

- Las direcciones se convierten en coordenadas con Nominatim
  (OpenStreetMap) la primera vez que alguno abre el mapa, y se guardan
  en Supabase: cada dirección se busca una sola vez para los dos.
  Necesita la columna `geo` (`supabase-migracion-mapa.sql`).
- Si cambias una dirección, se vuelve a situar sola.
- Tu ubicación no sale del móvil: las distancias se calculan en local.
  El GPS solo está encendido con el mapa abierto o al ordenar por
  «Más cerca de mí».

## Listas por grupo

Cada restaurante pertenece a una lista (Familia, Amigos…). Cada persona
solo ve las listas de las que es miembro: lo garantiza la base de datos
(las políticas de `supabase-migracion-listas.sql`), no la app.

- **Crear cuentas:** Authentication → Users → Add user, con «Auto Confirm
  User» marcado. El registro público debe estar DESACTIVADO
  (Authentication → Sign In / Providers → «Allow new users to sign up»).
- **Añadir a alguien a una lista:** en la app, «Gestionar» → su email.
  Tiene que tener cuenta antes.
- **Gestores:** pueden renombrar la lista y añadir o quitar gente. Una
  lista con gente no se puede quedar sin gestor. Si se va el último
  miembro, la lista y sus restaurantes se borran.
- **Contraseña:** cada uno la cambia en «Gestionar» → Tu contraseña.
- Al pulsar «Salir», se borran de ese dispositivo las copias guardadas
  de tus listas.
