-- Gorditos — horarios de apertura.
-- Pega esto en el SQL Editor de Supabase y dale a Run (una vez).
-- Solo añade una columna vacía: no toca nada de lo que ya tenéis.
-- Los horarios de los locales de las cadenas van dentro de «sedes»,
-- que ya existe, así que para ellos no hace falta nada más.

alter table public.restaurantes
  add column if not exists horario jsonb;
