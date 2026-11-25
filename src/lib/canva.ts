// ── Integração Canva (Connect API) ────────────────────────────────────
// Modelo de CONTA ÚNICA da plataforma: você autoriza o app uma vez (OAuth),
// o servidor guarda o refresh token e gera/renova access tokens sozinho.
// NUNCA importar no front-end.
//
// Variáveis de ambiente (defina na Vercel):
//   CANVA_CLIENT_ID, CANVA_CLIENT_SECRET
//   CANVA_REDIRECT_URI     (ex.: https://SEU_APP/api/canva/callback — igual ao do app)
//   CANVA_BRAND_TEMPLATE_ID (o modelo da arte)
//   CANVA_SCOPES           (opcional; um padrão sensato é usado se vazio)

import crypto from "crypto";
import type { getServiceClient } from "@/lib/supabase/server";

type DB = ReturnType<typeof getServiceClient>;

const API = "https://api.canva.com/rest/v1";
export const CANVA_AUTHORIZE_URL = "https://www.canva.com/api/oauth/authorize";

export function canvaScopes(): string {
  return (
    process.env.CANVA_SCOPES ||
    "design:content:read design:content:write design:meta:read asset:read asset:write brand_template:meta:read"
  );
}
export function canvaRedirectUri(): string {
  return process.env.CANVA_REDIRECT_URI || "";
}
export function canvaConfigured(): boolean {
  return Boolean(process.env.CANVA_CLIENT_ID && process.env.CANVA_CLIENT_SECRET);
}

function basicAuth(): string {
  const id = process.env.CANVA_CLIENT_ID, secret = process.env.CANVA_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Canva não configurado (CANVA_CLIENT_ID / CANVA_CLIENT_SECRET).");
  return "Basic " + Buffer.from(`${id}:${secret}`).toString("base64");
}

export function base64url(b: Buffer): string {
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
/** Par PKCE (verifier + challenge S256) para o fluxo de autorização. */
export function pkce(): { verifier: string; challenge: string } {
  const verifier = base64url(crypto.randomBytes(48));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

interface TokenResp { access_token: string; refresh_token: string; expires_in: number }

/** Troca o código de autorização por tokens (fim do fluxo OAuth). */
export async function exchangeCode(code: string, codeVerifier: string): Promise<TokenResp> {
  const body = new URLSearchParams({
    grant_type: "authorization_code", code, code_verifier: codeVerifier, redirect_uri: canvaRedirectUri(),
  });
  const res = await fetch(`${API}/oauth/token`, {
    method: "POST",
    headers: { authorization: basicAuth(), "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error("Falha ao trocar código Canva: " + (await res.text()));
  return res.json();
}

async function refreshToken(refresh: string): Promise<TokenResp> {
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh });
  const res = await fetch(`${API}/oauth/token`, {
    method: "POST",
    headers: { authorization: basicAuth(), "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error("Falha ao renovar token Canva: " + (await res.text()));
  return res.json();
}

export async function saveTokens(db: DB, t: TokenResp): Promise<void> {
  await db.from("canva_tokens").upsert({
    id: "org", access_token: t.access_token, refresh_token: t.refresh_token,
    expires_at: new Date(Date.now() + (t.expires_in - 60) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: "id" });
}

export async function isConnected(db: DB): Promise<boolean> {
  const { data } = await db.from("canva_tokens").select("id").eq("id", "org").maybeSingle();
  return Boolean(data);
}

/** Access token válido (renova pelo refresh quando necessário). */
export async function getAccessToken(db: DB): Promise<string> {
  const { data } = await db.from("canva_tokens").select("*").eq("id", "org").maybeSingle();
  const row = data as { access_token?: string; refresh_token?: string; expires_at?: string } | null;
  if (!row?.refresh_token) throw new Error("Canva não conectado. Conecte no painel (Conectar Canva).");
  if (row.access_token && row.expires_at && new Date(row.expires_at) > new Date()) return row.access_token;
  const t = await refreshToken(row.refresh_token);
  await saveTokens(db, t);
  return t.access_token;
}

// ── Chamadas da API (Bearer) ──────────────────────────────────────────
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function apiGet(token: string, path: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Canva GET ${path}: ${await res.text()}`);
  return res.json();
}
async function apiPost(token: string, path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Canva POST ${path}: ${await res.text()}`);
  return res.json();
}

interface Job { id: string; status: string; error?: { message?: string }; [k: string]: unknown }

/** Espera um job assíncrono do Canva terminar (success|failed). */
async function pollJob(token: string, pathBase: string, jobId: string, tries = 40, delayMs = 1500): Promise<Job> {
  for (let i = 0; i < tries; i++) {
    const j = (await apiGet(token, `${pathBase}/${jobId}`)).job as Job;
    if (j?.status === "success") return j;
    if (j?.status === "failed") throw new Error(j.error?.message || "Canva: job falhou.");
    await sleep(delayMs);
  }
  throw new Error("Canva: tempo esgotado esperando o job.");
}

/** Importa uma imagem por URL e devolve o asset_id. */
export async function importAssetFromUrl(token: string, url: string, name: string): Promise<string> {
  const created = (await apiPost(token, "/url-asset-uploads", { name: name.slice(0, 255), url })).job as Job;
  const done = await pollJob(token, "/url-asset-uploads", created.id);
  const asset = done.asset as { id?: string } | undefined;
  if (!asset?.id) throw new Error("Canva: upload de imagem sem asset_id.");
  return asset.id;
}

/** Campos do brand template (nome → tipo), para montar o autofill certo. */
export async function getTemplateDataset(token: string, templateId: string): Promise<Record<string, { type: string }>> {
  const j = await apiGet(token, `/brand-templates/${templateId}/dataset`);
  return (j.dataset as Record<string, { type: string }>) ?? {};
}

export type AutofillData = Record<string, { type: "text"; text: string } | { type: "image"; asset_id: string }>;

/** Preenche o brand template e devolve o design_id. */
export async function autofillDesign(token: string, templateId: string, data: AutofillData, title?: string): Promise<string> {
  const created = (await apiPost(token, "/autofills", {
    type: "create_from_brand_template", brand_template_id: templateId, title, data,
  })).job as Job;
  const done = await pollJob(token, "/autofills", created.id);
  const result = done.result as { design?: { id?: string } } | undefined;
  if (!result?.design?.id) throw new Error("Canva: autofill sem design_id.");
  return result.design.id;
}

/** Exporta o design em PNG e devolve a URL do arquivo (expira em 24h). */
export async function exportPng(token: string, designId: string): Promise<string> {
  const created = (await apiPost(token, "/exports", { design_id: designId, format: { type: "png" } })).job as Job;
  const done = await pollJob(token, "/exports", created.id);
  const urls = done.urls as string[] | undefined;
  if (!urls?.length) throw new Error("Canva: export sem URL.");
  return urls[0];
}
