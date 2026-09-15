// ── Motivos automáticos ("por que essa nota") ─────────────────────────
// Gera 1–3 frases curtas explicando a avaliação de um imóvel, a partir do
// insight (preço justo), dos comércios por perto e da distância à praia.
// Usado no mapa e na página de Análise, para não duplicar a lógica.

import { haversine, coastlineDistanceM, type ListingInsight } from "./score";

const POI_LABEL: Record<string, string> = {
  escola: "escola", farmacia: "farmácia", supermercado: "mercado",
  hospital: "hospital", saude: "saúde", padaria: "padaria",
  banco: "banco", praca: "praça", academia: "academia",
};

export interface ReasonInput {
  lat: number | null;
  lng: number | null;
  insight: Pick<ListingInsight, "discountPct" | "basis">;
  pois?: { category: string; lat: number; lng: number }[];
  coastline?: [number, number][][];
  radiusM?: number; // raio para contar comércios (padrão 1200 m)
}

export function buildReasons(inp: ReasonInput): string[] {
  const out: string[] = [];
  const { insight: ins, lat, lng } = inp;
  const R = inp.radiusM ?? 1200;

  // 1) oferta vs. mercado
  if (ins.discountPct != null) {
    const pct = Math.round(Math.abs(ins.discountPct) * 100);
    const base = ins.basis === "bairro" ? "do bairro" : ins.basis === "tipo" ? "do tipo" : "da cidade";
    if (ins.discountPct > 0.03) out.push(`${pct}% abaixo do R$/m² médio ${base}`);
    else if (ins.discountPct < -0.03) out.push(`${pct}% acima do R$/m² médio ${base}`);
    else out.push(`no preço médio ${base}`);
  }

  // 2) comércio mais presente por perto
  if (lat != null && lng != null && inp.pois?.length) {
    const counts: Record<string, number> = {};
    for (const p of inp.pois) {
      if (haversine(lat, lng, p.lat, p.lng) <= R) {
        counts[p.category] = (counts[p.category] ?? 0) + 1;
      }
    }
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (top) out.push(`${top[1]} ${POI_LABEL[top[0]] ?? top[0]} num raio de ${(R / 1000).toLocaleString("pt-BR")} km`);
  }

  // 3) proximidade da praia (distância ao segmento de costa mais próximo)
  if (lat != null && lng != null && inp.coastline?.length) {
    const bd = coastlineDistanceM(lat, lng, inp.coastline);
    if (bd != null && bd < 1500) out.push(`praia a ~${bd < 1000 ? Math.round(bd) + " m" : (bd / 1000).toFixed(1) + " km"}`);
  }

  return out.slice(0, 3);
}
