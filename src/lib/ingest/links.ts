// ── Extração de links de anúncio ──────────────────────────────────────
// Versão generalizada da lógica que rodava no nó "Extrair Imóveis1" do n8n.
// A partir do markdown de uma página de listagem, extrai as URLs que
// apontam para páginas de anúncio individuais, deduplicando.

const IMAGE_EXT = /\.(jpg|jpeg|png|webp|gif|svg|ico)(\?|$)/i;
const ROOT_ONLY = /^https?:\/\/[^/]+\/?$/i; // só o domínio, sem caminho

export interface ExtractLinksOptions {
  /**
   * Palavras que devem aparecer na URL para ela ser considerada um anúncio.
   * Ex: ['terreno', 'imovel', 'casa']. Vazio/omitido = não filtra por palavra.
   */
  keywords?: string[];
  /** Se informado, mantém só links do mesmo host da página de listagem. */
  sameHostAs?: string;
}

/**
 * Extrai e deduplica URLs de anúncio a partir do texto/markdown de uma
 * página de listagem.
 */
export function extractListingLinks(
  markdown: string,
  { keywords = [], sameHostAs }: ExtractLinksOptions = {},
): string[] {
  const text = (markdown || "").slice(0, 200_000);
  const seen = new Set<string>();
  const out: string[] = [];

  let host: string | null = null;
  if (sameHostAs) {
    try {
      host = new URL(sameHostAs).host;
    } catch {
      host = null;
    }
  }

  const lowered = keywords.map((k) => k.toLowerCase());

  // Casa tanto links markdown [texto](url) quanto URLs cruas.
  const urlRegex = /https?:\/\/[^\s)"'<>]+/g;
  let m: RegExpExecArray | null;
  while ((m = urlRegex.exec(text)) !== null) {
    let url = m[0].replace(/[.,);]+$/, ""); // tira pontuação final

    if (seen.has(url)) continue;
    if (IMAGE_EXT.test(url)) continue;
    if (ROOT_ONLY.test(url)) continue;

    if (host) {
      try {
        if (new URL(url).host !== host) continue;
      } catch {
        continue;
      }
    }

    if (lowered.length) {
      const u = url.toLowerCase();
      if (!lowered.some((k) => u.includes(k))) continue;
    }

    seen.add(url);
    out.push(url);
  }

  return out;
}
