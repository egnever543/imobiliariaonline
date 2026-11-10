"use client";

// Solicitações de cidade dos clientes. Aprovar garante a cidade na base, cria
// a assinatura (trial) de quem pediu e marca "em captura" — depois é só ir em
// "Adicionar imóveis" e coletar a cidade.

import { useEffect, useState, useCallback } from "react";
import Nav from "@/components/Nav";

interface Req {
  id: string; city_name: string; state: string | null; slug: string | null;
  status: string; email: string | null; created_at: string;
}

const STATUS: Record<string, { txt: string; color: string }> = {
  pendente: { txt: "Pendente", color: "var(--warn)" },
  em_captura: { txt: "Em captura", color: "var(--accent)" },
  disponivel: { txt: "Disponível", color: "var(--ok)" },
  recusada: { txt: "Recusada", color: "var(--danger)" },
};

export default function Solicitacoes() {
  const [token, setToken] = useState("");
  const [reqs, setReqs] = useState<Req[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => { setToken(localStorage.getItem("admin_token") ?? ""); }, []);
  function saveToken(v: string) { setToken(v); localStorage.setItem("admin_token", v); }

  const load = useCallback(async (tok: string) => {
    if (!tok) return;
    setMsg("");
    const res = await fetch("/api/admin/city-requests", { headers: { "x-admin-token": tok } });
    if (!res.ok) { setMsg("Não autorizado — verifique a senha do painel."); return; }
    const json = await res.json();
    setReqs(json.requests ?? []);
  }, []);

  useEffect(() => { if (token) load(token); }, [token, load]);

  async function act(id: string, action: "approve" | "reject") {
    setBusy(true); setMsg("");
    try {
      const res = await fetch("/api/admin/city-requests", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-token": token },
        body: JSON.stringify({ id, action }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      if (action === "approve" && json.slug) {
        setMsg(`Cidade liberada e em captura. Agora colete em "Adicionar imóveis" (cidade: ${json.slug}).`);
      }
      await load(token);
    } catch (e) {
      setMsg("Erro: " + (e as Error).message);
    } finally { setBusy(false); }
  }

  const pendentes = reqs.filter((r) => r.status === "pendente");

  return (
    <>
      <Nav />
      <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 24px 96px" }}>
        <span className="chip">Painel</span>
        <h1 style={{ fontSize: 30, margin: "12px 0 4px" }}>Solicitações de cidade</h1>
        <p style={{ color: "var(--muted)", marginTop: 0, fontSize: 15 }}>
          Cidades pedidas por clientes que ainda não estão na base. Aprovar cria
          a cidade e a assinatura do cliente; depois você coleta os imóveis.
        </p>

        <div className="card" style={{ padding: 16, marginTop: 16 }}>
          <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 5 }}>Senha do painel (ADMIN_TOKEN)</label>
          <input type="password" value={token} onChange={(e) => saveToken(e.target.value)} placeholder="a mesma do servidor"
            style={{ width: "100%", padding: "9px 11px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "var(--paper)", color: "var(--ink)", fontSize: 14 }} />
        </div>

        {msg && <p style={{ marginTop: 12, fontSize: 14, color: "var(--muted)" }}>{msg}</p>}

        <section style={{ marginTop: 20 }}>
          <h2 style={{ fontSize: 16, margin: "0 0 10px" }}>
            Pendentes {pendentes.length > 0 && <span style={{ fontSize: 12, fontWeight: 700, color: "var(--on-accent)", background: "var(--warn)", borderRadius: 999, padding: "1px 8px" }}>{pendentes.length}</span>}
          </h2>
          {reqs.length === 0 ? (
            <div className="card" style={{ padding: 16, color: "var(--muted)", fontSize: 14 }}>Nenhuma solicitação.</div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {reqs.map((r) => {
                const st = STATUS[r.status] ?? { txt: r.status, color: "var(--muted)" };
                return (
                  <div key={r.id} className="card" style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700 }}>{r.city_name}{r.state ? " · " + r.state : ""}</div>
                      <div style={{ fontSize: 12.5, color: "var(--muted)" }}>{r.email ?? "—"} · <span style={{ color: st.color }}>{st.txt}</span></div>
                    </div>
                    {r.status === "pendente" && (
                      <div style={{ display: "flex", gap: 8 }}>
                        <button className="btn btn-ghost" style={{ padding: "6px 12px", fontSize: 13 }} disabled={busy} onClick={() => act(r.id, "reject")}>Recusar</button>
                        <button className="btn" style={{ padding: "6px 12px", fontSize: 13 }} disabled={busy} onClick={() => act(r.id, "approve")}>Aprovar</button>
                      </div>
                    )}
                    {r.status === "em_captura" && r.slug && (
                      <a href="/admin/coletar" className="btn btn-ghost" style={{ padding: "6px 12px", fontSize: 13 }}>Coletar</a>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </>
  );
}
