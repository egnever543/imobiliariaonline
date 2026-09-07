// ── Descoberta de imobiliárias via Google Places ──────────────────────
// Usa a Places API (Text Search + Details) para achar imobiliárias de uma
// cidade e o site de cada uma. Requer GOOGLE_MAPS_API_KEY com a Places API
// habilitada.

export interface PlaceAgency {
  name: string;
  website: string | null;
  address: string | null;
  place_id: string;
}

export async function findAgencies(
  city: string,
  uf: string,
): Promise<PlaceAgency[]> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new Error("GOOGLE_MAPS_API_KEY não configurada.");

  const query = `imobiliárias em ${city} ${uf}`;
  const searchUrl =
    `https://maps.googleapis.com/maps/api/place/textsearch/json` +
    `?query=${encodeURIComponent(query)}&region=br&language=pt-BR&key=${key}`;

  const res = await fetch(searchUrl);
  const data = (await res.json()) as {
    status: string;
    error_message?: string;
    results?: { name: string; formatted_address?: string; place_id: string }[];
  };
  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new Error(
      `Google Places retornou ${data.status}${data.error_message ? " — " + data.error_message : ""}`,
    );
  }

  const results = (data.results ?? []).slice(0, 20);
  const out: PlaceAgency[] = [];
  for (const r of results) {
    let website: string | null = null;
    try {
      const detailsUrl =
        `https://maps.googleapis.com/maps/api/place/details/json` +
        `?place_id=${r.place_id}&fields=website&language=pt-BR&key=${key}`;
      const dres = await fetch(detailsUrl);
      const ddata = (await dres.json()) as { result?: { website?: string } };
      website = ddata.result?.website ?? null;
    } catch {
      /* segue sem site */
    }
    out.push({
      name: r.name,
      website,
      address: r.formatted_address ?? null,
      place_id: r.place_id,
    });
  }
  return out;
}
