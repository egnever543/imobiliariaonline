// ── Orquestrador da ingestão ──────────────────────────────────────────
// Reproduz, em código, o fluxo do n8n:
//   listagem (Jina) -> extrai links -> por anúncio: Jina -> IA -> normaliza
//   -> grava no Supabase (upsert) + snapshot de preço.
//
// Exposto em peças pequenas para o painel poder processar 1 anúncio por vez
// (evita o timeout de funções serverless da Vercel e dá barra de progresso).

import { fetchReadable } from "./jina";
import { extractListingLinks } from "./links";
import { extractListing } from "./extract";
import { normalizeListing } from "./normalize";
import { estimateCostUSD } from "./cost";
import { getServiceClient } from "../supabase/server";
import type { AgencySource, CanonicalListing } from "./types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Grava (upsert) um imóvel e registra um snapshot de preço. */
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

// ── 1. Descoberta de links (custo ZERO) ───────────────────────────────
export interface DiscoverResult {
  total: number;
  links: string[];
}

/**
 * Busca a página de listagem e devolve os links de anúncio (sem IA).
 * `limit` opcional corta a lista devolvida.
 */
export async function discoverLinks(
  source: AgencySource,
  limit?: number,
): Promise<DiscoverResult> {
  const md = await fetchReadable(source.listingUrl);
  let links = extractListingLinks(md, {
    keywords: source.keywords,
    sameHostAs: source.listingUrl,
  });
  const total = links.length;
  if (limit != null) links = links.slice(0, limit);
  return { total, links };
}

// ── 2. Coleta de UM anúncio (uma unidade de custo) ─────────────────────
export interface OneResult {
  url: string;
  saved: boolean;
  error?: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUSD: number;
}

export async function ingestOne(
  source: AgencySource,
  url: string,
): Promise<OneResult> {
  try {
    const adMd = await fetchReadable(url);
    const { listing, inputTokens, outputTokens, model } =
      await extractListing(adMd);
    const estimatedCostUSD = estimateCostUSD(model, inputTokens, outputTokens);

    if (!listing) {
      return {
        url,
        saved: false,
        error: "IA não devolveu JSON",
        model,
        inputTokens,
        outputTokens,
        estimatedCostUSD,
      };
    }
    await saveListing(normalizeListing(listing, source, url));
    return { url, saved: true, model, inputTokens, outputTokens, estimatedCostUSD };
  } catch (err) {
    return {
      url,
      saved: false,
      error: (err as Error).message,
      model: "",
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUSD: 0,
    };
  }
}

// ── 3. Coleta completa (usada pela CLI) ────────────────────────────────
export interface IngestResult {
  listingUrl: string;
  linksFound: number;
  processed: number;
  saved: number;
  errors: string[];
  inputTokens: number;
  outputTokens: number;
  estimatedCostUSD: number;
  dryRun: boolean;
}

export interface IngestOptions {
  delayMs?: number;
  limit?: number;
  dryRun?: boolean;
}

export async function ingestAgency(
  source: AgencySource,
  { delayMs = 1000, limit, dryRun = false }: IngestOptions = {},
): Promise<IngestResult> {
  const { total, links } = await discoverLinks(source, limit);
  const result: IngestResult = {
    listingUrl: source.listingUrl,
    linksFound: total,
    processed: 0,
    saved: 0,
    errors: [],
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUSD: 0,
    dryRun,
  };

  if (dryRun) return result; // custo zero

  for (const url of links) {
    const one = await ingestOne(source, url);
    result.processed++;
    result.inputTokens += one.inputTokens;
    result.outputTokens += one.outputTokens;
    result.estimatedCostUSD += one.estimatedCostUSD;
    if (one.saved) result.saved++;
    else if (one.error) result.errors.push(`${url} -> ${one.error}`);
    if (delayMs) await sleep(delayMs);
  }
  return result;
}
