// Marca (brand kit) do cliente. GET lê, POST salva. Autenticado por Bearer.

import { getUserFromRequest, unauthenticated } from "@/lib/supabase/session";
import { getServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const FIELDS = ["agency_name", "logo_url", "primary_color", "phone", "creci", "instagram"] as const;

export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return unauthenticated();
  const db = getServiceClient();
  const { data } = await db.from("brand_kits").select("*").eq("user_id", user.id).maybeSingle();
  return Response.json({ brand: data ?? null });
}

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return unauthenticated();
  const b = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = { user_id: user.id, updated_at: new Date().toISOString() };
  for (const f of FIELDS) if (f in b) patch[f] = (b[f] ?? "").toString().trim() || null;
  const db = getServiceClient();
  const { error } = await db.from("brand_kits").upsert(patch, { onConflict: "user_id" });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
