-- ── Registro de auditorias por IA ────────────────────────────────────
-- Guarda o que a IA conferiu em cada imóvel e o que foi corrigido
-- (com antes/depois), para histórico e reversão.

create table if not exists data_audits (
  id            uuid primary key default gen_random_uuid(),
  listing_id    uuid references listings(id) on delete cascade,
  verdicts      jsonb,          -- veredito por campo (ok/fix + confiança)
  changes       jsonb,          -- {campo: {from, to}} do que foi aplicado
  applied       boolean not null default false,
  model         text,
  input_tokens  integer,
  output_tokens integer,
  cost_usd      double precision,
  created_at    timestamptz not null default now()
);

create index if not exists data_audits_listing_idx on data_audits (listing_id);
create index if not exists data_audits_created_idx on data_audits (created_at desc);
