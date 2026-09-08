// ── Geocodificação de endereços ───────────────────────────────────────
// Converte o endereço do imóvel em lat/lng. Usa a Google Geocoding API se
// GOOGLE_MAPS_API_KEY estiver definida; senão, cai no Nominatim (OpenStreetMap),
// que é gratuito (mas com limite de ~1 req/s).
//
// Blindagem contra pino em outra cidade: bairros como "Santa Terezinha" ou
// "Volta ao Mundo" existem em dezenas de cidades. Se o geocoder devolve um
// homônimo longe, o pino caía em outra cidade (até em outro estado). Por isso
// geocodificamos o CENTRO da cidade uma vez e rejeitamos qualquer coordenada a
// mais de MAX_KM dele.

export interface GeoResult {
  lat: number;
  lng: number;
  method: string; // endereco_completo | rua | bairro
}

export interface GeoInput {
  street?: string | null;
  street_number?: string | null;
  neighborhood?: string | null;
  cityName?: string | null;
  state?: string | null;
}

// Raio máximo aceitável a partir do centro da cidade. Cobre até municípios
// grandes; acima disso é quase certo homônimo em outra cidade.
const MAX_KM = 40;

// Gera candidatos de busca, do mais específico ao mais amplo. Tentamos um a
// um e devolvemos o primeiro que o geocoder reconhecer.
function buildQueries(input: GeoInput): { q: string; method: string }[] {
  const city = [input.cityName, input.state].filter(Boolean).join(" - ");
  const out: { q: string; method: string }[] = [];
  if (input.street) {
    const rua = [input.street, input.street_number].filter(Boolean).join(", ");
    out.push({
      q: [rua, input.neighborhood, city, "Brasil"].filter(Boolean).join(", "),
      method: input.street_number ? "endereco_completo" : "rua",
    });
  }
  if (input.neighborhood) {
    out.push({
      q: [input.neighborhood, city, "Brasil"].filter(Boolean).join(", "),
      method: "bairro",
    });
  }
  return out;
}

// Restringe a busca do Google ao país/estado/cidade (reduz homônimos na fonte).
function componentsFilter(input: GeoInput): string {
  const parts = ["country:BR"];
  if (input.state) parts.push(`administrative_area:${input.state}`);
  if (input.cityName) parts.push(`locality:${input.cityName}`);
  return parts.join("|");
}

async function geocodeGoogle(
  q: string,
  key: string,
  components?: string,
): Promise<[number, number] | null> {
  const params = new URLSearchParams({ address: q, key, region: "br" });
  if (components) params.set("components", components);
  const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params}`);
  if (!res.ok) return null;
  const data = (await res.json()) as {
    status: string;
    results?: { geometry: { location: { lat: number; lng: number } } }[];
  };
  const loc = data.results?.[0]?.geometry?.location;
  return loc ? [loc.lat, loc.lng] : null;
}

async function geocodeNominatim(q: string): Promise<[number, number] | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "radar-imobiliario/0.1 (contato via app)" },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { lat: string; lon: string }[];
  const hit = data?.[0];
  return hit ? [parseFloat(hit.lat), parseFloat(hit.lon)] : null;
}

// distância aproximada em km entre duas coordenadas (Haversine).
function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Centro da cidade, geocodificado uma vez e memoizado por cidade+estado.
const centerCache = new Map<string, [number, number] | null>();

async function cityCenter(
  input: GeoInput,
  key: string | undefined,
): Promise<[number, number] | null> {
  if (!input.cityName) return null;
  const cacheKey = `${input.cityName}|${input.state ?? ""}`;
  const cached = centerCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const q = [input.cityName, input.state, "Brasil"].filter(Boolean).join(", ");
  let center: [number, number] | null = null;
  try {
    center = key ? await geocodeGoogle(q, key, componentsFilter(input)) : await geocodeNominatim(q);
  } catch {
    center = null;
  }
  centerCache.set(cacheKey, center);
  return center;
}

/**
 * Geocodifica um endereço. Tenta do mais específico ao mais amplo e só aceita
 * uma coordenada que esteja dentro de MAX_KM do centro da cidade — evita que
 * um bairro homônimo em outra cidade contamine o mapa. Se o centro não puder
 * ser resolvido, aceita sem validar (não perde geocodificação boa).
 */
export async function geocode(input: GeoInput): Promise<GeoResult | null> {
  const queries = buildQueries(input);
  if (!queries.length) return null;

  const key = process.env.GOOGLE_MAPS_API_KEY;
  const components = componentsFilter(input);
  const center = await cityCenter(input, key);

  for (const { q, method } of queries) {
    try {
      const coords = key
        ? await geocodeGoogle(q, key, components)
        : await geocodeNominatim(q);
      if (!coords) continue;
      // rejeita coordenada longe do centro da cidade (homônimo em outra cidade)
      if (center && haversineKm(coords, center) > MAX_KM) continue;
      return { lat: coords[0], lng: coords[1], method };
    } catch {
      // tenta o próximo candidato
    }
  }
  return null;
}
