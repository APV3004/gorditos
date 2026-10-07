-- Gorditos — añade el soporte de varios locales por restaurante.
-- Pega esto en el SQL Editor de Supabase y dale a Run.
-- (Solo esto: no hace falta volver a ejecutar supabase.sql entero,
-- la tabla y la seguridad ya las tienes.)

alter table public.restaurantes
  add column if not exists sedes jsonb not null default '[]'::jsonb;
