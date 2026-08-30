// GET /api/health — verificação simples de que o app está no ar.
export const runtime = "nodejs";

export async function GET() {
  return Response.json({ ok: true, service: "radar-imobiliario" });
}
