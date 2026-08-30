// ── Orquestrador da ingestão ──────────────────────────────────────────
// Reproduz, em código, o fluxo do n8n:
//   listagem (Jina) -> extrai links -> por anúncio: Jina -> IA -> normaliza
//   -> grava no Supabase (upsert) + snapshot de preço.

import { fetchReadable } from "./jina";
import { extractListingLinks } from "./links";
import { extractListing } from "./extract";
import { normalizeListing } from "./normalize";
import { estimateCostUSD } from "./cost";
import { getServiceClient } from "../supabase/server";
import type { AgencySource, CanonicalListing } from "./types";

export interface IngestResult {
  listingUrl: string;
  linksFound: number;
  processed: number;
  saved: number;
  errors: string[];
  // contabilidade de custo da IA
  inputTokens: number;
  outputTokens: number;
  estimatedCostUSD: number;
  dryRun: boolean;
}

export interface IngestOptions {
  /** Pausa entre anúncios em ms (padrão 1s). */
  delayMs?: number;
  /** Máximo de anúncios a processar (proteção contra gasto acidental). */
  limit?: number;
  /**
   * Se true, NÃO chama a IA nem busca os anúncios: só lista quantos links
   * existem. Custo ZERO. Use para conferir o volume antes de gastar.
   */
  dryRun?: boolean;
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
  { delayMs = 1000, limit, dryRun = false }: IngestOptions = {},
): Promise<IngestResult> {
  const result: IngestResult = {
    listingUrl: source.listingUrl,
    linksFound: 0,
    processed: 0,
    saved: 0,
    errors: [],
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUSD: 0,
    dryRun,
  };

  // 1. Página de listagem -> markdown (barato/grátis)
  const listingMd = await fetchReadable(source.listingUrl);

  // 2. Extrai os links de anúncio
  let links = extractListingLinks(listingMd, {
    keywords: source.keywords,
    sameHostAs: source.listingUrl,
  });
  result.linksFound = links.length;
  if (limit != null) links = links.slice(0, limit);

  // Modo dry-run: para aqui. Nenhuma chamada de IA -> custo zero.
  if (dryRun) return result;

  // 3. Por anúncio: busca -> extrai (IA) -> normaliza -> grava
  let model = "";
  for (const url of links) {
    try {
      const adMd = await fetchReadable(url);
      const { listing, inputTokens, outputTokens, model: m } =
        await extractListing(adMd);
      result.processed++;
      result.inputTokens += inputTokens;
      result.outputTokens += outputTokens;
      model = m;
      if (!listing) {
        result.errors.push(`Sem JSON extraído: ${url}`);
        continue;
      }
      const canonical = normalizeListing(listing, source, url);
      await saveListing(canonical);
      result.saved++;
    } catch (err) {
      result.errors.push(`${url} -> ${(err as Error).message}`);
    }
    if (delayMs) await sleep(delayMs);
  }

  result.estimatedCostUSD = estimateCostUSD(
    model,
    result.inputTokens,
    result.outputTokens,
  );
  return result;
}
