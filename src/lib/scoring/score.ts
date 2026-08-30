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
}

export interface Poi {
  category: string;
  lat: number | null;
  lng: number | null;
}

export interface ScoreConfig {
  weights?: Weights;
  /** Linha de costa da cidade (opcional), para o fator "praia". */
  coastline?: [number, number][];
  pois?: Poi[];
}

export interface ScoredListing {
  id: string;
  score: number;
  factors: Record<ScoreFactor, number>;
}

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
};
const CAT_IMP: Record<string, number> = {
  hospital: 1.0,
  farmacia: 0.6,
  escola: 0.8,
  supermercado: 0.7,
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

  const results = listings.map((d) => {
    // praia
    let beach = 0;
    if (d.lat != null && d.lng != null && coastline.length) {
      const dist = Math.min(
        ...coastline.map((c) => haversine(d.lat!, d.lng!, c[0], c[1])),
      );
      beach = Math.max(0, Math.min(100, 100 * (1 - dist / 5000)));
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

    const factors = { beach, poi, pricePerM2, geoQuality, area };
    const score = Math.round(
      (beach * w.beach +
        poi * w.poi +
        pricePerM2 * w.pricePerM2 +
        geoQuality * w.geoQuality +
        area * w.area) /
        100,
    );

    return { id: d.id, score, factors };
  });

  return results.sort((a, b) => b.score - a.score);
}
