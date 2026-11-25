"use client";

// Conectar o Canva (conta única da plataforma). Mostra o estado e o botão que
// inicia a autorização OAuth. Protegido pela senha do painel.

import { useEffect, useState, useCallback } from "react";
import Nav from "@/components/Nav";

interface Status { configured: boolean; hasRedirect: boolean; hasTemplate: boolean; connected: boolean }

export default function CanvaAdmin() {
  const [token, setToken] = useState("");
  const [st, setSt] = useState<Status | null>(null);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    setToken(localStorage.getItem("admin_token") ?? "");
    const q = new URLSearchParams(window.location.search).get("canva");
    if (q === "ok") setMsg("Canva conectado com sucesso.");
    if (q === "erro") setMsg("Não foi possível conectar o Canva. Tente de novo.");
  }, []);

  const load = useCallback(async (tok: string) => {
    if (!tok) return;
    const res = await fetch("/api/canva/status", { headers: { "x-admin-token": tok } });
    if (!res.ok) { setSt(null); return; }
    setSt(await res.json());
  }, []);
  useEffect(() => { if (token) load(token); }, [token, load]);

  function saveToken(v: string) { setToken(v); localStorage.setItem("admin_token", v); }

  const Row = ({ ok, label, hint }: { ok: boolean; label: string; hint?: string }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0" }}>
      <span style={{ width: 10, height: 10, borderRadius: 99, background: ok ? "var(--ok)" : "var(--danger)", flexShrink: 0 }} />
      <span style={{ fontSize: 14 }}>{label}</span>
      {!ok && hint && <span style={{ fontSize: 12, color: "var(--muted)" }}>· {hint}</span>}
    </div>
  );

  return (
    <>
      <Nav />
      <main style={{ maxWidth: 640, margin: "0 auto", padding: "40px 24px 96px" }}>
        <span className="chip">Painel</span>
        <h1 style={{ fontSize: 30, margin: "12px 0 4px" }}>Conectar Canva</h1>
        <p style={{ color: "var(--muted)", marginTop: 0, fontSize: 15 }}>
          Autorize o app Canva uma vez. O servidor passa a gerar as artes dos
          posts sozinho (autofill do brand template + export).
        </p>

        <div className="card" style={{ padding: 16, marginTop: 16 }}>
          <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 5 }}>Senha do painel (ADMIN_TOKEN)</label>
          <input type="password" value={token} onChange={(e) => saveToken(e.target.value)} placeholder="a mesma do servidor"
            style={{ width: "100%", padding: "9px 11px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "var(--paper)", color: "var(--ink)", fontSize: 14 }} />
        </div>

        {msg && <p style={{ marginTop: 12, fontSize: 14, color: msg.includes("sucesso") ? "var(--ok)" : "var(--danger)" }}>{msg}</p>}

        {st && (
          <div className="card" style={{ padding: 16, marginTop: 16 }}>
            <Row ok={st.configured} label="Credenciais do app (CLIENT_ID / SECRET)" hint="defina na Vercel" />
            <Row ok={st.hasRedirect} label="Redirect URI (CANVA_REDIRECT_URI)" hint="igual ao registrado no app Canva" />
            <Row ok={st.hasTemplate} label="Brand template (CANVA_BRAND_TEMPLATE_ID)" hint="o modelo da arte" />
            <Row ok={st.connected} label="Conta Canva autorizada" hint="clique em Conectar" />

            <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
              <a className="btn" href={token ? `/api/canva/connect?key=${encodeURIComponent(token)}` : undefined}
                aria-disabled={!st.configured || !token}
                style={{ opacity: st.configured && token ? 1 : 0.5, pointerEvents: st.configured && token ? "auto" : "none" }}>
                {st.connected ? "Reconectar Canva" : "Conectar Canva"}
              </a>
            </div>
            {st.connected && st.hasTemplate && (
              <p style={{ fontSize: 13, color: "var(--ok)", marginTop: 12 }}>
                Tudo pronto. No Marketing, o botão “Gerar arte” de cada post já produz a imagem real.
              </p>
            )}
          </div>
        )}
      </main>
    </>
  );
}
