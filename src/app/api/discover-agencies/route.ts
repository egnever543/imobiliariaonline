// POST /api/discover-agencies
// Descobre imobiliárias da cidade via Google Places, salva na tabela agencies
// e faz o fingerprint de cada site. Devolve um relatório dos padrões.

import { isAuthorized, unauthorized } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase/server";
import { findAgencies } from "@/lib/ingest/places";
import { fingerprint, type Fingerprint } from "@/lib/ingest/fingerprint";
import { normalizeWebsite } from "@/lib/ingest/url";

export const runtime = "nodejs";
export const maxDuration = 60;

interface ReportRow {
  name: string;
  website: string | null;
  address: string | null;
  fingerprint: Fingerprint | null;
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) return unauthorized();

  const b = await req.json().catch(() => null);
  if (!b?.citySlug) {
    return Response.json({ error: "Informe citySlug." }, { status: 400 });
  }

  const db = getServiceClient();

  // garante a cidade
  const { data: city, error: cityErr } = await db
    .from("cities")
    .upsert(
      { slug: b.citySlug, name: b.cityName ?? b.citySlug, state: b.uf ?? "" },
      { onConflict: "slug" },
    )
    .select("id")
    .single();
  if (cityErr || !city) {
    return Response.json({ error: cityErr?.message ?? "cidade" }, { status: 500 });
  }

  // Google Places
  let agencies;
  try {
    agencies = await findAgencies(b.cityName ?? b.citySlug, b.uf ?? "");
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }

  const report: ReportRow[] = [];
  let saved = 0;
  // limita o fingerprint para não estourar o tempo da função
  const withSite = agencies.filter((a) => a.website).slice(0, 12);
  const withoutSite = agencies.filter((a) => !a.website);

  for (const a of withSite) {
    const fp = await fingerprint(a.website!);
    // salva/atualiza a imobiliária
    const { error } = await db.from("agencies").upsert(
      {
        city_id: city.id,
        name: a.name,
        website: normalizeWebsite(a.website!),
        platform: fp.platform,
        listing_url: fp.candidateListingUrls[0] ?? null,
        google_place_id: a.place_id,
      },
      { onConflict: "city_id,website" },
    );
    if (!error) saved++;
    report.push({ name: a.name, website: a.website, address: a.address, fingerprint: fp });
  }

  // as sem site também entram no relatório (sem fingerprint)
  for (const a of withoutSite) {
    report.push({ name: a.name, website: null, address: a.address, fingerprint: null });
  }

  // resumo por plataforma
  const byPlatform: Record<string, number> = {};
  report.forEach((r) => {
    if (r.fingerprint) {
      byPlatform[r.fingerprint.platform] =
        (byPlatform[r.fingerprint.platform] ?? 0) + 1;
    }
  });

  return Response.json({
    city: b.citySlug,
    found: agencies.length,
    withSite: withSite.length,
    savedAgencies: saved,
    byPlatform,
    report,
  });
}
