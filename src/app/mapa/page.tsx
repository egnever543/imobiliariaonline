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
    const cols =
      "id,title,type,price,price_original,area_total_m2,built_area_m2,bedrooms,bathrooms,suites,parking,frente_m,comprimento_m,neighborhood,street,cep,lat,lng,geo_method,accepts_permuta,is_launch,source_url,agencies(name)";

    // Só imóveis ATIVOS entram no mapa (vendido/alugado/locação/indisponível
    // ficam no banco, mas fora do mapa). Se a coluna status ainda não existir
    // (migration 0007 não rodada), cai no fallback sem o filtro.
    const active = await db
      .from("listings")
      .select(cols)
      .eq("status", "ativo")
      .order("first_seen_at", { ascending: false })
      .limit(3000);
    let data = active.data as Record<string, unknown>[] | null;
    if (active.error) {
      const all = await db.from("listings").select(cols).order("first_seen_at", { ascending: false }).limit(3000);
      data = all.data as Record<string, unknown>[] | null;
    }

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
