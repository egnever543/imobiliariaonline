// ── Auditoria de localização ──────────────────────────────────────────
// A IA lê o anúncio e extrai o endereço; o sistema geocodifica esse endereço
// e compara com as coordenadas salvas. Se o desvio passar de um limite (ou não
// houver coordenada), propõe o novo ponto (e os campos de endereço corrigidos).

import { llmComplete } from "./llm";
import { geocode } from "./geocode";

function auditModel(): string {
  return process.env.AUDIT_MODEL || process.env.EXTRACTION_MODEL || "claude-opus-5";
}

const SYSTEM_GEO = `Você extrai o ENDEREÇO de um anúncio de imóvel no Brasil.
Responda APENAS um objeto JSON válido, sem texto ao redor e sem cercas:
{"street": <rua/avenida ou null>, "street_number": <número ou null>, "neighborhood": <bairro ou null>, "cep": <CEP ou null>}
Nunca invente. Se o anúncio não trouxer o dado, use null.`;

function parseObj(raw: string): Record<string, unknown> | null {
  const s = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    const o = JSON.parse(s);
    return o && typeof o === "object" ? (o as Record<string, unknown>) : null;
  } catch {
    const a = s.indexOf("{");
    const b = s.lastIndexOf("}");
    if (a >= 0 && b > a) {
      try { return JSON.parse(s.slice(a, b + 1)); } catch { /* desiste */ }
    }
    return null;
  }
}

function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export interface GeoAuditResult {
  changes: Record<string, { from: unknown; to: unknown }>;
  info: {
    distanceM: number | null; // desvio em metros (null se não havia ponto salvo)
    from: { lat: number; lng: number } | null;
    to: { lat: number; lng: number };
    method: string;
    address: { street: string | null; street_number: string | null; neighborhood: string | null; cep: string | null };
  } | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
  error?: string;
}

/** Confere a localização de um imóvel contra o endereço do anúncio. */
export async function auditGeo(opts: {
  adText: string;
  current: Record<string, unknown>;
  cityName?: string | null;
  state?: string | null;
  thresholdM?: number;
}): Promise<GeoAuditResult> {
  const model = auditModel();
  const thresholdM = opts.thresholdM ?? 300;
  const cur = opts.current;

  // 1) IA extrai o endereço do anúncio
  let ai: Record<string, unknown> | null = null;
  let inputTokens = 0, outputTokens = 0;
  try {
    const res = await llmComplete({
      model, system: SYSTEM_GEO, maxTokens: 400,
      user: `ANÚNCIO:\n${opts.adText.slice(0, 14_000)}`,
    });
    inputTokens = res.inputTokens; outputTokens = res.outputTokens;
    ai = parseObj(res.text);
  } catch (e) {
    return { changes: {}, info: null, model, inputTokens, outputTokens, error: (e as Error).message };
  }

  // 2) melhor endereço: prioriza o que a IA achou, cai para o salvo
  const address = {
    street: str(ai?.street) ?? str(cur.street),
    street_number: str(ai?.street_number) ?? str(cur.street_number),
    neighborhood: str(ai?.neighborhood) ?? str(cur.neighborhood),
    cep: str(ai?.cep) ?? str(cur.cep),
  };
  if (!address.street && !address.neighborhood) {
    // sem nada geocodificável
    return { changes: {}, info: null, model, inputTokens, outputTokens };
  }

  // 3) geocodifica
  const geo = await geocode({
    street: address.street, street_number: address.street_number,
    neighborhood: address.neighborhood, cityName: opts.cityName, state: opts.state,
  });
  if (!geo) return { changes: {}, info: null, model, inputTokens, outputTokens };

  // 4) compara com o ponto salvo
  const curLat = typeof cur.lat === "number" ? (cur.lat as number) : null;
  const curLng = typeof cur.lng === "number" ? (cur.lng as number) : null;
  const distanceM = curLat != null && curLng != null ? haversineM(curLat, curLng, geo.lat, geo.lng) : null;

  const shouldFix = distanceM == null || distanceM > thresholdM;
  const info: GeoAuditResult["info"] = {
    distanceM, from: curLat != null && curLng != null ? { lat: curLat, lng: curLng } : null,
    to: { lat: geo.lat, lng: geo.lng }, method: geo.method, address,
  };
  if (!shouldFix) return { changes: {}, info, model, inputTokens, outputTokens };

  // 5) monta as correções (coordenadas + endereço que a IA corrigiu)
  const changes: GeoAuditResult["changes"] = {
    lat: { from: curLat, to: geo.lat },
    lng: { from: curLng, to: geo.lng },
    geo_method: { from: cur.geo_method ?? null, to: geo.method },
  };
  for (const f of ["street", "street_number", "neighborhood", "cep"] as const) {
    const to = address[f];
    const from = str(cur[f]);
    if (to && to !== from) changes[f] = { from, to };
  }
  return { changes, info, model, inputTokens, outputTokens };
}
