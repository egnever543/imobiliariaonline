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

interface Est { imoveis: number; cells: number; requests: number; costUSD: number }
interface Done { imoveis: number; cells: number; requests: number; collected: number; saved: number; estimatedCostUSD: number }

export default function Comercios() {
  const [token, setToken] = useState("");
  const [citySlug, setCitySlug] = useState("itapoa-sc");
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
        body: JSON.stringify({ citySlug, dryRun, maxCells: maxCells || undefined }),
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
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 2 }}>
              <label style={label}>Cidade (slug)</label>
              <input style={input} value={citySlug} onChange={(e) => setCitySlug(e.target.value)} placeholder="itapoa-sc" />
            </div>
            <div style={{ flex: 1 }}>
              <label style={label}>Máx. de células (0 = todas)</label>
              <input style={input} type="number" min={0} value={maxCells} onChange={(e) => setMaxCells(Number(e.target.value))} />
            </div>
          </div>
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
              <Stat n={est.cells} l="células" />
              <Stat n={est.requests} l="requisições" />
              <Stat n={usd(est.costUSD)} l="custo estimado" hot />
            </div>
            <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 10 }}>
              Se ficar caro, reduza com “máx. de células”. Coleta uma vez por cidade
              (o resultado fica salvo).
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
