// ── Cálculo do score ──────────────────────────────────────────────────
// Port do scoring.js. Normaliza cada fator 0–100 sobre o conjunto de
// imóveis, aplica os pesos (normalizados) e devolve uma nota final.

import { DEFAULT_WEIGHTS, type Weights, type ScoreFactor } from "./profiles";

export interface ScorableListing {
  id: string;
  price: number | null;
  area_total_m2: number | null;
  lat: number | null;
  lng: number | null;
  geo_method: string | null;
  neighborhood?: string | null;
  type?: string | null;
}

// Explicação por imóvel: preço justo estimado, desconto e confiança do dado.
export interface ListingInsight {
  pm2: number | null;          // R$/m² deste imóvel
  expectedPm2: number | null;  // R$/m² esperado (mediana do grupo comparável)
  fairPrice: number | null;    // preço justo estimado (expectedPm2 × área)
  discountPct: number | null;  // +% abaixo do esperado (positivo = barganha)
  basis: "bairro" | "tipo" | "cidade" | null; // base da comparação
  sample: number;              // nº de imóveis comparáveis
  confidence: number;          // 0–100, confiança nos dados (não é mérito)
}

export interface Poi {
  category: string;
  lat: number | null;
  lng: number | null;
}

export interface ScoreConfig {
  weights?: Weights;
  /** Linha de costa da cidade: lista de polilinhas [[lat,lng],...]. */
  coastline?: [number, number][][];
  pois?: Poi[];
}

// Distância (m) de um ponto até a linha de costa — até o SEGMENTO mais próximo
// (não só ao vértice), o que dá precisão mesmo com pontos espaçados. Usa
// projeção equirretangular local (boa em escala de cidade). null se sem costa.
export function coastlineDistanceM(
  lat: number,
  lng: number,
  coastline: [number, number][][] | undefined,
): number | null {
  if (!coastline?.length) return null;
  const mLat = 111_320;
  const mLng = 111_320 * Math.cos((lat * Math.PI) / 180);
  const px = lng * mLng, py = lat * mLat;
  let min = Infinity;
  for (const way of coastline) {
    for (let i = 1; i < way.length; i++) {
      const ax = way[i - 1][1] * mLng, ay = way[i - 1][0] * mLat;
      const bx = way[i][1] * mLng, by = way[i][0] * mLat;
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy;
      let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const cx = ax + t * dx, cy = ay + t * dy;
      const d = Math.hypot(px - cx, py - cy);
      if (d < min) min = d;
    }
  }
  return Number.isFinite(min) ? min : null;
}

export interface ScoredListing {
  id: string;
  score: number;
  factors: Record<ScoreFactor, number>;
  insight: ListingInsight;
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().trim();

const R = 6_371_000;
export function haversine(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) *
      Math.cos((bLat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

// distância ideal (m) e importância por categoria de POI
const DIST_IDEAL: Record<string, number> = {
  hospital: 2000,
  farmacia: 1000,
  escola: 1500,
  supermercado: 1000,
  saude: 1500,
  padaria: 800,
  banco: 1500,
  praca: 1000,
  academia: 1200,
};
const CAT_IMP: Record<string, number> = {
  hospital: 0.8,
  farmacia: 0.9,
  escola: 1.0,
  supermercado: 0.9,
  saude: 0.5,
  padaria: 0.4,
  banco: 0.35,
  praca: 0.4,
  academia: 0.35,
};

const GEO_SCORE: Record<string, number> = {
  endereco_completo: 100,
  rua: 80,
  cep: 60,
  bairro: 25,
  fallback: 10,
};

function normalizeWeights(w: Weights): Weights {
  const total = Object.values(w).reduce((a, b) => a + b, 0) || 1;
  const out = {} as Weights;
  (Object.keys(w) as ScoreFactor[]).forEach((k) => {
    out[k] = (w[k] / total) * 100;
  });
  return out;
}

/**
 * Calcula os scores para um conjunto de imóveis. Retorna ordenado (maior nota
 * primeiro). As notas de preço/área são relativas ao próprio conjunto.
 */
export function scoreListings(
  listings: ScorableListing[],
  config: ScoreConfig = {},
): ScoredListing[] {
  const w = normalizeWeights(config.weights ?? DEFAULT_WEIGHTS);
  const coastline = config.coastline ?? [];
  const pois = config.pois ?? [];

  const pm2s = listings
    .filter((d) => d.price && d.area_total_m2 && d.area_total_m2 > 0)
    .map((d) => d.price! / d.area_total_m2!);
  const minPM2 = pm2s.length ? Math.min(...pm2s) : 0;
  const maxPM2 = pm2s.length ? Math.max(...pm2s) : 1;

  const areas = listings
    .filter((d) => d.area_total_m2 && d.area_total_m2 > 0)
    .map((d) => d.area_total_m2!);
  const minA = areas.length ? Math.min(...areas) : 0;
  const maxA = areas.length ? Math.max(...areas) : 1;

  const byCat: Record<string, Poi[]> = {};
  pois.forEach((p) => {
    if (p.lat == null || p.lng == null) return;
    (byCat[p.category] ??= []).push(p);
  });

  // ── "preço justo": mediana de R$/m² por (bairro, tipo), por tipo e geral.
  // O desconto de cada imóvel é medido contra o grupo comparável mais
  // específico que tenha amostra suficiente. É o coração do fator "oferta".
  const MIN_SAMPLE = 5;
  const groups: Record<string, number[]> = {};
  const push = (k: string, v: number) => (groups[k] ??= []).push(v);
  listings.forEach((d) => {
    if (!d.price || !d.area_total_m2 || d.area_total_m2 <= 0) return;
    const pm2 = d.price / d.area_total_m2;
    push(`nt:${norm(d.neighborhood)}|${norm(d.type)}`, pm2);
    push(`t:${norm(d.type)}`, pm2);
    push("all", pm2);
  });
  const medianCache: Record<string, number> = {};
  const medOf = (k: string) => (medianCache[k] ??= median(groups[k] ?? []));
  function expectedPm2Of(d: ScorableListing): { value: number | null; basis: ListingInsight["basis"]; sample: number } {
    const kNT = `nt:${norm(d.neighborhood)}|${norm(d.type)}`;
    const kT = `t:${norm(d.type)}`;
    if ((groups[kNT]?.length ?? 0) >= MIN_SAMPLE) return { value: medOf(kNT), basis: "bairro", sample: groups[kNT].length };
    if ((groups[kT]?.length ?? 0) >= MIN_SAMPLE) return { value: medOf(kT), basis: "tipo", sample: groups[kT].length };
    if ((groups.all?.length ?? 0) > 0) return { value: medOf("all"), basis: "cidade", sample: groups.all.length };
    return { value: null, basis: null, sample: 0 };
  }

  const results = listings.map((d) => {
    // praia: distância até o segmento de costa mais próximo (satura em 5 km)
    let beach = 0;
    if (d.lat != null && d.lng != null && coastline.length) {
      const dist = coastlineDistanceM(d.lat, d.lng, coastline);
      if (dist != null) beach = Math.max(0, Math.min(100, 100 * (1 - dist / 5000)));
    }

    // POIs
    let poiScore = 0;
    let poiWeightTotal = 0;
    if (d.lat != null && d.lng != null) {
      Object.keys(DIST_IDEAL).forEach((cat) => {
        const imp = CAT_IMP[cat] ?? 0.5;
        poiWeightTotal += imp;
        const list = byCat[cat] ?? [];
        if (!list.length) return;
        let md = Infinity;
        list.forEach((p) => {
          const dist = haversine(d.lat!, d.lng!, p.lat!, p.lng!);
          if (dist < md) md = dist;
        });
        const cs = Math.max(0, 100 * (1 - md / (DIST_IDEAL[cat] * 2)));
        poiScore += cs * imp;
      });
    }
    const poi = poiWeightTotal > 0 ? poiScore / poiWeightTotal : 0;

    // preço/m²
    let pricePerM2 = 50;
    if (d.price && d.area_total_m2 && d.area_total_m2 > 0 && maxPM2 > minPM2) {
      const pm2 = d.price / d.area_total_m2;
      pricePerM2 = 100 * (1 - (pm2 - minPM2) / (maxPM2 - minPM2));
    }

    // geo
    const geoQuality = GEO_SCORE[d.geo_method ?? "fallback"] ?? 10;

    // área
    let area = 50;
    if (d.area_total_m2 && d.area_total_m2 > 0 && maxA > minA) {
      area = 100 * ((d.area_total_m2 - minA) / (maxA - minA));
    }

    // ── "oferta" (deal): preço vs. preço justo do grupo comparável ──
    const pm2 =
      d.price && d.area_total_m2 && d.area_total_m2 > 0 ? d.price / d.area_total_m2 : null;
    const exp = expectedPm2Of(d);
    const expectedPm2 = exp.value;
    const discountPct =
      pm2 != null && expectedPm2 != null && expectedPm2 > 0
        ? (expectedPm2 - pm2) / expectedPm2
        : null;
    // 50 = neutro (no preço esperado); −20% do esperado → 100; +20% → 0
    const deal = discountPct != null ? clamp(50 + discountPct * 250) : 50;
    const fairPrice =
      expectedPm2 != null && d.area_total_m2 && d.area_total_m2 > 0
        ? Math.round(expectedPm2 * d.area_total_m2)
        : null;

    // confiança do dado (NÃO é mérito — vira selo): geo + completude
    let confidence = GEO_SCORE[d.geo_method ?? "fallback"] ?? 10;
    if (!d.price) confidence -= 25;
    if (!d.area_total_m2) confidence -= 20;
    confidence = clamp(confidence);

    const insight: ListingInsight = {
      pm2: pm2 != null ? Math.round(pm2) : null,
      expectedPm2: expectedPm2 != null ? Math.round(expectedPm2) : null,
      fairPrice,
      discountPct,
      basis: exp.basis,
      sample: exp.sample,
      confidence,
    };

    const factors = { beach, poi, pricePerM2, geoQuality, area, deal };
    const score = Math.round(
      (beach * w.beach +
        poi * w.poi +
        pricePerM2 * w.pricePerM2 +
        geoQuality * w.geoQuality +
        area * w.area +
        deal * w.deal) /
        100,
    );

    return { id: d.id, score, factors, insight };
  });

  return results.sort((a, b) => b.score - a.score);
}
