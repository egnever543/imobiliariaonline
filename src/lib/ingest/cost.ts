// ── Estimativa de custo da extração por IA ────────────────────────────
// Preços em US$ por 1 milhão de tokens (Anthropic, first-party).

export const PRICES: Record<string, { in: number; out: number }> = {
  "claude-opus-5": { in: 5, out: 25 },
  "claude-opus-4-8": { in: 5, out: 25 },
  "claude-sonnet-5": { in: 2, out: 10 },
  "claude-haiku-4-5": { in: 1, out: 5 },
};

/** Custo estimado (US$) de uma quantidade de tokens em um modelo. */
export function estimateCostUSD(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const p = PRICES[model] ?? PRICES["claude-opus-5"];
  return (inputTokens / 1e6) * p.in + (outputTokens / 1e6) * p.out;
}
