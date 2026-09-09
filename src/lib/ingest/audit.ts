// ── Auditoria de qualidade por IA ─────────────────────────────────────
// Lê o texto do anúncio + os campos que estão salvos e devolve, campo a
// campo, se está "ok" ou se deve "corrigir" (com o valor certo e a confiança).
// Reaproveita o Anthropic SDK, igual à extração.

import Anthropic from "@anthropic-ai/sdk";

// Modelo do auditor: AUDIT_MODEL > EXTRACTION_MODEL > opus-5.
function currentAuditModel(): string {
  return process.env.AUDIT_MODEL || process.env.EXTRACTION_MODEL || "claude-opus-5";
}

// Campos que o auditor pode conferir/corrigir.
export const AUDIT_FIELDS = [
  "type", "price", "area_total_m2", "bedrooms", "bathrooms",
  "suites", "parking", "neighborhood", "is_launch", "accepts_permuta",
] as const;
export type AuditField = (typeof AUDIT_FIELDS)[number];

export interface FieldVerdict {
  field: AuditField;
  status: "ok" | "fix";
  value: string | number | boolean | null; // valor correto quando status = fix
  confidence: number; // 0..1
  reason: string;
}
export interface AuditResult {
  verdicts: FieldVerdict[];
  notes: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

const SYSTEM = `Você audita dados de anúncios de imóveis no Brasil. Recebe o TEXTO do anúncio e os CAMPOS já salvos no sistema. Sua tarefa: dizer, para cada campo, se o valor salvo bate com o anúncio.

Regras:
- Responda APENAS com um array JSON válido, sem texto ao redor e sem cercas de código.
- Um item por campo conferido. Formato de cada item:
  {"field": <nome>, "status": "ok"|"fix", "value": <valor correto ou null>, "confidence": <0 a 1>, "reason": <curto>}
- "ok" = o valor salvo condiz com o anúncio (ou o anúncio não permite afirmar o contrário).
- "fix" = o valor salvo está claramente ERRADO segundo o anúncio; então "value" traz o valor correto.
- Seja CONSERVADOR: só marque "fix" com evidência clara no texto. Na dúvida, "ok".
- Números puros (ex.: 530000, 180, 3). Preço em reais. "type": Terreno/Casa/Apartamento/Sobrado/Comercial/Sítio.
- Nunca invente. Se o anúncio não fala do campo, "status":"ok" e "value": o valor salvo.
- "confidence" reflete quão claro está no anúncio (1 = explícito; 0.5 = indício fraco).`;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

function stripFences(s: string): string {
  return s.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
}

/** Confere os campos salvos contra o texto do anúncio. */
export async function auditListing(
  adText: string,
  current: Record<string, unknown>,
): Promise<AuditResult> {
  const model = currentAuditModel();
  const fieldsJson = JSON.stringify(
    Object.fromEntries(AUDIT_FIELDS.map((f) => [f, current[f] ?? null])),
  );

  const msg = await getClient().messages.create({
    model,
    max_tokens: 1500,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content:
          `CAMPOS SALVOS:\n${fieldsJson}\n\n` +
          `TEXTO DO ANÚNCIO:\n${adText.slice(0, 14_000)}`,
      },
    ],
  });

  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  let verdicts: FieldVerdict[] = [];
  try {
    const parsed = JSON.parse(stripFences(text)) as FieldVerdict[];
    const allowed = new Set<string>(AUDIT_FIELDS);
    verdicts = (Array.isArray(parsed) ? parsed : []).filter(
      (v) => v && allowed.has(v.field) && (v.status === "ok" || v.status === "fix"),
    );
  } catch {
    verdicts = [];
  }

  return {
    verdicts,
    notes: "",
    model,
    inputTokens: msg.usage?.input_tokens ?? 0,
    outputTokens: msg.usage?.output_tokens ?? 0,
  };
}
