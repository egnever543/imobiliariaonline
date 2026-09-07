"use client";

// ── Descoberta de imobiliárias + análise de padrões ───────────────────
// Roda na Vercel (que tem acesso à internet e à chave do Google). Mostra o
// relatório e um JSON copiável para análise.

import { useEffect, useState } from "react";

interface Fp {
  platform: string;
  ok: boolean;
  status?: number;
  hasJsonLd: boolean;
  likelyJsRendered: boolean;
  candidateListingUrls: string[];
  error?: string;
}
interface Row {
  name: string;
  website: string | null;
  fingerprint: Fp | null;
}
interface Report {
  found: number;
  withSite: number;
  savedAgencies: number;
  byPlatform: Record<string, number>;
  report: Row[];
}

const input: React.CSSProperties = {
  padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)",
  background: "transparent", color: "var(--ink)", fontSize: 14,
};
const btn: React.CSSProperties = {
  padding: "10px 16px", borderRadius: 8, border: "none",
  background: "var(--accent)", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer",
};

export default function Descobrir() {
  const [token, setToken] = useState("");
  const [citySlug, setCitySlug] = useState("itapoa-sc");
  const [cityName, setCityName] = useState("Itapoá");
  const [uf, setUf] = useState("SC");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [data, setData] = useState<Report | null>(null);

  useEffect(() => setToken(localStorage.getItem("admin_token") ?? ""), []);

  async function run() {
    setBusy(true);
    setMsg("");
    setData(null);
    try {
      const res = await fetch("/api/discover-agencies", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-token": token },
        body: JSON.stringify({ citySlug, cityName, uf }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      setData(d);
      setMsg(`${d.found} imobiliárias encontradas · ${d.savedAgencies} salvas.`);
    } catch (e) {
      setMsg("Erro: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "40px 24px 96px" }}>
      <a href="/admin" style={{ fontSize: 13 }}>← painel</a>
      <h1 style={{ fontSize: 24, margin: "6px 0 2px" }}>Descobrir imobiliárias</h1>
      <p style={{ color: "var(--muted)", marginTop: 0, fontSize: 14 }}>
        Pesquisa no Google Places, salva as imobiliárias e analisa o padrão de
        cada site. Requer a chave do Google (Places API) nas variáveis da Vercel.
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input style={{ ...input, flex: 2, minWidth: 160 }} type="password"
          value={token} onChange={(e) => { setToken(e.target.value); localStorage.setItem("admin_token", e.target.value); }}
          placeholder="senha do painel" />
        <input style={{ ...input, width: 130 }} value={citySlug} onChange={(e) => setCitySlug(e.target.value)} placeholder="cidade-slug" />
        <input style={{ ...input, width: 110 }} value={cityName} onChange={(e) => setCityName(e.target.value)} placeholder="Cidade" />
        <input style={{ ...input, width: 60 }} value={uf} onChange={(e) => setUf(e.target.value)} placeholder="UF" />
        <button style={{ ...btn, opacity: busy ? 0.6 : 1 }} onClick={run} disabled={busy}>
          {busy ? "Analisando…" : "Descobrir"}
        </button>
      </div>

      {msg && <p style={{ marginTop: 14, fontSize: 14 }}>{msg}</p>}

      {data && (
        <div style={{ marginTop: 20 }}>
          {/* resumo por plataforma */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
            {Object.entries(data.byPlatform).map(([p, n]) => (
              <span key={p} style={{ background: "var(--paper)", border: "1px solid var(--border)", borderRadius: 999, padding: "4px 12px", fontSize: 12.5 }}>
                <b>{p}</b>: {n}
              </span>
            ))}
          </div>

          {/* tabela */}
          <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 10 }}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 620, fontSize: 12.5, background: "var(--paper)" }}>
              <thead>
                <tr>
                  {["Imobiliária", "Plataforma", "JSON-LD", "JS?", "Listagem detectada"].map((h) => (
                    <th key={h} style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid var(--border)", color: "var(--muted)", fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.report.map((r, i) => (
                  <tr key={i}>
                    <td style={td}>{r.name}</td>
                    <td style={td}>{r.fingerprint?.platform ?? (r.website ? "?" : "sem site")}{r.fingerprint?.error ? " ⚠️" : ""}</td>
                    <td style={td}>{r.fingerprint?.hasJsonLd ? "✅" : "—"}</td>
                    <td style={td}>{r.fingerprint?.likelyJsRendered ? "⚠️" : "—"}</td>
                    <td style={{ ...td, maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.fingerprint?.candidateListingUrls[0] ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* JSON copiável */}
          <div style={{ marginTop: 16 }}>
            <button style={{ ...btn, background: "transparent", border: "1px solid var(--accent)", color: "var(--accent)" }}
              onClick={() => navigator.clipboard.writeText(JSON.stringify(data, null, 2))}>
              Copiar relatório (JSON)
            </button>
            <p style={{ fontSize: 12.5, color: "var(--muted)" }}>
              Copie e cole aqui no chat para eu analisar os padrões e afinar o leitor.
            </p>
            <pre style={{ background: "var(--paper)", border: "1px solid var(--border)", borderRadius: 10, padding: 12, fontSize: 11, overflow: "auto", maxHeight: 300 }}>
              {JSON.stringify(data, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </main>
  );
}

const td: React.CSSProperties = {
  padding: "8px 10px",
  borderBottom: "1px solid var(--border)",
  verticalAlign: "top",
};
