// ── Fingerprint de site de imobiliária ────────────────────────────────
// Acessa a home do site e detecta a plataforma/CRM e como os dados de imóveis
// são servidos (HTML direto, JSON-LD, ou renderizado por JavaScript). Serve
// para a gente identificar padrões e escolher a melhor estratégia de leitura.

export interface Fingerprint {
  url: string;
  ok: boolean;
  status?: number;
  bytes?: number;
  platform: string; // jetimob | vista | imoview | tecimob | wordpress | react/next | desconhecido
  hasJsonLd: boolean;
  likelyJsRendered: boolean;
  candidateListingUrls: string[];
  error?: string;
}

// Assinaturas conhecidas (ordem importa: primeira que casar vence).
const PLATFORMS: [string, RegExp][] = [
  ["jetimob", /jetimob/i],
  ["vista", /vistahost|vista ?soft|vistasoft|\/vista\//i],
  ["imoview", /imoview/i],
  ["tecimob", /tecimob/i],
  ["union", /union\s?imob|unionsoft/i],
  ["imobibrasil", /imobibrasil/i],
  ["ingaia", /ingaia/i],
  ["wordpress", /wp-content|wp-json|wordpress/i],
  ["react/next", /__NEXT_DATA__|data-reactroot|_next\/static|__NUXT__/i],
];

const LISTING_HINT = /(imovel|imoveis|terreno|venda|comprar|aluguel|locacao|busca)/i;

export async function fingerprint(rawUrl: string): Promise<Fingerprint> {
  const base: Fingerprint = {
    url: rawUrl,
    ok: false,
    platform: "desconhecido",
    hasJsonLd: false,
    likelyJsRendered: false,
    candidateListingUrls: [],
  };

  let url = rawUrl;
  try {
    url = new URL(rawUrl).toString();
  } catch {
    return { ...base, error: "URL inválida" };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; radar-imobiliario/0.1; +https://vercel.app)",
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    const html = await res.text();
    base.ok = res.ok;
    base.status = res.status;
    base.bytes = html.length;

    // plataforma
    for (const [name, re] of PLATFORMS) {
      if (re.test(html)) {
        base.platform = name;
        break;
      }
    }

    // JSON-LD de imóvel
    base.hasJsonLd =
      /application\/ld\+json/i.test(html) &&
      /(RealEstate|Residence|Product|Offer|Apartment|House)/i.test(html);

    // links candidatos a listagem
    const host = new URL(url).host;
    const seen = new Set<string>();
    const links: string[] = [];
    const re = /href=["']([^"']+)["']/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null && links.length < 8) {
      let href = m[1];
      if (href.startsWith("/")) href = `https://${host}${href}`;
      if (!href.startsWith("http")) continue;
      if (!LISTING_HINT.test(href)) continue;
      if (/(manifest\.json|\/api\/|\/amp\/|wa\.me|whatsapp|[?&]phone=|tel:|mailto:|\.(png|jpg|css|js)(\?|$))/i.test(href)) continue;
      try {
        if (new URL(href).host !== host) continue;
      } catch {
        continue;
      }
      if (seen.has(href)) continue;
      seen.add(href);
      links.push(href);
    }
    base.candidateListingUrls = links;

    // heurística de "renderizado por JS": pouco texto + framework SPA e sem links
    const textish = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    base.likelyJsRendered =
      (/__NEXT_DATA__|data-reactroot|__NUXT__|ng-version/i.test(html) &&
        links.length === 0) ||
      textish.length < 800;

    return base;
  } catch (err) {
    return { ...base, error: (err as Error).message };
  }
}
