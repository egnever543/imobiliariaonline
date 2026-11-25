-- 0012_canva.sql — token da conexão Canva (modelo de conta única da plataforma).
-- Guarda o refresh token (e o access token corrente) numa linha só ('org').
-- Lido/escrito apenas pelo servidor (service-role); RLS ligado sem policy.
create table if not exists canva_tokens (
  id            text primary key default 'org',
  access_token  text,
  refresh_token text,
  expires_at    timestamptz,
  updated_at    timestamptz not null default now()
);
alter table canva_tokens enable row level security;

-- Bucket público para guardar as artes exportadas (o link do Canva expira em
-- 24h; baixamos o PNG e servimos daqui, de forma durável).
insert into storage.buckets (id, name, public)
values ('post-art', 'post-art', true)
on conflict (id) do nothing;

notify pgrst, 'reload schema';
