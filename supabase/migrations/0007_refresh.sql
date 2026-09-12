-- ── Foto, status e controle de atualização ───────────────────────────
-- image_url: foto principal (og:image), capturada de graça na coleta.
-- status: ativo | indisponivel | vendido — atualizado ao revisitar o anúncio.
-- last_checked_at: quando foi a última verificação de atualização.

alter table listings
  add column if not exists image_url       text,
  add column if not exists status          text not null default 'ativo',
  add column if not exists last_checked_at timestamptz;

create index if not exists idx_listings_status on listings (status);
