// ── Motivos automáticos ("por que essa nota") ─────────────────────────
// Gera 1–3 frases curtas explicando a avaliação de um imóvel, a partir do
// insight (preço justo), dos comércios por perto e da distância à praia.
// Usado no mapa e na página de Análise, para não duplicar a lógica.

import { haversine, beachDistanceM, type ListingInsight } from "./score";

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
  beaches?: [number, number][][]; // praias de areia (OSM natural=beach)
  declaredBeachM?: number | null; // distância do mar informada no anúncio
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

  // 3) proximidade da praia (anúncio → praia OSM → costa OSM)
  {
    const bd = beachDistanceM(lat, lng, {
      declaredM: inp.declaredBeachM, beaches: inp.beaches, coastline: inp.coastline,
    });
    if (bd.meters != null && bd.meters < 1500) {
      const txt = bd.meters < 1000 ? Math.round(bd.meters) + " m" : (bd.meters / 1000).toFixed(1) + " km";
      out.push(`praia a ~${txt}${bd.source === "anuncio" ? " (anúncio)" : ""}`);
    }
  }

  return out.slice(0, 3);
}
