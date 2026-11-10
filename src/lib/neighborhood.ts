// Chave normalizada de bairro para unir diferenças só de FORMATAÇÃO entre sites
// (maiúsculas/minúsculas, acentos, espaços, pontuação). Ex.:
//   "Balneário Cambijú" e "Balneário Cambiju" → "balneario cambiju".
// NÃO une diferenças de palavra (de/do) nem "I" vs "II" — isso é proposital:
// essas distinções podem ser bairros diferentes.
export function normBairro(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ") // pontuação/símbolos → espaço
    .trim()
    .replace(/\s+/g, " ");
}

// Prefixos comuns de bairro que variam/abreviam entre sites. Usados só para
// ORDENAR por proximidade de nome (não para unir): "Bal. Itapema do Norte",
// "Balneário Itapema do Norte" e "Itapema do Norte" ficam lado a lado.
const BAIRRO_PREFIXOS = new Set([
  "balneario", "bal", "jardim", "jd", "residencial", "resid", "loteamento",
  "lot", "vila", "vl", "parque", "pq", "chacara", "chacaras", "nucleo",
  "conjunto", "cj", "condominio", "cond", "praia",
]);

/** Chave de ORDENAÇÃO: o nome sem os prefixos iniciais comuns. */
export function sortKeyBairro(name: string): string {
  const words = normBairro(name).split(" ").filter(Boolean);
  let i = 0;
  while (i < words.length - 1 && BAIRRO_PREFIXOS.has(words[i])) i++;
  return words.slice(i).join(" ");
}
