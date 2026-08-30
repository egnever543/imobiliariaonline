// POST /api/discover
// Garante cidade + imobiliária e devolve os links de anúncio (custo ZERO).

import { isAuthorized, unauthorized } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase/server";
import { discoverLinks } from "@/lib/ingest/pipeline";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!isAuthorized(req)) return unauthorized();

  const body = await req.json().catch(() => null);
  if (!body?.listingUrl || !body?.citySlug) {
    return Response.json(
      { error: "Informe listingUrl e citySlug." },
      { status: 400 },
    );
  }

  const db = getServiceClient();

  // garante a cidade
  const { data: city, error: cityErr } = await db
    .from("cities")
    .upsert(
      {
        slug: body.citySlug,
        name: body.cityName ?? body.citySlug,
        state: body.uf ?? "",
      },
      { onConflict: "slug" },
    )
    .select("id")
    .single();
  if (cityErr || !city) {
    return Response.json({ error: cityErr?.message ?? "cidade" }, { status: 500 });
  }

  // garante a imobiliária (opcional)
  let agencyId: string | null = null;
  if (body.agencyName) {
    let website = body.listingUrl;
    try {
      website = new URL(body.listingUrl).origin;
    } catch {
      /* mantém como veio */
    }
    const { data: agency, error: agErr } = await db
      .from("agencies")
      .upsert(
        {
          city_id: city.id,
          name: body.agencyName,
          website,
          listing_url: body.listingUrl,
        },
        { onConflict: "city_id,website" },
      )
      .select("id")
      .single();
    if (agErr) return Response.json({ error: agErr.message }, { status: 500 });
    agencyId = agency?.id ?? null;
  }

  const keywords: string[] = Array.isArray(body.keywords) ? body.keywords : [];

  try {
    const { total, links } = await discoverLinks({
      cityId: city.id,
      agencyId,
      listingUrl: body.listingUrl,
      keywords,
    });
    return Response.json({ cityId: city.id, agencyId, total, links });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}
