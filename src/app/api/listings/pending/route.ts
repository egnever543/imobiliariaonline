// GET /api/listings/pending — imóveis sem coordenadas (para correção manual).

import { isAuthorized, unauthorized } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!isAuthorized(req)) return unauthorized();

  const db = getServiceClient();
  const { data, error } = await db
    .from("listings")
    .select(
      "id,title,type,price,neighborhood,street,street_number,cep,source_url,city_id,cities(name,state)",
    )
    .is("lat", null)
    .order("first_seen_at", { ascending: false })
    .limit(100);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ listings: data ?? [] });
}
