// GET /api/account/listings?cidade=<slug> — imóveis da cidade do cliente,
// liberados só se ele tiver assinatura (trial/ativa) para aquela cidade.
// Lido pelo servidor (service-role); o cliente nunca consulta a tabela direto.

import { getUserFromRequest, unauthenticated } from "@/lib/supabase/session";
import { getServiceClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/supabase/paginate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LISTING_COLS =
  "id,title,type,price,area_total_m2,built_area_m2,bedrooms,bathrooms,suites,parking,neighborhood,street,cep,lat,lng,geo_method,image_url,source_url,agencies(name)";

export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return unauthenticated();

  const slug = new URL(req.url).searchParams.get("cidade")?.trim();
  if (!slug) return Response.json({ error: "Informe a cidade." }, { status: 400 });

  const db = getServiceClient();
  const { data: cityRow } = await db.from("cities").select("id,name,state,slug").eq("slug", slug).maybeSingle();
  const city = cityRow as { id: string; name: string; state: string; slug: string } | null;
  if (!city) return Response.json({ error: "Cidade não encontrada na base." }, { status: 404 });

  // o cliente tem assinatura liberada para essa cidade?
  const { data: sub } = await db
    .from("subscriptions")
    .select("status")
    .eq("user_id", user.id)
    .eq("city_id", city.id)
    .in("status", ["trialing", "active"])
    .maybeSingle();
  if (!sub) return Response.json({ error: "Sem acesso a esta cidade." }, { status: 403 });

  type Page = PromiseLike<{ data: Record<string, unknown>[] | null; error: unknown }>;
  const listingsRaw = await selectAll<Record<string, unknown>>((from, to) =>
    db.from("listings").select(LISTING_COLS).eq("city_id", city.id).eq("status", "ativo")
      .order("first_seen_at", { ascending: false }).range(from, to) as unknown as Page,
  ).catch(() => [] as Record<string, unknown>[]);

  const listings = listingsRaw.map((r) => {
    const ag = (r as { agencies?: { name?: string } | { name?: string }[] }).agencies;
    const agency = (Array.isArray(ag) ? ag[0]?.name : ag?.name) ?? "Sem imobiliária";
    return { ...r, agency };
  });

  const pois = await selectAll<Record<string, unknown>>((from, to) =>
    db.from("pois").select("name,category,lat,lng").eq("city_id", city.id).not("lat", "is", null).range(from, to) as unknown as Page,
  ).catch(() => [] as Record<string, unknown>[]);

  return Response.json({ city, listings, pois });
}
