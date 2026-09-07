// GET /api/agencies?city=<slug> — imobiliárias de uma cidade (para o coletor).

import { isAuthorized, unauthorized } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!isAuthorized(req)) return unauthorized();
  const slug = new URL(req.url).searchParams.get("city");
  const db = getServiceClient();

  let cityId: string | null = null;
  let cityName = "";
  let uf = "";
  if (slug) {
    const { data: city } = await db
      .from("cities")
      .select("id,name,state")
      .eq("slug", slug)
      .maybeSingle();
    cityId = city?.id ?? null;
    cityName = city?.name ?? "";
    uf = city?.state ?? "";
  }

  let q = db
    .from("agencies")
    .select("id,name,website,listing_url,platform")
    .eq("active", true);
  if (cityId) q = q.eq("city_id", cityId);
  const { data, error } = await q;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ cityId, cityName, uf, agencies: data ?? [] });
}
