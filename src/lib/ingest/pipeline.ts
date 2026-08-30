// ── Orquestrador da ingestão ──────────────────────────────────────────
// Reproduz, em código, o fluxo do n8n:
//   listagem (Jina) -> extrai links -> por anúncio: Jina -> IA -> normaliza
//   -> grava no Supabase (upsert) + snapshot de preço.

import { fetchReadable } from "./jina";
import { extractListingLinks } from "./links";
import { extractListing } from "./extract";
import { normalizeListing } from "./normalize";
import { getServiceClient } from "../supabase/server";
import type { AgencySource, CanonicalListing } from "./types";

export interface IngestResult {
  listingUrl: string;
  linksFound: number;
  processed: number;
  saved: number;
  errors: string[];
}

/** Executa uma pausa (para respeitar rate limits). */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Grava (upsert) um imóvel e registra um snapshot de preço.
 */
async function saveListing(listing: CanonicalListing): Promise<void> {
  const db = getServiceClient();

  const { data, error } = await db
    .from("listings")
    .upsert(
      { ...listing, last_seen_at: new Date().toISOString() },
      { onConflict: "source_url" },
    )
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  if (data?.id && listing.price != null) {
    await db.from("listing_snapshots").insert({
      listing_id: data.id,
      price: listing.price,
    });
  }
}

/**
 * Coleta todos os anúncios de uma imobiliária.
 * @param delayMs pausa entre anúncios (padrão 1s), para não sobrecarregar.
 */
export async function ingestAgency(
  source: AgencySource,
  { delayMs = 1000, limit }: { delayMs?: number; limit?: number } = {},
): Promise<IngestResult> {
  const result: IngestResult = {
    listingUrl: source.listingUrl,
    linksFound: 0,
    processed: 0,
    saved: 0,
    errors: [],
  };

  // 1. Página de listagem -> markdown
  const listingMd = await fetchReadable(source.listingUrl);

  // 2. Extrai os links de anúncio
  let links = extractListingLinks(listingMd, {
    keywords: source.keywords,
    sameHostAs: source.listingUrl,
  });
  result.linksFound = links.length;
  if (limit) links = links.slice(0, limit);

  // 3. Por anúncio: busca -> extrai -> normaliza -> grava
  for (const url of links) {
    try {
      const adMd = await fetchReadable(url);
      const extracted = await extractListing(adMd);
      result.processed++;
      if (!extracted) {
        result.errors.push(`Sem JSON extraído: ${url}`);
        continue;
      }
      const canonical = normalizeListing(extracted, source, url);
      await saveListing(canonical);
      result.saved++;
    } catch (err) {
      result.errors.push(`${url} -> ${(err as Error).message}`);
    }
    if (delayMs) await sleep(delayMs);
  }

  return result;
}
