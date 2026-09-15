// POST /api/coastline/collect — coleta a linha de costa da cidade (OSM) e salva.
//   { cityId? }  → cidade específica; se omitido e só houver uma cidade, usa ela.
// Usa a bbox robusta dos imóveis da cidade (ignora coordenadas outliers) e faz
// UMA chamada ao Overpass. Grátis. Escala: uma cidade nova = um clique.

import { isAuthorized, unauthorized } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/supabase/paginate";
import { boundsRobust } from "@/lib/ingest/pois";
import { collectCoastlineOsm } from "@/lib/ingest/coastline_osm";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!isAuthorized(req)) return unauthorized();
  try {
    const body = await req.json().catch(() => ({}));
    const db = getServiceClient();

    // resolve a cidade (por id, por slug, ou única cadastrada)
    let cityId: string | undefined = body?.cityId;
    if (!cityId && body?.citySlug) {
      const { data: c } = await db.from("cities").select("id").eq("slug", body.citySlug).maybeSingle();
      cityId = (c?.id as string) ?? undefined;
    }
    if (!cityId) {
      const { data: cities } = await db.from("cities").select("id").limit(2);
      if (!cities?.length) return Response.json({ error: "Nenhuma cidade cadastrada." }, { status: 400 });
      if (cities.length > 1) return Response.json({ error: "Informe cityId ou citySlug (há mais de uma cidade)." }, { status: 400 });
      cityId = cities[0].id as string;
    }

    // bbox robusta a partir dos imóveis geolocalizados da cidade
    const pts = await selectAll<{ lat: number | null; lng: number | null }>((from, to) =>
      db.from("listings").select("lat,lng").eq("city_id", cityId).not("lat", "is", null).range(from, to),
    );
    const bbox = boundsRobust(pts.map((p) => ({ lat: p.lat as number, lng: p.lng as number })));
    if (!bbox) return Response.json({ error: "Cidade sem imóveis geolocalizados para definir a área." }, { status: 400 });

    // coleta (uma chamada Overpass)
    const { ways, points } = await collectCoastlineOsm(bbox);

    // salva (upsert por cidade)
    const { error } = await db.from("city_coastlines").upsert(
      { city_id: cityId, ways, point_count: points, source: "osm", updated_at: new Date().toISOString() },
      { onConflict: "city_id" },
    );
    if (error) return Response.json({ error: error.message }, { status: 500 });

    return Response.json({
      ok: true, cityId, ways: ways.length, points,
      note: points === 0 ? "Nenhuma costa encontrada nessa área (cidade sem mar?)." : undefined,
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message || "Falha ao coletar a costa." }, { status: 500 });
  }
}
