// POST /api/listings/geo — corrige a localização de um imóvel.
// Aceita coordenadas manuais (lat/lng) OU re-geocodifica a partir do endereço
// (possivelmente editado). Também salva os campos de endereço ajustados.

import { isAuthorized, unauthorized } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase/server";
import { geocode } from "@/lib/ingest/geocode";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  if (!isAuthorized(req)) return unauthorized();

  const b = await req.json().catch(() => null);
  if (!b?.id) return Response.json({ error: "Informe id." }, { status: 400 });

  const db = getServiceClient();
  const patch: Record<string, unknown> = {};
  for (const f of ["street", "street_number", "neighborhood", "cep"]) {
    if (f in b) patch[f] = b[f] || null;
  }

  let lat = typeof b.lat === "number" ? b.lat : null;
  let lng = typeof b.lng === "number" ? b.lng : null;
  let method = "manual";

  if (lat == null || lng == null) {
    const geo = await geocode({
      street: b.street,
      street_number: b.street_number,
      neighborhood: b.neighborhood,
      cityName: b.cityName,
      state: b.uf,
    });
    if (!geo) {
      // salva pelo menos os campos de endereço ajustados
      if (Object.keys(patch).length) {
        await db.from("listings").update(patch).eq("id", b.id);
      }
      return Response.json({
        ok: false,
        error:
          "Não foi possível geocodificar esse endereço. Ajuste o bairro/rua ou marque o ponto no mapa.",
      });
    }
    lat = geo.lat;
    lng = geo.lng;
    method = geo.method;
  }

  patch.lat = lat;
  patch.lng = lng;
  patch.geo_method = method;
  patch.updated_at = new Date().toISOString();

  const { error } = await db.from("listings").update(patch).eq("id", b.id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true, lat, lng, geo_method: method });
}
