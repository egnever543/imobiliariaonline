// ── Coleta de POIs (comércios/serviços) via Google Places ─────────────
// Objetivo: mapa de calor de valorização + "nota de vizinhança" por imóvel.
// Só comércio que faz diferença no dia a dia (escola, farmácia, mercado,
// saúde…). Para controlar custo, coletamos apenas EM VOLTA dos imóveis que já
// temos (agrupados numa grade), com passo de estimativa antes de gastar.

export interface CollectedPoi {
  provider_id: string;
  name: string | null;
  category: string;
  gtype: string;
  lat: number;
  lng: number;
  rating: number | null;
  ratings_total: number | null;
  weight: number;
}

// Categoria normalizada → tipos do Google + peso + se exige nota mínima.
// Essenciais (escola/farmácia/mercado/saúde) contam sempre; opcionais (comida,
// academia) só entram com nota boa — é o "só comércio bom" que você pediu.
interface CatDef {
  category: string;
  weight: number;
  gtypes: string[];
  requireGood?: boolean; // aplica filtro de nota
}
export const POI_CATEGORIES: CatDef[] = [
  { category: "escola", weight: 3, gtypes: ["school", "primary_school", "secondary_school"] },
  { category: "farmacia", weight: 3, gtypes: ["pharmacy", "drugstore"] },
  { category: "supermercado", weight: 3, gtypes: ["supermarket"] },
  { category: "hospital", weight: 2.5, gtypes: ["hospital"] },
  { category: "saude", weight: 2, gtypes: ["doctor"] },
  { category: "padaria", weight: 1.5, gtypes: ["bakery"], requireGood: true },
  { category: "banco", weight: 1.2, gtypes: ["bank"] },
  { category: "praca", weight: 1.2, gtypes: ["park"] },
  { category: "academia", weight: 1.2, gtypes: ["gym"], requireGood: true },
];

const NEARBY = "https://maps.googleapis.com/maps/api/place/nearbysearch/json";
const CELL_DEG = 0.0075;   // ~800 m — 1 célula de grade
const RADIUS_M = 750;      // raio da busca por célula
const MIN_RATING = 3.8;    // nota mínima p/ categorias "requireGood"
const MIN_VOTES = 5;

/** Agrupa coordenadas em células de grade e devolve o centro de cada célula. */
export function gridCells(
  points: { lat: number; lng: number }[],
  cell = CELL_DEG,
): { lat: number; lng: number }[] {
  const seen = new Map<string, { lat: number; lng: number }>();
  for (const p of points) {
    if (p.lat == null || p.lng == null) continue;
    const gy = Math.round(p.lat / cell);
    const gx = Math.round(p.lng / cell);
    const key = `${gy}:${gx}`;
    if (!seen.has(key)) seen.set(key, { lat: gy * cell, lng: gx * cell });
  }
  return [...seen.values()];
}

/** Estimativa (sem gastar): nº de requisições e custo aproximado. */
export function estimate(cells: number) {
  const requests = cells * POI_CATEGORIES.length;
  const costUSD = requests * 0.032; // Nearby Search: ~US$32/1000
  return { cells, categorias: POI_CATEGORIES.length, requests, costUSD };
}

async function nearby(
  key: string,
  lat: number,
  lng: number,
  gtype: string,
): Promise<GoogleResult[]> {
  const url =
    `${NEARBY}?location=${lat},${lng}&radius=${RADIUS_M}&type=${gtype}` +
    `&language=pt-BR&key=${key}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = (await res.json()) as { status: string; results?: GoogleResult[] };
    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") return [];
    return data.results ?? [];
  } catch {
    return [];
  }
}

interface GoogleResult {
  place_id: string;
  name?: string;
  rating?: number;
  user_ratings_total?: number;
  geometry?: { location?: { lat: number; lng: number } };
}

/**
 * Coleta POIs em volta das coordenadas dadas. Deduplica por place_id.
 * Faz uma requisição por (célula × categoria). Respeita `maxRequests`.
 */
export async function collectPois(
  points: { lat: number; lng: number }[],
  opts: { maxCells?: number } = {},
): Promise<{ pois: CollectedPoi[]; requests: number; cells: number }> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new Error("GOOGLE_MAPS_API_KEY não configurada.");

  let cells = gridCells(points);
  if (opts.maxCells && cells.length > opts.maxCells) cells = cells.slice(0, opts.maxCells);

  const byId = new Map<string, CollectedPoi>();
  let requests = 0;

  for (const c of cells) {
    for (const def of POI_CATEGORIES) {
      // uma requisição por tipo principal da categoria (o primeiro cobre bem)
      const gtype = def.gtypes[0];
      const results = await nearby(key, c.lat, c.lng, gtype);
      requests++;
      for (const r of results) {
        const loc = r.geometry?.location;
        if (!loc || !r.place_id) continue;
        if (def.requireGood) {
          if ((r.rating ?? 0) < MIN_RATING) continue;
          if ((r.user_ratings_total ?? 0) < MIN_VOTES) continue;
        }
        if (!byId.has(r.place_id)) {
          byId.set(r.place_id, {
            provider_id: r.place_id,
            name: r.name ?? null,
            category: def.category,
            gtype,
            lat: loc.lat,
            lng: loc.lng,
            rating: r.rating ?? null,
            ratings_total: r.user_ratings_total ?? null,
            weight: def.weight,
          });
        }
      }
    }
  }

  return { pois: [...byId.values()], requests, cells: cells.length };
}
