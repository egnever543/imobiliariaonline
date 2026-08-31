// Página do explorador de imóveis. Server Component: busca os imóveis
// (com o nome da imobiliária) e passa para o Explorer (client).

import { getServiceClient } from "@/lib/supabase/server";
import Explorer, { type Listing } from "./Explorer";

export const dynamic = "force-dynamic";

async function loadListings(): Promise<Listing[]> {
  try {
    const db = getServiceClient();
    const { data } = await db
      .from("listings")
      .select(
        "id,title,type,price,price_original,area_total_m2,frente_m,comprimento_m,neighborhood,street,cep,lat,lng,geo_method,accepts_permuta,source_url,agencies(name)",
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
  const listings = await loadListings();
  return <Explorer listings={listings} />;
}
