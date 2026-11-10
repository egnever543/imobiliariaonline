"use client";

// Cadastro do cliente: cria a conta (Supabase Auth) e registra a cidade.
// A vinculação da cidade (onboard) roda assim que houver sessão — se o projeto
// exigir confirmação de e-mail, ela acontece no primeiro acesso a /conta.

import { useState } from "react";
import { getBrowserClient } from "@/lib/supabase/browser";

const input: React.CSSProperties = {
  width: "100%", padding: "11px 12px", borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border)", background: "var(--paper)", color: "var(--ink)", fontSize: 15,
};
const label: React.CSSProperties = { fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 5 };

export default function Cadastro() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [cidade, setCidade] = useState("");
  const [uf, setUf] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const sb = getBrowserClient();
    if (!sb) { setMsg("Cadastro ainda não configurado neste ambiente."); return; }
    setBusy(true); setMsg("");
    const { data, error } = await sb.auth.signUp({ email: email.trim(), password: senha });
    if (error) { setBusy(false); setMsg("Não foi possível cadastrar: " + error.message); return; }

    // guarda a cidade para vincular quando houver sessão (onboard)
    try {
      localStorage.setItem("pending_onboard", JSON.stringify({ city_name: cidade.trim(), state: uf.trim(), full_name: fullName.trim() }));
    } catch { /* ignora */ }

    // se já veio sessão (confirmação de e-mail desligada), vincula agora
    if (data.session?.access_token) {
      await fetch("/api/account/onboard", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${data.session.access_token}` },
        body: JSON.stringify({ city_name: cidade.trim(), state: uf.trim(), full_name: fullName.trim() }),
      }).catch(() => {});
      try { localStorage.removeItem("pending_onboard"); } catch { /* ignora */ }
      window.location.href = "/conta";
      return;
    }
    setBusy(false);
    setMsg("Conta criada! Confirme seu e-mail (se pedirmos) e depois entre para ver sua cidade.");
  }

  return (
    <main style={{ maxWidth: 440, margin: "0 auto", padding: "60px 24px 96px" }}>
      <a href="/" style={{ fontSize: 13, color: "var(--muted)" }}>← Radar Imobiliário</a>
      <h1 style={{ fontSize: 28, margin: "16px 0 4px" }}>Criar conta</h1>
      <p style={{ color: "var(--muted)", marginTop: 0, fontSize: 14 }}>
        Informe a sua cidade. Se ela já estiver na base, você já vê o mapa; se
        não, registramos o pedido e avisamos quando estiver pronta.
      </p>
      <form onSubmit={submit} className="card" style={{ padding: 20, display: "grid", gap: 14, marginTop: 16 }}>
        <div>
          <label style={label}>Nome</label>
          <input style={input} value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" />
        </div>
        <div>
          <label style={label}>E-mail</label>
          <input style={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </div>
        <div>
          <label style={label}>Senha</label>
          <input style={input} type="password" value={senha} onChange={(e) => setSenha(e.target.value)} required minLength={6} autoComplete="new-password" />
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={label}>Cidade</label>
            <input style={input} value={cidade} onChange={(e) => setCidade(e.target.value)} placeholder="Itapoá" required />
          </div>
          <div style={{ width: 90 }}>
            <label style={label}>UF</label>
            <input style={input} value={uf} onChange={(e) => setUf(e.target.value.toUpperCase().slice(0, 2))} placeholder="SC" maxLength={2} />
          </div>
        </div>
        <button className="btn" disabled={busy} type="submit">{busy ? "Criando…" : "Criar conta"}</button>
        {msg && <p style={{ fontSize: 13, color: msg.startsWith("Conta criada") ? "var(--ok)" : "var(--danger)", margin: 0 }}>{msg}</p>}
      </form>
      <p style={{ fontSize: 14, color: "var(--muted)", marginTop: 16 }}>
        Já tem conta? <a href="/entrar">Entrar</a>
      </p>
    </main>
  );
}
