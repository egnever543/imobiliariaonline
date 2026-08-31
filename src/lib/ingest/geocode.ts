// ── Geocodificação de endereços ───────────────────────────────────────
// Converte o endereço do imóvel em lat/lng. Usa a Google Geocoding API se
// GOOGLE_MAPS_API_KEY estiver definida; senão, cai no Nominatim (OpenStreetMap),
// que é gratuito (mas com limite de ~1 req/s).

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

async function geocodeGoogle(q: string, key: string): Promise<[number, number] | null> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&key=${key}`;
  const res = await fetch(url);
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

/** Geocodifica um endereço. Tenta do mais específico ao mais amplo. */
export async function geocode(input: GeoInput): Promise<GeoResult | null> {
  const queries = buildQueries(input);
  if (!queries.length) return null;

  const key = process.env.GOOGLE_MAPS_API_KEY;
  for (const { q, method } of queries) {
    try {
      const coords = key
        ? await geocodeGoogle(q, key)
        : await geocodeNominatim(q);
      if (coords) return { lat: coords[0], lng: coords[1], method };
    } catch {
      // tenta o próximo candidato
    }
  }
  return null;
}
