-- ═══════════════════════════════════════════════════════════════════════
-- Radar Imobiliário — esquema inicial
-- Base única e buscável do inventário de imóveis, multi-cidade.
-- ═══════════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";      -- gen_random_uuid()

-- ── Cidades atendidas ──────────────────────────────────────────────────
create table if not exists cities (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  state        text not null,                    -- UF, ex: SC
  slug         text not null unique,             -- ex: itapoa-sc
  -- bounding box para limitar buscas de POIs / geocoding
  bbox_min_lat double precision,
  bbox_min_lng double precision,
  bbox_max_lat double precision,
  bbox_max_lng double precision,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

-- ── Imobiliárias (descobertas via Google Places ou cadastradas) ────────
create table if not exists agencies (
  id            uuid primary key default gen_random_uuid(),
  city_id       uuid not null references cities(id) on delete cascade,
  name          text not null,
  website       text,
  platform      text,                            -- CRM detectado: vista | jetimob | imoview | ...
  -- URL da página de listagem que o coletor deve varrer (ex: /terrenos)
  listing_url   text,
  google_place_id text,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (city_id, website)
);

-- ── Imóveis (registro canônico) ────────────────────────────────────────
create table if not exists listings (
  id               uuid primary key default gen_random_uuid(),
  city_id          uuid not null references cities(id) on delete cascade,
  agency_id        uuid references agencies(id) on delete set null,

  -- chave de deduplicação (mesmo imóvel anunciado por várias imobiliárias)
  dedup_key        text,

  -- origem
  source_url       text not null,
  external_code    text,                          -- código do anúncio no site de origem

  -- dados do imóvel
  title            text,
  type             text,                          -- Terreno | Casa | Apartamento | Comercial | ...
  price            numeric,
  price_original   numeric,
  area_total_m2    numeric,
  frente_m         numeric,
  comprimento_m    numeric,
  neighborhood     text,
  street           text,
  street_number    text,
  cep              text,
  accepts_permuta  boolean,
  description      text,

  -- geolocalização
  lat              double precision,
  lng              double precision,
  geo_method       text,                          -- endereco_completo | rua | cep | bairro | fallback

  -- payload cru do coletor, para auditoria/reprocessamento
  raw              jsonb,

  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  unique (source_url)
);

create index if not exists idx_listings_city       on listings(city_id);
create index if not exists idx_listings_agency      on listings(agency_id);
create index if not exists idx_listings_dedup       on listings(dedup_key);
create index if not exists idx_listings_type        on listings(type);
create index if not exists idx_listings_price       on listings(price);
create index if not exists idx_listings_neighborhood on listings(neighborhood);

-- ── Histórico de preço (snapshots a cada coleta) ───────────────────────
-- Permite detectar quedas de preço e tempo de anúncio.
create table if not exists listing_snapshots (
  id           uuid primary key default gen_random_uuid(),
  listing_id   uuid not null references listings(id) on delete cascade,
  price        numeric,
  captured_at  timestamptz not null default now()
);

create index if not exists idx_snapshots_listing on listing_snapshots(listing_id, captured_at desc);

-- ── POIs (hospital, farmácia, escola, supermercado...) ─────────────────
create table if not exists pois (
  id          uuid primary key default gen_random_uuid(),
  city_id     uuid not null references cities(id) on delete cascade,
  category    text not null,                      -- hospital | farmacia | escola | supermercado
  name        text,
  address     text,
  lat         double precision,
  lng         double precision,
  google_place_id text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (city_id, google_place_id)
);

create index if not exists idx_pois_city_cat on pois(city_id, category);

-- ── Contas B2B (imobiliárias que assinam o produto) ────────────────────
-- Multi-tenant. A autenticação de usuários usa o Supabase Auth (auth.users).
create table if not exists tenants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  -- cidades que a conta pode acessar (o produto é vendido por cidade/região)
  created_at  timestamptz not null default now()
);

create table if not exists tenant_cities (
  tenant_id   uuid not null references tenants(id) on delete cascade,
  city_id     uuid not null references cities(id) on delete cascade,
  primary key (tenant_id, city_id)
);

-- Vínculo entre usuários do Supabase Auth e a conta (tenant).
create table if not exists memberships (
  user_id     uuid not null,                      -- referencia auth.users(id)
  tenant_id   uuid not null references tenants(id) on delete cascade,
  role        text not null default 'member',     -- owner | admin | member
  created_at  timestamptz not null default now(),
  primary key (user_id, tenant_id)
);

-- NOTA: as políticas de Row Level Security (RLS) que isolam os dados por
-- tenant serão adicionadas numa migração seguinte, junto com o Supabase Auth.
