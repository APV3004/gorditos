# Gorditos

Guía de restaurantes en Madrid, compartida entre dos personas en tiempo
real, con Supabase como backend. Funciona sin conexión en modo lectura
(última copia vista); para añadir o editar hace falta red.

## Archivos

| Archivo | Para qué |
|---|---|
| `index.html` | La app: HTML y CSS |
| `restaurantes-madrid.html` | Solo redirige a `index.html`: para iconos, marcadores y enlaces viejos |
| `app.js` | La lógica de la app (aparte para poder aplicar una CSP estricta) |
| `sw.js` | Service worker: trae siempre la última versión y abre sin red |
| `manifest.webmanifest` | Nombre, icono y modo pantalla completa |
| `icon-512.png` | El icono |
| `icon-maskable-512.png` | El icono para Android, con el dibujo al 80 % para que la máscara no lo recorte |
| `config.js` | Tu URL y tu clave de Supabase — se sube una vez y no se vuelve a tocar |
| `supabase.sql` | Crea la tabla, la seguridad y el tiempo real — se pega una vez en el SQL Editor de Supabase |

Los primeros van juntos en el mismo hosting. `supabase.sql` no se
sube a ningún sitio: se pega en el panel de Supabase.

## Puesta en marcha (una vez)

1. **Crea un proyecto en [supabase.com](https://supabase.com)** (gratis).
2. **SQL Editor → New query** → pega el contenido de `supabase.sql` entero → Run.
3. **Authentication → Users → Add user** → crea una cuenta para ti y otra
   para tu hermano (email + contraseña cada una).
4. **Project Settings → API** → copia el "Project URL" y la clave
   "anon public".
5. Abre `config.js` y pon tu URL y tu clave. Es el único sitio donde
   van: las actualizaciones de la app solo cambian `index.html` y `app.js`, así
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

Cambies `index.html` o `app.js`, sube el mismo número en dos sitios:
```html
<!-- index.html, al final -->
<script src="app.js?v=37"></script>   <!-- -> ?v=38 -->
```
```js
// sw.js
var CACHE = "gorditos-v37";   // -> "gorditos-v38"
```
Cada vez que la app vuelve a primer plano mira qué versión hay
publicada. Si es otra, se recarga sola (o, si tienes un formulario a
medio rellenar, te sale un botón de «Actualizar»). Con red, abrir la
app enseña siempre la última versión; sin red, la última que viste.

Si cambias de versión de Supabase o Leaflet, el `integrity` del
`<script>` tiene que ser el de ese archivo exacto: si no coincide, el
navegador bloquea la librería y la app se queda en blanco.

## Los datos

Viven en Supabase, no en el teléfono. El `localStorage` de cada móvil
solo guarda una copia de lectura para cuando no hay red, más las
preferencias de tema y filtros (esas sí son solo tuyas). Copia de
seguridad manual: pie de página → Copia de seguridad → Crear copia.


## El mapa

Selector «Lista / Mapa» en la barra de resultados. Salen los restaurantes (o cada local,
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
- **Añadir a alguien a una lista:** en la app, «Listas y ajustes» (el botón redondo de arriba) → su email.
  Tiene que tener cuenta antes.
- **Gestores:** pueden renombrar la lista y añadir o quitar gente. Una
  lista con gente no se puede quedar sin gestor. Si se va el último
  miembro, la lista y sus restaurantes se borran.
- **Contraseña:** cada uno la cambia en «Listas y ajustes» → Tu contraseña.
- Al pulsar «Salir», se borran de ese dispositivo las copias guardadas
  de tus listas.

## Horarios de apertura

**El tuyo manda.** En el formulario (y en el de cada local) hay un campo
«Horario». Se escribe como lo dirías:

    L-V 13-16, 20-23:30; S-D 13-24; lunes cerrado
    de martes a domingo de 13:00 a 16:00 y de 20:00 a 23:30
    todos los días 12-24

Debajo te dice cómo lo ha entendido («Entendido: …») y si ahora está
abierto. Si no lo entiende, no deja guardar. Lo que escribes tú no lo
pisa nunca el horario automático; si borras el campo, vuelve el automático.

**«Buscar en su web»** lee la web del restaurante (la de la carta, la de
reservas o el enlace que hayas pegado arriba, y su portada) con Gemini y
rellena el campo para que lo revises. No guarda nada hasta que le das a
Guardar. «Rellenar» desde un enlace también trae el horario si la página
lo dice. Gratis con la clave de Gemini que ya tienes; necesita la función
`asistente` actualizada (ver abajo).

**Automático:** si no escribes nada, se sacan de OpenStreetMap (servicio Overpass): para cada local ya
situado en el mapa, se busca un local de comida con ese mismo nombre a
menos de 80 m y se toma su horario publicado. Se guarda en Supabase y
se refresca cada mes. Necesita la columna `horario`
(`supabase-migracion-horarios.sql`).

- Si un horario no se entiende (meses, festivos concretos, texto
  libre), no se dice si está abierto: mejor callar que acertar mal.
- «Abierto ahora» quita los cerrados, pero no los que no publican
  horario: de esos no se sabe.

## Marcas: «Quiero ir» y «Ya he ido»

Cada persona marca por su cuenta. Los demás miembros de la lista ven
tus marcas («Quiere ir: adrian») pero solo tú puedes cambiarlas: lo
garantizan las políticas de `supabase-migracion-marcas.sql`, no la app.
Sin esa migración, los botones y el filtro simplemente no aparecen.
En la tarjeta son dos iconos junto al precio: el marcador («Quiero ir»)
y el check («Ya he ido»).

## Zonas

El filtro agrupa por distrito (o municipio) y la tarjeta enseña lo que
se escribió: un restaurante en «Chueca» sale al filtrar por «Centro» y
su tarjeta sigue diciendo «Chueca». La tabla de barrios está en
`DISTRITO_DE` (`app.js`, sección 8); lo que no aparece ahí se queda tal
cual. Mayúsculas, tildes, espacios y guiones no cuentan.

## Buscar por platos

La función `asistente` lee las cartas de cada restaurante (su web, un PDF
o una foto) con Gemini y la app guarda los platos y las dietas que
encuentra en la columna `carta_info`. No se edita a mano y la comparte
toda la lista. Se leen en segundo plano, como mucho 8 por sesión, de una
en una y con 15 s entre cada una, para no gastar la cuota del modelo (si Gemini
dice que se ha agotado, se para hasta la próxima vez); si cambian los enlaces de la
carta se vuelven a leer, y cada dos meses se refrescan. En «Listas y
ajustes → Buscar por platos» se ve cuántas hay leídas y se pueden leer las
que faltan.

- Escribir un plato en la búsqueda («cachopo», «tiramisú») encuentra al
  instante los restaurantes que lo tienen; la tarjeta dice «En su carta: …».
- Una frase («algo sin gluten en Chamberí») va a la IA con lo leído de
  las cartas, y aparece el chip «Carta: sin gluten ✕» para quitarlo.
- Cartas que se pintan con JavaScript no se pueden leer: mejor enlazar el
  PDF o una foto de la carta.

Si la columna no existiera, la app lo dice en Ajustes y no lo intenta.
Se crea así (se puede ejecutar más de una vez):
```sql
alter table public.restaurantes add column if not exists carta_info jsonb;
```

## Asistente (rellenar desde un enlace y buscar con una frase)

Usa Gemini a través de una función de Supabase, para que la clave no
esté en config.js (que es público).

1. **Clave:** en Google AI Studio (aistudio.google.com) → «Get API key».
2. **La función:** Supabase → Edge Functions → «Deploy a new function» →
   «Via Editor». Nómbrala exactamente `asistente`, borra el ejemplo y
   pega `supabase/functions/asistente/index.ts`. Despliega. Deja activada
   la verificación de JWT: así solo la usan quienes han iniciado sesión.
3. **Secretos** (Edge Functions → Secrets):
   - `GEMINI_API_KEY`: tu clave.
   - `GEMINI_MODEL` (opcional): el modelo, si quieres otro distinto del
     que viene por defecto. Google cambia los nombres a menudo; si la
     app dice que Gemini «no reconoce el modelo», pon aquí uno actual
     de la lista de AI Studio. No hace falta volver a desplegar.

Nada de lo que propone se guarda solo: rellena el formulario o los
filtros, y tú confirmas. Si la función no está desplegada, la app lo
dice y todo lo demás sigue funcionando igual.

### Actualizar la función `asistente`

Cada vez que cambie `supabase/functions/asistente/index.ts`: Supabase →
Edge Functions → `asistente` → Code → borra todo, pega el nuevo → Deploy.
Los secretos (`GEMINI_API_KEY`…) se quedan como están.
