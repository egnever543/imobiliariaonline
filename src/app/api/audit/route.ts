// POST /api/audit
// Auditoria por IA: confere os campos de UM imóvel contra o texto do anúncio
// e (opcional) corrige o que estiver claramente errado.
//   { list: true, limit? }              → lista imóveis para auditar (sem custo)
//   { listingId, apply?, minConfidence?, model? } → audita/corrige um imóvel

import { isAuthorized, unauthorized } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase/server";
import { fetchReadable } from "@/lib/ingest/jina";
import { estimateCostUSD } from "@/lib/ingest/cost";
import { auditListing, AUDIT_FIELDS, type FieldVerdict } from "@/lib/ingest/audit";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    return await handle(req);
  } catch (e) {
    return Response.json({ error: (e as Error).message || "Falha na auditoria." }, { status: 500 });
  }
}

async function handle(req: Request) {
  if (!isAuthorized(req)) return unauthorized();
  const body = await req.json().catch(() => null);
  const db = getServiceClient();

  // 1) listar imóveis a auditar (grátis)
  if (body?.list) {
    const limit = Math.min(Number(body.limit) || 50, 300);
    const { data, error } = await db
      .from("listings")
      .select("id,title,type")
      .order("first_seen_at", { ascending: false })
      .limit(limit);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ listings: data ?? [] });
  }

  if (!body?.listingId) {
    return Response.json({ error: "Informe listingId (ou list: true)." }, { status: 400 });
  }

  // modelo só para esta chamada, se pedido
  if (body.model) process.env.AUDIT_MODEL = body.model;
  const minConf = typeof body.minConfidence === "number" ? body.minConfidence : 0.75;
  const apply = body.apply === true;

  // 2) carrega o imóvel
  const cols = ["id", "title", "source_url", ...AUDIT_FIELDS].join(",");
  const { data: row, error: rowErr } = await db
    .from("listings")
    .select(cols)
    .eq("id", body.listingId)
    .maybeSingle();
  if (rowErr) return Response.json({ error: rowErr.message }, { status: 500 });
  if (!row) return Response.json({ error: "Imóvel não encontrado." }, { status: 404 });

  const listing = row as unknown as Record<string, unknown> & { source_url: string; title: string | null };

  // 3) lê o anúncio
  let adText = "";
  try {
    adText = await fetchReadable(listing.source_url, { timeoutMs: 25_000 });
  } catch (e) {
    return Response.json(
      { error: "Não consegui ler o anúncio: " + (e as Error).message, id: listing.id },
      { status: 502 },
    );
  }

  // 4) audita
  const res = await auditListing(adText, listing);
  const costUSD = estimateCostUSD(res.model, res.inputTokens, res.outputTokens);

  // 5) monta as correções (só fix com confiança suficiente e valor diferente)
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const v of res.verdicts as FieldVerdict[]) {
    if (v.status !== "fix") continue;
    if ((v.confidence ?? 0) < minConf) continue;
    const cur = listing[v.field] ?? null;
    if (JSON.stringify(cur) === JSON.stringify(v.value)) continue;
    changes[v.field] = { from: cur, to: v.value };
  }

  // 6) aplica, se pedido
  let applied = false;
  if (apply && Object.keys(changes).length) {
    const patch: Record<string, unknown> = {};
    for (const [f, c] of Object.entries(changes)) patch[f] = c.to;
    const { error: upErr } = await db.from("listings").update(patch).eq("id", listing.id);
    if (upErr) return Response.json({ error: upErr.message, id: listing.id }, { status: 500 });
    applied = true;
  }

  // 7) registra a auditoria + o gasto (não falha a resposta)
  db.from("data_audits")
    .insert({
      listing_id: listing.id,
      verdicts: res.verdicts,
      changes,
      applied,
      model: res.model,
      input_tokens: res.inputTokens,
      output_tokens: res.outputTokens,
      cost_usd: costUSD,
    })
    .then(() => {}, () => {});
  db.from("usage_events")
    .insert({ via: "audit", model: res.model, input_tokens: res.inputTokens, output_tokens: res.outputTokens, cost_usd: costUSD })
    .then(() => {}, () => {});

  return Response.json({
    id: listing.id,
    title: listing.title,
    verdicts: res.verdicts,
    changes,
    applied,
    model: res.model,
    estimatedCostUSD: costUSD,
  });
}
