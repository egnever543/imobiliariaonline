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

// ── Preço no TEXTO VISÍVEL (fallback, grátis) ──
// Muitos sites mostram o valor só como texto ("Valor R$ 250.000,00") sem
// JSON-LD nem og:price. Este fallback varre o corpo da página atrás de
// "R$ ...", ignorando condomínio/IPTU/parcela/financiamento, e escolhe o
// maior valor plausível (o de venda costuma ser o maior número da página).
// Beneficia tanto a coleta quanto o refresh (que não usa IA).

// Número no formato BR do texto: ponto = milhar, vírgula = decimal.
//   "250.000"    -> 250000
//   "1.250.000"  -> 1250000
//   "250.000,50" -> 250000.5
//   "250000"     -> 250000
function brNum(raw: string): number | null {
  let s = raw.replace(/[^0-9.,]/g, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/\./g, ""); // sem vírgula: pontos são separador de milhar
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

// rótulo imediatamente antes do "R$" que indica que NÃO é o preço de venda
const PRICE_EXCLUDE =
  /(condom[ií]nio|iptu|\btaxa\b|parcela|mensal|financ|entrada|di[áa]ria|avalia|c[óo]d|refer[êe]ncia)/i;
// sufixo logo após o valor que denuncia mensalidade ("R$ 2.500/mês")
const PRICE_SUFFIX_EXCLUDE = /^\s*(\/\s*m[êe]s|por\s*m[êe]s|\s*mensal|ao\s*m[êe]s)/i;
// rótulo que confirma que É o preço de venda (tem prioridade)
const PRICE_PREFER = /(valor|pre[çc]o|venda|à\s*vista|a\s*vista)/i;

function priceFromText(html: string): number | null {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ");

  const re = /r\$\s*([0-9][0-9.\s]{2,15}(?:,\d{1,2})?)/gi;
  const cands: { value: number; preferred: boolean }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const value = brNum(m[1]);
    if (value == null || value < 5000 || value > 80_000_000) continue;
    // só o RÓTULO IMEDIATO antes do R$ (corta no separador anterior, para não
    // herdar o rótulo do item vizinho, ex.: "... Condomínio: R$ 850 | R$ 250.000")
    const win = text.slice(Math.max(0, m.index - 45), m.index).toLowerCase();
    const label = win.split(/[.|;:•·\n]|r\$/).pop() ?? win;
    const suffix = text.slice(m.index + m[0].length, m.index + m[0].length + 8).toLowerCase();
    if (PRICE_EXCLUDE.test(label)) continue;
    if (PRICE_SUFFIX_EXCLUDE.test(suffix)) continue;
    cands.push({ value, preferred: PRICE_PREFER.test(label) });
  }
  if (!cands.length) return null;
  const preferred = cands.filter((c) => c.preferred);
  const pool = preferred.length ? preferred : cands;
  return pool.reduce((max, c) => (c.value > max ? c.value : max), 0) || null;
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
  // fallback: preço só como texto visível na página
  if (out.price == null) {
    const p = priceFromText(html);
    if (p != null) out.price = p;
  }
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
