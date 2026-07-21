-- ============================================================
--  Program BI - Licitaciones | Esquema Supabase / Postgres
--  Ejecuta esto en el SQL Editor de Supabase.
-- ============================================================

-- Tabla principal de licitaciones detectadas
create table if not exists public.licitaciones (
  codigo_externo    text primary key,
  nombre            text,
  descripcion       text,
  codigo_estado     text,
  estado            text,
  tipo              text,
  fecha_publicacion timestamptz,
  fecha_cierre      timestamptz,
  nombre_organismo  text,
  codigo_organismo  text,
  monto_estimado    double precision,
  url_ficha         text,
  cursos            jsonb default '[]'::jsonb,
  score             integer default 0,
  afinidad          integer default 0,
  es_favorito       boolean default false,
  visto             boolean default false,
  notificado        boolean default false,
  creado_en         timestamptz default now(),
  actualizado_en    timestamptz default now()
);

create index if not exists idx_lic_fecha_pub on public.licitaciones (fecha_publicacion);
create index if not exists idx_lic_estado    on public.licitaciones (estado);
create index if not exists idx_lic_score     on public.licitaciones (score);
create index if not exists idx_lic_favorito  on public.licitaciones (es_favorito);
create index if not exists idx_lic_visto     on public.licitaciones (visto);
create index if not exists idx_lic_cursos    on public.licitaciones using gin (cursos);

-- Log de ejecuciones del buscador
create table if not exists public.log_busquedas (
  id                      bigserial primary key,
  fecha                   timestamptz default now(),
  origen                  text,
  licitaciones_api        integer default 0,
  licitaciones_nuevas     integer default 0,
  licitaciones_guardadas  integer default 0,
  detalle                 text
);

-- Configuracion de palabras clave (una sola fila, id=1)
create table if not exists public.config_keywords (
  id    integer primary key default 1,
  data  jsonb not null,
  constraint config_keywords_singleton check (id = 1)
);

-- Descartadas (licitaciones que la API trajo pero no pasaron el filtro)
create table if not exists public.descartadas (
  codigo_externo    text primary key,
  nombre            text,
  nombre_organismo  text,
  estado            text,
  fecha_publicacion timestamptz,
  fecha_cierre      timestamptz,
  url_ficha         text,
  score             integer default 0,
  score_tecnico     integer default 0,
  afinidad          integer default 0,
  motivo            text default 'sin_coincidencia',
  cursos_parciales  jsonb default '[]'::jsonb,
  coincidencias     jsonb default '[]'::jsonb,
  busqueda_id       text,
  veces_visto       integer default 1,
  primera_vez       timestamptz default now(),
  ultima_vez        timestamptz default now()
);

create index if not exists idx_desc_ultima_vez on public.descartadas (ultima_vez);
create index if not exists idx_desc_motivo     on public.descartadas (motivo);
create index if not exists idx_desc_nombre     on public.descartadas (nombre);

-- Actualiza actualizado_en automaticamente (UPSERT)
create or replace function public.touch_actualizado()
returns trigger language plpgsql as $$
begin
  new.actualizado_en := now();
  return new;
end;
$$;

drop trigger if exists trg_licitaciones_touch on public.licitaciones;
create trigger trg_licitaciones_touch
before update on public.licitaciones
for each row execute function public.touch_actualizado();

-- ============ SEGURIDAD (Row Level Security) ============
-- El backend usa la service_role key, que omite RLS.
-- Aun asi, dejamos RLS activado y solo permitimos acceso anonimo
-- de lectura/escritura si la policy lo permite (ajusta segun tu caso).
alter table public.licitaciones   enable row level security;
alter table public.log_busquedas  enable row level security;
alter table public.config_keywords enable row level security;
alter table public.descartadas    enable row level security;

-- Para produccion con service_role no necesitas policies aqui.
-- Si quieres acceso desde el navegador (anon key), define policies, ej:
-- create policy "lectura publica licitaciones" on public.licitaciones
--   for select using (true);
