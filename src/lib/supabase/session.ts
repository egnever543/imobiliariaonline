// ── Verificação de sessão no servidor ─────────────────────────────────
// As páginas do cliente mandam o access token (Bearer) nas chamadas de API.
// Aqui validamos esse token no Supabase e descobrimos quem é o usuário, sem
// expor service-role no front. Retorna null se o token for inválido/ausente.

import { createClient } from "@supabase/supabase-js";

export interface SessionUser {
  id: string;
  email: string | null;
}

export async function getUserFromRequest(req: Request): Promise<SessionUser | null> {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;

  const header = req.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : "";
  if (!token) return null;

  try {
    const client = createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.auth.getUser(token);
    if (error || !data?.user) return null;
    return { id: data.user.id, email: data.user.email ?? null };
  } catch {
    return null;
  }
}

export function unauthenticated(): Response {
  return Response.json({ error: "Faça login para continuar." }, { status: 401 });
}
