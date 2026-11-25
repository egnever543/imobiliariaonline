// POST /api/marketing/generate-art  { postId }
// Gera a arte real do post no Canva: sobe a foto do imóvel → preenche o brand
// template (autofill) → exporta PNG → guarda de forma durável no storage →
// grava a URL no post. Autenticado por Bearer (dono do post).

import { getUserFromRequest, unauthenticated } from "@/lib/supabase/session";
import { getServiceClient } from "@/lib/supabase/server";
import { getAccessToken, importAssetFromUrl, getTemplateDataset, autofillDesign, exportPng, type AutofillData } from "@/lib/canva";

export const runtime = "nodejs";
export const maxDuration = 120;

interface L {
  id: string; type: string | null; price: number | null;
  area_total_m2: number | null; built_area_m2: number | null;
  bedrooms: number | null; parking: number | null; neighborhood: string | null;
  image_url: string | null;
}
interface Brand { agency_name?: string | null; phone?: string | null; creci?: string | null; instagram?: string | null }

const fmtPrice = (v: number | null) => (v ? "R$ " + Number(v).toLocaleString("pt-BR") : "Sob consulta");

function textFor(field: string, l: L, brand: Brand | null): string {
  const f = field.toLowerCase();
  if (/pre[cç]o|valor/.test(f)) return fmtPrice(l.price);
  if (/bairro/.test(f)) return l.neighborhood ?? "";
  if (/t[ií]tulo|tipo/.test(f)) return l.type ?? "Imóvel";
  if (/quarto|dormit/.test(f)) return l.bedrooms ? `${l.bedrooms} quartos` : "";
  if (/[aá]rea|metragem|m2|m²/.test(f)) { const a = l.area_total_m2 ?? l.built_area_m2; return a ? `${Number(a).toLocaleString("pt-BR")} m²` : ""; }
  if (/vaga|garagem/.test(f)) return l.parking ? `${l.parking} vagas` : "";
  if (/contato|telefone|whats|fone|celular/.test(f)) return brand?.phone ?? "";
  if (/creci/.test(f)) return brand?.creci ? `CRECI ${brand.creci}` : "";
  if (/imobili|marca|empresa|nome/.test(f)) return brand?.agency_name ?? "";
  if (/instagram|insta|arroba/.test(f)) return brand?.instagram ?? "";
  if (/endere[cç]o/.test(f)) return l.neighborhood ?? "";
  return "";
}

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return unauthenticated();
  const b = await req.json().catch(() => ({}));
  const postId = b?.postId as string | undefined;
  if (!postId) return Response.json({ error: "Informe postId." }, { status: 400 });

  const templateId = process.env.CANVA_BRAND_TEMPLATE_ID;
  if (!templateId) return Response.json({ error: "Falta configurar CANVA_BRAND_TEMPLATE_ID." }, { status: 400 });

  const db = getServiceClient();

  // post + imóvel (confere dono)
  const { data: post } = await db.from("content_posts")
    .select("id,user_id,listing_id,listings(id,type,price,area_total_m2,built_area_m2,bedrooms,parking,neighborhood,image_url)")
    .eq("id", postId).eq("user_id", user.id).maybeSingle();
  if (!post) return Response.json({ error: "Post não encontrado." }, { status: 404 });
  const lraw = (post as Record<string, unknown>).listings;
  const l = (Array.isArray(lraw) ? lraw[0] : lraw) as L | null;
  if (!l) return Response.json({ error: "Post sem imóvel." }, { status: 400 });

  const { data: brand } = await db.from("brand_kits").select("agency_name,phone,creci,instagram").eq("user_id", user.id).maybeSingle();

  try {
    const token = await getAccessToken(db);

    // 1) campos do template
    const dataset = await getTemplateDataset(token, templateId);
    const fields = Object.entries(dataset);
    if (fields.length === 0) {
      return Response.json({ error: "Não consegui ler os campos do brand template (confira o ID e o scope brand_template:meta:read)." }, { status: 400 });
    }

    // 2) foto → asset
    let assetId: string | null = null;
    if (l.image_url) {
      try { assetId = await importAssetFromUrl(token, l.image_url, `imovel-${l.id}`); } catch { assetId = null; }
    }

    // 3) monta o autofill conforme os tipos do template
    const data: AutofillData = {};
    for (const [name, meta] of fields) {
      if (meta.type === "image") { if (assetId) data[name] = { type: "image", asset_id: assetId }; }
      else { const t = textFor(name, l, (brand as Brand) ?? null); if (t) data[name] = { type: "text", text: t }; }
    }

    // 4) autofill → export
    const designId = await autofillDesign(token, templateId, data, `${l.type ?? "Imóvel"} - ${fmtPrice(l.price)}`);
    const canvaUrl = await exportPng(token, designId);

    // 5) baixa o PNG e guarda de forma durável (o link do Canva expira em 24h)
    const bytes = Buffer.from(await (await fetch(canvaUrl)).arrayBuffer());
    const path = `${user.id}/${postId}.png`;
    const up = await db.storage.from("post-art").upload(path, bytes, { contentType: "image/png", upsert: true });
    const artUrl = up.error ? canvaUrl : db.storage.from("post-art").getPublicUrl(path).data.publicUrl;

    await db.from("content_posts").update({ art_url: artUrl, canva_design_id: designId, status: "gerado", updated_at: new Date().toISOString() }).eq("id", postId);
    return Response.json({ ok: true, art_url: artUrl });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
