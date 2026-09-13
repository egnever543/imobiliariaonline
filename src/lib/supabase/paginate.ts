// ── Paginação (contorna o teto de 1.000 linhas do PostgREST) ──────────
// O Supabase/PostgREST devolve no máximo ~1.000 linhas por requisição,
// mesmo com .limit() maior. Este helper busca em páginas com .range() até
// trazer tudo (respeitando um teto de segurança).

interface PageResult<T> {
  data: T[] | null;
  error: unknown;
}

/**
 * Executa `makeQuery(from, to)` repetidamente (páginas de `pageSize`) e
 * concatena os resultados até acabar ou atingir `cap`.
 * `makeQuery` deve aplicar `.range(from, to)` na query.
 */
export async function selectAll<T>(
  makeQuery: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize = 1000,
  cap = 50000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < cap; from += pageSize) {
    const { data, error } = await makeQuery(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < pageSize) break;
  }
  return out;
}
