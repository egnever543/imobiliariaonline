-- ═══════════════════════════════════════════════════════════════════════
-- 0010_accounts.sql — contas de cliente, solicitação de cidade e base de
-- cobrança (Stripe). Liga o Row Level Security (RLS) para que a chave pública
-- (anon) exposta no front NÃO consiga ler as tabelas de dados: tudo que é dado
-- de imóvel continua acessível só pelo servidor (service-role, que ignora RLS).
-- ═══════════════════════════════════════════════════════════════════════

-- ── Perfil do cliente (espelha auth.users com dados do app) ────────────
create table if not exists profiles (
  user_id    uuid primary key,            -- referencia auth.users(id)
  email      text,
  full_name  text,
  created_at timestamptz not null default now()
);

-- ── Solicitações de cidade ─────────────────────────────────────────────
-- Quando o cliente pede uma cidade que ainda não está na base, cai aqui como
-- "pendente". Você (admin) revisa e dispara a coleta deliberadamente.
create table if not exists city_requests (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,               -- quem pediu (auth.users)
  city_name   text not null,
  state       text,                         -- UF
  slug        text,                         -- itapoa-sc (gerado)
  -- pendente | em_captura | disponivel | recusada
  status      text not null default 'pendente',
  city_id     uuid references cities(id) on delete set null, -- preenchido ao liberar
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_city_requests_user   on city_requests(user_id);
create index if not exists idx_city_requests_status on city_requests(status);

-- ── Assinaturas (base para cobrança mensal via Stripe) ─────────────────
-- Modelada agora; a cobrança é ligada depois. Enquanto não há Stripe, o
-- cliente fica em 'trialing' e vê o mapa da cidade dele de graça.
create table if not exists subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null,     -- dono (auth.users)
  city_id                uuid references cities(id) on delete set null,
  plan                   text not null default 'trial',
  -- trialing | active | past_due | canceled | incomplete
  status                 text not null default 'trialing',
  -- ganchos do Stripe (preenchidos quando a cobrança for ligada)
  stripe_customer_id     text,
  stripe_subscription_id text,
  stripe_price_id        text,
  current_period_end     timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (user_id, city_id)
);
create index if not exists idx_subscriptions_user on subscriptions(user_id);

-- ═══════════════════════════════════════════════════════════════════════
-- Row Level Security
-- ═══════════════════════════════════════════════════════════════════════
-- Tabelas do cliente: o usuário autenticado só enxerga/edita as PRÓPRIAS
-- linhas. (O servidor usa service-role e ignora o RLS.)
alter table profiles      enable row level security;
alter table city_requests enable row level security;
alter table subscriptions enable row level security;

drop policy if exists "próprio perfil" on profiles;
create policy "próprio perfil" on profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "próprias solicitações" on city_requests;
create policy "próprias solicitações" on city_requests
  for select using (auth.uid() = user_id);

drop policy if exists "próprias assinaturas" on subscriptions;
create policy "próprias assinaturas" on subscriptions
  for select using (auth.uid() = user_id);

-- Tabelas de DADOS: liga o RLS SEM criar policy para anon/authenticated.
-- Resultado: a chave pública não lê nada; só o service-role (servidor) acessa.
-- O app já lê tudo isso pelo servidor, então nada quebra.
alter table cities           enable row level security;
alter table agencies         enable row level security;
alter table listings         enable row level security;
alter table listing_snapshots enable row level security;
alter table pois             enable row level security;
alter table tenants          enable row level security;
alter table tenant_cities    enable row level security;
alter table memberships      enable row level security;

-- Tabelas de outras migrações: liga o RLS se a tabela existir (idempotente).
do $$
begin
  if to_regclass('public.usage_events')   is not null then execute 'alter table usage_events enable row level security'; end if;
  if to_regclass('public.data_audits')    is not null then execute 'alter table data_audits enable row level security'; end if;
  if to_regclass('public.city_coastlines') is not null then execute 'alter table city_coastlines enable row level security'; end if;
end $$;

-- exposto ao PostgREST
notify pgrst, 'reload schema';
