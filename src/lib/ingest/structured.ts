// ── Extração estruturada (grátis) ─────────────────────────────────────
// Junta tudo que dá pra tirar sem IA: JSON-LD + OpenGraph + microdados +
// pistas da própria URL. A IA depois só completa os campos que faltarem.

import type { ExtractedListing } from "./types";
import { extractJsonLd } from "./jsonld";

export const EMPTY: ExtractedListing = {
  title: null, type: null, price: null, price_original: null,
  area_total_m2: null, frente_m: null, comprimento_m: null,
  neighborhood: null, street: null, street_number: null, cep: null,
  accepts_permuta: null, description: null, external_code: null,
  bedrooms: null, bathrooms: null, suites: null, parking: null,
  built_area_m2: null, condo_fee: null, is_launch: null,
  image_url: null,
};

/** Preenche em `base` os campos ainda nulos com os de `src`. */
export function mergeFill(
  base: ExtractedListing,
  src: Partial<ExtractedListing> | null,
): ExtractedListing {
  if (!src) return base;
  const out = { ...base };
  const rec = out as Record<string, unknown>;
  (Object.keys(EMPTY) as (keyof ExtractedListing)[]).forEach((k) => {
    if (out[k] == null && src[k] != null) rec[k] = src[k];
  });
  return out;
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const s = String(v).replace(/[^0-9.,-]/g, "");
  if (!s) return null;
  const hasComma = s.includes(",");
  const dots = (s.match(/\./g) || []).length;
  const norm = hasComma
    ? s.replace(/\./g, "").replace(",", ".")
    : dots > 1
      ? s.replace(/\./g, "")
      : s;
  const n = parseFloat(norm);
  return Number.isFinite(n) ? n : null;
}

function meta(html: string, key: string): string | null {
  const re = new RegExp(
    `<meta[^>]+(?:property|name|itemprop)=["']${key}["'][^>]*>`,
    "i",
  );
  const tag = html.match(re)?.[0];
  if (!tag) return null;
  return tag.match(/content=["']([^"']*)["']/i)?.[1] ?? null;
}

// ── OpenGraph + microdados (via <meta>) ──
function fromMeta(html: string): Partial<ExtractedListing> {
  const price =
    toNum(meta(html, "product:price:amount")) ??
    toNum(meta(html, "og:price:amount")) ??
    toNum(meta(html, "price"));
  return {
    title: meta(html, "og:title"),
    description: meta(html, "og:description"),
    price,
    bedrooms: toNum(meta(html, "numberOfBedrooms") ?? meta(html, "numberOfRooms")),
    bathrooms: toNum(meta(html, "numberOfBathroomsTotal")),
    image_url: meta(html, "og:image") ?? meta(html, "og:image:secure_url"),
  };
}

// ── Pistas da URL (tipo, quartos, vagas, bairro) ──
function fromUrl(url: string): Partial<ExtractedListing> {
  let u = url;
  try {
    u = decodeURIComponent(url);
  } catch {
    /* usa como veio */
  }
  u = u.toLowerCase();
  const out: Partial<ExtractedListing> = {};

  if (/terreno|lote/.test(u)) out.type = "Terreno";
  else if (/apartament|kitnet|studio|cobertura|duplex/.test(u)) out.type = "Apartamento";
  else if (/sobrado/.test(u)) out.type = "Sobrado";
  else if (/casa|residencia/.test(u)) out.type = "Casa";
  else if (/comercial|\bsala\b|loja|galp/.test(u)) out.type = "Comercial";
  else if (/sitio|chacara|fazenda/.test(u)) out.type = "Sítio";

  const q = u.match(/(\d+)\s*-?\s*(quartos?|dormitorios?|dorm|suites?)/);
  if (q) out.bedrooms = Number(q[1]);
  const v = u.match(/(\d+)\s*-?\s*(vagas?|garagens?|garagem)/);
  if (v) out.parking = Number(v[1]);
  if (/lancamento|na-planta|em-construcao/.test(u)) out.is_launch = true;

  return out;
}

/** Extrai tudo que der de forma determinística (sem IA). */
export function extractStructured(html: string, url: string): ExtractedListing {
  let out = { ...EMPTY };
  // prioridade: JSON-LD > microdados/OG > URL
  out = mergeFill(out, extractJsonLd(html));
  out = mergeFill(out, fromMeta(html));
  out = mergeFill(out, fromUrl(url));
  return out;
}

// ── Situação do anúncio (vendido / alugado / locação) ─────────────────
export type ListingStatus = "ativo" | "vendido" | "alugado" | "reservado" | "locacao";

/**
 * Detecta a situação do anúncio pelo TEXTO VISÍVEL (sem tags) + a URL.
 * Conservador: usa palavra no SINGULAR (vendido, não "vendidos") para menus
 * do tipo "Imóveis Vendidos" não darem falso positivo.
 */
export function detectStatus(html: string, url: string): ListingStatus {
  let u = url;
  try { u = decodeURIComponent(url); } catch { /* usa como veio */ }
  u = u.toLowerCase();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .toLowerCase();
  const has = (re: RegExp) => re.test(text);

  // marcações de indisponibilidade (o que descartamos/marcamos)
  if (has(/\bvendid[oa]\b/)) return "vendido";
  if (has(/\b(alugad[oa]|locad[oa])\b/)) return "alugado";
  if (has(/\breservad[oa]\b/)) return "reservado";

  // tipo de transação: locação/aluguel (não é venda) — pista pela URL
  if (/(^|[^a-z])(loca[cç][aã]o|aluguel|para-alugar|locar)([^a-z]|$)/.test(u)) return "locacao";

  return "ativo";
}

/** Busca o HTML uma vez e devolve os campos estruturados + a situação. */
export async function fetchListingSignals(
  url: string,
  timeoutMs = 12_000,
): Promise<{ listing: ExtractedListing; status: ListingStatus } | null> {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), timeoutMs);
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; radar-imobiliario/0.1; +https://vercel.app)",
      },
      signal: c.signal,
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const html = await res.text();
    return { listing: extractStructured(html, url), status: detectStatus(html, url) };
  } catch {
    return null;
  }
}

/** Busca o HTML cru e extrai o que for estruturado. */
export async function fetchStructured(
  url: string,
  timeoutMs = 12_000,
): Promise<ExtractedListing | null> {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), timeoutMs);
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; radar-imobiliario/0.1; +https://vercel.app)",
      },
      signal: c.signal,
    });
    clearTimeout(t);
    if (!res.ok) return null;
    return extractStructured(await res.text(), url);
  } catch {
    return null;
  }
}
