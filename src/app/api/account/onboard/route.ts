// POST /api/account/onboard — chamado logo após o cadastro (signUp).
// Cria/atualiza o perfil e resolve a cidade escolhida:
//  - cidade já na base  → cria assinatura em trial (cliente vê o mapa dela);
//  - cidade ausente     → registra uma solicitação (pendente) para o admin.
// Autenticado pelo token do próprio usuário (Bearer).

import { getUserFromRequest, unauthenticated } from "@/lib/supabase/session";
import { getServiceClient } from "@/lib/supabase/server";
import { citySlug } from "@/lib/slug";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return unauthenticated();

  const b = await req.json().catch(() => null);
  const cityName = (b?.city_name ?? "").toString().trim();
  const state = (b?.state ?? "").toString().trim() || null;
  const fullName = (b?.full_name ?? "").toString().trim() || null;
  if (!cityName) return Response.json({ error: "Informe a cidade." }, { status: 400 });

  const db = getServiceClient();

  // perfil (espelha auth.users)
  await db.from("profiles").upsert(
    { user_id: user.id, email: user.email, full_name: fullName },
    { onConflict: "user_id" },
  );

  const slug = citySlug(cityName, state);

  // a cidade já está na base?
  const { data: cityRows } = await db
    .from("cities")
    .select("id,name,state,slug")
    .or(`slug.eq.${slug},name.ilike.${cityName}`)
    .limit(1);
  const city = (cityRows ?? [])[0] as { id: string; name: string; state: string; slug: string } | undefined;

  if (city) {
    // trial: cria (ou mantém) a assinatura do cliente para essa cidade
    await db.from("subscriptions").upsert(
      { user_id: user.id, city_id: city.id, plan: "trial", status: "trialing" },
      { onConflict: "user_id,city_id" },
    );
    return Response.json({ status: "disponivel", city: { name: city.name, state: city.state, slug: city.slug } });
  }

  // cidade ausente → solicitação pendente (evita duplicar a mesma cidade do usuário)
  const { data: existing } = await db
    .from("city_requests")
    .select("id,status")
    .eq("user_id", user.id)
    .eq("slug", slug)
    .limit(1);
  if (!(existing ?? [])[0]) {
    await db.from("city_requests").insert({
      user_id: user.id, city_name: cityName, state, slug, status: "pendente",
    });
  }
  return Response.json({ status: "solicitada", city: { name: cityName, state, slug } });
}
