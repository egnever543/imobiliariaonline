// Página do explorador de imóveis. Server Component: busca os imóveis
// (com o nome da imobiliária) e passa para o Explorer (client).

import { getServiceClient } from "@/lib/supabase/server";
import Explorer, { type Listing, type PoiPoint } from "./Explorer";

export const dynamic = "force-dynamic";

async function loadPois(): Promise<PoiPoint[]> {
  try {
    const db = getServiceClient();
    const { data } = await db
      .from("pois")
      .select("name,category,lat,lng,rating,weight")
      .limit(8000);
    return (data ?? []) as PoiPoint[];
  } catch {
    return [];
  }
}

async function loadListings(): Promise<Listing[]> {
  try {
    const db = getServiceClient();
    const { data } = await db
      .from("listings")
      .select(
        "id,title,type,price,price_original,area_total_m2,built_area_m2,bedrooms,bathrooms,suites,parking,frente_m,comprimento_m,neighborhood,street,cep,lat,lng,geo_method,accepts_permuta,is_launch,source_url,agencies(name)",
      )
      .order("first_seen_at", { ascending: false })
      .limit(3000);

    return (data ?? []).map((r) => {
      const ag = (r as { agencies?: { name?: string } | { name?: string }[] })
        .agencies;
      const agency =
        (Array.isArray(ag) ? ag[0]?.name : ag?.name) ?? "Sem imobiliária";
      return { ...(r as unknown as Listing), agency };
    });
  } catch {
    return [];
  }
}

export default async function Mapa() {
  const [listings, pois] = await Promise.all([loadListings(), loadPois()]);
  return <Explorer listings={listings} pois={pois} />;
}
