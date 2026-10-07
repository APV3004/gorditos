-- Gorditos — marcas personales: «Quiero ir» y «Ya he ido».
-- Pega esto entero en el SQL Editor de Supabase y dale a Run (una vez).
--
-- Cada persona marca por su cuenta: que tú quieras ir a un sitio no
-- significa que lo quiera tu hermano. Los miembros de una lista ven las
-- marcas de los demás en esa lista («también quiere ir…»), pero cada
-- uno solo puede cambiar las suyas.
--
-- Se puede volver a ejecutar sin romper nada.

create table if not exists public.marcas (
  restaurante_id uuid not null references public.restaurantes(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  estado text not null check (estado in ('quiero', 'visitado')),
  updated_at timestamptz not null default now(),
  primary key (restaurante_id, user_id)
);
create index if not exists marcas_user_idx on public.marcas (user_id);

-- A qué lista pertenece un restaurante (security definer: se usa dentro
-- de las políticas sin chocar con las políticas de «restaurantes»).
create or replace function public.lista_de_restaurante(p_rest uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select lista_id from restaurantes where id = p_rest;
$$;
revoke execute on function public.lista_de_restaurante(uuid) from public, anon;
grant execute on function public.lista_de_restaurante(uuid) to authenticated;

alter table public.marcas enable row level security;

drop policy if exists "ves marcas de tus listas" on public.marcas;
drop policy if exists "pones tus marcas" on public.marcas;
drop policy if exists "cambias tus marcas" on public.marcas;
drop policy if exists "quitas tus marcas" on public.marcas;

-- Ves las marcas de todos en los restaurantes de tus listas
create policy "ves marcas de tus listas" on public.marcas
  for select to authenticated
  using (public.es_miembro(public.lista_de_restaurante(restaurante_id)));

-- Pero solo creas, cambias o quitas las TUYAS, y solo en tus listas
create policy "pones tus marcas" on public.marcas
  for insert to authenticated
  with check (user_id = auth.uid() and public.es_miembro(public.lista_de_restaurante(restaurante_id)));
create policy "cambias tus marcas" on public.marcas
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.es_miembro(public.lista_de_restaurante(restaurante_id)));
create policy "quitas tus marcas" on public.marcas
  for delete to authenticated
  using (user_id = auth.uid());

-- Tiempo real: ver al momento cuando alguien marca algo
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'marcas') then
    alter publication supabase_realtime add table public.marcas;
  end if;
end $$;
