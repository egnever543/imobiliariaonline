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

function buildQuery(input: GeoInput): { q: string; method: string } | null {
  const city = [input.cityName, input.state].filter(Boolean).join(" - ");
  if (input.street) {
    const rua = [input.street, input.street_number].filter(Boolean).join(", ");
    const q = [rua, input.neighborhood, city, "Brasil"].filter(Boolean).join(", ");
    return { q, method: input.street_number ? "endereco_completo" : "rua" };
  }
  if (input.neighborhood) {
    const q = [input.neighborhood, city, "Brasil"].filter(Boolean).join(", ");
    return { q, method: "bairro" };
  }
  return null;
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
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "radar-imobiliario/0.1 (contato via app)" },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { lat: string; lon: string }[];
  const hit = data?.[0];
  return hit ? [parseFloat(hit.lat), parseFloat(hit.lon)] : null;
}

/** Geocodifica um endereço. Retorna null se não houver dados suficientes. */
export async function geocode(input: GeoInput): Promise<GeoResult | null> {
  const built = buildQuery(input);
  if (!built) return null;

  const key = process.env.GOOGLE_MAPS_API_KEY;
  try {
    const coords = key
      ? await geocodeGoogle(built.q, key)
      : await geocodeNominatim(built.q);
    if (!coords) return null;
    return { lat: coords[0], lng: coords[1], method: built.method };
  } catch {
    return null;
  }
}
