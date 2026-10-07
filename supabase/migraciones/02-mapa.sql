-- Gorditos — coordenadas para el mapa.
-- Pega esto en el SQL Editor de Supabase y dale a Run (una vez).
-- Solo añade una columna vacía: no toca nada de lo que ya tenéis.
-- Las coordenadas se rellenan solas la primera vez que alguno de los
-- dos abra el mapa, y se comparten: cada dirección se busca una sola vez.

alter table public.restaurantes
  add column if not exists geo jsonb;
