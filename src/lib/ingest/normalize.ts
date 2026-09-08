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

/**
 * Descarta preços implausíveis (erros de parsing: valor em centavos, ×1000,
 * casas decimais coladas etc.). Preferimos preço nulo a preço errado — um
 * valor absurdo contamina o ranking e a inteligência de mercado.
 *   - fora da faixa [R$ 5 mil, R$ 80 milhões]  → nulo
 *   - R$/m² acima de R$ 80 mil (quando há área) → nulo
 * Retorna o próprio número quando plausível.
 */
function sanePrice(price: number | null, area: number | null): number | null {
  if (price == null) return null;
  if (price < 5_000 || price > 80_000_000) return null;
  if (area != null && area > 0 && price / area > 80_000) return null;
  return price;
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
  const area = toNumber(extracted.area_total_m2);
  // Bairro não pode ser a própria cidade (extração às vezes pega "Itapoá"
  // como bairro). Se bater com o nome da cidade, zera — melhor sem bairro.
  const neighborhood =
    extracted.neighborhood &&
    source.cityName &&
    slug(extracted.neighborhood) === slug(source.cityName)
      ? null
      : extracted.neighborhood;
  return {
    ...extracted,
    neighborhood,
    price: sanePrice(toNumber(extracted.price), area),
    price_original: sanePrice(toNumber(extracted.price_original), area),
    area_total_m2: area,
    frente_m: toNumber(extracted.frente_m),
    comprimento_m: toNumber(extracted.comprimento_m),
    bedrooms: toNumber(extracted.bedrooms),
    bathrooms: toNumber(extracted.bathrooms),
    suites: toNumber(extracted.suites),
    parking: toNumber(extracted.parking),
    built_area_m2: toNumber(extracted.built_area_m2),
    condo_fee: toNumber(extracted.condo_fee),
    city_id: source.cityId,
    agency_id: source.agencyId,
    source_url: sourceUrl,
    dedup_key: dedupKey(extracted),
    lat: null,
    lng: null,
    geo_method: null,
    raw: { extracted: extracted as unknown as Record<string, unknown> },
  };
}
