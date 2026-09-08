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

// peso por categoria (compartilhado por Google e OSM)
export const CAT_WEIGHT: Record<string, number> = {
  escola: 3, farmacia: 3, supermercado: 3, hospital: 2.5,
  saude: 2, padaria: 1.5, banco: 1.2, praca: 1.2, academia: 1.2,
};

// ── OpenStreetMap / Overpass (grátis, cidade inteira em 1 consulta) ────
// Vários espelhos: se um estiver lento/fora, tenta o próximo (kumi costuma
// ser o mais rápido, então vem primeiro).
const OVERPASS_MIRRORS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

/**
 * Caixa robusta: usa percentis (2%–98%) em vez de min/max, para ignorar
 * imóveis com coordenada errada (outliers) que inflariam a bbox e fariam o
 * Overpass varrer meio país. Cai no min/max se houver poucos pontos.
 */
export function boundsRobust(
  points: { lat: number; lng: number }[],
  marginDeg = 0.03,
): { minLat: number; maxLat: number; minLng: number; maxLng: number } | null {
  const lats = points.map((p) => p.lat).filter((v) => v != null).sort((a, b) => a - b);
  const lngs = points.map((p) => p.lng).filter((v) => v != null).sort((a, b) => a - b);
  if (!lats.length) return null;
  const at = (arr: number[], p: number) =>
    arr[Math.min(arr.length - 1, Math.max(0, Math.round((arr.length - 1) * p)))];
  const lo = lats.length >= 20 ? 0.02 : 0;
  const hi = lats.length >= 20 ? 0.98 : 1;
  return {
    minLat: at(lats, lo) - marginDeg, maxLat: at(lats, hi) + marginDeg,
    minLng: at(lngs, lo) - marginDeg, maxLng: at(lngs, hi) + marginDeg,
  };
}

// tag OSM (chave=valor) → categoria normalizada
function osmCategory(tags: Record<string, string>): string | null {
  const a = tags.amenity, s = tags.shop, l = tags.leisure;
  if (a === "school" || a === "kindergarten" || a === "college" || a === "university") return "escola";
  if (a === "pharmacy") return "farmacia";
  if (a === "hospital") return "hospital";
  if (a === "clinic" || a === "doctors" || a === "health_post") return "saude";
  if (a === "bank") return "banco";
  if (s === "supermarket" || s === "grocery") return "supermercado";
  if (s === "bakery") return "padaria";
  if (l === "park" || l === "garden") return "praca";
  if (l === "fitness_centre" || l === "sports_centre" || a === "gym") return "academia";
  return null;
}

/** Monta a consulta Overpass que traz todos os comércios bons da bbox. */
export function overpassQuery(b: {
  minLat: number; minLng: number; maxLat: number; maxLng: number;
}): string {
  const bbox = `${b.minLat},${b.minLng},${b.maxLat},${b.maxLng}`;
  // node+way (sem relations — mais leve/rápido); relations quase não agregam POIs.
  const sel = [
    `nw["amenity"~"^(school|kindergarten|college|university|pharmacy|hospital|clinic|doctors|health_post|bank)$"](${bbox});`,
    `nw["shop"~"^(supermarket|grocery|bakery)$"](${bbox});`,
    `nw["leisure"~"^(park|garden|fitness_centre|sports_centre)$"](${bbox});`,
  ].join("\n  ");
  return `[out:json][timeout:25];\n(\n  ${sel}\n);\nout center tags;`;
}

interface OverpassEl {
  type: string;
  id: number;
  lat?: number; lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

async function overpassFetch(query: string, timeoutMs = 18_000): Promise<{ elements?: OverpassEl[] }> {
  let lastErr = "";
  for (const url of OVERPASS_MIRRORS) {
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), timeoutMs);
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(query),
        signal: c.signal,
      });
      clearTimeout(t);
      const text = await res.text();
      if (!res.ok) { lastErr = `HTTP ${res.status} em ${new URL(url).host}`; continue; }
      try {
        return JSON.parse(text) as { elements?: OverpassEl[] };
      } catch {
        lastErr = `resposta não-JSON de ${new URL(url).host}`;
        continue;
      }
    } catch (e) {
      lastErr = (e as Error).name === "AbortError" ? "tempo esgotado (Overpass lento)" : (e as Error).message;
    }
  }
  throw new Error("Overpass indisponível: " + lastErr);
}

/** Uma única chamada ao Overpass devolve a cidade toda (grátis). */
export async function collectPoisOsm(b: {
  minLat: number; minLng: number; maxLat: number; maxLng: number;
}): Promise<{ pois: CollectedPoi[]; requests: number }> {
  const query = overpassQuery(b);
  const data = await overpassFetch(query);
  const byId = new Map<string, CollectedPoi>();
  for (const el of data.elements ?? []) {
    const tags = el.tags ?? {};
    const category = osmCategory(tags);
    if (!category) continue;
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (lat == null || lng == null) continue;
    const pid = `${el.type[0]}${el.id}`; // n123 / w456
    if (byId.has(pid)) continue;
    byId.set(pid, {
      provider_id: pid,
      name: tags.name ?? null,
      category,
      gtype: tags.amenity ?? tags.shop ?? tags.leisure ?? "",
      lat, lng,
      rating: null,
      ratings_total: null,
      weight: CAT_WEIGHT[category] ?? 1,
    });
  }
  return { pois: [...byId.values()], requests: 1 };
}

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

/** Caixa (bbox) que contém os pontos, com uma margem em graus (~0.009 = 1 km). */
export function boundsOf(
  points: { lat: number; lng: number }[],
  marginDeg = 0.018,
): { minLat: number; maxLat: number; minLng: number; maxLng: number } | null {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const p of points) {
    if (p.lat == null || p.lng == null) continue;
    minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng); maxLng = Math.max(maxLng, p.lng);
  }
  if (!Number.isFinite(minLat)) return null;
  return {
    minLat: minLat - marginDeg, maxLat: maxLat + marginDeg,
    minLng: minLng - marginDeg, maxLng: maxLng + marginDeg,
  };
}

/** Preenche uma bbox inteira com centros de célula (cobre a região toda). */
export function bboxCells(
  b: { minLat: number; maxLat: number; minLng: number; maxLng: number },
  cell = CELL_DEG,
): { lat: number; lng: number }[] {
  const cells: { lat: number; lng: number }[] = [];
  for (let lat = b.minLat; lat <= b.maxLat; lat += cell) {
    for (let lng = b.minLng; lng <= b.maxLng; lng += cell) {
      cells.push({ lat: Math.round(lat / cell) * cell, lng: Math.round(lng / cell) * cell });
    }
  }
  return cells;
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
 * Coleta POIs nas células dadas. Deduplica por place_id.
 * Faz uma requisição por (célula × categoria). Respeita `maxCells`.
 */
export async function collectPois(
  cellsIn: { lat: number; lng: number }[],
  opts: { maxCells?: number } = {},
): Promise<{ pois: CollectedPoi[]; requests: number; cells: number }> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new Error("GOOGLE_MAPS_API_KEY não configurada.");

  let cells = cellsIn;
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
