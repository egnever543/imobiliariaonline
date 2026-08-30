// POST /api/collect
// Processa UM anúncio (Jina -> IA -> normaliza -> grava) e devolve o custo.
// O painel chama esta rota uma vez por anúncio, mostrando progresso.

import { isAuthorized, unauthorized } from "@/lib/auth";
import { ingestOne } from "@/lib/ingest/pipeline";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!isAuthorized(req)) return unauthorized();

  const body = await req.json().catch(() => null);
  if (!body?.url || !body?.cityId) {
    return Response.json(
      { error: "Informe url e cityId." },
      { status: 400 },
    );
  }

  // troca o modelo da IA só para esta chamada, se pedido
  if (body.model) process.env.EXTRACTION_MODEL = body.model;

  const result = await ingestOne(
    {
      cityId: body.cityId,
      agencyId: body.agencyId ?? null,
      listingUrl: body.listingUrl ?? "",
      keywords: [],
    },
    body.url,
  );

  return Response.json(result);
}
