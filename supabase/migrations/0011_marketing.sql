-- ═══════════════════════════════════════════════════════════════════════
-- 0011_marketing.sql — braço de marketing: marca do cliente e calendário de
-- posts gerados a partir dos imóveis. (A arte do Canva entra depois; aqui
-- fica a estrutura e o preview.)
-- ═══════════════════════════════════════════════════════════════════════

-- ── Marca da imobiliária (brand kit) ──────────────────────────────────
create table if not exists brand_kits (
  user_id       uuid primary key,          -- auth.users
  agency_name   text,
  logo_url      text,
  primary_color text default '#d6b25e',
  phone         text,
  creci         text,
  instagram     text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ── Posts do calendário ───────────────────────────────────────────────
create table if not exists content_posts (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null,
  listing_id     uuid references listings(id) on delete set null,
  scheduled_for  date not null,
  -- destaque | novo | baixou  (o tipo de arte/mensagem)
  template       text not null default 'destaque',
  caption        text,
  -- agendado | gerado | postado
  status         text not null default 'agendado',
  art_url        text,                       -- arte exportada (Canva), quando houver
  canva_design_id text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_content_posts_user on content_posts(user_id, scheduled_for);

-- RLS: cada cliente só vê a própria marca e os próprios posts. O servidor usa
-- service-role e ignora o RLS.
alter table brand_kits    enable row level security;
alter table content_posts enable row level security;

drop policy if exists "própria marca" on brand_kits;
create policy "própria marca" on brand_kits
  for select using (auth.uid() = user_id);

drop policy if exists "próprios posts" on content_posts;
create policy "próprios posts" on content_posts
  for select using (auth.uid() = user_id);

notify pgrst, 'reload schema';
