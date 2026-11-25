// GET /api/canva/status — estado da conexão Canva (admin). Protegido pela senha
// do painel. Mostra um PREVIEW do início de cada valor configurado (sem expor o
// segredo inteiro) e avisa se há espaço/quebra de linha colado junto.

import { isAuthorized, unauthorized } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase/server";
import { isConnected, canvaConfigured, canvaScopes } from "@/lib/canva";

export const runtime = "nodejs";

// start = começo do valor (limpo); len = tamanho real; ws = tem espaço/linha extra
function peek(v: string | undefined, keep: number, full = false) {
  if (!v) return null;
  const t = v.trim();
  return { start: full ? t : t.slice(0, keep), len: v.length, ws: v !== t };
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) return unauthorized();
  const connected = await isConnected(getServiceClient()).catch(() => false);
  return Response.json({
    configured: canvaConfigured(),
    hasRedirect: Boolean(process.env.CANVA_REDIRECT_URI),
    hasTemplate: Boolean(process.env.CANVA_BRAND_TEMPLATE_ID),
    connected,
    previews: {
      clientId: peek(process.env.CANVA_CLIENT_ID, 14),
      secret: process.env.CANVA_CLIENT_SECRET
        ? { start: process.env.CANVA_CLIENT_SECRET.trim().slice(0, 3), len: process.env.CANVA_CLIENT_SECRET.length, ws: process.env.CANVA_CLIENT_SECRET !== process.env.CANVA_CLIENT_SECRET.trim() }
        : null,
      redirect: peek(process.env.CANVA_REDIRECT_URI, 0, true),
      template: peek(process.env.CANVA_BRAND_TEMPLATE_ID, 0, true),
      scopes: canvaScopes(),
    },
  });
}
