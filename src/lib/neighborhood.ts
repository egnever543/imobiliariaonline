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
