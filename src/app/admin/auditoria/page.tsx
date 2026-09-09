"use client";

// ── Central de auditoria por IA ───────────────────────────────────────
// Lista TODOS os imóveis com status (revisado / não revisado). Permite
// auditar um imóvel (individual) ou disparar em lote os que faltam.
// A IA lê o anúncio, compara com os dados salvos e corrige o que está errado.

import { useCallback, useEffect, useRef, useState } from "react";
import Nav from "@/components/Nav";

const box: React.CSSProperties = {
  background: "var(--paper)", border: "1px solid var(--border)",
  borderRadius: "var(--radius)", padding: 16, boxShadow: "var(--shadow-sm)",
};
const input: React.CSSProperties = {
  padding: "8px 10px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)",
  background: "var(--paper)", color: "var(--ink)", fontSize: 13,
};

interface Change { from: unknown; to: unknown }
interface Item {
  id: string; title: string | null; type: string | null; neighborhood: string | null;
  price: number | null; source_url?: string | null;
  reviewed: boolean; lastChanges: number; applied: boolean;
  // estado local durante a auditoria
  busy?: boolean; changes?: Record<string, Change>; error?: string;
}
const fmt = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
const money = (v: number | null) => (v ? "R$ " + v.toLocaleString("pt-BR") : "—");

type Filter = "todos" | "pendentes" | "revisados";

export default function Auditoria() {
  const [token, setToken] = useState("");
  const [model, setModel] = useState("claude-haiku-4-5");
  const [minConf, setMinConf] = useState(0.8);
  const [apply, setApply] = useState(false);

  const [items, setItems] = useState<Item[]>([]);
  const [filter, setFilter] = useState<Filter>("pendentes");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const [batch, setBatch] = useState(false);
  const [done, setDone] = useState(0);
  const [batchTotal, setBatchTotal] = useState(0);
  const [cost, setCost] = useState(0);
  const abort = useRef(false);

  useEffect(() => { setToken(localStorage.getItem("admin_token") ?? ""); }, []);
  function saveToken(v: string) { setToken(v); localStorage.setItem("admin_token", v); }
  const headers = useCallback(() => ({ "content-type": "application/json", "x-admin-token": token }), [token]);

  const post = useCallback(async (payload: object) => {
    const res = await fetch("/api/audit", { method: "POST", headers: headers(), body: JSON.stringify(payload) });
    const text = await res.text();
    let data: Record<string, unknown> = {};
    try { data = text ? JSON.parse(text) : {}; } catch {}
    if (!res.ok) throw new Error((data.error as string) ?? `HTTP ${res.status}`);
    return data;
  }, [headers]);

  const load = useCallback(async () => {
    setLoading(true); setMsg("");
    try {
      const data = await post({ list: true });
      setItems((data.listings as Item[]) ?? []);
    } catch (e) {
      setMsg("Erro: " + (e as Error).message);
    } finally { setLoading(false); }
  }, [post]);

  // audita 1 imóvel e atualiza sua linha
  async function auditOne(it: Item) {
    setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, busy: true, error: undefined } : x)));
    try {
      const r = await post({ listingId: it.id, apply, minConfidence: minConf, model });
      const changes = (r.changes as Record<string, Change>) ?? {};
      setCost((c) => c + ((r.estimatedCostUSD as number) || 0));
      setItems((xs) => xs.map((x) => x.id === it.id
        ? { ...x, busy: false, reviewed: true, applied: !!r.applied, lastChanges: Object.keys(changes).length, changes }
        : x));
      return true;
    } catch (e) {
      setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, busy: false, error: (e as Error).message } : x)));
      return false;
    }
  }

  // lote: audita os pendentes (do filtro atual)
  async function runBatch() {
    const targets = shown.filter((x) => !x.reviewed);
    if (!targets.length) { setMsg("Nada pendente com esse filtro."); return; }
    abort.current = false; setBatch(true); setDone(0); setBatchTotal(targets.length); setCost(0);
    for (const it of targets) {
      if (abort.current) { setMsg("⏹ Interrompido."); break; }
      await auditOne(it);
      setDone((n) => n + 1);
      await new Promise((r) => setTimeout(r, 250));
    }
    setBatch(false);
  }

  const total = items.length;
  const reviewed = items.filter((x) => x.reviewed).length;
  const pending = total - reviewed;

  const shown = items.filter((x) => {
    if (filter === "pendentes" && x.reviewed) return false;
    if (filter === "revisados" && !x.reviewed) return false;
    if (q) {
      const s = (x.title ?? "") + " " + (x.neighborhood ?? "") + " " + (x.type ?? "");
      if (!s.toLowerCase().includes(q.toLowerCase())) return false;
    }
    return true;
  });
  const pct = batchTotal ? Math.round((done / batchTotal) * 100) : 0;

  const seg = (on: boolean): React.CSSProperties => ({
    padding: "6px 12px", borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: "pointer",
    border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`,
    background: on ? "var(--accent)" : "var(--paper)", color: on ? "#fff" : "var(--muted)",
  });

  return (
    <>
      <Nav />
      <main style={{ maxWidth: 960, margin: "0 auto", padding: "32px 20px 96px" }}>
        <span className="chip">Painel</span>
        <h1 style={{ fontSize: 28, margin: "12px 0 4px" }}>Auditoria por IA</h1>
        <p style={{ color: "var(--muted)", marginTop: 0, fontSize: 14.5 }}>
          A IA lê cada anúncio, compara com os dados salvos e corrige o que
          estiver errado. Revise um a um ou dispare os pendentes em lote.
        </p>

        {/* Configuração */}
        <div style={{ ...box, marginTop: 16, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: 2, minWidth: 180 }}>
            <label style={{ fontSize: 11.5, color: "var(--muted)", display: "block", marginBottom: 4 }}>Senha do painel</label>
            <input style={{ ...input, width: "100%" }} type="password" value={token} onChange={(e) => saveToken(e.target.value)} placeholder="ADMIN_TOKEN" />
          </div>
          <div>
            <label style={{ fontSize: 11.5, color: "var(--muted)", display: "block", marginBottom: 4 }}>Modelo</label>
            <select style={input} value={model} onChange={(e) => setModel(e.target.value)}>
              <option value="claude-haiku-4-5">Haiku (barato)</option>
              <option value="claude-sonnet-5">Sonnet</option>
              <option value="claude-opus-5">Opus</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11.5, color: "var(--muted)", display: "block", marginBottom: 4 }}>Confiança</label>
            <input style={{ ...input, width: 80 }} type="number" min={0} max={1} step={0.05} value={minConf} onChange={(e) => setMinConf(Number(e.target.value))} />
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, cursor: "pointer", paddingBottom: 8 }}>
            <input type="checkbox" checked={apply} onChange={(e) => setApply(e.target.checked)} style={{ accentColor: "var(--accent)", width: 16, height: 16 }} />
            aplicar
          </label>
          <button className="btn btn-ghost" onClick={load} disabled={loading || !token} style={{ paddingBottom: 8 }}>
            {loading ? "…" : items.length ? "Recarregar" : "Carregar imóveis"}
          </button>
        </div>

        {msg && <p style={{ marginTop: 12, fontSize: 13.5, color: "var(--muted)" }}>{msg}</p>}

        {items.length > 0 && (
          <>
            {/* Resumo + ações */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: 6 }}>
                <button style={seg(filter === "pendentes")} onClick={() => setFilter("pendentes")}>Não revisados ({pending})</button>
                <button style={seg(filter === "revisados")} onClick={() => setFilter("revisados")}>Revisados ({reviewed})</button>
                <button style={seg(filter === "todos")} onClick={() => setFilter("todos")}>Todos ({total})</button>
              </div>
              <input style={{ ...input, flex: 1, minWidth: 140 }} placeholder="buscar por título/bairro…" value={q} onChange={(e) => setQ(e.target.value)} />
              {!batch ? (
                <button className="btn" onClick={runBatch} disabled={!shown.some((x) => !x.reviewed)}>
                  Revisar {shown.filter((x) => !x.reviewed).length} em lote
                </button>
              ) : (
                <button className="btn" style={{ background: "var(--warn)" }} onClick={() => (abort.current = true)}>⏹ Parar</button>
              )}
            </div>

            {(batch || cost > 0) && (
              <div style={{ ...box, marginTop: 12, padding: 12 }}>
                {batch && (
                  <div style={{ height: 7, background: "var(--border)", borderRadius: 4, overflow: "hidden", marginBottom: 8 }}>
                    <div style={{ width: `${pct}%`, height: "100%", background: "var(--accent)", transition: "width .2s" }} />
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                  <span>{batch ? `${done}/${batchTotal} conferidos` : "sessão"}</span>
                  <span style={{ fontWeight: 600 }}>custo: US$ {cost.toFixed(4)}</span>
                </div>
              </div>
            )}

            {/* Tabela */}
            <div style={{ ...box, marginTop: 12, padding: 0, overflow: "hidden" }}>
              {shown.slice(0, 400).map((x, i) => (
                <div key={x.id} style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
                  borderTop: i === 0 ? "none" : "1px solid var(--border)",
                }}>
                  {/* status */}
                  <span title={x.reviewed ? "revisado" : "não revisado"} style={{
                    width: 9, height: 9, borderRadius: 99, flexShrink: 0,
                    background: x.reviewed ? "var(--ok)" : "var(--border)",
                  }} />
                  {/* info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {x.title ?? x.type ?? "Imóvel"}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--muted)", display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                      <span>{[x.type, x.neighborhood, money(x.price)].filter(Boolean).join(" · ")}</span>
                      {x.source_url && (
                        <a href={x.source_url} target="_blank" rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          style={{ fontSize: 11.5, fontWeight: 600 }}>
                          ver anúncio ↗
                        </a>
                      )}
                    </div>
                    {/* correções da última auditoria (sessão atual) */}
                    {x.changes && Object.keys(x.changes).length > 0 && (
                      <div style={{ marginTop: 4, display: "grid", gap: 2 }}>
                        {Object.entries(x.changes).map(([f, c]) => (
                          <div key={f} style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "baseline" }}>
                            <span style={{ minWidth: 92, color: "var(--muted)" }}>{f}</span>
                            <span style={{ color: "var(--warn)", textDecoration: "line-through" }}>{fmt(c.from)}</span>
                            <span>→</span>
                            <span style={{ color: "var(--accent)", fontWeight: 700 }}>{fmt(c.to)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {x.error && <div style={{ fontSize: 12, color: "var(--warn)" }}>⚠️ {x.error}</div>}
                  </div>
                  {/* selo */}
                  {x.reviewed && !x.busy && (
                    <span style={{ fontSize: 11.5, color: "var(--muted)", whiteSpace: "nowrap" }}>
                      {x.lastChanges > 0 ? `${x.lastChanges} ${x.applied ? "corrig." : "sugest."}` : "ok"}
                    </span>
                  )}
                  {/* ação */}
                  <button className="btn btn-ghost" style={{ padding: "6px 12px", fontSize: 12.5 }}
                    onClick={() => auditOne(x)} disabled={x.busy || batch}>
                    {x.busy ? "…" : x.reviewed ? "Rever" : "Revisar"}
                  </button>
                </div>
              ))}
              {shown.length > 400 && (
                <div style={{ padding: "10px 14px", fontSize: 12.5, color: "var(--muted)", borderTop: "1px solid var(--border)" }}>
                  Mostrando 400 de {shown.length}. Use a busca ou o lote para os demais.
                </div>
              )}
              {shown.length === 0 && (
                <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
                  Nenhum imóvel neste filtro.
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </>
  );
}
