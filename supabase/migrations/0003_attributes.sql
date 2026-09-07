-- ═══════════════════════════════════════════════════════════════════════
-- Atributos por tipo de imóvel (casa/apartamento/lançamento)
-- Base para os filtros e o ranking específicos por tipo.
-- ═══════════════════════════════════════════════════════════════════════

alter table listings
  add column if not exists bedrooms      integer,   -- quartos
  add column if not exists bathrooms     integer,   -- banheiros
  add column if not exists suites        integer,   -- suítes
  add column if not exists parking       integer,   -- vagas de garagem
  add column if not exists built_area_m2 numeric,   -- área construída (≠ área do terreno)
  add column if not exists condo_fee     numeric,   -- condomínio mensal
  add column if not exists is_launch     boolean;   -- lançamento / na planta

create index if not exists idx_listings_bedrooms on listings(bedrooms);
create index if not exists idx_listings_parking  on listings(parking);
