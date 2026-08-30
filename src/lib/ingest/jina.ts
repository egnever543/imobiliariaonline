// ── Jina Reader ───────────────────────────────────────────────────────
// Busca uma URL através do r.jina.ai, que renderiza a página (mesmo sites
// em JavaScript) e devolve o conteúdo já em texto/markdown limpo.
// É o que substitui a necessidade de um navegador Playwright hospedado.

const JINA_BASE = "https://r.jina.ai/";

export interface FetchReadableOptions {
  /** Timeout em ms (padrão 30s). */
  timeoutMs?: number;
}

/**
 * Busca uma URL e devolve o texto limpo (markdown) via Jina Reader.
 * Lança em caso de erro de rede ou status HTTP não-OK.
 */
export async function fetchReadable(
  url: string,
  { timeoutMs = 30_000 }: FetchReadableOptions = {},
): Promise<string> {
  const headers: Record<string, string> = {
    // pede markdown, que preserva os links dos anúncios
    "X-Return-Format": "markdown",
  };
  const apiKey = process.env.JINA_API_KEY;
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(JINA_BASE + url, {
      headers,
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Jina Reader HTTP ${res.status} ao buscar ${url}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}
