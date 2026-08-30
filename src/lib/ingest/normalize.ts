// ── Normalização + chave de deduplicação ──────────────────────────────

import type { CanonicalListing, ExtractedListing, AgencySource } from "./types";

/** Converte para número puro aceitando strings tipo "1.400.000,00". */
function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    // remove tudo que não é dígito/vírgula/ponto/-, depois normaliza
    const cleaned = v
      .replace(/[^0-9.,-]/g, "")
      .replace(/\./g, "")
      .replace(",", ".");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function slug(s: string | null | undefined): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Gera uma chave de deduplicação. A ideia: o mesmo imóvel anunciado por
 * imobiliárias diferentes tende a bater em bairro + área + faixa de preço.
 * Heurística inicial — refinar com o tempo (ex: hash de fotos, endereço).
 */
export function dedupKey(e: ExtractedListing): string | null {
  const area = toNumber(e.area_total_m2);
  if (!e.neighborhood && !e.street && !area) return null;
  const priceBucket = e.price ? Math.round(toNumber(e.price)! / 10_000) : 0;
  return [
    slug(e.type),
    slug(e.neighborhood),
    slug(e.street),
    area ? Math.round(area) : 0,
    priceBucket,
  ].join("|");
}

/** Monta o registro canônico pronto para gravar. */
export function normalizeListing(
  extracted: ExtractedListing,
  source: AgencySource,
  sourceUrl: string,
): CanonicalListing {
  return {
    ...extracted,
    price: toNumber(extracted.price),
    price_original: toNumber(extracted.price_original),
    area_total_m2: toNumber(extracted.area_total_m2),
    frente_m: toNumber(extracted.frente_m),
    comprimento_m: toNumber(extracted.comprimento_m),
    city_id: source.cityId,
    agency_id: source.agencyId,
    source_url: sourceUrl,
    dedup_key: dedupKey(extracted),
    raw: { extracted: extracted as unknown as Record<string, unknown> },
  };
}
