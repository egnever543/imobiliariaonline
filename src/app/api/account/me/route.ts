// GET /api/account/me — resumo da conta do cliente autenticado: perfil,
// assinaturas (com a cidade) e solicitações de cidade. Autenticado por Bearer.

import { getUserFromRequest, unauthenticated } from "@/lib/supabase/session";
import { getServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return unauthenticated();

  const db = getServiceClient();
  const [{ data: profile }, { data: subs }, { data: reqs }] = await Promise.all([
    db.from("profiles").select("email,full_name,created_at").eq("user_id", user.id).maybeSingle(),
    db.from("subscriptions").select("plan,status,current_period_end,city_id,cities(name,state,slug)").eq("user_id", user.id),
    db.from("city_requests").select("city_name,state,slug,status,created_at").eq("user_id", user.id).order("created_at", { ascending: false }),
  ]);

  const subscriptions = ((subs ?? []) as Record<string, unknown>[]).map((s) => {
    const c = s.cities as { name?: string; state?: string; slug?: string } | { name?: string; state?: string; slug?: string }[] | null;
    const city = Array.isArray(c) ? c[0] : c;
    return {
      plan: s.plan, status: s.status, current_period_end: s.current_period_end,
      city: city ? { name: city.name, state: city.state, slug: city.slug } : null,
    };
  });

  return Response.json({
    email: user.email,
    profile: profile ?? null,
    subscriptions,
    requests: reqs ?? [],
  });
}
