# Radar Imobiliário

SaaS de inteligência de mercado imobiliário. Coleta o inventário público de
imóveis de uma cidade (anúncios das imobiliárias) e o disponibiliza numa base
única e buscável — para uma imobiliária **encontrar imóveis em parceiras** e
**estudar a concorrência**. Feito para replicar em qualquer cidade e rodar em
**Vercel + Supabase**.

> Plano de arquitetura completo (produto, escala multi-cidade, custos):
> https://claude.ai/code/artifact/0899b2f8-3b36-40c9-ac24-c92ee9ac6e8e

## Como funciona a coleta

O pipeline (portado do protótipo em n8n) é:

```
página de listagem → Jina Reader (r.jina.ai) → extrai links de anúncio
   → por anúncio: Jina Reader → extração por IA → normaliza → Supabase (+ histórico de preço)
```

- **Jina Reader** renderiza a página (mesmo sites em JavaScript) e devolve texto
  limpo, via uma simples chamada HTTP — dispensa navegador Playwright.
- **Extração por IA** (Anthropic) transforma o texto do anúncio em campos
  estruturados. Cobre qualquer site sem escrever um scraper específico.

## Estrutura

```
src/
  app/                    # Next.js (App Router) — a casca do produto
  lib/
    ingest/               # o motor de coleta
      jina.ts             # busca via r.jina.ai
      links.ts            # extrai URLs de anúncio da listagem
      extract.ts          # extração estruturada por IA
      normalize.ts        # normalização + chave de deduplicação
      pipeline.ts         # orquestra tudo e grava no banco
    scoring/              # ranking ponderado (perfis: investidor, moradia…)
    supabase/             # cliente do banco (service-role, só no servidor)
scripts/
  ingest.ts               # CLI para rodar uma coleta
supabase/
  migrations/0001_init.sql# esquema do banco (cidades, imobiliárias, imóveis…)
```

## Setup

1. Instale as dependências:
   ```bash
   npm install
   ```
2. Configure o ambiente:
   ```bash
   cp .env.example .env.local   # e preencha as chaves
   ```
   São necessárias: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `ANTHROPIC_API_KEY`. (`JINA_API_KEY` e `GOOGLE_MAPS_API_KEY` são opcionais.)
3. Rode a migração `supabase/migrations/0001_init.sql` no seu projeto Supabase
   (SQL Editor ou Supabase CLI).

## Rodando

Servidor de desenvolvimento (o painel):
```bash
npm run dev
```

Uma coleta de teste (limitada a 5 anúncios):
```bash
npm run ingest -- \
  --url "https://SITE_DA_IMOBILIARIA/terrenos" \
  --city itapoa-sc --city-name "Itapoá" --uf SC \
  --agency "Nome da Imobiliária" \
  --keywords terreno,imovel \
  --limit 5
```

Verificação de tipos:
```bash
npm run typecheck
```

## Custo da extração por IA

`EXTRACTION_MODEL` (em `.env.local`) controla o modelo. O padrão é
`claude-opus-5` (máxima qualidade). Para **alto volume**, troque por um modelo
mais barato — ex. `claude-haiku-4-5` — já que o custo é por anúncio processado.

## Próximas etapas

- [ ] Autenticação (Supabase Auth) + RLS multi-tenant
- [ ] Descoberta de imobiliárias por cidade (Google Places) e geocoding
- [ ] Detecção de plataforma (CRM) + adapters determinísticos por plataforma
- [ ] Painel: mapa, busca, preço por bairro, quedas de preço
- [ ] Deduplicação entre imobiliárias
