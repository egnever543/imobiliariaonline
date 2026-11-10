// Gera um slug de cidade no padrão "nome-uf" (ex.: "Itapoá", "SC" → "itapoa-sc").
export function citySlug(name: string, state?: string | null): string {
  const base = (name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const uf = (state ?? "").trim().toLowerCase().replace(/[^a-z]/g, "");
  return uf ? `${base}-${uf}` : base;
}
