// ── Perfis de ranking ─────────────────────────────────────────────────
// Portado do scoring.js original. Pesos não precisam somar 100 — são
// normalizados no cálculo.

export type ScoreFactor =
  | "beach"
  | "poi"
  | "pricePerM2"
  | "geoQuality"
  | "area";

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
    desc: "Valorização e área grande",
    weights: { beach: 40, poi: 15, pricePerM2: 15, geoQuality: 5, area: 25 },
  },
  {
    id: "moradia",
    label: "🏠 Moradia",
    desc: "Infraestrutura e conveniência",
    weights: { beach: 15, poi: 40, pricePerM2: 25, geoQuality: 10, area: 10 },
  },
  {
    id: "menor_custo",
    label: "💰 Menor custo",
    desc: "Prioriza menor preço por m²",
    weights: { beach: 10, poi: 25, pricePerM2: 55, geoQuality: 5, area: 5 },
  },
  {
    id: "custo_beneficio",
    label: "⚖️ Custo-benefício",
    desc: "Equilíbrio entre todos os fatores",
    weights: { beach: 25, poi: 25, pricePerM2: 30, geoQuality: 10, area: 10 },
  },
];

export const DEFAULT_WEIGHTS: Weights = {
  beach: 35,
  poi: 25,
  pricePerM2: 25,
  geoQuality: 8,
  area: 7,
};
