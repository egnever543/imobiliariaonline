-- ═══════════════════════════════════════════════════════════════════════
-- Histórico de gastos com IA (extração de anúncios)
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists usage_events (
  id            uuid primary key default gen_random_uuid(),
  via           text,         -- ai | jsonld
  model         text,
  input_tokens  integer default 0,
  output_tokens integer default 0,
  cost_usd      numeric default 0,
  created_at    timestamptz not null default now()
);

create index if not exists idx_usage_created on usage_events(created_at desc);

-- Resumo geral (uma linha) para a home
create or replace view spend_summary as
select
  coalesce(sum(cost_usd), 0)                                                              as total_usd,
  coalesce(sum(cost_usd) filter (where created_at >= date_trunc('day', now())), 0)        as today_usd,
  coalesce(sum(cost_usd) filter (where created_at >= now() - interval '7 days'), 0)       as week_usd,
  count(*) filter (where via = 'ai')                                                      as ai_count,
  count(*) filter (where via = 'jsonld')                                                  as jsonld_count
from usage_events;

-- Gasto por dia (para um mini-histórico)
create or replace view spend_daily as
select
  (date_trunc('day', created_at))::date          as dia,
  count(*) filter (where via = 'ai')             as ia,
  count(*) filter (where via = 'jsonld')         as jsonld,
  coalesce(sum(cost_usd), 0)                     as usd
from usage_events
group by 1
order by 1 desc;
