-- 0008_coastline.sql — linha de costa por cidade (coletada do OpenStreetMap)
-- Substitui a linha de costa fixa no código por um dado coletado por cidade,
-- para o fator "praia" do ranking escalar sem trabalho manual em cada cidade.
-- `ways` guarda uma lista de polilinhas: [[[lat,lng],[lat,lng],...], ...].

create table if not exists city_coastlines (
  city_id     uuid primary key references cities(id) on delete cascade,
  ways        jsonb not null default '[]'::jsonb,
  point_count int  not null default 0,
  source      text not null default 'osm',
  updated_at  timestamptz not null default now()
);

-- exposto ao PostgREST
notify pgrst, 'reload schema';
