// POST /api/refresh
// Revisita o anúncio de um imóvel (grátis, sem IA) e atualiza:
//  - preço (se mudou), foto e campos que faltavam;
//  - status: "indisponivel" se a página não abre mais.
//   { list: true, limit? }  → lista imóveis (id, status, última verificação)
//   { listingId }           → atualiza um imóvel

import { isAuthorized, unauthorized } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase/server";
import { fetchStructured } from "@/lib/ingest/structured";

export const runtime = "nodejs";
export const maxDuration = 60;

// campos preenchidos só quando estão vazios (não sobrescreve dado bom)
const FILL_IF_MISSING = [
  "type", "area_total_m2", "built_area_m2", "bedrooms", "bathrooms",
  "suites", "parking", "neighborhood", "image_url",
] as const;

function sanePrice(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 5000 || n > 80_000_000) return null;
  return n;
}

export async function POST(req: Request) {
  try {
    return await handle(req);
  } catch (e) {
    return Response.json({ error: (e as Error).message || "Falha ao atualizar." }, { status: 500 });
  }
}

async function handle(req: Request) {
  if (!isAuthorized(req)) return unauthorized();
  const body = await req.json().catch(() => null);
  const db = getServiceClient();

  if (body?.list) {
    const limit = Math.min(Number(body.limit) || 2000, 5000);
    const { data, error } = await db
      .from("listings")
      .select("id,title,type,neighborhood,price,image_url,status,last_checked_at,source_url")
      .order("first_seen_at", { ascending: false })
      .limit(limit);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ listings: data ?? [] });
  }

  if (!body?.listingId) {
    return Response.json({ error: "Informe listingId (ou list: true)." }, { status: 400 });
  }

  const { data: row, error: rowErr } = await db
    .from("listings")
    .select("id,source_url,price," + FILL_IF_MISSING.join(","))
    .eq("id", body.listingId)
    .maybeSingle();
  if (rowErr) return Response.json({ error: rowErr.message }, { status: 500 });
  if (!row) return Response.json({ error: "Imóvel não encontrado." }, { status: 404 });

  const cur = row as unknown as Record<string, unknown> & { id: string; source_url: string };
  const now = new Date().toISOString();

  // revisita (grátis)
  const s = await fetchStructured(cur.source_url);

  // página não abre mais → provavelmente saiu do ar / vendido
  if (!s) {
    await db.from("listings").update({ status: "indisponivel", last_checked_at: now }).eq("id", cur.id);
    return Response.json({ id: cur.id, status: "indisponivel", changed: {} });
  }

  const changed: Record<string, { from: unknown; to: unknown }> = {};
  const patch: Record<string, unknown> = { status: "ativo", last_checked_at: now, last_seen_at: now };

  // preço pode mudar
  const newPrice = sanePrice((s as unknown as Record<string, unknown>).price);
  if (newPrice != null && newPrice !== cur.price) {
    changed.price = { from: cur.price ?? null, to: newPrice };
    patch.price = newPrice;
  }

  // completa o que faltava
  for (const f of FILL_IF_MISSING) {
    const currentVal = cur[f];
    const newVal = (s as unknown as Record<string, unknown>)[f];
    if ((currentVal === null || currentVal === undefined || currentVal === "") && newVal != null && newVal !== "") {
      changed[f] = { from: currentVal ?? null, to: newVal };
      patch[f] = newVal;
    }
  }

  await db.from("listings").update(patch).eq("id", cur.id);
  if (patch.price != null) {
    db.from("listing_snapshots").insert({ listing_id: cur.id, price: patch.price }).then(() => {}, () => {});
  }

  return Response.json({ id: cur.id, status: "ativo", changed });
}
