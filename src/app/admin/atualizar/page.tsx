"use client";

// ── Atualizar imóveis ─────────────────────────────────────────────────
// Revisita os anúncios existentes (grátis) para trazer preço novo, foto e
// campos que faltavam, e marcar como indisponível o que saiu do ar.

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
  price: number | null; image_url: string | null; status: string | null; last_checked_at: string | null;
  busy?: boolean; changes?: Record<string, Change>; error?: string; done?: boolean;
}
const fmt = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
const when = (s: string | null) => (s ? new Date(s).toLocaleDateString("pt-BR") : "nunca");

export default function Atualizar() {
  const [token, setToken] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [filter, setFilter] = useState<"todos" | "nunca">("nunca");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [batch, setBatch] = useState(false);
  const [done, setDone] = useState(0);
  const [batchTotal, setBatchTotal] = useState(0);
  const abort = useRef(false);

  useEffect(() => { setToken(localStorage.getItem("admin_token") ?? ""); }, []);
  function saveToken(v: string) { setToken(v); localStorage.setItem("admin_token", v); }
  const headers = useCallback(() => ({ "content-type": "application/json", "x-admin-token": token }), [token]);

  const post = useCallback(async (payload: object) => {
    const res = await fetch("/api/refresh", { method: "POST", headers: headers(), body: JSON.stringify(payload) });
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
    } catch (e) { setMsg("Erro: " + (e as Error).message); } finally { setLoading(false); }
  }, [post]);

  async function refreshOne(it: Item) {
    setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, busy: true, error: undefined } : x)));
    try {
      const r = await post({ listingId: it.id });
      const changes = (r.changes as Record<string, Change>) ?? {};
      setItems((xs) => xs.map((x) => x.id === it.id
        ? { ...x, busy: false, done: true, changes, status: (r.status as string) ?? x.status, last_checked_at: new Date().toISOString() }
        : x));
      return true;
    } catch (e) {
      setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, busy: false, error: (e as Error).message } : x)));
      return false;
    }
  }

  async function runBatch() {
    const targets = shown.filter((x) => !x.done);
    if (!targets.length) { setMsg("Nada para atualizar com esse filtro."); return; }
    abort.current = false; setBatch(true); setDone(0); setBatchTotal(targets.length);
    for (const it of targets) {
      if (abort.current) { setMsg("⏹ Interrompido."); break; }
      await refreshOne(it);
      setDone((n) => n + 1);
      await new Promise((r) => setTimeout(r, 250));
    }
    setBatch(false);
  }

  const shown = items.filter((x) => {
    if (filter === "nunca" && x.last_checked_at) return false;
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
        <h1 style={{ fontSize: 28, margin: "12px 0 4px" }}>Atualizar imóveis</h1>
        <p style={{ color: "var(--muted)", marginTop: 0, fontSize: 14.5 }}>
          Revisita os anúncios (grátis, sem IA): traz preço novo, foto e campos
          que faltavam, e marca como indisponível o que saiu do ar.
        </p>

        <div style={{ ...box, marginTop: 16, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={{ fontSize: 11.5, color: "var(--muted)", display: "block", marginBottom: 4 }}>Senha do painel</label>
            <input style={{ ...input, width: "100%" }} type="password" value={token} onChange={(e) => saveToken(e.target.value)} placeholder="ADMIN_TOKEN" />
          </div>
          <button className="btn btn-ghost" onClick={load} disabled={loading || !token} style={{ paddingBottom: 8 }}>
            {loading ? "…" : items.length ? "Recarregar" : "Carregar imóveis"}
          </button>
        </div>
        {msg && <p style={{ marginTop: 12, fontSize: 13.5, color: "var(--muted)" }}>{msg}</p>}

        {items.length > 0 && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: 6 }}>
                <button style={seg(filter === "nunca")} onClick={() => setFilter("nunca")}>Nunca verificados ({items.filter((x) => !x.last_checked_at).length})</button>
                <button style={seg(filter === "todos")} onClick={() => setFilter("todos")}>Todos ({items.length})</button>
              </div>
              <input style={{ ...input, flex: 1, minWidth: 140 }} placeholder="buscar…" value={q} onChange={(e) => setQ(e.target.value)} />
              {!batch ? (
                <button className="btn" onClick={runBatch} disabled={!shown.some((x) => !x.done)}>
                  Atualizar {shown.filter((x) => !x.done).length} em lote
                </button>
              ) : (
                <button className="btn" style={{ background: "var(--warn)" }} onClick={() => (abort.current = true)}>⏹ Parar</button>
              )}
            </div>

            {batch && (
              <div style={{ ...box, marginTop: 12, padding: 12 }}>
                <div style={{ height: 7, background: "var(--border)", borderRadius: 4, overflow: "hidden", marginBottom: 8 }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: "var(--accent)", transition: "width .2s" }} />
                </div>
                <div style={{ fontSize: 13 }}>{done}/{batchTotal} atualizados</div>
              </div>
            )}

            <div style={{ ...box, marginTop: 12, padding: 0, overflow: "hidden" }}>
              {shown.slice(0, 400).map((x, i) => (
                <div key={x.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
                  <span title={x.status ?? "ativo"} style={{ width: 9, height: 9, borderRadius: 99, flexShrink: 0, background: x.status === "indisponivel" ? "var(--warn)" : x.status === "ativo" || !x.status ? "var(--ok)" : "var(--muted)" }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.title ?? x.type ?? "Imóvel"}</div>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>
                      {[x.type, x.neighborhood].filter(Boolean).join(" · ")} · verificado: {when(x.last_checked_at)}
                    </div>
                    {x.changes && Object.keys(x.changes).length > 0 && (
                      <div style={{ marginTop: 4, display: "grid", gap: 2 }}>
                        {Object.entries(x.changes).map(([f, c]) => (
                          <div key={f} style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "baseline" }}>
                            <span style={{ minWidth: 92, color: "var(--muted)" }}>{f}</span>
                            <span style={{ color: "var(--warn)", textDecoration: "line-through" }}>{fmt(c.from)}</span>
                            <span>→</span>
                            <span style={{ color: "var(--accent)", fontWeight: 700 }}>{f === "image_url" ? "(foto)" : fmt(c.to)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {x.done && (!x.changes || Object.keys(x.changes).length === 0) && x.status !== "indisponivel" && (
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>sem novidades</div>
                    )}
                    {x.status === "indisponivel" && <div style={{ fontSize: 12, color: "var(--warn)" }}>⚠️ anúncio fora do ar (indisponível)</div>}
                    {x.error && <div style={{ fontSize: 12, color: "var(--warn)" }}>⚠️ {x.error}</div>}
                  </div>
                  <button className="btn btn-ghost" style={{ padding: "6px 12px", fontSize: 12.5 }} onClick={() => refreshOne(x)} disabled={x.busy || batch}>
                    {x.busy ? "…" : "Atualizar"}
                  </button>
                </div>
              ))}
              {shown.length === 0 && <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>Nenhum imóvel neste filtro.</div>}
            </div>
          </>
        )}
      </main>
    </>
  );
}
