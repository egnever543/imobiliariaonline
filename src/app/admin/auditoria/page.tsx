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
interface Verdict {
  field: string; status: "ok" | "fix";
  value: unknown; confidence: number; reason?: string;
}
interface Item {
  id: string; title: string | null; type: string | null; neighborhood: string | null;
  price: number | null; lat?: number | null; source_url?: string | null;
  reviewed: boolean; lastChanges: number; applied: boolean; lastAt?: string | null;
  // estado local durante a auditoria
  busy?: boolean; changes?: Record<string, Change>; verdicts?: Verdict[]; geoInfo?: GeoInfo | null; priceProbe?: { found: number | null } | null; statusProbe?: { detected: string } | null; error?: string;
}
const fmt = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
const money = (v: number | null) => (v ? "R$ " + v.toLocaleString("pt-BR") : "—");

// campos de texto que dá para auditar (marque só o que quiser conferir)
const AUDIT_FIELD_LABELS: { k: string; label: string }[] = [
  { k: "price", label: "Preço" }, { k: "area_total_m2", label: "Área" }, { k: "type", label: "Tipo" },
  { k: "bedrooms", label: "Quartos" }, { k: "bathrooms", label: "Banheiros" }, { k: "suites", label: "Suítes" },
  { k: "parking", label: "Vagas" }, { k: "neighborhood", label: "Bairro" },
  { k: "is_launch", label: "Lançamento" }, { k: "accepts_permuta", label: "Permuta" },
];
const ALL_FIELD_KEYS = AUDIT_FIELD_LABELS.map((f) => f.k);
const FIELD_LABEL = new Map(AUDIT_FIELD_LABELS.map((f) => [f.k, f.label]));
const MODEL_LABELS: Record<string, string> = {
  "gpt-5-nano": "GPT-5 Nano", "claude-haiku-4-5": "Haiku", "claude-sonnet-5": "Sonnet", "claude-opus-5": "Opus",
};
// distância legível (m/km)
const fmtDist = (m: number) => (m >= 1000 ? (m / 1000).toFixed(1) + " km" : Math.round(m) + " m");
// chaves de coordenada exibidas via bloco de localização (não na lista crua)
const GEO_KEYS = new Set(["lat", "lng", "geo_method"]);
interface GeoInfo {
  distanceM: number | null;
  to: { lat: number; lng: number };
  method: string;
  address: { street: string | null; street_number: string | null; neighborhood: string | null; cep: string | null };
}

type Filter = "todos" | "pendentes" | "revisados" | "sugestoes" | "desde" | "sem_preco" | "sem_local";

// "hoje 00:00" no formato do input datetime-local (aaaa-mm-ddThh:mm)
function startOfTodayLocal(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
const fmtWhen = (iso?: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};

export default function Auditoria() {
  const [token, setToken] = useState("");
  const [model, setModel] = useState("gpt-5-nano");
  const [minConf, setMinConf] = useState(0.7);
  const [apply, setApply] = useState(false);
  const [applyingAll, setApplyingAll] = useState(false);
  // config recolhível (sai do caminho depois de configurada) + linhas expansíveis
  const [configOpen, setConfigOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // o que auditar: campos de texto marcados + localização (com limite de desvio)
  const [selFields, setSelFields] = useState<Set<string>>(new Set(ALL_FIELD_KEYS));
  const [checkGeo, setCheckGeo] = useState(false);
  const [checkStatus, setCheckStatus] = useState(false);
  const [geoThreshold, setGeoThreshold] = useState(300);

  const [items, setItems] = useState<Item[]>([]);
  const [filter, setFilter] = useState<Filter>("pendentes");
  const [cutoff, setCutoff] = useState<string>(startOfTodayLocal()); // "desde": auditados antes disto
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const [batch, setBatch] = useState(false);
  const [done, setDone] = useState(0);
  const [batchTotal, setBatchTotal] = useState(0);
  const [cost, setCost] = useState(0);
  const abort = useRef(false);

  useEffect(() => {
    const t = localStorage.getItem("admin_token") ?? "";
    setToken(t);
    if (!t) setConfigOpen(true); // sem senha ainda → abre a config para preencher
  }, []);
  // deep-link do painel: ?falta=preco|local → já filtra e mira o campo certo
  useEffect(() => {
    try {
      const f = new URLSearchParams(window.location.search).get("falta");
      if (f === "preco") { setFilter("sem_preco"); setSelFields(new Set(["price"])); setCheckGeo(false); }
      else if (f === "local") { setFilter("sem_local"); setSelFields(new Set()); setCheckGeo(true); }
    } catch { /* ignora */ }
  }, []);
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
      const raw = (data.listings as (Item & { pendingChanges?: Record<string, Change> })[]) ?? [];
      // traz as sugestões ainda não aplicadas para o botão "Aplicar" já
      // aparecer sem precisar reauditar.
      setItems(raw.map((l) => (l.pendingChanges ? { ...l, changes: l.pendingChanges } : l)));
    } catch (e) {
      setMsg("Erro: " + (e as Error).message);
    } finally { setLoading(false); }
  }, [post]);

  function toggleField(k: string) {
    setSelFields((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  }
  function toggleExpand(id: string) {
    setExpanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  // audita 1 imóvel e atualiza sua linha
  async function auditOne(it: Item) {
    if (selFields.size === 0 && !checkGeo && !checkStatus) { setMsg("Selecione ao menos um campo para auditar."); return false; }
    setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, busy: true, error: undefined } : x)));
    try {
      const r = await post({
        listingId: it.id, apply, minConfidence: minConf, model,
        fields: [...selFields], checkGeo, checkStatus, geoThresholdM: geoThreshold,
      });
      const changes = (r.changes as Record<string, Change>) ?? {};
      const verdicts = (r.verdicts as Verdict[]) ?? [];
      const geoInfo = (r.geoInfo as GeoInfo | null) ?? null;
      const priceProbe = (r.priceProbe as { found: number | null } | null) ?? null;
      const statusProbe = (r.statusProbe as { detected: string } | null) ?? null;
      setCost((c) => c + ((r.estimatedCostUSD as number) || 0));
      setItems((xs) => xs.map((x) => x.id === it.id
        ? { ...x, busy: false, reviewed: true, applied: !!r.applied, lastChanges: Object.keys(changes).length, changes, verdicts, geoInfo, priceProbe, statusProbe, lastAt: new Date().toISOString() }
        : x));
      return true;
    } catch (e) {
      setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, busy: false, error: (e as Error).message } : x)));
      return false;
    }
  }

  // aplica as sugestões já calculadas de 1 imóvel (sem nova chamada de IA)
  async function applyOne(it: Item) {
    if (!it.changes || Object.keys(it.changes).length === 0) return;
    setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, busy: true } : x)));
    try {
      await post({ listingId: it.id, applyChanges: it.changes });
      setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, busy: false, applied: true } : x)));
    } catch (e) {
      setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, busy: false, error: (e as Error).message } : x)));
    }
  }

  // aplica TODAS as sugestões visíveis (sem gastar IA)
  async function applyAll() {
    const targets = shown.filter((x) => !x.applied && x.changes && Object.keys(x.changes).length > 0);
    if (!targets.length) return;
    setApplyingAll(true);
    for (const it of targets) await applyOne(it);
    setApplyingAll(false);
  }

  // lote: em "pendentes" audita só os não revisados; nos outros filtros
  // reaudita TODOS os visíveis (permite reconferir o que já foi auditado).
  async function runBatch() {
    const targets = filter === "pendentes" ? shown.filter((x) => !x.reviewed) : shown;
    if (!targets.length) { setMsg("Nada para auditar com esse filtro."); return; }
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

  const withSuggestion = (x: Item) => x.reviewed && !x.applied && (x.lastChanges > 0 || (x.changes && Object.keys(x.changes).length > 0));
  const suggestionCount = items.filter(withSuggestion).length;
  const cutoffMs = cutoff ? new Date(cutoff).getTime() : NaN;
  const isStale = (x: Item) => !x.lastAt || (Number.isFinite(cutoffMs) && new Date(x.lastAt).getTime() < cutoffMs);
  const staleCount = items.filter(isStale).length;
  const noPrice = (x: Item) => x.price == null;
  const noLocal = (x: Item) => x.lat == null;
  const noPriceCount = items.filter(noPrice).length;
  const noLocalCount = items.filter(noLocal).length;
  const shown = items.filter((x) => {
    if (filter === "pendentes" && x.reviewed) return false;
    if (filter === "revisados" && !x.reviewed) return false;
    if (filter === "sugestoes" && !withSuggestion(x)) return false;
    if (filter === "desde" && !isStale(x)) return false;
    if (filter === "sem_preco" && !noPrice(x)) return false;
    if (filter === "sem_local" && !noLocal(x)) return false;
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
  const chipBtn = (on: boolean): React.CSSProperties => ({
    padding: "5px 12px", borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
    border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`,
    background: on ? "var(--accent)" : "var(--paper)", color: on ? "#fff" : "var(--muted)",
  });
  const linkBtn: React.CSSProperties = {
    background: "transparent", border: "none", color: "var(--accent)", fontSize: 12, fontWeight: 600, cursor: "pointer", padding: 0,
  };
  const grpLabel: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em", minWidth: 118 };

  // resumo em badges do que a auditoria encontrou (linha fechada)
  type Tone = "warn" | "accent" | "muted" | "ok";
  const badgeStyle = (t: Tone): React.CSSProperties => ({
    fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999, whiteSpace: "nowrap",
    background: t === "muted" ? "transparent" : "color-mix(in srgb, var(--accent) 10%, transparent)",
    color: t === "warn" ? "var(--warn)" : t === "ok" ? "var(--ok)" : t === "muted" ? "var(--muted)" : "var(--accent)",
    border: t === "muted" ? "1px solid var(--border)" : "1px solid transparent",
  });
  function rowBadges(x: Item): { key: string; label: string; tone: Tone }[] {
    const out: { key: string; label: string; tone: Tone }[] = [];
    const ch = x.changes ?? {};
    const tone: Tone = x.applied ? "accent" : "warn";
    for (const [f, c] of Object.entries(ch)) {
      if (GEO_KEYS.has(f) || f === "status") continue;
      out.push({ key: f, label: `${FIELD_LABEL.get(f) ?? f}: ${fmt(c.to)}`, tone });
    }
    if (ch.status) out.push({ key: "status", label: `📌 ${fmt(ch.status.to)}`, tone });
    if (ch.lat && x.geoInfo) {
      out.push({ key: "geo", label: `📍 ${x.geoInfo.distanceM != null ? "desvio " + fmtDist(x.geoInfo.distanceM) : "novo ponto"}`, tone });
    }
    // veredictos "fix" abaixo do limiar (não viraram correção)
    const changeKeys = new Set(Object.keys(ch));
    const weak = (x.verdicts ?? []).filter((v) => v.status === "fix" && !changeKeys.has(v.field));
    if (weak.length) out.push({ key: "weak", label: `⚠️ ${weak.length} possíve${weak.length > 1 ? "is" : "l"}`, tone: "muted" });
    if (x.priceProbe && x.priceProbe.found == null && !ch.price) out.push({ key: "noprice", label: "💲 sem preço no anúncio", tone: "muted" });
    if (x.error) out.push({ key: "err", label: "⚠️ erro", tone: "warn" });
    // nada mudou e já revisado → confere
    if (!out.length && x.reviewed && !x.busy) out.push({ key: "ok", label: "✓ confere", tone: "ok" });
    return out;
  }
  const hasDetail = (x: Item) =>
    !!(x.changes && Object.keys(x.changes).length) || !!(x.verdicts && x.verdicts.length) ||
    !!x.geoInfo || !!x.priceProbe || !!x.statusProbe || !!x.error;

  return (
    <>
      <Nav />
      <main style={{ maxWidth: 960, margin: "0 auto", padding: "32px 20px 96px" }}>
        <span className="chip">Painel</span>
        <h1 style={{ fontSize: 28, margin: "12px 0 4px" }}>Auditoria por IA</h1>
        <p style={{ color: "var(--muted)", marginTop: 0, fontSize: 14.5 }}>
          A IA lê cada anúncio, compara com os dados salvos e corrige o que
          estiver errado. Escolha o que conferir, revise um a um ou em lote.
        </p>

        {/* Config recolhível — sai do caminho depois de preenchida */}
        <div style={{ ...box, marginTop: 16, padding: configOpen ? 16 : "10px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <button onClick={() => setConfigOpen((v) => !v)} style={{ ...linkBtn, display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <span style={{ transform: configOpen ? "rotate(90deg)" : "none", transition: "transform .15s" }}>▸</span>
              ⚙️ Configuração
            </button>
            {!configOpen && (
              <span style={{ fontSize: 12.5, color: "var(--muted)", display: "flex", gap: 10, flexWrap: "wrap" }}>
                <span>Modelo: <strong style={{ color: "var(--ink)" }}>{MODEL_LABELS[model] ?? model}</strong></span>
                <span>Confiança: <strong style={{ color: "var(--ink)" }}>{Math.round(minConf * 100)}%</strong></span>
                <span style={{ color: apply ? "var(--warn)" : "var(--muted)" }}>{apply ? "grava ao auditar" : "só sugere"}</span>
                {!token && <span style={{ color: "var(--warn)" }}>· falta a senha</span>}
              </span>
            )}
            <button className="btn btn-ghost" onClick={load} disabled={loading || !token} style={{ marginLeft: "auto" }}>
              {loading ? "…" : items.length ? "Recarregar" : "Carregar imóveis"}
            </button>
          </div>
          {configOpen && (
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginTop: 14 }}>
              <div style={{ flex: 2, minWidth: 180 }}>
                <label style={{ fontSize: 11.5, color: "var(--muted)", display: "block", marginBottom: 4 }}>Senha do painel</label>
                <input style={{ ...input, width: "100%" }} type="password" value={token} onChange={(e) => saveToken(e.target.value)} placeholder="ADMIN_TOKEN" />
              </div>
              <div>
                <label style={{ fontSize: 11.5, color: "var(--muted)", display: "block", marginBottom: 4 }}>Modelo</label>
                <select style={input} value={model} onChange={(e) => setModel(e.target.value)}>
                  <option value="gpt-5-nano">GPT-5 Nano (mais barato)</option>
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
                gravar ao auditar
              </label>
            </div>
          )}
        </div>

        {/* O que auditar — 3 grupos (marque só o necessário; menos campos, menos tokens) */}
        <div style={{ ...box, marginTop: 10, padding: "14px 16px", display: "grid", gap: 12 }}>
          {/* Dados do anúncio */}
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
            <span style={{ ...grpLabel, paddingTop: 6 }}>Dados do anúncio</span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", flex: 1 }}>
              {AUDIT_FIELD_LABELS.map((f) => (
                <button key={f.k} onClick={() => toggleField(f.k)} style={chipBtn(selFields.has(f.k))}>{f.label}</button>
              ))}
              <button style={linkBtn} onClick={() => setSelFields(new Set(ALL_FIELD_KEYS))}>todos</button>
              <button style={linkBtn} onClick={() => setSelFields(new Set())}>nenhum</button>
            </div>
          </div>
          {/* Situação */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", borderTop: "1px solid var(--border)", paddingTop: 12 }}>
            <span style={grpLabel}>Situação</span>
            <button onClick={() => setCheckStatus((v) => !v)} style={chipBtn(checkStatus)}>📌 Conferir situação</button>
            <span style={{ fontSize: 11.5, color: "var(--muted)" }}>vendido / alugado / reservado / fora do ar</span>
          </div>
          {/* Localização */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", borderTop: "1px solid var(--border)", paddingTop: 12 }}>
            <span style={grpLabel}>Localização</span>
            <button onClick={() => setCheckGeo((v) => !v)} style={chipBtn(checkGeo)}>📍 Conferir localização</button>
            {checkGeo && (
              <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted)" }}>
                marca desvio &gt;
                <input type="number" min={50} step={50} value={geoThreshold}
                  onChange={(e) => setGeoThreshold(Number(e.target.value) || 300)} style={{ ...input, width: 76 }} /> m
              </span>
            )}
          </div>
        </div>

        {msg && <p style={{ marginTop: 12, fontSize: 13.5, color: "var(--muted)" }}>{msg}</p>}

        {items.length > 0 && (
          <>
            {/* Filtros — eixo 1: estado de revisão */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
              <span style={grpLabel}>Estado</span>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button style={seg(filter === "pendentes")} onClick={() => setFilter("pendentes")}>Não revisados ({pending})</button>
                <button style={seg(filter === "sugestoes")} onClick={() => setFilter("sugestoes")}>💡 Com sugestão ({suggestionCount})</button>
                <button style={seg(filter === "revisados")} onClick={() => setFilter("revisados")}>Revisados ({reviewed})</button>
                <button style={seg(filter === "todos")} onClick={() => setFilter("todos")}>Todos ({total})</button>
              </div>
            </div>
            {/* Filtros — eixo 2: dados faltando / por data */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <span style={grpLabel}>Dados faltando</span>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <button style={seg(filter === "sem_preco")} onClick={() => setFilter("sem_preco")}>💲 Sem preço ({noPriceCount})</button>
                <button style={seg(filter === "sem_local")} onClick={() => setFilter("sem_local")}>📍 Sem localização ({noLocalCount})</button>
                <button style={seg(filter === "desde")} onClick={() => setFilter("desde")}>🕓 Não auditados desde ({staleCount})</button>
                {filter === "desde" && (
                  <input type="datetime-local" value={cutoff} onChange={(e) => setCutoff(e.target.value)} style={{ ...input }} />
                )}
              </div>
            </div>

            {/* Barra de ação — separada dos filtros */}
            <div style={{ ...box, marginTop: 12, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <input style={{ ...input, flex: 1, minWidth: 160 }} placeholder="buscar por título/bairro…" value={q} onChange={(e) => setQ(e.target.value)} />
              <span style={{ fontSize: 12.5, color: "var(--muted)", whiteSpace: "nowrap" }}>
                {shown.length} {shown.length === 1 ? "imóvel" : "imóveis"}
              </span>
              {cost > 0 && <span style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap" }}>· US$ {cost.toFixed(4)}</span>}
              <span style={{ flexBasis: "100%", height: 0 }} />
              {filter === "sugestoes" && !batch && (
                <button className="btn btn-ghost" onClick={applyAll}
                  disabled={applyingAll || !shown.some((x) => !x.applied && x.changes && Object.keys(x.changes).length > 0)}>
                  {applyingAll ? "Aplicando…" : `✓ Aplicar ${shown.filter((x) => !x.applied && x.changes && Object.keys(x.changes).length > 0).length} sugestões`}
                </button>
              )}
              {!batch ? (
                (() => {
                  const n = filter === "pendentes" ? shown.filter((x) => !x.reviewed).length : shown.length;
                  const verb = filter === "pendentes" ? "Revisar"
                    : (filter === "sem_preco" || filter === "sem_local") ? "Auditar" : "Reauditar";
                  return (
                    <button className="btn" onClick={runBatch} disabled={n === 0}>
                      {verb} {n} em lote
                    </button>
                  );
                })()
              ) : (
                <button className="btn" style={{ background: "var(--warn)" }} onClick={() => (abort.current = true)}>⏹ Parar</button>
              )}
              {batch && (
                <div style={{ flexBasis: "100%", height: 7, background: "var(--border)", borderRadius: 4, overflow: "hidden" }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: "var(--accent)", transition: "width .2s" }} />
                </div>
              )}
              {batch && <span style={{ flexBasis: "100%", fontSize: 12, color: "var(--muted)" }}>{done}/{batchTotal} conferidos</span>}
            </div>

            {/* Tabela — linhas de altura estável (badges); detalhe abre ao clicar */}
            <div style={{ ...box, marginTop: 12, padding: 0, overflow: "hidden" }}>
              {shown.slice(0, 400).map((x, i) => {
                const isOpen = expanded.has(x.id);
                const badges = rowBadges(x);
                const canExpand = hasDetail(x);
                const canApply = !!(x.changes && Object.keys(x.changes).length > 0 && !x.applied && !x.busy);
                return (
                <div key={x.id} style={{ borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
                  {/* linha fechada */}
                  <div
                    onClick={() => canExpand && toggleExpand(x.id)}
                    style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
                      cursor: canExpand ? "pointer" : "default",
                    }}>
                    {/* status */}
                    <span title={x.reviewed ? "revisado" : "não revisado"} style={{
                      width: 9, height: 9, borderRadius: 99, flexShrink: 0,
                      background: x.reviewed ? "var(--ok)" : "var(--border)",
                    }} />
                    {/* info + badges */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {x.title ?? x.type ?? "Imóvel"}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--muted)", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 1 }}>
                        <span style={{ whiteSpace: "nowrap" }}>{[x.type, x.neighborhood, money(x.price)].filter(Boolean).join(" · ")}</span>
                        {badges.map((b) => (
                          <span key={b.key} style={badgeStyle(b.tone)}>{b.label}</span>
                        ))}
                      </div>
                    </div>
                    {/* aplicar sugestões (sem gastar IA) */}
                    {canApply && (
                      <button className="btn" style={{ padding: "6px 12px", fontSize: 12.5 }}
                        onClick={(e) => { e.stopPropagation(); applyOne(x); }} disabled={batch}>
                        Aplicar
                      </button>
                    )}
                    {/* ação */}
                    <button className="btn btn-ghost" style={{ padding: "6px 12px", fontSize: 12.5 }}
                      onClick={(e) => { e.stopPropagation(); auditOne(x); }} disabled={x.busy || batch}>
                      {x.busy ? "…" : x.reviewed ? "Rever" : "Revisar"}
                    </button>
                    {canExpand && (
                      <span style={{ color: "var(--muted)", fontSize: 12, transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .15s" }}>▸</span>
                    )}
                  </div>

                  {/* detalhe (expandido) */}
                  {isOpen && (
                  <div style={{ padding: "0 14px 12px 33px", display: "grid", gap: 6 }}>
                    <div style={{ fontSize: 12, color: "var(--muted)", display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                      {x.lastAt && <span>auditado {fmtWhen(x.lastAt)}</span>}
                      {x.source_url && (
                        <a href={x.source_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ fontSize: 11.5, fontWeight: 600 }}>ver anúncio ↗</a>
                      )}
                      <a href={`/mapa?imovel=${x.id}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ fontSize: 11.5, fontWeight: 600 }}>ver no mapa ↗</a>
                    </div>
                    {/* correções de texto (sem coordenadas cruas nem status) */}
                    {x.changes && Object.keys(x.changes).some((f) => !GEO_KEYS.has(f) && f !== "status") && (
                      <div style={{ display: "grid", gap: 2 }}>
                        {Object.entries(x.changes).filter(([f]) => !GEO_KEYS.has(f) && f !== "status").map(([f, c]) => (
                          <div key={f} style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "baseline" }}>
                            <span style={{ minWidth: 92, color: "var(--muted)" }}>{FIELD_LABEL.get(f) ?? f}</span>
                            <span style={{ color: "var(--warn)", textDecoration: "line-through" }}>{fmt(c.from)}</span>
                            <span>→</span>
                            <span style={{ color: "var(--accent)", fontWeight: 700 }}>{fmt(c.to)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* localização: desvio detectado e novo ponto */}
                    {x.changes && x.changes.lat && x.geoInfo && (
                      <div style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "baseline", flexWrap: "wrap" }}>
                        <span style={{ color: "var(--accent)", fontWeight: 700 }}>📍 localização</span>
                        <span style={{ color: "var(--muted)" }}>
                          {x.geoInfo.distanceM != null ? `desvio de ${fmtDist(x.geoInfo.distanceM)} → novo ponto` : "sem ponto salvo → novo ponto"}
                        </span>
                        <a href={`https://www.google.com/maps?q=${x.geoInfo.to.lat},${x.geoInfo.to.lng}`} target="_blank" rel="noreferrer"
                          onClick={(e) => e.stopPropagation()} style={{ fontSize: 11.5, fontWeight: 600 }}>ver ponto ↗</a>
                        {[x.geoInfo.address.street, x.geoInfo.address.neighborhood].filter(Boolean).length > 0 && (
                          <span style={{ color: "var(--muted)" }}>· {[x.geoInfo.address.street, x.geoInfo.address.neighborhood].filter(Boolean).join(", ")}</span>
                        )}
                      </div>
                    )}
                    {x.reviewed && checkGeo && x.geoInfo === null && (!x.changes || !x.changes.lat) && (
                      <div style={{ fontSize: 11.5, color: "var(--muted)" }}>📍 localização confere (ou sem endereço no anúncio)</div>
                    )}
                    {/* veredicto da IA + "fix" abaixo do limiar */}
                    {x.reviewed && x.verdicts && (() => {
                      const checked = x.verdicts.length;
                      const changeKeys = new Set(Object.keys(x.changes ?? {}));
                      const weak = x.verdicts.filter((v) => v.status === "fix" && !changeKeys.has(v.field));
                      const anyFix = x.verdicts.some((v) => v.status === "fix");
                      return (
                        <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                          {checked > 0
                            ? `IA conferiu ${checked} campo(s)${!anyFix ? " · sem divergências" : ""}`
                            : "IA não retornou veredicto (resposta vazia ou fora do formato)"}
                          {weak.length > 0 && (
                            <div style={{ marginTop: 3, display: "grid", gap: 2 }}>
                              {weak.map((v) => (
                                <div key={v.field} style={{ display: "flex", gap: 6, alignItems: "baseline", flexWrap: "wrap" }}>
                                  <span style={{ minWidth: 88 }}>{FIELD_LABEL.get(v.field) ?? v.field}</span>
                                  <span>→ <b>{fmt(v.value)}</b></span>
                                  <span style={{ opacity: 0.85 }}>
                                    conf {Math.round((v.confidence ?? 0) * 100)}% · abaixo do limiar ({Math.round(minConf * 100)}%)
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    {/* situação */}
                    {x.changes && x.changes.status && (
                      <div style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "baseline", flexWrap: "wrap" }}>
                        <span style={{ color: "var(--accent)", fontWeight: 700 }}>📌 situação</span>
                        <span style={{ color: "var(--warn)", textDecoration: "line-through" }}>{fmt(x.changes.status.from)}</span>
                        <span>→</span>
                        <span style={{ color: "var(--accent)", fontWeight: 700 }}>{fmt(x.changes.status.to)}</span>
                        <span style={{ color: "var(--muted)" }}>· sai do mapa ao aplicar</span>
                      </div>
                    )}
                    {x.statusProbe && !(x.changes && x.changes.status) && (
                      <div style={{ fontSize: 11.5, color: "var(--muted)" }}>📌 situação confere ({x.statusProbe.detected})</div>
                    )}
                    {x.priceProbe && x.priceProbe.found == null && !(x.changes && x.changes.price) && (
                      <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                        💲 preço não consta no anúncio (nem no texto nem nos metadados) — provável “Consulte”
                      </div>
                    )}
                    {x.error && <div style={{ fontSize: 12, color: "var(--warn)" }}>⚠️ {x.error}</div>}
                  </div>
                  )}
                </div>
                );
              })}
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
