"use client";

// ── Auditoria por IA ──────────────────────────────────────────────────
// Confere os campos de cada imóvel contra o anúncio e corrige o que estiver
// errado. Roda um imóvel por vez, mostrando progresso e custo ao vivo.

import { useEffect, useRef, useState } from "react";
import Nav from "@/components/Nav";

const box: React.CSSProperties = {
  background: "var(--paper)", border: "1px solid var(--border)",
  borderRadius: "var(--radius)", padding: 20, boxShadow: "var(--shadow-sm)",
};
const input: React.CSSProperties = {
  width: "100%", padding: "9px 11px", borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border)", background: "var(--paper)", color: "var(--ink)", fontSize: 14,
};
const label: React.CSSProperties = { fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 };

interface Change { from: unknown; to: unknown }
interface Row {
  id: string; title: string | null;
  changes: Record<string, Change>; applied: boolean; cost: number; error?: string;
}
const fmt = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));

export default function Auditoria() {
  const [token, setToken] = useState("");
  const [limit, setLimit] = useState(20);
  const [model, setModel] = useState("claude-haiku-4-5");
  const [minConf, setMinConf] = useState(0.8);
  const [apply, setApply] = useState(false);

  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [cost, setCost] = useState(0);
  const [fixes, setFixes] = useState(0);
  const [rows, setRows] = useState<Row[]>([]);
  const [msg, setMsg] = useState("");
  const abort = useRef(false);

  useEffect(() => { setToken(localStorage.getItem("admin_token") ?? ""); }, []);
  function saveToken(v: string) { setToken(v); localStorage.setItem("admin_token", v); }
  function headers() { return { "content-type": "application/json", "x-admin-token": token }; }

  async function post(payload: object) {
    const res = await fetch("/api/audit", { method: "POST", headers: headers(), body: JSON.stringify(payload) });
    const text = await res.text();
    let data: Record<string, unknown> = {};
    try { data = text ? JSON.parse(text) : {}; } catch {}
    if (!res.ok) throw new Error((data.error as string) ?? `HTTP ${res.status}`);
    return data;
  }

  async function run() {
    abort.current = false;
    setRunning(true); setDone(0); setCost(0); setFixes(0); setRows([]); setMsg("");
    try {
      const list = await post({ list: true, limit });
      const items = (list.listings as { id: string; title: string | null }[]) ?? [];
      setTotal(items.length);
      for (const it of items) {
        if (abort.current) { setMsg("⏹ Interrompido."); break; }
        try {
          const r = await post({ listingId: it.id, apply, minConfidence: minConf, model });
          const changes = (r.changes as Record<string, Change>) ?? {};
          const nFix = Object.keys(changes).length;
          setCost((c) => c + ((r.estimatedCostUSD as number) || 0));
          setFixes((f) => f + nFix);
          if (nFix > 0) {
            setRows((rs) => [{ id: it.id, title: (r.title as string) ?? it.title, changes, applied: !!r.applied, cost: (r.estimatedCostUSD as number) || 0 }, ...rs]);
          }
        } catch (e) {
          setRows((rs) => [{ id: it.id, title: it.title, changes: {}, applied: false, cost: 0, error: (e as Error).message }, ...rs]);
        }
        setDone((n) => n + 1);
        await new Promise((r) => setTimeout(r, 250));
      }
    } catch (e) {
      setMsg("Erro: " + (e as Error).message);
    } finally { setRunning(false); }
  }

  const pct = total ? Math.round((done / total) * 100) : 0;

  return (
    <>
      <Nav />
      <main style={{ maxWidth: 780, margin: "0 auto", padding: "40px 24px 96px" }}>
        <span className="chip">Painel</span>
        <h1 style={{ fontSize: 30, margin: "12px 0 4px" }}>Auditoria por IA</h1>
        <p style={{ color: "var(--muted)", marginTop: 0, fontSize: 15 }}>
          A IA lê cada anúncio, compara com os dados salvos e corrige o que
          estiver errado. Custa por imóvel — comece com poucos.
        </p>

        <div style={{ ...box, marginTop: 20, display: "grid", gap: 12 }}>
          <div>
            <label style={label}>Senha do painel (ADMIN_TOKEN)</label>
            <input style={input} type="password" value={token} onChange={(e) => saveToken(e.target.value)} placeholder="a mesma do servidor" />
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 120 }}>
              <label style={label}>Quantos imóveis</label>
              <input style={input} type="number" min={1} max={300} value={limit} onChange={(e) => setLimit(Number(e.target.value))} />
            </div>
            <div style={{ flex: 1, minWidth: 160 }}>
              <label style={label}>Modelo da IA</label>
              <select style={input} value={model} onChange={(e) => setModel(e.target.value)}>
                <option value="claude-haiku-4-5">Haiku (mais barato)</option>
                <option value="claude-sonnet-5">Sonnet (meio-termo)</option>
                <option value="claude-opus-5">Opus (máxima qualidade)</option>
              </select>
            </div>
            <div style={{ flex: 1, minWidth: 120 }}>
              <label style={label}>Confiança mín.</label>
              <input style={input} type="number" min={0} max={1} step={0.05} value={minConf} onChange={(e) => setMinConf(Number(e.target.value))} />
            </div>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 14 }}>
            <input type="checkbox" checked={apply} onChange={(e) => setApply(e.target.checked)} style={{ accentColor: "var(--accent)", width: 16, height: 16 }} />
            <span><strong>Aplicar correções automaticamente</strong> (desmarcado = só sugere)</span>
          </label>
          {!running ? (
            <button className="btn" onClick={run} disabled={!token}>Auditar {limit} imóveis</button>
          ) : (
            <button className="btn" style={{ background: "var(--warn)" }} onClick={() => (abort.current = true)}>⏹ Parar</button>
          )}
        </div>

        {(running || done > 0) && (
          <div style={{ ...box, marginTop: 16 }}>
            <div style={{ height: 8, background: "var(--border)", borderRadius: 4, overflow: "hidden" }}>
              <div style={{ width: `${pct}%`, height: "100%", background: "var(--accent)", transition: "width .2s" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 13, flexWrap: "wrap", gap: 8 }}>
              <span>{done}/{total} conferidos</span>
              <span>🛠 {fixes} {apply ? "corrigidos" : "sugestões"}</span>
              <span style={{ fontWeight: 600 }}>custo: US$ {cost.toFixed(4)}</span>
            </div>
          </div>
        )}

        {msg && <p style={{ marginTop: 12, fontSize: 14, color: "var(--muted)" }}>{msg}</p>}

        {rows.length > 0 && (
          <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
            {rows.map((r, i) => (
              <div key={r.id + i} className="card" style={{ padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <strong style={{ fontSize: 13.5 }}>{r.title ?? "Imóvel"}</strong>
                  {r.error ? (
                    <span style={{ fontSize: 12, color: "var(--warn)" }}>⚠️ {r.error}</span>
                  ) : (
                    <span className="chip">{r.applied ? "corrigido" : "sugestão"}</span>
                  )}
                </div>
                {!r.error && (
                  <div style={{ marginTop: 8, display: "grid", gap: 4 }}>
                    {Object.entries(r.changes).map(([f, c]) => (
                      <div key={f} style={{ fontSize: 13, display: "flex", gap: 8, alignItems: "baseline" }}>
                        <span style={{ minWidth: 110, color: "var(--muted)" }}>{f}</span>
                        <span style={{ color: "var(--warn)", textDecoration: "line-through" }}>{fmt(c.from)}</span>
                        <span>→</span>
                        <span style={{ color: "var(--accent)", fontWeight: 700 }}>{fmt(c.to)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
