// GET /api/canva/status — estado da conexão Canva (admin). Protegido pela senha
// do painel.

import { isAuthorized, unauthorized } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase/server";
import { isConnected, canvaConfigured } from "@/lib/canva";

export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!isAuthorized(req)) return unauthorized();
  const connected = await isConnected(getServiceClient()).catch(() => false);
  return Response.json({
    configured: canvaConfigured(),
    hasRedirect: Boolean(process.env.CANVA_REDIRECT_URI),
    hasTemplate: Boolean(process.env.CANVA_BRAND_TEMPLATE_ID),
    connected,
  });
}
