// POST /api/audit
// Auditoria por IA: confere os campos de UM imóvel contra o texto do anúncio
// e (opcional) corrige o que estiver claramente errado.
//   { list: true, limit? }              → lista imóveis para auditar (sem custo)
//   { listingId, apply?, minConfidence?, model? } → audita/corrige um imóvel

import { isAuthorized, unauthorized } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/supabase/paginate";
import { fetchReadable } from "@/lib/ingest/jina";
import { estimateCostUSD } from "@/lib/ingest/cost";
import { auditListing, AUDIT_FIELDS, type AuditField, type FieldVerdict } from "@/lib/ingest/audit";
import { auditGeo } from "@/lib/ingest/geoaudit";
import { fetchListingSignals } from "@/lib/ingest/structured";

export const runtime = "nodejs";
export const maxDuration = 60;

function sanePrice(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 5000 || n > 80_000_000) return null;
  return n;
}

// campos que a auditoria pode gravar ao aplicar: os de texto + os de localização
const GEO_APPLY = ["lat", "lng", "geo_method", "street", "street_number", "neighborhood", "cep"] as const;
const APPLY_ALLOWED = new Set<string>([...AUDIT_FIELDS, ...GEO_APPLY]);

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

  // 1) listar imóveis + status de revisão (grátis)
  if (body?.list) {
    const listings = await selectAll<Record<string, unknown>>((from, to) =>
      db
        .from("listings")
        .select("id,title,type,neighborhood,price,lat,source_url")
        .order("first_seen_at", { ascending: false })
        .range(from, to),
    );

    // auditorias existentes → última por imóvel (paginado)
    const audits = await selectAll<{ listing_id: string; applied: boolean; changes: Record<string, unknown>; created_at: string }>(
      (from, to) => db.from("data_audits").select("listing_id,applied,changes,created_at").order("created_at", { ascending: false }).range(from, to),
    );
    const last = new Map<string, { applied: boolean; changes: Record<string, unknown>; at: string }>();
    for (const a of audits ?? []) {
      const lid = a.listing_id as string;
      if (last.has(lid)) continue; // já é a mais recente (ordenado desc)
      const changes = (a.changes as Record<string, unknown>) ?? {};
      last.set(lid, { applied: !!a.applied, changes, at: a.created_at as string });
    }

    const out = (listings ?? []).map((l) => {
      const rev = last.get(l.id as string);
      const nChanges = rev ? Object.keys(rev.changes).length : 0;
      return {
        id: l.id, title: l.title, type: l.type, neighborhood: l.neighborhood, price: l.price,
        lat: l.lat ?? null,
        source_url: l.source_url,
        reviewed: !!rev,
        lastChanges: nChanges,
        lastAt: rev?.at ?? null, // data da última auditoria (para reauditar por data)
        applied: rev?.applied ?? false,
        // sugestões ainda não aplicadas → permitem o botão "Aplicar" mesmo
        // depois de recarregar a página.
        pendingChanges: rev && !rev.applied && nChanges > 0 ? rev.changes : undefined,
      };
    });
    const reviewed = out.filter((l) => l.reviewed).length;
    return Response.json({ listings: out, total: out.length, reviewed, pending: out.length - reviewed });
  }

  if (!body?.listingId) {
    return Response.json({ error: "Informe listingId (ou list: true)." }, { status: 400 });
  }

  // 1b) aplicar sugestões já calculadas (sem nova chamada de IA)
  if (body?.applyChanges) {
    const changes = (body.applyChanges as Record<string, { from: unknown; to: unknown }>) ?? {};
    const patch: Record<string, unknown> = {};
    for (const [f, c] of Object.entries(changes)) if (APPLY_ALLOWED.has(f)) patch[f] = c.to;
    if (!Object.keys(patch).length) {
      return Response.json({ ok: true, applied: false, id: body.listingId });
    }
    const { error: upErr } = await db.from("listings").update(patch).eq("id", body.listingId);
    if (upErr) return Response.json({ error: upErr.message, id: body.listingId }, { status: 500 });
    db.from("data_audits")
      .insert({ listing_id: body.listingId, verdicts: [], changes, applied: true, model: "manual", input_tokens: 0, output_tokens: 0, cost_usd: 0 })
      .then(() => {}, () => {});
    return Response.json({ ok: true, applied: true, id: body.listingId });
  }

  // modelo só para esta chamada, se pedido
  if (body.model) process.env.AUDIT_MODEL = body.model;
  const minConf = typeof body.minConfidence === "number" ? body.minConfidence : 0.75;
  const apply = body.apply === true;

  // quais campos conferir (menos campos = menos tokens) + localização
  const reqFields = Array.isArray(body.fields)
    ? (body.fields as string[]).filter((f): f is AuditField => (AUDIT_FIELDS as readonly string[]).includes(f))
    : AUDIT_FIELDS;
  const checkGeo = body.checkGeo === true;
  const geoThresholdM = typeof body.geoThresholdM === "number" ? body.geoThresholdM : 300;
  if (!reqFields.length && !checkGeo) {
    return Response.json({ error: "Selecione ao menos um campo para auditar." }, { status: 400 });
  }

  // 2) carrega o imóvel (campos de texto + endereço + cidade para geocodificar)
  const cols = [
    "id", "title", "source_url", ...AUDIT_FIELDS,
    "street", "street_number", "cep", "lat", "lng", "geo_method", "cities(name,state)",
  ].join(",");
  const { data: row, error: rowErr } = await db
    .from("listings")
    .select(cols)
    .eq("id", body.listingId)
    .maybeSingle();
  if (rowErr) return Response.json({ error: rowErr.message }, { status: 500 });
  if (!row) return Response.json({ error: "Imóvel não encontrado." }, { status: 404 });

  const listing = row as unknown as Record<string, unknown> & { source_url: string; title: string | null };
  const cityRel = (listing as { cities?: { name?: string; state?: string } | { name?: string; state?: string }[] }).cities;
  const city = Array.isArray(cityRel) ? cityRel[0] : cityRel;

  // 3) lê o anúncio (uma vez, serve para texto e localização)
  let adText = "";
  try {
    adText = await fetchReadable(listing.source_url, { timeoutMs: 25_000 });
  } catch (e) {
    return Response.json(
      { error: "Não consegui ler o anúncio: " + (e as Error).message, id: listing.id },
      { status: 502 },
    );
  }

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  let verdicts: FieldVerdict[] = [];
  let model = body.model || process.env.AUDIT_MODEL || "";
  let inTok = 0, outTok = 0;

  // 4) audita os campos de texto selecionados
  if (reqFields.length) {
    const res = await auditListing(adText, listing, reqFields);
    verdicts = res.verdicts as FieldVerdict[];
    model = res.model; inTok += res.inputTokens; outTok += res.outputTokens;
    for (const v of verdicts) {
      if (v.status !== "fix") continue;
      if ((v.confidence ?? 0) < minConf) continue;
      const cur = listing[v.field] ?? null;
      if (JSON.stringify(cur) === JSON.stringify(v.value)) continue;
      changes[v.field] = { from: cur, to: v.value };
    }
  }

  // 4a) preço pelo ESTRUTURADO (HTML cru: JSON-LD / og:price / "R$" no corpo).
  // A IA lê o texto renderizado (Jina), que muitas vezes traz só "Consulte" —
  // o preço real costuma estar nos metadados. Grátis; recupera o que a IA não vê.
  let priceProbe: { found: number | null } | null = null;
  if (reqFields.includes("price")) {
    try {
      const sig = await fetchListingSignals(listing.source_url);
      const p = sanePrice((sig?.listing as { price?: unknown } | undefined)?.price);
      priceProbe = { found: p };
      const cur = sanePrice(listing.price);
      if (p != null && p !== cur && !("price" in changes)) {
        changes.price = { from: listing.price ?? null, to: p };
      }
    } catch { /* ignora — segue com o que a IA achou */ }
  }

  // 4b) audita a localização (IA extrai endereço → geocodifica → compara)
  let geoInfo: Awaited<ReturnType<typeof auditGeo>>["info"] = null;
  if (checkGeo) {
    const g = await auditGeo({
      adText, current: listing, cityName: city?.name ?? null, state: city?.state ?? null, thresholdM: geoThresholdM,
    });
    model = g.model; inTok += g.inputTokens; outTok += g.outputTokens;
    geoInfo = g.info;
    Object.assign(changes, g.changes);
  }

  const costUSD = estimateCostUSD(model, inTok, outTok);

  // 5) aplica, se pedido
  let applied = false;
  if (apply && Object.keys(changes).length) {
    const patch: Record<string, unknown> = {};
    for (const [f, c] of Object.entries(changes)) if (APPLY_ALLOWED.has(f)) patch[f] = c.to;
    const { error: upErr } = await db.from("listings").update(patch).eq("id", listing.id);
    if (upErr) return Response.json({ error: upErr.message, id: listing.id }, { status: 500 });
    applied = true;
  }

  // 6) registra a auditoria + o gasto (não falha a resposta)
  db.from("data_audits")
    .insert({ listing_id: listing.id, verdicts, changes, applied, model, input_tokens: inTok, output_tokens: outTok, cost_usd: costUSD })
    .then(() => {}, () => {});
  db.from("usage_events")
    .insert({ via: "audit", model, input_tokens: inTok, output_tokens: outTok, cost_usd: costUSD })
    .then(() => {}, () => {});

  return Response.json({
    id: listing.id, title: listing.title,
    verdicts, changes, geoInfo, priceProbe, applied, model, estimatedCostUSD: costUSD,
  });
}
