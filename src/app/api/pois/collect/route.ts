// POST /api/pois/collect
// Coleta os comércios/serviços (POIs) em volta dos imóveis de uma cidade,
// para o mapa de calor de valorização e a nota de vizinhança.
//   body: { cityId, dryRun?, maxCells? }
//   dryRun=true → só estima (nº de células, requisições e custo), sem gastar.

import { isAuthorized, unauthorized } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase/server";
import { collectPois, collectPoisOsm, estimate, gridCells, boundsOf, bboxCells } from "@/lib/ingest/pois";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  if (!isAuthorized(req)) return unauthorized();

  const body = await req.json().catch(() => null);
  const db = getServiceClient();

  // resolve a cidade por id ou slug
  let cityId: string | null = body?.cityId ?? null;
  if (!cityId && body?.citySlug) {
    const { data: city } = await db
      .from("cities")
      .select("id")
      .eq("slug", body.citySlug)
      .maybeSingle();
    cityId = city?.id ?? null;
  }
  if (!cityId) {
    return Response.json({ error: "Informe cityId ou citySlug válido." }, { status: 400 });
  }
  body.cityId = cityId;

  // coordenadas dos imóveis já coletados dessa cidade
  const { data: rows, error } = await db
    .from("listings")
    .select("lat,lng")
    .eq("city_id", body.cityId)
    .not("lat", "is", null)
    .not("lng", "is", null)
    .limit(5000);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const points = (rows ?? []).map((r) => ({
    lat: r.lat as number,
    lng: r.lng as number,
  }));
  if (!points.length) {
    return Response.json(
      { error: "Nenhum imóvel geolocalizado nesta cidade ainda." },
      { status: 400 },
    );
  }

  const provider = body.provider === "google" ? "google" : "osm";

  // ── OpenStreetMap: 1 chamada cobre a cidade toda, de graça ──
  if (provider === "osm") {
    const margin = typeof body.marginKm === "number" ? body.marginKm * 0.009 : 0.03;
    const b = boundsOf(points, margin);
    if (!b) return Response.json({ error: "Sem bbox." }, { status: 400 });
    if (body.dryRun) {
      return Response.json({ dryRun: true, provider: "osm", imoveis: points.length, requests: 1, costUSD: 0, gratis: true });
    }
    const { pois, requests } = await collectPoisOsm(b);
    let saved = 0;
    if (pois.length) {
      const payload = pois.map((p) => ({ ...p, city_id: cityId, provider: "osm" }));
      const { error: upErr, count } = await db
        .from("pois")
        .upsert(payload, { onConflict: "provider,provider_id", count: "exact" });
      if (upErr) return Response.json({ error: upErr.message, collected: pois.length }, { status: 500 });
      saved = count ?? pois.length;
    }
    return Response.json({ ok: true, provider: "osm", imoveis: points.length, requests, collected: pois.length, saved, estimatedCostUSD: 0 });
  }

  // modo de cobertura (Google):
  //  - "city"     → grade sobre a região toda (imóveis + margem)
  //  - "listings" → só em volta dos imóveis (mais barato)
  const mode = body.mode === "listings" ? "listings" : "city";
  let cells: { lat: number; lng: number }[];
  if (mode === "city") {
    const margin = typeof body.marginKm === "number" ? body.marginKm * 0.009 : 0.018;
    const b = boundsOf(points, margin);
    cells = b ? bboxCells(b) : gridCells(points);
  } else {
    cells = gridCells(points);
  }
  if (body.maxCells && cells.length > body.maxCells) {
    cells = cells.slice(0, body.maxCells);
  }

  // estimativa (grátis)
  if (body.dryRun) {
    return Response.json({ dryRun: true, mode, imoveis: points.length, ...estimate(cells.length) });
  }

  // coleta de verdade
  const { pois, requests, cells: usedCells } = await collectPois(cells, {
    maxCells: body.maxCells,
  });

  // grava (upsert por provider+provider_id)
  let saved = 0;
  if (pois.length) {
    const payload = pois.map((p) => ({ ...p, city_id: body.cityId, provider: "google" }));
    const { error: upErr, count } = await db
      .from("pois")
      .upsert(payload, { onConflict: "provider,provider_id", count: "exact" });
    if (upErr) return Response.json({ error: upErr.message, collected: pois.length }, { status: 500 });
    saved = count ?? pois.length;
  }

  // registra o gasto (mesma tabela de custo da IA)
  const costUSD = requests * 0.032;
  db.from("usage_events")
    .insert({ via: "places", model: "google-places", input_tokens: requests, output_tokens: 0, cost_usd: costUSD })
    .then(() => {}, () => {});

  return Response.json({
    ok: true,
    imoveis: points.length,
    cells: usedCells,
    requests,
    collected: pois.length,
    saved,
    estimatedCostUSD: costUSD,
  });
}
