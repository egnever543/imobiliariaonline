"use client";

// ── Aba: Descobrir imobiliárias (Google Places) ───────────────────────
// Pesquisa no Google Places, salva as imobiliárias e analisa o padrão de cada
// site. Recebe senha e cidade da página pai. Requer a chave do Google na Vercel.

import { useState } from "react";

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

const btn: React.CSSProperties = {
  padding: "10px 16px", borderRadius: 8, border: "none",
  background: "var(--accent)", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer",
};
const td: React.CSSProperties = { padding: "8px 10px", borderBottom: "1px solid var(--border)", verticalAlign: "top" };

export default function Descobrir({ token, citySlug, cityName, uf }: { token: string; citySlug: string; cityName: string; uf: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [data, setData] = useState<Report | null>(null);

  async function run() {
    setBusy(true); setMsg(""); setData(null);
    try {
      const res = await fetch("/api/discover-agencies", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-token": token },
        body: JSON.stringify({ citySlug, cityName, uf }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      setData(d);
      setMsg(`${d.found} imobiliárias encontradas · ${d.savedAgencies} salvas. Agora vá para “Coletar a cidade”.`);
    } catch (e) {
      setMsg("Erro: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p style={{ color: "var(--muted)", marginTop: 0, fontSize: 13.5 }}>
        Busca as imobiliárias da cidade no Google Places, salva cada uma e detecta o
        padrão do site. Requer a chave do Google (Places API) na Vercel.
      </p>
      <button style={{ ...btn, opacity: busy || !token ? 0.6 : 1 }} onClick={run} disabled={busy || !token}>
        {busy ? "Analisando…" : "Descobrir imobiliárias"}
      </button>

      {msg && <p style={{ marginTop: 14, fontSize: 14 }}>{msg}</p>}

      {data && (
        <div style={{ marginTop: 20 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
            {Object.entries(data.byPlatform).map(([p, n]) => (
              <span key={p} style={{ background: "var(--paper)", border: "1px solid var(--border)", borderRadius: 999, padding: "4px 12px", fontSize: 12.5 }}>
                <b>{p}</b>: {n}
              </span>
            ))}
          </div>

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
    </div>
  );
}
