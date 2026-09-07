"use client";

// ── Coletar cidade inteira ────────────────────────────────────────────
// 1) Enumera todos os anúncios de todas as imobiliárias (sitemap + fallback).
// 2) Coleta um por um, pulando os já existentes, com progresso e custo ao vivo.

import { useEffect, useRef, useState } from "react";

interface Agency {
  id: string;
  name: string;
  website: string | null;
  listing_url: string | null;
}
interface QItem {
  url: string;
  agencyId: string;
}

const input: React.CSSProperties = {
  padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)",
  background: "transparent", color: "var(--ink)", fontSize: 14,
};
const btn: React.CSSProperties = {
  padding: "10px 16px", borderRadius: 8, border: "none",
  background: "var(--accent)", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer",
};
const card: React.CSSProperties = {
  background: "var(--paper)", border: "1px solid var(--border)", borderRadius: 12, padding: 16,
};

export default function ColetarCidade() {
  const [token, setToken] = useState("");
  const [citySlug, setCitySlug] = useState("itapoa-sc");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [city, setCity] = useState<{ cityId: string; cityName: string; uf: string } | null>(null);
  const [queue, setQueue] = useState<QItem[]>([]);
  const [done, setDone] = useState(0);
  const [saved, setSaved] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [jsonld, setJsonld] = useState(0);
  const [ai, setAi] = useState(0);
  const [cost, setCost] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const abort = useRef(false);

  useEffect(() => setToken(localStorage.getItem("admin_token") ?? ""), []);
  const headers = () => ({ "content-type": "application/json", "x-admin-token": token });
  const log = (s: string) => setLogs((l) => [s, ...l].slice(0, 60));

  // ── 1. Preparar: enumerar todos os anúncios ──
  async function prepare() {
    setBusy(true); setMsg(""); setQueue([]); setDone(0); setSaved(0);
    setSkipped(0); setJsonld(0); setAi(0); setCost(0); setLogs([]);
    try {
      const res = await fetch(`/api/agencies?city=${encodeURIComponent(citySlug)}`, { headers: headers() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setCity({ cityId: data.cityId, cityName: data.cityName, uf: data.uf });
      const ags: Agency[] = data.agencies;
      const q: QItem[] = [];
      const seen = new Set<string>();
      for (const a of ags) {
        if (!a.website && !a.listing_url) continue;
        setMsg(`Enumerando ${a.name}…`);
        try {
          const r = await fetch("/api/enumerate", {
            method: "POST", headers: headers(),
            body: JSON.stringify({ website: a.website, listingUrl: a.listing_url }),
          });
          const d = await r.json();
          const urls: string[] = d.urls ?? [];
          for (const u of urls) if (!seen.has(u)) { seen.add(u); q.push({ url: u, agencyId: a.id }); }
          log(`🔎 ${a.name}: ${urls.length} anúncios`);
        } catch {
          log(`⚠️ ${a.name}: falha ao enumerar`);
        }
      }
      setQueue(q);
      setMsg(`${q.length} anúncios encontrados na cidade. Pronto para coletar.`);
    } catch (e) {
      setMsg("Erro: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // ── 2. Coletar todos ──
  async function run() {
    if (!city) return;
    abort.current = false;
    setBusy(true);
    for (let i = done; i < queue.length; i++) {
      if (abort.current) { log("⏹ Interrompido."); break; }
      const { url, agencyId } = queue[i];
      try {
        const r = await fetch("/api/collect", {
          method: "POST", headers: headers(),
          body: JSON.stringify({
            url, cityId: city.cityId, agencyId,
            cityName: city.cityName, uf: city.uf, skipExisting: true,
          }),
        });
        const d = await r.json();
        setDone((n) => n + 1);
        setCost((c) => c + (d.estimatedCostUSD || 0));
        if (d.via === "skip") setSkipped((n) => n + 1);
        else if (d.via === "jsonld") { setJsonld((n) => n + 1); if (d.saved) setSaved((n) => n + 1); }
        else if (d.via === "ai") { setAi((n) => n + 1); if (d.saved) setSaved((n) => n + 1); }
        else if (d.saved) setSaved((n) => n + 1);
        if (d.error) log(`⚠️ ${short(url)} — ${d.error}`);
      } catch (e) {
        setDone((n) => n + 1);
        log(`❌ ${short(url)} — ${(e as Error).message}`);
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    setBusy(false);
  }

  const short = (u: string) => (u.length > 60 ? u.slice(0, 60) + "…" : u);
  const pct = queue.length ? Math.round((done / queue.length) * 100) : 0;

  return (
    <main style={{ maxWidth: 780, margin: "0 auto", padding: "40px 24px 96px" }}>
      <a href="/admin" style={{ fontSize: 13 }}>← painel</a>
      <h1 style={{ fontSize: 24, margin: "6px 0 2px" }}>Coletar cidade inteira</h1>
      <p style={{ color: "var(--muted)", marginTop: 0, fontSize: 14 }}>
        Enumera todos os anúncios (via sitemap) e coleta um por um, pulando os já
        salvos. Deixe a aba aberta durante a coleta.
      </p>

      <div style={{ ...card, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input style={{ ...input, flex: 2, minWidth: 160 }} type="password" value={token}
          onChange={(e) => { setToken(e.target.value); localStorage.setItem("admin_token", e.target.value); }}
          placeholder="senha do painel" />
        <input style={{ ...input, width: 140 }} value={citySlug} onChange={(e) => setCitySlug(e.target.value)} placeholder="cidade-slug" />
        <button style={{ ...btn, opacity: busy ? 0.6 : 1 }} onClick={prepare} disabled={busy}>
          1. Preparar (grátis)
        </button>
      </div>

      {msg && <p style={{ marginTop: 12, fontSize: 14 }}>{msg}</p>}

      {queue.length > 0 && (
        <div style={{ ...card, marginTop: 12 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            {!busy || abort.current ? (
              <button style={btn} onClick={run}>
                {done > 0 ? "Continuar coleta" : `2. Coletar ${queue.length}`}
              </button>
            ) : (
              <button style={{ ...btn, background: "#b5651d" }} onClick={() => (abort.current = true)}>
                ⏹ Parar
              </button>
            )}
          </div>

          <div style={{ height: 10, background: "var(--border)", borderRadius: 5, overflow: "hidden" }}>
            <div style={{ width: `${pct}%`, height: "100%", background: "var(--accent)", transition: "width .2s" }} />
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 10, fontSize: 13 }}>
            <span>{done}/{queue.length}</span>
            <span>✅ {saved} salvos</span>
            <span>⏭ {skipped} já tinha</span>
            <span>🟢 JSON-LD {jsonld}</span>
            <span>🤖 IA {ai}</span>
            <span style={{ fontWeight: 700 }}>US$ {cost.toFixed(4)}</span>
          </div>

          {logs.length > 0 && (
            <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, color: "var(--muted)", maxHeight: 200, overflow: "auto", marginTop: 10, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
              {logs.map((l, i) => <div key={i}>{l}</div>)}
            </div>
          )}
        </div>
      )}
    </main>
  );
}
