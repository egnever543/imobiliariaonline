// ── Proteção simples das rotas de administração ───────────────────────
// As rotas de coleta gastam API (IA) e escrevem no banco. Protegemos com um
// token compartilhado (ADMIN_TOKEN) enviado no header `x-admin-token`.
//
// É uma trava inicial para o MVP — será substituída por autenticação real
// (Supabase Auth) numa etapa seguinte.

export function isAuthorized(req: Request): boolean {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return false; // fail-closed: sem token configurado, nega tudo
  return req.headers.get("x-admin-token") === expected;
}

export function unauthorized(): Response {
  return new Response(
    JSON.stringify({ error: "Não autorizado. Verifique a senha do painel." }),
    { status: 401, headers: { "content-type": "application/json" } },
  );
}
