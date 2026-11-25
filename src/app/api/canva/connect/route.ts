// GET /api/canva/connect?key=ADMIN_TOKEN — inicia o OAuth do Canva (conta única
// da plataforma). Gera PKCE + state, guarda em cookie e redireciona o admin
// para a tela de autorização do Canva. Ao voltar, /api/canva/callback salva o
// refresh token.

import { CANVA_AUTHORIZE_URL, canvaRedirectUri, canvaScopes, canvaConfigured, pkce } from "@/lib/canva";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get("key");
  if (!process.env.ADMIN_TOKEN || key !== process.env.ADMIN_TOKEN) {
    return new Response("Não autorizado.", { status: 401 });
  }
  if (!canvaConfigured() || !canvaRedirectUri()) {
    return new Response("Canva não configurado (CANVA_CLIENT_ID/SECRET/REDIRECT_URI).", { status: 400 });
  }

  const { verifier, challenge } = pkce();
  const state = Math.random().toString(36).slice(2) + Date.now().toString(36);

  const p = new URLSearchParams({
    response_type: "code",
    client_id: process.env.CANVA_CLIENT_ID!,
    redirect_uri: canvaRedirectUri(),
    scope: canvaScopes(),
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });

  const headers = new Headers({ Location: `${CANVA_AUTHORIZE_URL}?${p.toString()}` });
  const opts = "HttpOnly; Path=/; Max-Age=600; SameSite=Lax; Secure";
  headers.append("Set-Cookie", `canva_pkce=${verifier}; ${opts}`);
  headers.append("Set-Cookie", `canva_state=${state}; ${opts}`);
  return new Response(null, { status: 302, headers });
}
