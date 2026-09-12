// Vitrine de imóveis (estilo portal). Server Component: carrega os imóveis
// (com foto, atributos e status) e passa para a grade cliente.

import { getServiceClient } from "@/lib/supabase/server";
import Catalogo, { type Card } from "./Catalogo";
import Nav from "@/components/Nav";

export const dynamic = "force-dynamic";

async function load(): Promise<Card[]> {
  try {
    const db = getServiceClient();
    const { data } = await db
      .from("listings")
      .select(
        "id,title,type,price,area_total_m2,bedrooms,bathrooms,parking,neighborhood,lat,image_url,status,source_url,agencies(name)",
      )
      .order("first_seen_at", { ascending: false })
      .limit(3000);
    return (data ?? []).map((r) => {
      const ag = (r as { agencies?: { name?: string } | { name?: string }[] }).agencies;
      const agency = (Array.isArray(ag) ? ag[0]?.name : ag?.name) ?? "Sem imobiliária";
      return { ...(r as unknown as Card), agency };
    });
  } catch {
    return [];
  }
}

export default async function Imoveis() {
  const listings = await load();
  return (
    <>
      <Nav />
      <Catalogo listings={listings} />
    </>
  );
}
