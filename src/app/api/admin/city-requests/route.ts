// Solicitações de cidade (admin). Protegido pela senha do painel (x-admin-token).
//  GET  → lista as solicitações (com o e-mail de quem pediu).
//  POST → { id, action: "approve" | "reject" }
//         approve: garante a cidade na base, marca a solicitação "em_captura" e
//                  cria a assinatura (trial) do solicitante — assim ele vê o
//                  mapa assim que você coletar. Depois é só ir em "Adicionar
//                  imóveis" e coletar a cidade.
//         reject:  marca "recusada".

import { isAuthorized, unauthorized } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase/server";
import { citySlug } from "@/lib/slug";

export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!isAuthorized(req)) return unauthorized();
  const db = getServiceClient();
  const status = new URL(req.url).searchParams.get("status");
  let q = db.from("city_requests")
    .select("id,city_name,state,slug,status,city_id,created_at,user_id,profiles(email)")
    .order("created_at", { ascending: false });
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => {
    const p = r.profiles as { email?: string } | { email?: string }[] | null;
    const email = (Array.isArray(p) ? p[0]?.email : p?.email) ?? null;
    return { ...r, email };
  });
  return Response.json({ requests: rows });
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) return unauthorized();
  const b = await req.json().catch(() => null);
  const id = b?.id as string | undefined;
  const action = b?.action as string | undefined;
  if (!id || !action) return Response.json({ error: "Informe id e action." }, { status: 400 });

  const db = getServiceClient();
  const { data: reqRow } = await db
    .from("city_requests").select("id,city_name,state,slug,user_id,status").eq("id", id).maybeSingle();
  const r = reqRow as { id: string; city_name: string; state: string | null; slug: string | null; user_id: string } | null;
  if (!r) return Response.json({ error: "Solicitação não encontrada." }, { status: 404 });

  if (action === "reject") {
    await db.from("city_requests").update({ status: "recusada", updated_at: new Date().toISOString() }).eq("id", id);
    return Response.json({ ok: true, status: "recusada" });
  }

  if (action !== "approve") return Response.json({ error: "action inválida." }, { status: 400 });

  const slug = r.slug || citySlug(r.city_name, r.state);
  // garante a cidade na base
  let { data: cityRow } = await db.from("cities").select("id").eq("slug", slug).maybeSingle();
  if (!cityRow) {
    const ins = await db.from("cities")
      .insert({ name: r.city_name, state: r.state ?? "", slug, active: true })
      .select("id").single();
    if (ins.error) return Response.json({ error: ins.error.message }, { status: 500 });
    cityRow = ins.data;
  }
  const cityId = (cityRow as { id: string }).id;

  // assinatura trial do solicitante + marca a solicitação em captura
  await db.from("subscriptions").upsert(
    { user_id: r.user_id, city_id: cityId, plan: "trial", status: "trialing" },
    { onConflict: "user_id,city_id" },
  );
  await db.from("city_requests")
    .update({ status: "em_captura", city_id: cityId, updated_at: new Date().toISOString() })
    .eq("id", id);

  return Response.json({ ok: true, status: "em_captura", city_id: cityId, slug });
}
