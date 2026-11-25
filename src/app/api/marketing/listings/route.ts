// Imóveis disponíveis para virar post (têm foto e preço). Autenticado por Bearer.
// Para o MVP usa a base inteira (os imóveis de Itapoá já coletados), para você
// testar sem precisar cadastrar um site novo. Depois dá para filtrar pela
// imobiliária do próprio cliente.

import { getUserFromRequest, unauthenticated } from "@/lib/supabase/session";
import { getServiceClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/supabase/paginate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLS = "id,title,type,price,area_total_m2,built_area_m2,bedrooms,parking,neighborhood,image_url,source_url";

export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return unauthenticated();
  const db = getServiceClient();
  type Page = PromiseLike<{ data: Record<string, unknown>[] | null; error: unknown }>;
  const rows = await selectAll<Record<string, unknown>>((from, to) =>
    db.from("listings").select(COLS)
      .not("image_url", "is", null).not("price", "is", null).eq("status", "ativo")
      .order("first_seen_at", { ascending: false }).range(from, to) as unknown as Page,
  ).catch(() => [] as Record<string, unknown>[]);
  return Response.json({ listings: rows.slice(0, 120) });
}
