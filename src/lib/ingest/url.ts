// ── Normalização de endereço de site ──────────────────────────────────
// Garante uma chave única e estável por imobiliária: força https, remove
// "www." e a barra final. Evita duplicatas do tipo http/https/www.

export function normalizeWebsite(raw: string): string {
  try {
    const u = new URL(raw);
    const host = u.host.replace(/^www\./i, "").toLowerCase();
    return `https://${host}`;
  } catch {
    return raw;
  }
}
