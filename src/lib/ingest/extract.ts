// ── Extração estruturada por IA ───────────────────────────────────────
// Lê o texto de um anúncio e devolve os campos estruturados.
// Porta a lógica do nó OpenAI do n8n para o Anthropic SDK.

import Anthropic from "@anthropic-ai/sdk";
import type { ExtractedListing } from "./types";

// Modelo configurável. Padrão: claude-opus-5 (máxima qualidade).
// Para alto volume, defina EXTRACTION_MODEL=claude-haiku-4-5 (bem mais barato).
const MODEL = process.env.EXTRACTION_MODEL || "claude-opus-5";

const SYSTEM = `Você é um assistente especializado em extração de dados de anúncios de imóveis no Brasil.

Sua tarefa: ler o conteúdo de UM anúncio e devolver os dados em JSON.

Regras:
- Responda APENAS com um objeto JSON válido, sem texto ao redor e sem cercas de código.
- Converta preços para número puro (ex: "R$ 1.400.000,00" -> 1400000). Sem preço -> null.
- Converta metragens para número puro (ex: "180 m²" -> 180). Sem valor -> null.
- Se um campo não existir no anúncio, use null. Nunca invente dados.
- "type": normalize para Terreno, Casa, Apartamento, Comercial, Sítio, etc.
- "accepts_permuta": true se o anúncio menciona aceitar permuta/troca, senão false.

Formato exato do JSON:
{
  "title": string|null,
  "type": string|null,
  "price": number|null,
  "price_original": number|null,
  "area_total_m2": number|null,
  "frente_m": number|null,
  "comprimento_m": number|null,
  "neighborhood": string|null,
  "street": string|null,
  "street_number": string|null,
  "cep": string|null,
  "accepts_permuta": boolean|null,
  "description": string|null,
  "external_code": string|null
}`;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic(); // lê ANTHROPIC_API_KEY
  return client;
}

/** Remove cercas de código ```json ... ``` caso o modelo as inclua. */
function stripFences(s: string): string {
  return s
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
}

const EMPTY: ExtractedListing = {
  title: null,
  type: null,
  price: null,
  price_original: null,
  area_total_m2: null,
  frente_m: null,
  comprimento_m: null,
  neighborhood: null,
  street: null,
  street_number: null,
  cep: null,
  accepts_permuta: null,
  description: null,
  external_code: null,
};

/**
 * Extrai os campos estruturados do texto de um anúncio.
 * Retorna null se a IA não devolver um JSON parseável.
 */
export async function extractListing(
  adText: string,
): Promise<ExtractedListing | null> {
  const msg = await getClient().messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM,
    messages: [{ role: "user", content: adText.slice(0, 50_000) }],
  });

  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  try {
    const parsed = JSON.parse(stripFences(text)) as Partial<ExtractedListing>;
    return { ...EMPTY, ...parsed };
  } catch {
    return null;
  }
}
