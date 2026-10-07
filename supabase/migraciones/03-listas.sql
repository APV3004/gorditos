-- Gorditos — listas separadas por grupo (familia, amigos…).
-- Pega esto ENTERO en el SQL Editor de Supabase y dale a Run (una vez).
--
-- Qué hace:
--   1. Crea las tablas de listas y de quién pertenece a cada una.
--   2. Mete todos los restaurantes que ya tenéis en una primera lista,
--      «Familia», con todas las cuentas que existen ahora como gestoras.
--   3. Cambia la seguridad: antes bastaba con tener cuenta para verlo
--      todo; ahora cada uno solo ve y toca las listas de las que es
--      miembro. Aunque alguien consiguiera crearse una cuenta, no vería
--      nada.
--
-- Se puede volver a ejecutar sin romper nada (no duplica la lista).

-- ---------------------------------------------------------------
-- 1. Tablas
-- ---------------------------------------------------------------

create table if not exists public.listas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (length(trim(nombre)) between 1 and 60),
  created_at timestamptz not null default now()
);

create table if not exists public.miembros (
  lista_id uuid not null references public.listas(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rol text not null default 'miembro' check (rol in ('admin', 'miembro')),
  email text not null default '',
  created_at timestamptz not null default now(),
  primary key (lista_id, user_id)
);
create index if not exists miembros_user_idx on public.miembros (user_id);

alter table public.restaurantes
  add column if not exists lista_id uuid references public.listas(id) on delete cascade;
create index if not exists restaurantes_lista_idx on public.restaurantes (lista_id);

-- ---------------------------------------------------------------
-- 2. Lo que ya teníais pasa a la lista «Familia»
-- ---------------------------------------------------------------

do $$
declare v_lista uuid;
begin
  if exists (select 1 from public.restaurantes where lista_id is null) then
    insert into public.listas (nombre) values ('Familia') returning id into v_lista;
    insert into public.miembros (lista_id, user_id, rol, email)
      select v_lista, u.id, 'admin', coalesce(u.email, '') from auth.users u
      on conflict do nothing;
    update public.restaurantes set lista_id = v_lista where lista_id is null;
  end if;
end $$;

alter table public.restaurantes alter column lista_id set not null;

-- ---------------------------------------------------------------
-- 3. Comprobaciones de pertenencia
--    security definer: consultan «miembros» saltándose su propia
--    política, para que las políticas no se llamen a sí mismas en bucle.
-- ---------------------------------------------------------------

create or replace function public.es_miembro(p_lista uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from miembros where lista_id = p_lista and user_id = auth.uid());
$$;

create or replace function public.es_admin(p_lista uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from miembros where lista_id = p_lista and user_id = auth.uid() and rol = 'admin');
$$;

-- ---------------------------------------------------------------
-- 4. Operaciones de gestión. Toda escritura en «listas» y «miembros»
--    pasa por aquí: no hay políticas de escritura directa en esas
--    tablas, así que no hay forma de saltarse estas comprobaciones.
-- ---------------------------------------------------------------

create or replace function public.crear_lista(p_nombre text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_lista uuid; v_email text;
begin
  if auth.uid() is null then raise exception 'sin sesión'; end if;
  if length(trim(coalesce(p_nombre, ''))) not between 1 and 60 then raise exception 'nombre no válido'; end if;
  select email into v_email from auth.users where id = auth.uid();
  insert into listas (nombre) values (trim(p_nombre)) returning id into v_lista;
  insert into miembros (lista_id, user_id, rol, email) values (v_lista, auth.uid(), 'admin', coalesce(v_email, ''));
  return v_lista;
end; $$;

create or replace function public.renombrar_lista(p_lista uuid, p_nombre text)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not es_admin(p_lista) then return 'sin_permiso'; end if;
  if length(trim(coalesce(p_nombre, ''))) not between 1 and 60 then return 'nombre_invalido'; end if;
  update listas set nombre = trim(p_nombre) where id = p_lista;
  return 'ok';
end; $$;

-- La persona tiene que tener ya cuenta (se crean en Authentication → Users).
create or replace function public.anadir_miembro(p_lista uuid, p_email text, p_rol text default 'miembro')
returns text language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_email text;
begin
  if not es_admin(p_lista) then return 'sin_permiso'; end if;
  if p_rol not in ('admin', 'miembro') then return 'rol_invalido'; end if;
  select id, email into v_user, v_email from auth.users
    where lower(email) = lower(trim(p_email)) limit 1;
  if v_user is null then return 'no_existe'; end if;
  insert into miembros (lista_id, user_id, rol, email) values (p_lista, v_user, p_rol, coalesce(v_email, ''))
    on conflict (lista_id, user_id) do update set rol = excluded.rol;
  return 'ok';
end; $$;

-- Quitar a alguien (si gestionas la lista) o salirte tú.
-- No deja una lista con gente pero sin nadie que la gestione.
-- Si se va el último miembro, la lista y sus restaurantes se borran.
create or replace function public.quitar_miembro(p_lista uuid, p_user uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_rol text; v_admins int; v_total int;
begin
  if not (es_admin(p_lista) or p_user = auth.uid()) then return 'sin_permiso'; end if;
  select rol into v_rol from miembros where lista_id = p_lista and user_id = p_user;
  if v_rol is null then return 'no_es_miembro'; end if;
  select count(*) filter (where rol = 'admin'), count(*) into v_admins, v_total
    from miembros where lista_id = p_lista;
  if v_rol = 'admin' and v_admins = 1 and v_total > 1 then return 'ultimo_admin'; end if;
  delete from miembros where lista_id = p_lista and user_id = p_user;
  if v_total = 1 then delete from listas where id = p_lista; end if;
  return 'ok';
end; $$;

-- Solo usuarios con sesión pueden llamar a estas funciones.
revoke execute on function public.es_miembro(uuid), public.es_admin(uuid),
  public.crear_lista(text), public.renombrar_lista(uuid, text),
  public.anadir_miembro(uuid, text, text), public.quitar_miembro(uuid, uuid)
  from public, anon;
grant execute on function public.es_miembro(uuid), public.es_admin(uuid),
  public.crear_lista(text), public.renombrar_lista(uuid, text),
  public.anadir_miembro(uuid, text, text), public.quitar_miembro(uuid, uuid)
  to authenticated;

-- ---------------------------------------------------------------
-- 5. Políticas: se sustituye «basta con tener cuenta» por
--    «tienes que ser miembro de esa lista». «to authenticated»: sin
--    sesión no aplica ninguna, y Postgres deniega por defecto.
-- ---------------------------------------------------------------

alter table public.listas enable row level security;
alter table public.miembros enable row level security;

drop policy if exists "solo autenticados leen" on public.restaurantes;
drop policy if exists "solo autenticados insertan" on public.restaurantes;
drop policy if exists "solo autenticados editan" on public.restaurantes;
drop policy if exists "solo autenticados borran" on public.restaurantes;
drop policy if exists "miembros leen" on public.restaurantes;
drop policy if exists "miembros insertan" on public.restaurantes;
drop policy if exists "miembros editan" on public.restaurantes;
drop policy if exists "miembros borran" on public.restaurantes;

create policy "miembros leen" on public.restaurantes
  for select to authenticated using (public.es_miembro(lista_id));
create policy "miembros insertan" on public.restaurantes
  for insert to authenticated with check (public.es_miembro(lista_id));
create policy "miembros editan" on public.restaurantes
  for update to authenticated using (public.es_miembro(lista_id)) with check (public.es_miembro(lista_id));
create policy "miembros borran" on public.restaurantes
  for delete to authenticated using (public.es_miembro(lista_id));

drop policy if exists "ves tus listas" on public.listas;
create policy "ves tus listas" on public.listas
  for select to authenticated using (public.es_miembro(id));

drop policy if exists "ves a los de tus listas" on public.miembros;
create policy "ves a los de tus listas" on public.miembros
  for select to authenticated using (public.es_miembro(lista_id));
