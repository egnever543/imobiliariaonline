-- 0009_beach.sql — distância do mar mais confiável
-- 1) Distância do mar declarada no anúncio (a imobiliária escreve "a 800 m do
--    mar"). É a fonte primária do fator "praia" — mais fiel que medir geometria.
alter table listings add column if not exists beach_distance_m numeric;

-- 2) Praias de areia (OSM natural=beach) por cidade. Guardadas junto da linha
--    de costa. Usadas como distância do mar quando o anúncio não informa — sem
--    o viés de baía/estuário da linha de costa crua. `beaches` = lista de
--    polígonos [[[lat,lng],...], ...].
alter table city_coastlines add column if not exists beaches jsonb not null default '[]'::jsonb;
alter table city_coastlines add column if not exists beach_point_count int not null default 0;

-- exposto ao PostgREST
notify pgrst, 'reload schema';
