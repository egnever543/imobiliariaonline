"use client";

// ── Adicionar imóveis (coleta num fluxo único) ────────────────────────
// Junta o que antes eram 3 páginas (Descobrir imobiliárias, Coletar cidade,
// Coletar um site) numa só: você digita a senha e a cidade UMA vez e escolhe a
// etapa por abas. As rotas de API são as mesmas.

import { useEffect, useState } from "react";
import Nav from "@/components/Nav";
import Descobrir from "./Descobrir";
import ColetarCidade from "./ColetarCidade";
import ColetarSite from "./ColetarSite";

const box: React.CSSProperties = {
  background: "var(--paper)", border: "1px solid var(--border)",
  borderRadius: "var(--radius)", padding: 16, boxShadow: "var(--shadow-sm)",
};
const input: React.CSSProperties = {
  padding: "9px 11px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)",
  background: "var(--paper)", color: "var(--ink)", fontSize: 14,
};
const label: React.CSSProperties = { fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 };

type Tab = "descobrir" | "cidade" | "site";
const TABS: { id: Tab; label: string }[] = [
  { id: "descobrir", label: "1. Descobrir imobiliárias" },
  { id: "cidade", label: "2. Coletar a cidade" },
  { id: "site", label: "＋ Um site" },
];

export default function AdicionarImoveis() {
  const [token, setToken] = useState("");
  const [citySlug, setCitySlug] = useState("itapoa-sc");
  const [cityName, setCityName] = useState("Itapoá");
  const [uf, setUf] = useState("SC");
  const [tab, setTab] = useState<Tab>("descobrir");

  useEffect(() => setToken(localStorage.getItem("admin_token") ?? ""), []);
  function saveToken(v: string) { setToken(v); localStorage.setItem("admin_token", v); }

  const city = { token, citySlug, cityName, uf };

  const seg = (on: boolean): React.CSSProperties => ({
    padding: "8px 14px", borderRadius: 9, fontSize: 13.5, fontWeight: 700, cursor: "pointer",
    border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`,
    background: on ? "var(--accent)" : "var(--paper)", color: on ? "#fff" : "var(--muted)",
  });

  return (
    <>
      <Nav />
      <main style={{ maxWidth: 900, margin: "0 auto", padding: "32px 20px 96px" }}>
        <span className="chip">Painel</span>
        <h1 style={{ fontSize: 28, margin: "12px 0 4px" }}>Adicionar imóveis</h1>
        <p style={{ color: "var(--muted)", marginTop: 0, fontSize: 14.5 }}>
          Para abrir uma cidade nova, siga <strong>1 → 2</strong>. Para uma imobiliária
          avulsa, use <strong>Um site</strong>. Preencha a senha e a cidade uma vez só.
        </p>

        {/* Senha + cidade (compartilhados por todas as abas) */}
        <div style={{ ...box, marginTop: 16, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: 2, minWidth: 160 }}>
            <label style={label}>Senha do painel</label>
            <input style={{ ...input, width: "100%" }} type="password" value={token}
              onChange={(e) => saveToken(e.target.value)} placeholder="ADMIN_TOKEN" />
          </div>
          <div style={{ flex: 1, minWidth: 120 }}>
            <label style={label}>Cidade (slug)</label>
            <input style={{ ...input, width: "100%" }} value={citySlug} onChange={(e) => setCitySlug(e.target.value)} placeholder="itapoa-sc" />
          </div>
          <div style={{ flex: 1, minWidth: 110 }}>
            <label style={label}>Cidade (nome)</label>
            <input style={{ ...input, width: "100%" }} value={cityName} onChange={(e) => setCityName(e.target.value)} placeholder="Itapoá" />
          </div>
          <div style={{ width: 64 }}>
            <label style={label}>UF</label>
            <input style={{ ...input, width: "100%" }} value={uf} onChange={(e) => setUf(e.target.value)} placeholder="SC" />
          </div>
        </div>

        {/* Abas */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
          {TABS.map((t) => (
            <button key={t.id} style={seg(tab === t.id)} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </div>

        <div style={{ marginTop: 16 }}>
          {tab === "descobrir" && <Descobrir {...city} />}
          {tab === "cidade" && <ColetarCidade token={token} citySlug={citySlug} />}
          {tab === "site" && <ColetarSite {...city} />}
        </div>
      </main>
    </>
  );
}
