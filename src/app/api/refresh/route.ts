// POST /api/refresh
// Revisita o anúncio de um imóvel (grátis, sem IA) e atualiza:
//  - preço (se mudou), foto e campos que faltavam;
//  - status: "indisponivel" se a página não abre mais.
//   { list: true, limit? }  → lista imóveis (id, status, última verificação)
//   { listingId }           → atualiza um imóvel

import { isAuthorized, unauthorized } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/supabase/paginate";
import { refreshOne, REFRESH_COLS } from "@/lib/ingest/refresh";

export const runtime = "nodejs";
export const maxDuration = 60;

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
    const data = await selectAll<Record<string, unknown>>((from, to) =>
      db
        .from("listings")
        .select("id,title,type,neighborhood,price,image_url,status,last_checked_at,source_url")
        .order("first_seen_at", { ascending: false })
        .range(from, to),
    );
    return Response.json({ listings: data });
  }

  if (!body?.listingId) {
    return Response.json({ error: "Informe listingId (ou list: true)." }, { status: 400 });
  }

  const { data: row, error: rowErr } = await db
    .from("listings")
    .select(REFRESH_COLS)
    .eq("id", body.listingId)
    .maybeSingle();
  if (rowErr) return Response.json({ error: rowErr.message }, { status: 500 });
  if (!row) return Response.json({ error: "Imóvel não encontrado." }, { status: 404 });

  const cur = row as unknown as Record<string, unknown> & { id: string; source_url: string };
  const out = await refreshOne(db, cur);
  return Response.json(out);
}
