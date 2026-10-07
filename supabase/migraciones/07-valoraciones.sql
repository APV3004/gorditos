-- Gorditos — puntuación (1–5) y nota corta de cada persona al marcar «Ya he ido».
-- Van en la tabla «marcas», que ya es por (restaurante, usuario) y tiene RLS y
-- tiempo real: las políticas de 05-marcas.sql cubren las columnas nuevas (los
-- miembros ven las marcas de sus listas; cada uno solo cambia las suyas).
-- Se puede ejecutar más de una vez.

alter table public.marcas add column if not exists puntuacion smallint
  check (puntuacion between 1 and 5);
alter table public.marcas add column if not exists nota text
  check (char_length(nota) <= 280);
