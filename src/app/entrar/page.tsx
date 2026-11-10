"use client";

// Login do cliente (Supabase Auth · e-mail + senha).

import { useState } from "react";
import { getBrowserClient } from "@/lib/supabase/browser";

const input: React.CSSProperties = {
  width: "100%", padding: "11px 12px", borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border)", background: "var(--paper)", color: "var(--ink)", fontSize: 15,
};
const label: React.CSSProperties = { fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 5 };

export default function Entrar() {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const sb = getBrowserClient();
    if (!sb) { setMsg("Cadastro ainda não configurado neste ambiente."); return; }
    setBusy(true); setMsg("");
    const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password: senha });
    setBusy(false);
    if (error) { setMsg("Não foi possível entrar: " + error.message); return; }
    window.location.href = "/conta";
  }

  return (
    <main style={{ maxWidth: 400, margin: "0 auto", padding: "72px 24px 96px" }}>
      <a href="/" style={{ fontSize: 13, color: "var(--muted)" }}>← Radar Imobiliário</a>
      <h1 style={{ fontSize: 28, margin: "16px 0 4px" }}>Entrar</h1>
      <p style={{ color: "var(--muted)", marginTop: 0, fontSize: 14 }}>
        Acesse o mapa da sua cidade.
      </p>
      <form onSubmit={submit} className="card" style={{ padding: 20, display: "grid", gap: 14, marginTop: 16 }}>
        <div>
          <label style={label}>E-mail</label>
          <input style={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </div>
        <div>
          <label style={label}>Senha</label>
          <input style={input} type="password" value={senha} onChange={(e) => setSenha(e.target.value)} required autoComplete="current-password" />
        </div>
        <button className="btn" disabled={busy} type="submit">{busy ? "Entrando…" : "Entrar"}</button>
        {msg && <p style={{ fontSize: 13, color: "var(--danger)", margin: 0 }}>{msg}</p>}
      </form>
      <p style={{ fontSize: 14, color: "var(--muted)", marginTop: 16 }}>
        Ainda não tem conta? <a href="/cadastro">Cadastre-se</a>
      </p>
    </main>
  );
}
