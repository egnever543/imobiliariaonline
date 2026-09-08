-- ── Pontos de interesse (comércios/serviços) ─────────────────────────
-- Base de POIs por cidade, usada para o mapa de calor de valorização e a
-- "nota de vizinhança" de cada imóvel. Coletado uma vez por cidade
-- (Google Places), com dedup por place_id.

create table if not exists pois (
  id            uuid primary key default gen_random_uuid(),
  city_id       uuid references cities(id) on delete cascade,
  provider      text not null default 'google',
  provider_id   text,                     -- place_id (dedup)
  name          text,
  category      text not null,            -- normalizada: escola, farmacia, ...
  gtype         text,                     -- tipo cru do provedor
  lat           double precision not null,
  lng           double precision not null,
  rating        real,
  ratings_total integer,
  weight        real not null default 1,  -- peso da categoria
  raw           jsonb,
  created_at    timestamptz not null default now(),
  unique (provider, provider_id)
);

create index if not exists pois_city_idx on pois (city_id);
create index if not exists pois_cat_idx on pois (category);
create index if not exists pois_geo_idx on pois (lat, lng);
