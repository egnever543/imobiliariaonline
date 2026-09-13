// Página do explorador de imóveis. Server Component: busca os imóveis
// (com o nome da imobiliária) e passa para o Explorer (client).

import { getServiceClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/supabase/paginate";
import Explorer, { type Listing, type PoiPoint } from "./Explorer";

export const dynamic = "force-dynamic";

async function loadPois(): Promise<PoiPoint[]> {
  try {
    const db = getServiceClient();
    return await selectAll<PoiPoint>((from, to) =>
      db.from("pois").select("name,category,lat,lng,rating,weight").range(from, to),
    );
  } catch {
    return [];
  }
}

async function loadListings(): Promise<Listing[]> {
  try {
    const db = getServiceClient();
    const cols =
      "id,title,type,price,price_original,area_total_m2,built_area_m2,bedrooms,bathrooms,suites,parking,frente_m,comprimento_m,neighborhood,street,cep,lat,lng,geo_method,accepts_permuta,is_launch,image_url,source_url,agencies(name)";

    // Só imóveis ATIVOS entram no mapa (vendido/alugado/locação/indisponível
    // ficam no banco, mas fora do mapa). Paginado para trazer TODOS (o
    // PostgREST limita ~1.000 por requisição). Fallback sem o filtro caso a
    // coluna status ainda não exista.
    let data: Record<string, unknown>[];
    try {
      data = await selectAll<Record<string, unknown>>((from, to) =>
        db.from("listings").select(cols).eq("status", "ativo").order("first_seen_at", { ascending: false }).range(from, to),
      );
    } catch {
      data = await selectAll<Record<string, unknown>>((from, to) =>
        db.from("listings").select(cols).order("first_seen_at", { ascending: false }).range(from, to),
      );
    }

    return data.map((r) => {
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
