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

// Linha de costa coletada do OSM (todas as cidades, unidas). Vazio → o
// componente usa a linha fixa como fallback.
async function loadCoast(): Promise<{ coastline: [number, number][][]; beaches: [number, number][][] }> {
  const db = getServiceClient();
  // `beaches` pode não existir ainda (migration 0009): tenta com ela e, se
  // falhar, reconsulta só `ways`.
  const read = async (cols: string) => {
    const { data, error } = await db.from("city_coastlines").select(cols);
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as { ways?: [number, number][][]; beaches?: [number, number][][] }[];
  };
  let rows: { ways?: [number, number][][]; beaches?: [number, number][][] }[] = [];
  try {
    rows = await read("ways,beaches");
  } catch {
    try { rows = await read("ways"); } catch { rows = []; }
  }
  const coastline: [number, number][][] = [];
  const beaches: [number, number][][] = [];
  for (const row of rows) {
    for (const w of row.ways ?? []) if (Array.isArray(w) && w.length >= 2) coastline.push(w);
    for (const b of row.beaches ?? []) if (Array.isArray(b) && b.length >= 2) beaches.push(b);
  }
  return { coastline, beaches };
}

async function loadListings(): Promise<Listing[]> {
  try {
    const db = getServiceClient();
    // `beach_distance_m` pode não existir ainda (migration 0009 não rodada):
    // tenta com a coluna e, se falhar, reconsulta sem ela. `status` idem.
    const base =
      "id,title,type,price,price_original,area_total_m2,built_area_m2,bedrooms,bathrooms,suites,parking,frente_m,comprimento_m,neighborhood,street,cep,lat,lng,geo_method,accepts_permuta,is_launch,image_url,source_url,agencies(name)";
    const withBeach = base + ",beach_distance_m";

    // Só imóveis ATIVOS entram no mapa (vendido/alugado/locação/indisponível
    // ficam no banco, mas fora do mapa). Paginado para trazer TODOS (o
    // PostgREST limita ~1.000 por requisição). Fallback sem o filtro caso a
    // coluna status ainda não exista.
    type Page = PromiseLike<{ data: Record<string, unknown>[] | null; error: unknown }>;
    const fetchCols = async (cols: string) => {
      try {
        return await selectAll<Record<string, unknown>>((from, to) =>
          db.from("listings").select(cols).eq("status", "ativo").order("first_seen_at", { ascending: false }).range(from, to) as unknown as Page,
        );
      } catch {
        return await selectAll<Record<string, unknown>>((from, to) =>
          db.from("listings").select(cols).order("first_seen_at", { ascending: false }).range(from, to) as unknown as Page,
        );
      }
    };
    let data: Record<string, unknown>[];
    try {
      data = await fetchCols(withBeach);
    } catch {
      data = await fetchCols(base);
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
  const [listings, pois, coast] = await Promise.all([loadListings(), loadPois(), loadCoast()]);
  return <Explorer listings={listings} pois={pois} coastline={coast.coastline} beaches={coast.beaches} />;
}
