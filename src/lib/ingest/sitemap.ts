// ── Enumeração de anúncios via sitemap ────────────────────────────────
// Muitos sites de imobiliária publicam um sitemap.xml (ou um índice de
// sitemaps) que lista TODOS os anúncios. É a forma mais completa e barata de
// descobrir o inventário inteiro de uma imobiliária de uma vez.

const AD_HINT =
  /(imovel|imoveis|terreno|casa|apartamento|sobrado|kitnet|cobertura|comercial|sala|galpao|chacara|sitio|lote|duplex)/i;
const JUNK =
  /(wa\.me|whatsapp|[?&]phone=|\/contato|tel:|mailto:|facebook\.com|instagram\.com|\/api\/|manifest\.json|\/amp\/|\/politica|\/sobre|\/blog|temporada|aluguel|alugar|\.(png|jpg|jpeg|webp|gif|css|js)(\?|$))/i;

/** Parece uma página de anúncio individual (tem código/id ou slug com número). */
function looksLikeDetail(u: string): boolean {
  return /-codigo-|\/codigo\/|[?&](codigo|id|ref|cod)=|\/imovel\/|-id-|\/\d{3,}(\/|$|\?)|-\d{3,}(-|\/|$|\?)/i.test(
    u,
  );
}

async function fetchText(url: string, timeoutMs = 12_000): Promise<string | null> {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), timeoutMs);
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; radar-imobiliario/0.1)" },
      signal: c.signal,
    });
    clearTimeout(t);
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

function locs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
}

/** Descobre as URLs de sitemap a partir do robots.txt e de caminhos comuns. */
async function sitemapUrls(origin: string): Promise<string[]> {
  const out = new Set<string>();
  const robots = await fetchText(`${origin}/robots.txt`, 8000);
  if (robots) {
    for (const m of robots.matchAll(/sitemap:\s*(\S+)/gi)) out.add(m[1].trim());
  }
  ["/sitemap.xml", "/sitemap_index.xml", "/sitemap-index.xml", "/sitemap/sitemap.xml"].forEach(
    (p) => out.add(origin + p),
  );
  return [...out];
}

/**
 * Enumera todas as URLs de anúncio de um site via sitemap.
 * Segue índices de sitemap (até um limite) e filtra URLs que parecem anúncio.
 */
export async function enumerateFromSitemap(
  origin: string,
  maxSitemaps = 30,
): Promise<string[]> {
  const seenMaps = new Set<string>();
  const queue = await sitemapUrls(origin);
  const ads = new Set<string>();

  while (queue.length && seenMaps.size < maxSitemaps) {
    const sm = queue.shift()!;
    if (seenMaps.has(sm)) continue;
    seenMaps.add(sm);
    const xml = await fetchText(sm);
    if (!xml) continue;

    const found = locs(xml);
    for (const u of found) {
      if (/\.xml(\.gz)?($|\?)/i.test(u)) {
        // é outro sitemap (índice) → enfileira
        if (!seenMaps.has(u)) queue.push(u);
      } else if (AD_HINT.test(u) && !JUNK.test(u) && looksLikeDetail(u)) {
        ads.add(u.replace(/#.*$/, ""));
      }
    }
  }
  return [...ads];
}
