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
import { geocode } from "./geocode";
import { fetchJsonLd } from "./jsonld";
import { estimateCostUSD } from "./cost";
import { enumerateFromSitemap } from "./sitemap";
import { normalizeWebsite } from "./url";
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
  /** Método usado: "jsonld" (grátis) ou "ai" (Jina + Claude). */
  via: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUSD: number;
}

// ── Enumeração de todos os anúncios de uma imobiliária ─────────────────
// Sitemap primeiro (completo); se vier pouco, cai na página de listagem.
export async function enumerateAgency(a: {
  website?: string | null;
  listingUrl?: string | null;
  keywords?: string[];
}): Promise<string[]> {
  let origin: string | null = null;
  if (a.website) origin = normalizeWebsite(a.website);
  else if (a.listingUrl) {
    try {
      origin = new URL(a.listingUrl).origin;
    } catch {
      origin = null;
    }
  }

  const urls = new Set<string>();
  if (origin) {
    for (const u of await enumerateFromSitemap(origin)) urls.add(u);
  }
  // fallback: página de listagem (primeira página) se o sitemap rendeu pouco
  if (urls.size < 3 && a.listingUrl) {
    try {
      const md = await fetchReadable(a.listingUrl);
      for (const u of extractListingLinks(md, {
        keywords: a.keywords,
        sameHostAs: a.listingUrl,
      }))
        urls.add(u);
    } catch {
      /* ignora */
    }
  }
  return [...urls];
}

export async function ingestOne(
  source: AgencySource,
  url: string,
  opts: { skipExisting?: boolean } = {},
): Promise<OneResult> {
  try {
    // pula anúncios já coletados (barato, para rodadas incrementais)
    if (opts.skipExisting) {
      const db = getServiceClient();
      const { data } = await db
        .from("listings")
        .select("id")
        .eq("source_url", url)
        .maybeSingle();
      if (data) {
        return {
          url,
          saved: false,
          via: "skip",
          model: "",
          inputTokens: 0,
          outputTokens: 0,
          estimatedCostUSD: 0,
        };
      }
    }

    // 1. Tenta JSON-LD (schema.org) direto do HTML — grátis e determinístico.
    let via = "jsonld";
    let listing = await fetchJsonLd(url);
    let model = "";
    let inputTokens = 0;
    let outputTokens = 0;

    // Filtro de qualidade: só confia no JSON-LD se veio preço, área e um bairro
    // de verdade (diferente da própria cidade). Senão, usa a IA.
    if (listing) {
      const cityName = (source.cityName ?? "").trim().toLowerCase();
      const bairro = (listing.neighborhood ?? "").trim().toLowerCase();
      const bomJsonLd =
        listing.price != null &&
        listing.area_total_m2 != null &&
        bairro.length > 0 &&
        bairro !== cityName;
      if (!bomJsonLd) listing = null;
    }

    // 2. Fallback: IA (Jina Reader + Claude).
    if (!listing) {
      via = "ai";
      const adMd = await fetchReadable(url);
      const r = await extractListing(adMd);
      listing = r.listing;
      model = r.model;
      inputTokens = r.inputTokens;
      outputTokens = r.outputTokens;
    }

    const estimatedCostUSD = estimateCostUSD(model, inputTokens, outputTokens);

    // registra o evento de uso (histórico de gastos) — não falha a coleta
    if (via === "ai" || via === "jsonld") {
      getServiceClient()
        .from("usage_events")
        .insert({
          via,
          model,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cost_usd: estimatedCostUSD,
        })
        .then(
          () => {},
          () => {},
        );
    }

    if (!listing) {
      return {
        url,
        saved: false,
        error: "não foi possível extrair (sem JSON-LD e IA sem retorno)",
        via,
        model,
        inputTokens,
        outputTokens,
        estimatedCostUSD,
      };
    }

    const canonical = normalizeListing(listing, source, url);
    canonical.raw = { via, ...canonical.raw };

    // geocodifica o endereço (não falha a coleta se não achar coordenadas)
    const geo = await geocode({
      street: listing.street,
      street_number: listing.street_number,
      neighborhood: listing.neighborhood,
      cityName: source.cityName,
      state: source.state,
    });
    if (geo) {
      canonical.lat = geo.lat;
      canonical.lng = geo.lng;
      canonical.geo_method = geo.method;
    }

    await saveListing(canonical);
    return { url, saved: true, via, model, inputTokens, outputTokens, estimatedCostUSD };
  } catch (err) {
    return {
      url,
      saved: false,
      error: (err as Error).message,
      via: "erro",
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
