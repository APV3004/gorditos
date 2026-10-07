-- Gorditos — lo leído de las cartas, para buscar platos («¿dónde hay cachopo?»).
-- Pega esto en el SQL Editor de Supabase y dale a Run (una vez).
-- Solo añade una columna vacía: no toca nada de lo que ya tenéis.
-- Se rellena sola, en segundo plano, cuando alguien abre la app con la
-- función «asistente» desplegada; se comparte entre los de la lista.

alter table public.restaurantes
  add column if not exists carta_info jsonb;
