"use client";

// ── Aba: Coletar um site específico ───────────────────────────────────
// Passo 1: buscar os anúncios de UMA página de listagem (grátis).
// Passo 2: coletar quantos você quiser, vendo o custo ao vivo.
// Recebe senha e cidade da página pai.

import { useRef, useState } from "react";

interface DiscoverResp { cityId: string; agencyId: string | null; total: number; links: string[] }
interface CollectResp { url: string; saved: boolean; error?: string; estimatedCostUSD: number }

const box: React.CSSProperties = {
  background: "var(--paper)", border: "1px solid var(--border)",
  borderRadius: "var(--radius)", padding: 16, boxShadow: "var(--shadow-sm)",
};
const input: React.CSSProperties = {
  width: "100%", padding: "9px 11px", borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border)", background: "var(--paper)", color: "var(--ink)", fontSize: 14,
};
const label: React.CSSProperties = { fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 };
const btn: React.CSSProperties = {
  padding: "10px 16px", borderRadius: "var(--radius-sm)", border: "none",
  background: "var(--accent)", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer", boxShadow: "var(--shadow-sm)",
};

export default function ColetarSite({ token, citySlug, cityName, uf }: { token: string; citySlug: string; cityName: string; uf: string }) {
  const [listingUrl, setListingUrl] = useState("");
  const [agencyName, setAgencyName] = useState("");
  const [keywords, setKeywords] = useState("terreno");
  const [model, setModel] = useState("gpt-5-nano");
  const [maxItems, setMaxItems] = useState(3);

  const [discovering, setDiscovering] = useState(false);
  const [disc, setDisc] = useState<DiscoverResp | null>(null);
  const [collecting, setCollecting] = useState(false);
  const [done, setDone] = useState(0);
  const [saved, setSaved] = useState(0);
  const [cost, setCost] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [msg, setMsg] = useState("");
  const abort = useRef(false);

  const headers = () => ({ "content-type": "application/json", "x-admin-token": token });
  const log = (s: string) => setLogs((l) => [s, ...l].slice(0, 50));

  async function doDiscover() {
    setMsg(""); setDisc(null); setDone(0); setSaved(0); setCost(0); setLogs([]);
    setDiscovering(true);
    try {
      const kw = keywords.split(",").map((s) => s.trim()).filter(Boolean);
      const res = await fetch("/api/discover", {
        method: "POST", headers: headers(),
        body: JSON.stringify({ listingUrl, citySlug, cityName, uf, agencyName, keywords: kw }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setDisc(data);
      setMaxItems(Math.min(3, data.total || 0));
      setMsg(`Encontrados ${data.total} anúncios. Nenhum custo até aqui.`);
    } catch (e) {
      setMsg("Erro: " + (e as Error).message);
    } finally {
      setDiscovering(false);
    }
  }

  async function doCollect() {
    if (!disc) return;
    abort.current = false;
    setCollecting(true); setDone(0); setSaved(0); setCost(0); setLogs([]);
    const links = disc.links.slice(0, maxItems);
    for (const url of links) {
      if (abort.current) { log("⏹ Interrompido."); break; }
      try {
        const res = await fetch("/api/collect", {
          method: "POST", headers: headers(),
          body: JSON.stringify({ url, cityId: disc.cityId, agencyId: disc.agencyId, listingUrl, model, cityName, uf }),
        });
        const data: CollectResp = await res.json();
        setDone((n) => n + 1);
        setCost((c) => c + (data.estimatedCostUSD || 0));
        if (data.saved) { setSaved((n) => n + 1); log(`✅ ${short(url)}`); }
        else log(`⚠️ ${short(url)} — ${data.error ?? "falhou"}`);
      } catch (e) {
        setDone((n) => n + 1);
        log(`❌ ${short(url)} — ${(e as Error).message}`);
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    setCollecting(false);
  }

  const short = (u: string) => (u.length > 48 ? u.slice(0, 48) + "…" : u);
  const total = disc?.total ?? 0;
  const pct = maxItems ? Math.round((done / maxItems) * 100) : 0;

  return (
    <div>
      <p style={{ color: "var(--muted)", marginTop: 0, fontSize: 13.5 }}>
        Adicione uma imobiliária avulsa: informe a página de listagem (ex.: /terrenos),
        busque (grátis) e colete quantos anúncios quiser.
      </p>

      <div style={{ ...box, display: "grid", gap: 12 }}>
        <div>
          <label style={label}>URL da página de terrenos/imóveis</label>
          <input style={input} value={listingUrl} onChange={(e) => setListingUrl(e.target.value)}
            placeholder="https://imobiliaria.com.br/terrenos" />
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: 2, minWidth: 160 }}>
            <label style={label}>Imobiliária</label>
            <input style={input} value={agencyName} onChange={(e) => setAgencyName(e.target.value)} placeholder="Nome da imobiliária" />
          </div>
          <div style={{ flex: 1, minWidth: 120 }}>
            <label style={label}>Palavras no link</label>
            <input style={input} value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="terreno,imovel" />
          </div>
        </div>
        <button style={{ ...btn, opacity: discovering || !listingUrl || !token ? 0.6 : 1 }}
          onClick={doDiscover} disabled={discovering || !listingUrl || !token}>
          {discovering ? "Buscando…" : "1. Buscar anúncios (grátis)"}
        </button>
      </div>

      {msg && <p style={{ marginTop: 12, fontSize: 14, color: "var(--muted)" }}>{msg}</p>}

      {disc && total > 0 && (
        <div style={{ ...box, marginTop: 16, display: "grid", gap: 12 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 120 }}>
              <label style={label}>Quantos coletar (de {total})</label>
              <input style={input} type="number" min={1} max={total} value={maxItems} onChange={(e) => setMaxItems(Number(e.target.value))} />
            </div>
            <div style={{ flex: 1, minWidth: 140 }}>
              <label style={label}>Modelo da IA</label>
              <select style={input} value={model} onChange={(e) => setModel(e.target.value)}>
                <option value="gpt-5-nano">GPT-5 Nano (mais barato)</option>
                <option value="claude-haiku-4-5">Haiku (barato)</option>
                <option value="claude-sonnet-5">Sonnet (meio-termo)</option>
                <option value="claude-opus-5">Opus (máxima qualidade)</option>
              </select>
            </div>
          </div>
          {!collecting ? (
            <button style={btn} onClick={doCollect}>
              2. Coletar {maxItems} anúncio{maxItems > 1 ? "s" : ""}
            </button>
          ) : (
            <button style={{ ...btn, background: "var(--warn)" }} onClick={() => (abort.current = true)}>⏹ Parar</button>
          )}

          {(collecting || done > 0) && (
            <div>
              <div style={{ height: 8, background: "var(--border)", borderRadius: 4, overflow: "hidden" }}>
                <div style={{ width: `${pct}%`, height: "100%", background: "var(--accent)", transition: "width .2s" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 13 }}>
                <span>{done}/{maxItems} · {saved} salvos</span>
                <span style={{ fontWeight: 600 }}>custo: US$ {cost.toFixed(4)}</span>
              </div>
            </div>
          )}

          {logs.length > 0 && (
            <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, color: "var(--muted)", maxHeight: 180, overflow: "auto", borderTop: "1px solid var(--border)", paddingTop: 8 }}>
              {logs.map((l, i) => <div key={i}>{l}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
