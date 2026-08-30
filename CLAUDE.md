# CLAUDE.md — orientação para o repositório

## O que é
SaaS de inteligência imobiliária. Coleta o inventário público de imóveis de uma
cidade e o serve numa base única e buscável (multi-cidade, multi-tenant B2B).
Alvo de hospedagem: **Vercel** (app) + **Supabase** (dados/auth/cron).

## Stack
- Next.js 15 (App Router) + React 19 + TypeScript
- Supabase (Postgres) — cliente service-role em `src/lib/supabase/server.ts`
- Anthropic SDK — extração estruturada de anúncios (`src/lib/ingest/extract.ts`)
- Jina Reader (`r.jina.ai`) — coleta/render de páginas (`src/lib/ingest/jina.ts`)

## Arquitetura da coleta
`listagem → Jina → extrai links → por anúncio: Jina → IA → normaliza → Supabase`.
Foi portado de um protótipo em n8n (que usava Jina + OpenAI + Google Places +
Supabase). Ver `src/lib/ingest/pipeline.ts`.

## Convenções
- Código de servidor/ingestão nunca deve ser importado no front-end (a chave
  service-role é secreta).
- Comentários e textos de UI em português.
- Rodar `npm run typecheck` antes de commitar.
- Não colocar segredos no repositório; usar `.env.local` (ver `.env.example`).

## Estado atual
Esqueleto: motor de ingestão + esquema do banco + casca do app. Falta: Auth/RLS,
descoberta via Google Places, adapters por plataforma, painel com mapa/busca.
