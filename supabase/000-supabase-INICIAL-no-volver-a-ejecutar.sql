-- ⚠️  NO VOLVER A EJECUTAR. Es el script con el que se creó la base de datos al
-- principio. Se guarda solo como referencia: la base actual es este archivo
-- MÁS las migraciones de supabase/migraciones/, en orden.

-- Gorditos — tabla compartida, seguridad y tiempo real.
-- Pega esto entero en el SQL Editor de Supabase y dale a Run.

create table if not exists public.restaurantes (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  tipo text not null default 'Sin especificar',
  zona text not null default 'Sin especificar',
  precio smallint not null default 2 check (precio between 1 and 3),
  flag text not null default '',
  carta text not null default '',
  reserva text not null default '',
  direccion text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text not null default ''
);

-- Solo vosotros dos (usuarios autenticados en este proyecto) podéis leer y escribir.
alter table public.restaurantes enable row level security;

create policy "solo autenticados leen" on public.restaurantes
  for select using (auth.role() = 'authenticated');
create policy "solo autenticados insertan" on public.restaurantes
  for insert with check (auth.role() = 'authenticated');
create policy "solo autenticados editan" on public.restaurantes
  for update using (auth.role() = 'authenticated');
create policy "solo autenticados borran" on public.restaurantes
  for delete using (auth.role() = 'authenticated');

-- Cada insert/update deja constancia de quién lo tocó por última vez y
-- cuándo, decidido por el servidor (el cliente no puede falsear esto).
create or replace function public.marcar_actualizacion()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.jwt() ->> 'email', '');
  return new;
end;
$$;

drop trigger if exists restaurantes_marcar_actualizacion on public.restaurantes;
create trigger restaurantes_marcar_actualizacion
  before insert or update on public.restaurantes
  for each row execute function public.marcar_actualizacion();

-- Tiempo real: para que el móvil del otro se entere al instante.
alter publication supabase_realtime add table public.restaurantes;
