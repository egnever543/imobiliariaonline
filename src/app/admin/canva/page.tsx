"use client";

// Conectar o Canva (conta única da plataforma). Mostra o estado e o botão que
// inicia a autorização OAuth. Protegido pela senha do painel.

import { useEffect, useState, useCallback } from "react";
import Nav from "@/components/Nav";

interface Peek { start: string; len: number; ws: boolean }
interface Status {
  configured: boolean; hasRedirect: boolean; hasTemplate: boolean; connected: boolean;
  previews?: { clientId: Peek | null; secret: Peek | null; redirect: Peek | null; template: Peek | null; scopes: string };
}

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

  const Row = ({ ok, label, hint, value, warn }: { ok: boolean; label: string; hint?: string; value?: string; warn?: boolean }) => (
    <div style={{ padding: "8px 0", borderTop: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ width: 10, height: 10, borderRadius: 99, background: ok ? "var(--ok)" : "var(--danger)", flexShrink: 0 }} />
        <span style={{ fontSize: 14 }}>{label}</span>
        {!ok && hint && <span style={{ fontSize: 12, color: "var(--muted)" }}>· {hint}</span>}
      </div>
      {value && (
        <div style={{ marginLeft: 20, marginTop: 4, fontSize: 12.5, color: "var(--muted)", fontFamily: "ui-monospace, monospace", wordBreak: "break-all" }}>
          {value}
          {warn && <span style={{ color: "var(--danger)", marginLeft: 8, fontFamily: "inherit" }}>⚠ tem espaço/quebra de linha extra — reescreva o valor limpo</span>}
        </div>
      )}
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
            <Row ok={st.configured && !!st.previews?.clientId} label="Client ID (CANVA_CLIENT_ID)" hint="defina na Vercel"
              value={st.previews?.clientId ? `${st.previews.clientId.start}…   (${st.previews.clientId.len} caracteres)` : undefined}
              warn={st.previews?.clientId?.ws} />
            <Row ok={st.configured && !!st.previews?.secret} label="Client Secret (CANVA_CLIENT_SECRET)" hint="defina na Vercel"
              value={st.previews?.secret ? `${st.previews.secret.start}…   (${st.previews.secret.len} caracteres)` : undefined}
              warn={st.previews?.secret?.ws} />
            <Row ok={st.hasRedirect} label="Redirect URI (CANVA_REDIRECT_URI)" hint="idêntico ao do app Canva"
              value={st.previews?.redirect?.start || undefined} warn={st.previews?.redirect?.ws} />
            <Row ok={st.hasTemplate} label="Brand template (CANVA_BRAND_TEMPLATE_ID)" hint="o modelo da arte"
              value={st.previews?.template?.start || undefined} warn={st.previews?.template?.ws} />
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
