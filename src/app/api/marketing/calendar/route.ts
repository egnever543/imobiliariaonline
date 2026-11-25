// Calendário de posts do cliente.
//  GET    → lista os posts (com os dados do imóvel para o preview).
//  POST   → gera posts: usa os imóveis escolhidos (listingIds) ou escolhe
//           automaticamente os mais recentes com foto+preço, e agenda em dias
//           alternados a partir de amanhã.
//  PATCH  → troca o imóvel de um post (regenerate) ou edita legenda/data.
//  DELETE → remove um post.
// Autenticado por Bearer.

import { getUserFromRequest, unauthenticated } from "@/lib/supabase/session";
import { getServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DB = ReturnType<typeof getServiceClient>;
interface L {
  id: string; type: string | null; price: number | null;
  area_total_m2: number | null; built_area_m2: number | null;
  bedrooms: number | null; neighborhood: string | null;
}

const LCOLS = "id,type,price,area_total_m2,built_area_m2,bedrooms,parking,neighborhood,image_url,source_url";
const fmtPrice = (v: number | null) => (v ? "R$ " + Number(v).toLocaleString("pt-BR") : "Sob consulta");

function makeCaption(l: L): string {
  const tipo = l.type ?? "Imóvel";
  const bairro = l.neighborhood ? ` em ${l.neighborhood}` : "";
  const beds = l.bedrooms ? `${l.bedrooms} quartos` : "";
  const area = l.area_total_m2 || l.built_area_m2 ? `${(l.area_total_m2 ?? l.built_area_m2)!.toLocaleString("pt-BR")} m²` : "";
  const specs = [beds, area].filter(Boolean).join(" · ");
  return `${tipo}${bairro} por ${fmtPrice(l.price)}.${specs ? " " + specs + "." : ""} Agende sua visita e conheça.`;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function candidates(db: DB): Promise<L[]> {
  const { data } = await db.from("listings").select(LCOLS)
    .not("image_url", "is", null).not("price", "is", null).eq("status", "ativo")
    .order("first_seen_at", { ascending: false }).limit(120);
  return (data ?? []) as unknown as L[];
}

export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return unauthenticated();
  const db = getServiceClient();
  const { data } = await db.from("content_posts")
    .select(`id,listing_id,scheduled_for,template,caption,status,art_url,listings(${LCOLS})`)
    .eq("user_id", user.id).order("scheduled_for", { ascending: true });
  const posts = ((data ?? []) as Record<string, unknown>[]).map((p) => {
    const l = p.listings as Record<string, unknown> | Record<string, unknown>[] | null;
    return { ...p, listing: Array.isArray(l) ? l[0] ?? null : l };
  });
  return Response.json({ posts });
}

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return unauthenticated();
  const b = await req.json().catch(() => ({}));
  const db = getServiceClient();

  const pool = await candidates(db);
  if (pool.length === 0) return Response.json({ error: "Nenhum imóvel com foto e preço na base ainda." }, { status: 400 });

  let chosen: L[];
  if (Array.isArray(b.listingIds) && b.listingIds.length) {
    const byId = new Map(pool.map((l) => [l.id, l]));
    chosen = (b.listingIds as string[]).map((id) => byId.get(id)).filter(Boolean) as L[];
  } else {
    const count = Math.min(Math.max(Number(b.count) || 6, 1), 30);
    chosen = pool.slice(0, count);
  }
  if (chosen.length === 0) return Response.json({ error: "Nenhum imóvel selecionado." }, { status: 400 });

  // agenda em dias alternados a partir de amanhã
  const start = new Date();
  start.setDate(start.getDate() + 1);
  const rows = chosen.map((l, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i * 2);
    return {
      user_id: user.id, listing_id: l.id, scheduled_for: ymd(d),
      template: "destaque", caption: makeCaption(l), status: "agendado",
    };
  });
  const { error } = await db.from("content_posts").insert(rows);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true, created: rows.length });
}

export async function PATCH(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return unauthenticated();
  const b = await req.json().catch(() => ({}));
  const id = b?.id as string | undefined;
  if (!id) return Response.json({ error: "Informe id." }, { status: 400 });
  const db = getServiceClient();

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (b.regenerate) {
    // troca por um imóvel diferente do atual, escolhido ao acaso
    const { data: cur } = await db.from("content_posts").select("listing_id").eq("id", id).eq("user_id", user.id).maybeSingle();
    const pool = (await candidates(db)).filter((l) => l.id !== (cur as { listing_id?: string } | null)?.listing_id);
    if (pool.length) {
      const l = pool[Math.floor(Math.random() * pool.length)];
      patch.listing_id = l.id;
      patch.caption = makeCaption(l);
      patch.status = "agendado";
      patch.art_url = null;
    }
  }
  if (typeof b.caption === "string") patch.caption = b.caption;
  if (typeof b.scheduled_for === "string") patch.scheduled_for = b.scheduled_for;
  if (typeof b.status === "string") patch.status = b.status;

  const { error } = await db.from("content_posts").update(patch).eq("id", id).eq("user_id", user.id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return unauthenticated();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Informe id." }, { status: 400 });
  const db = getServiceClient();
  const { error } = await db.from("content_posts").delete().eq("id", id).eq("user_id", user.id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
