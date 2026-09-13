// GET /api/cron — rotina diária (chamada pelo Vercel Cron).
// Faz duas coisas, com orçamento de tempo para não estourar o limite da função:
//   1) NOVOS   → varre as imobiliárias e coleta anúncios ainda não salvos;
//   2) UPDATE  → revisita os imóveis ativos mais desatualizados (preço, foto,
//                situação vendido/alugado/indisponível).
//
// Autenticação: o Vercel Cron manda `Authorization: Bearer $CRON_SECRET`.
// Para disparo manual, aceita também o `x-admin-token` do painel.
//   /api/cron            → roda as duas fases
//   /api/cron?phase=new  → só coleta de novos
//   /api/cron?phase=update → só atualização
//
// Limites (por rodada) e orçamento, ajustáveis por env:
//   CRON_NEW_CAP (80) · CRON_UPDATE_CAP (400) · CRON_BUDGET_MS (250000)

import { isAuthorized } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase/server";
import { enumerateAgency, ingestOne } from "@/lib/ingest/pipeline";
import { refreshOne, REFRESH_COLS } from "@/lib/ingest/refresh";

export const runtime = "nodejs";
// Cron é pesado (muitas leituras de página). No plano Pro vai até 300s; no
// Hobby a função é cortada em 60s — o orçamento abaixo respeita o que sobrar.
export const maxDuration = 300;

type DB = ReturnType<typeof getServiceClient>;

function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (secret && auth === `Bearer ${secret}`) return true;
  return isAuthorized(req); // disparo manual pelo painel
}

const envNum = (k: string, def: number) => {
  const n = Number(process.env[k]);
  return Number.isFinite(n) && n > 0 ? n : def;
};

// ── Fase 1: coletar anúncios novos ─────────────────────────────────────
async function collectNew(db: DB, deadline: number, cap: number) {
  const [{ data: cities }, { data: agencies }] = await Promise.all([
    db.from("cities").select("id,name,state"),
    db.from("agencies").select("id,city_id,name,website,listing_url"),
  ]);
  const cityMap = new Map<string, { name: string | null; state: string | null }>();
  for (const c of (cities ?? []) as Record<string, unknown>[]) {
    cityMap.set(c.id as string, { name: (c.name as string) ?? null, state: (c.state as string) ?? null });
  }

  let saved = 0, skipped = 0, errors = 0, agenciesSeen = 0, cost = 0;
  for (const ag of ((agencies ?? []) as Record<string, unknown>[])) {
    if (Date.now() > deadline || saved >= cap) break;
    agenciesSeen++;
    const city = cityMap.get(ag.city_id as string);
    let urls: string[] = [];
    try {
      urls = await enumerateAgency({
        website: (ag.website as string) ?? null,
        listingUrl: (ag.listing_url as string) ?? null,
        cityName: city?.name ?? null,
      });
    } catch {
      errors++;
      continue;
    }
    for (const url of urls) {
      if (Date.now() > deadline || saved >= cap) break;
      try {
        const r = await ingestOne(
          {
            cityId: ag.city_id as string,
            agencyId: (ag.id as string) ?? null,
            listingUrl: (ag.listing_url as string) ?? "",
            keywords: [],
            cityName: city?.name ?? null,
            state: city?.state ?? null,
          },
          url,
          { skipExisting: true },
        );
        cost += r.estimatedCostUSD ?? 0;
        if (r.via === "skip") skipped++;
        else if (r.saved) saved++;
        else errors++;
      } catch {
        errors++;
      }
    }
  }
  return { agenciesSeen, saved, skipped, errors, costUSD: Number(cost.toFixed(4)) };
}

// ── Fase 2: revisitar os ativos mais desatualizados ────────────────────
async function updateStale(db: DB, deadline: number, cap: number) {
  const { data } = await db
    .from("listings")
    .select(REFRESH_COLS)
    .eq("status", "ativo")
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .limit(cap);

  let updated = 0, sold = 0, rented = 0, gone = 0, changed = 0;
  const rows = (data ?? []) as unknown as (Record<string, unknown> & { id: string; source_url: string })[];
  for (const row of rows) {
    if (Date.now() > deadline) break;
    try {
      const out = await refreshOne(db, row);
      updated++;
      if (out.status === "vendido") sold++;
      else if (out.status === "alugado" || out.status === "locacao") rented++;
      else if (out.status === "indisponivel") gone++;
      if (Object.keys(out.changed).length) changed++;
    } catch {
      /* segue para o próximo */
    }
  }
  return { updated, sold, rented, gone, changed };
}

async function run(req: Request) {
  const url = new URL(req.url);
  const phase = url.searchParams.get("phase") ?? "all";
  const budgetMs = envNum("CRON_BUDGET_MS", 250_000);
  const newCap = envNum("CRON_NEW_CAP", 80);
  const updateCap = envNum("CRON_UPDATE_CAP", 400);

  const start = Date.now();
  const deadline = start + budgetMs;
  const db = getServiceClient();

  const summary: Record<string, unknown> = { phase, startedAt: new Date(start).toISOString() };

  if (phase === "new" || phase === "all") {
    // reserva ~40% do orçamento para a coleta de novos
    const newDeadline = phase === "all" ? start + Math.floor(budgetMs * 0.4) : deadline;
    summary.new = await collectNew(db, newDeadline, newCap);
  }
  if (phase === "update" || phase === "all") {
    summary.update = await updateStale(db, deadline, updateCap);
  }

  summary.tookMs = Date.now() - start;
  return Response.json(summary);
}

export async function GET(req: Request) {
  if (!cronAuthorized(req)) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }
  try {
    return await run(req);
  } catch (e) {
    return Response.json({ error: (e as Error).message || "Falha no cron." }, { status: 500 });
  }
}

// permite também POST (disparo manual pelo painel, com x-admin-token)
export const POST = GET;
