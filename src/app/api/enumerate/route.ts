// POST /api/enumerate — enumera todas as URLs de anúncio de uma imobiliária
// (via sitemap, com fallback na página de listagem). Custo ZERO (sem IA).

import { isAuthorized, unauthorized } from "@/lib/auth";
import { enumerateAgency } from "@/lib/ingest/pipeline";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!isAuthorized(req)) return unauthorized();
  const b = await req.json().catch(() => null);
  if (!b?.website && !b?.listingUrl) {
    return Response.json({ error: "Informe website ou listingUrl." }, { status: 400 });
  }
  try {
    const urls = await enumerateAgency({
      website: b.website ?? null,
      listingUrl: b.listingUrl ?? null,
      keywords: b.keywords ?? ["terreno", "imovel", "casa", "apartamento"],
      cityName: b.cityName ?? null,
    });
    return Response.json({ count: urls.length, urls });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
