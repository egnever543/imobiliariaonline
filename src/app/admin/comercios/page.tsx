"use client";

// ── Coleta de comércios (POIs) ────────────────────────────────────────
// Puxa escola/farmácia/mercado/saúde etc. em volta dos imóveis da cidade
// (Google Places) para o mapa de calor e a nota de vizinhança.
// Sempre estima o custo (grátis) antes de coletar.

import { useEffect, useState } from "react";
import Nav from "@/components/Nav";

const box: React.CSSProperties = {
  background: "var(--paper)", border: "1px solid var(--border)",
  borderRadius: "var(--radius)", padding: 20, boxShadow: "var(--shadow-sm)",
};
const input: React.CSSProperties = {
  width: "100%", padding: "9px 11px", borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border)", background: "var(--paper)",
  color: "var(--ink)", fontSize: 14,
};
const label: React.CSSProperties = { fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 };

interface Est { imoveis: number; cells?: number; requests: number; costUSD: number; gratis?: boolean; provider?: string }
interface Done { imoveis: number; cells: number; requests: number; collected: number; saved: number; estimatedCostUSD: number }

export default function Comercios() {
  const [token, setToken] = useState("");
  const [citySlug, setCitySlug] = useState("itapoa-sc");
  const [provider, setProvider] = useState<"osm" | "google">("osm");
  const [mode, setMode] = useState<"city" | "listings">("city");
  const [maxCells, setMaxCells] = useState(0);
  const [busy, setBusy] = useState(false);
  const [est, setEst] = useState<Est | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [msg, setMsg] = useState("");

  useEffect(() => { setToken(localStorage.getItem("admin_token") ?? ""); }, []);
  function saveToken(v: string) { setToken(v); localStorage.setItem("admin_token", v); }
  function headers() { return { "content-type": "application/json", "x-admin-token": token }; }

  async function call(dryRun: boolean) {
    setBusy(true); setMsg(""); if (dryRun) setDone(null);
    try {
      const res = await fetch("/api/pois/collect", {
        method: "POST", headers: headers(),
        body: JSON.stringify({ citySlug, provider, mode, dryRun, maxCells: maxCells || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (dryRun) { setEst(data); setMsg(""); }
      else { setDone(data); setEst(null); setMsg("✅ Comércios coletados. Ative o 🔥 no mapa."); }
    } catch (e) {
      setMsg("Erro: " + (e as Error).message);
    } finally { setBusy(false); }
  }

  const usd = (v: number) => "US$ " + v.toFixed(v < 1 ? 4 : 2);

  return (
    <>
      <Nav />
      <main style={{ maxWidth: 640, margin: "0 auto", padding: "40px 24px 96px" }}>
        <span className="chip">Painel</span>
        <h1 style={{ fontSize: 30, margin: "12px 0 4px" }}>Coletar comércios (mapa de calor)</h1>
        <p style={{ color: "var(--muted)", marginTop: 0, fontSize: 15 }}>
          Puxa escola, farmácia, mercado, saúde e afins em volta dos imóveis já
          geolocalizados — para o mapa de calor de valorização e a nota de
          vizinhança. Estime o custo antes de coletar.
        </p>

        <div style={{ ...box, marginTop: 20, display: "grid", gap: 12 }}>
          <div>
            <label style={label}>Senha do painel (ADMIN_TOKEN)</label>
            <input style={input} type="password" value={token} onChange={(e) => saveToken(e.target.value)} placeholder="a mesma do servidor" />
          </div>
          <div>
            <label style={label}>Cidade (slug)</label>
            <input style={input} value={citySlug} onChange={(e) => setCitySlug(e.target.value)} placeholder="itapoa-sc" />
          </div>

          <div>
            <label style={label}>Fonte dos comércios</label>
            <div style={{ display: "flex", gap: 8 }}>
              {([
                ["osm", "OpenStreetMap · grátis"],
                ["google", "Google · pago"],
              ] as const).map(([p, lbl]) => (
                <button key={p} onClick={() => { setProvider(p); setEst(null); }}
                  style={{
                    flex: 1, padding: "9px 10px", borderRadius: "var(--radius-sm)", fontSize: 13, fontWeight: 600, cursor: "pointer",
                    border: `1px solid ${provider === p ? "var(--accent)" : "var(--border)"}`,
                    background: provider === p ? "var(--accent)" : "var(--paper)",
                    color: provider === p ? "#fff" : "var(--muted)",
                  }}>
                  {lbl}
                </button>
              ))}
            </div>
            <p style={{ fontSize: 12, color: "var(--muted)", margin: "6px 0 0" }}>
              {provider === "osm"
                ? "1 consulta cobre a cidade inteira, sem custo. Traz escola, farmácia, mercado, saúde, banco, praça… (sem nota de avaliação)."
                : "Mais completo e com nota, mas cobra por requisição e varre a cidade em grade. Use se quiser filtrar por qualidade."}
            </p>
          </div>

          {provider === "google" && (
            <>
              <div>
                <label style={label}>Cobertura</label>
                <div style={{ display: "flex", gap: 8 }}>
                  {([
                    ["city", "Cidade (redondezas)"],
                    ["listings", "Perto dos imóveis"],
                  ] as const).map(([m, lbl]) => (
                    <button key={m} onClick={() => { setMode(m); setEst(null); }}
                      style={{
                        flex: 1, padding: "9px 10px", borderRadius: "var(--radius-sm)", fontSize: 13, fontWeight: 600, cursor: "pointer",
                        border: `1px solid ${mode === m ? "var(--accent)" : "var(--border)"}`,
                        background: mode === m ? "var(--accent)" : "var(--paper)",
                        color: mode === m ? "#fff" : "var(--muted)",
                      }}>
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label style={label}>Máx. de células (0 = todas)</label>
                <input style={input} type="number" min={0} value={maxCells} onChange={(e) => setMaxCells(Number(e.target.value))} />
              </div>
            </>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-ghost" onClick={() => call(true)} disabled={busy || !token}>
              {busy ? "…" : "1. Estimar (grátis)"}
            </button>
            <button className="btn" onClick={() => call(false)} disabled={busy || !token || !est}
              title={!est ? "Estime primeiro" : ""}>
              2. Coletar comércios
            </button>
          </div>
        </div>

        {est && (
          <div style={{ ...box, marginTop: 16 }}>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>Estimativa (nada foi gasto)</div>
            <div style={{ display: "flex", gap: 18, marginTop: 8, flexWrap: "wrap" }}>
              <Stat n={est.imoveis} l="imóveis" />
              {est.cells != null && <Stat n={est.cells} l="células" />}
              <Stat n={est.requests} l="requisições" />
              <Stat n={est.gratis ? "grátis" : usd(est.costUSD)} l="custo estimado" hot />
            </div>
            <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 10 }}>
              {est.gratis
                ? "OpenStreetMap: 1 consulta cobre a cidade inteira, sem custo. Pode coletar."
                : "Se ficar caro, reduza com “máx. de células”. Coleta uma vez por cidade (o resultado fica salvo)."}
            </p>
          </div>
        )}

        {done && (
          <div style={{ ...box, marginTop: 16 }}>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>Coleta concluída</div>
            <div style={{ display: "flex", gap: 18, marginTop: 8, flexWrap: "wrap" }}>
              <Stat n={done.collected} l="comércios" />
              <Stat n={done.saved} l="salvos" />
              <Stat n={done.requests} l="requisições" />
              <Stat n={usd(done.estimatedCostUSD)} l="custo" hot />
            </div>
            <a href="/mapa" className="btn" style={{ marginTop: 12 }}>Ver no mapa →</a>
          </div>
        )}

        {msg && <p style={{ marginTop: 12, fontSize: 14, color: "var(--muted)" }}>{msg}</p>}
      </main>
    </>
  );
}

function Stat({ n, l, hot }: { n: number | string; l: string; hot?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em", color: hot ? "var(--accent)" : "var(--ink)" }}>{n}</div>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>{l}</div>
    </div>
  );
}
