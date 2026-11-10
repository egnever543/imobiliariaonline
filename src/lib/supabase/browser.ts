"use client";

// ── Cliente Supabase (navegador) ──────────────────────────────────────
// Usa a chave ANÔNIMA (pública) só para autenticação (login/cadastro/sessão).
// NUNCA consulta tabelas de dados direto — o RLS bloqueia a chave pública e
// todo dado de imóvel é lido pelo servidor (service-role). Degrada em silêncio
// se o Supabase ainda não estiver configurado (retorna null).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

export function getBrowserClient(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null; // auth ainda não configurada
  cached = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return cached;
}

/** true quando as chaves públicas do Supabase estão presentes. */
export function authConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
