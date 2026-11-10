// Página do mapa. Server Component: busca os imóveis ATIVOS (com o nome da
// imobiliária) e os pontos de referência, e passa para o Explorer (client).

import { getServiceClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/supabase/paginate";
import Explorer, { type Listing, type PoiPoint } from "./Explorer";

export const dynamic = "force-dynamic";

async function loadPois(): Promise<PoiPoint[]> {
  try {
    const db = getServiceClient();
    return await selectAll<PoiPoint>((from, to) =>
      db.from("pois").select("name,category,lat,lng").not("lat", "is", null).range(from, to),
    );
  } catch {
    return [];
  }
}

async function loadListings(): Promise<Listing[]> {
  try {
    const db = getServiceClient();
    const cols =
      "id,title,type,price,area_total_m2,bedrooms,bathrooms,suites,parking,neighborhood,street,cep,lat,lng,geo_method,image_url,source_url,agencies(name)";
    // Só imóveis ATIVOS entram no mapa. Paginado para trazer todos (PostgREST
    // limita ~1.000/req). Fallback sem o filtro caso a coluna status não exista.
    type Page = PromiseLike<{ data: Record<string, unknown>[] | null; error: unknown }>;
    let data: Record<string, unknown>[];
    try {
      data = await selectAll<Record<string, unknown>>((from, to) =>
        db.from("listings").select(cols).eq("status", "ativo").order("first_seen_at", { ascending: false }).range(from, to) as unknown as Page,
      );
    } catch {
      data = await selectAll<Record<string, unknown>>((from, to) =>
        db.from("listings").select(cols).order("first_seen_at", { ascending: false }).range(from, to) as unknown as Page,
      );
    }

    return data.map((r) => {
      const ag = (r as { agencies?: { name?: string } | { name?: string }[] }).agencies;
      const agency = (Array.isArray(ag) ? ag[0]?.name : ag?.name) ?? "Sem imobiliária";
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
