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

async function loadItems(): Promise<Item[]> {
  try {
    const db = getServiceClient();
    const cols =
      "id,title,type,price,area_total_m2,built_area_m2,bedrooms,bathrooms,suites,parking,neighborhood,street,cep,lat,lng,geo_method,image_url,source_url,agencies(name)";
    let data: Record<string, unknown>[];
    try {
      data = await selectAll<Record<string, unknown>>((from, to) =>
        db.from("listings").select(cols).eq("status", "ativo").range(from, to),
      );
    } catch {
      data = await selectAll<Record<string, unknown>>((from, to) =>
        db.from("listings").select(cols).range(from, to),
      );
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
  const [items, pois] = await Promise.all([loadItems(), loadPois()]);
  return <Analise items={items} pois={pois} />;
}
