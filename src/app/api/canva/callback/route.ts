// GET /api/canva/callback — fim do OAuth do Canva. Valida o state, troca o
// código por tokens e guarda o refresh token. Redireciona para /admin/canva.

import { exchangeCode, saveTokens } from "@/lib/canva";
import { getServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function cookies(h: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (h ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function redirect(to: string): Response {
  const headers = new Headers({ Location: to });
  headers.append("Set-Cookie", "canva_pkce=; Path=/; Max-Age=0");
  headers.append("Set-Cookie", "canva_state=; Path=/; Max-Age=0");
  return new Response(null, { status: 302, headers });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const c = cookies(req.headers.get("cookie"));

  if (!code || !state || !c.canva_state || state !== c.canva_state || !c.canva_pkce) {
    return redirect("/admin/canva?canva=erro");
  }
  try {
    const tokens = await exchangeCode(code, c.canva_pkce);
    await saveTokens(getServiceClient(), tokens);
  } catch {
    return redirect("/admin/canva?canva=erro");
  }
  return redirect("/admin/canva?canva=ok");
}
