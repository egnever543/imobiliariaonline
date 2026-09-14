// ── Adapter de LLM (multi-provedor) ───────────────────────────────────
// Uma função única para completar um prompt, escolhendo o provedor pelo id
// do modelo:
//   - "claude-*"        → Anthropic (SDK)
//   - "gpt-*", "o1..o4" → OpenAI (Chat Completions, via fetch — sem dep nova)
// Permite testar modelos baratos de outras empresas (ex.: gpt-5-nano) na
// auditoria sem trocar o resto do sistema.

import Anthropic from "@anthropic-ai/sdk";

export interface LlmResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export function providerOf(model: string): "openai" | "anthropic" {
  return /^(gpt-|o[1-4])/i.test(model) ? "openai" : "anthropic";
}

let anthropic: Anthropic | null = null;
function anthropicClient(): Anthropic {
  if (!anthropic) anthropic = new Anthropic(); // lê ANTHROPIC_API_KEY
  return anthropic;
}

/** Completa um prompt (system + user) e devolve o texto + uso de tokens. */
export async function llmComplete(opts: {
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<LlmResult> {
  const { model, system, user } = opts;
  const maxTokens = opts.maxTokens ?? 1500;

  if (providerOf(model) === "openai") {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OPENAI_API_KEY não configurada no servidor.");
    const base = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
    // Modelos de raciocínio (gpt-5/o-series) gastam tokens "pensando" antes de
    // responder. Se o teto for baixo, sobra 0 para a resposta e vem vazio.
    // Damos folga generosa e pedimos o menor esforço de raciocínio.
    const isReasoning = /^(gpt-5|o[1-4])/i.test(model);
    const body: Record<string, unknown> = {
      model,
      max_completion_tokens: Math.max(maxTokens, 4000),
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    };
    if (isReasoning) {
      body.reasoning_effort = process.env.OPENAI_REASONING_EFFORT || "low";
    }
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`OpenAI ${res.status}: ${t.slice(0, 300)}`);
    }
    const data = await res.json();
    const choice = data?.choices?.[0];
    const text = choice?.message?.content;
    if (!text || (typeof text === "string" && text.trim() === "")) {
      const fr = choice?.finish_reason ?? "?";
      const rt = data?.usage?.completion_tokens_details?.reasoning_tokens;
      throw new Error(
        `OpenAI devolveu resposta vazia (finish_reason=${fr}` +
          (rt != null ? `, reasoning_tokens=${rt}` : "") +
          `). Aumente OPENAI_REASONING_EFFORT/tokens ou tente outro modelo.`,
      );
    }
    return {
      text: typeof text === "string" ? text : "",
      inputTokens: data?.usage?.prompt_tokens ?? 0,
      outputTokens: data?.usage?.completion_tokens ?? 0,
    };
  }

  // Anthropic (Claude)
  const msg = await anthropicClient().messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
  });
  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return {
    text,
    inputTokens: msg.usage?.input_tokens ?? 0,
    outputTokens: msg.usage?.output_tokens ?? 0,
  };
}
