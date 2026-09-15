// ── Auditoria de qualidade por IA ─────────────────────────────────────
// Lê o texto do anúncio + os campos que estão salvos e devolve, campo a
// campo, se está "ok" ou se deve "corrigir" (com o valor certo e a confiança).
// Reaproveita o Anthropic SDK, igual à extração.

import { llmComplete } from "./llm";

// Modelo do auditor: AUDIT_MODEL > EXTRACTION_MODEL > opus-5.
// Pode ser Claude ("claude-*") ou OpenAI ("gpt-5-nano" etc.) — o adapter
// (llm.ts) escolhe o provedor pelo id do modelo.
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

// Extrai o array JSON da resposta, tolerando cercas de código ou texto ao
// redor (modelos baratos às vezes "conversam" antes do JSON).
function parseVerdicts(raw: string): unknown {
  const s = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(s);
  } catch {
    const a = s.indexOf("[");
    const b = s.lastIndexOf("]");
    if (a >= 0 && b > a) {
      try { return JSON.parse(s.slice(a, b + 1)); } catch { /* desiste */ }
    }
    return null;
  }
}

/** Confere os campos salvos contra o texto do anúncio.
 *  `fields` limita quais campos conferir (menos campos = menos tokens). */
export async function auditListing(
  adText: string,
  current: Record<string, unknown>,
  fields: readonly AuditField[] = AUDIT_FIELDS,
): Promise<AuditResult> {
  const model = currentAuditModel();
  const use = fields.length ? fields : AUDIT_FIELDS;
  const fieldsJson = JSON.stringify(
    Object.fromEntries(use.map((f) => [f, current[f] ?? null])),
  );

  const res = await llmComplete({
    model,
    system: SYSTEM,
    maxTokens: 1500,
    user:
      `CAMPOS SALVOS:\n${fieldsJson}\n\n` +
      `TEXTO DO ANÚNCIO:\n${adText.slice(0, 14_000)}`,
  });

  const parsed = parseVerdicts(res.text);
  const allowed = new Set<string>(AUDIT_FIELDS);
  const verdicts: FieldVerdict[] = (Array.isArray(parsed) ? parsed : []).filter(
    (v): v is FieldVerdict =>
      !!v && allowed.has((v as FieldVerdict).field) &&
      ((v as FieldVerdict).status === "ok" || (v as FieldVerdict).status === "fix"),
  );

  return {
    verdicts,
    notes: "",
    model,
    inputTokens: res.inputTokens,
    outputTokens: res.outputTokens,
  };
}
