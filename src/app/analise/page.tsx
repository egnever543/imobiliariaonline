// Página de Análise — o foco do produto: "qual o melhor imóvel para X".
// Server Component: carrega os imóveis ativos (com foto) + comércios e passa
// para o cliente, que roda o ranking por objetivo e destaca os melhores.

import { getServiceClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/supabase/paginate";
import Analise, { type Item, type Poi } from "./Analise";

export const dynamic = "force-dynamic";

async function loadPois(): Promise<Poi[]> {
  try {
    const db = getServiceClient();
    return await selectAll<Poi>((from, to) =>
      db.from("pois").select("category,lat,lng").range(from, to),
    );
  } catch {
    return [];
  }
}

// linha de costa + praias de areia da cidade (para o fator praia do ranking)
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

async function loadItems(): Promise<Item[]> {
  try {
    const db = getServiceClient();
    // `beach_distance_m` pode não existir ainda (migration 0009 não rodada):
    // tenta com a coluna e, se falhar, reconsulta sem ela — o deploy não
    // depende da ordem da migration. `status` idem (fallback sem o filtro).
    const base =
      "id,title,type,price,area_total_m2,built_area_m2,bedrooms,bathrooms,suites,parking,neighborhood,street,cep,lat,lng,geo_method,image_url,source_url,agencies(name)";
    const withBeach = base + ",beach_distance_m";
    type Page = PromiseLike<{ data: Record<string, unknown>[] | null; error: unknown }>;
    const fetchCols = async (cols: string) => {
      try {
        return await selectAll<Record<string, unknown>>((from, to) =>
          db.from("listings").select(cols).eq("status", "ativo").range(from, to) as unknown as Page,
        );
      } catch {
        return await selectAll<Record<string, unknown>>((from, to) =>
          db.from("listings").select(cols).range(from, to) as unknown as Page,
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
      const ag = (r as { agencies?: { name?: string } | { name?: string }[] }).agencies;
      const agency = (Array.isArray(ag) ? ag[0]?.name : ag?.name) ?? "Sem imobiliária";
      return { ...(r as unknown as Item), agency };
    });
  } catch {
    return [];
  }
}

export default async function AnalisePage() {
  const [items, pois, coast] = await Promise.all([loadItems(), loadPois(), loadCoast()]);
  return <Analise items={items} pois={pois} coastline={coast.coastline} beaches={coast.beaches} />;
}
