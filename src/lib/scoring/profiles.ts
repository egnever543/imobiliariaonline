// ── Perfis de ranking ─────────────────────────────────────────────────
// Portado do scoring.js original. Pesos não precisam somar 100 — são
// normalizados no cálculo.

export type ScoreFactor =
  | "beach"
  | "poi"
  | "pricePerM2"
  | "geoQuality"
  | "area"
  | "deal";

export type Weights = Record<ScoreFactor, number>;

export interface ScoreProfile {
  id: string;
  label: string;
  desc: string;
  weights: Weights;
}

export const SCORE_PROFILES: ScoreProfile[] = [
  {
    id: "investidor",
    label: "📈 Investidor",
    desc: "Oferta abaixo do mercado + praia e área",
    weights: { beach: 18, poi: 10, pricePerM2: 10, geoQuality: 5, area: 15, deal: 42 },
  },
  {
    id: "moradia",
    label: "🏠 Moradia",
    desc: "Infraestrutura, conveniência e bom preço",
    weights: { beach: 12, poi: 38, pricePerM2: 10, geoQuality: 8, area: 10, deal: 22 },
  },
  {
    id: "menor_custo",
    label: "💰 Menor custo",
    desc: "Prioriza menor preço por m²",
    weights: { beach: 8, poi: 20, pricePerM2: 42, geoQuality: 5, area: 5, deal: 20 },
  },
  {
    id: "custo_beneficio",
    label: "⚖️ Custo-benefício",
    desc: "Equilíbrio entre oferta, infra e preço",
    weights: { beach: 16, poi: 22, pricePerM2: 16, geoQuality: 8, area: 8, deal: 30 },
  },
];

export const DEFAULT_WEIGHTS: Weights = {
  beach: 22,
  poi: 22,
  pricePerM2: 16,
  geoQuality: 6,
  area: 7,
  deal: 27,
};
