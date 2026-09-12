"use client";

// ── Vitrine de imóveis ────────────────────────────────────────────────
// Grade estilo portal com foto, atributos e selos do que falta. Melhor que o
// mapa para revisar o que está incompleto.

import { useMemo, useState } from "react";

export interface Card {
  id: string;
  title: string | null;
  type: string | null;
  price: number | null;
  area_total_m2: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  parking: number | null;
  neighborhood: string | null;
  lat: number | null;
  image_url: string | null;
  status: string | null;
  source_url: string;
  agency: string;
}

const money = (v: number | null) => (v ? "R$ " + v.toLocaleString("pt-BR") : "Consulte");
const area = (v: number | null) => (v ? v.toLocaleString("pt-BR") + " m²" : null);

function missing(c: Card): string[] {
  const m: string[] = [];
  if (!c.image_url) m.push("sem foto");
  if (!c.price) m.push("sem preço");
  if (!c.area_total_m2) m.push("sem área");
  if (c.lat == null) m.push("sem localização");
  return m;
}

function Thumb({ src, alt }: { src: string | null; alt: string }) {
  const [err, setErr] = useState(false);
  const show = src && !err;
  return (
    <div style={{
      aspectRatio: "4 / 3", background: "var(--paper-2)", borderRadius: "10px 10px 0 0",
      overflow: "hidden", display: "grid", placeItems: "center", borderBottom: "1px solid var(--border)",
    }}>
      {show ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src!} alt={alt} loading="lazy" onError={() => setErr(true)}
          style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        <span style={{ color: "var(--muted)", fontSize: 12 }}>sem foto</span>
      )}
    </div>
  );
}

export default function Catalogo({ listings }: { listings: Card[] }) {
  const [tipo, setTipo] = useState("");
  const [bairro, setBairro] = useState("");
  const [q, setQ] = useState("");
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);

  const tipos = useMemo(() => [...new Set(listings.map((l) => l.type).filter(Boolean))].sort() as string[], [listings]);
  const bairros = useMemo(() => [...new Set(listings.map((l) => l.neighborhood).filter(Boolean))].sort() as string[], [listings]);

  const shown = useMemo(() => listings.filter((l) => {
    if (tipo && l.type !== tipo) return false;
    if (bairro && l.neighborhood !== bairro) return false;
    if (onlyIncomplete && missing(l).length === 0) return false;
    if (q) {
      const s = ((l.title ?? "") + " " + (l.neighborhood ?? "") + " " + l.agency).toLowerCase();
      if (!s.includes(q.toLowerCase())) return false;
    }
    return true;
  }), [listings, tipo, bairro, onlyIncomplete, q]);

  const field: React.CSSProperties = {
    padding: "8px 10px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)",
    background: "var(--paper)", color: "var(--ink)", fontSize: 13,
  };

  return (
    <main style={{ maxWidth: 1180, margin: "0 auto", padding: "28px 20px 80px" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 26, margin: 0 }}>Imóveis</h1>
          <p style={{ color: "var(--muted)", margin: "2px 0 0", fontSize: 14 }}>{shown.length} imóveis</p>
        </div>
        <a href="/mapa" style={{ fontSize: 13 }}>ver no mapa →</a>
      </div>

      {/* filtros */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
        <select style={field} value={tipo} onChange={(e) => setTipo(e.target.value)}>
          <option value="">Tipo: todos</option>
          {tipos.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select style={field} value={bairro} onChange={(e) => setBairro(e.target.value)}>
          <option value="">Bairro: todos</option>
          {bairros.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <input style={{ ...field, flex: 1, minWidth: 160 }} placeholder="buscar título/bairro/imobiliária…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, cursor: "pointer" }}>
          <input type="checkbox" checked={onlyIncomplete} onChange={(e) => setOnlyIncomplete(e.target.checked)} style={{ accentColor: "var(--accent)", width: 16, height: 16 }} />
          só incompletos
        </label>
      </div>

      {/* grade */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 14, marginTop: 18 }}>
        {shown.map((c) => {
          const miss = missing(c);
          const p2 = c.price && c.area_total_m2 ? Math.round(c.price / c.area_total_m2) : null;
          return (
            <div key={c.id} className="card" style={{ padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
              <div style={{ position: "relative" }}>
                <Thumb src={c.image_url} alt={c.title ?? "Imóvel"} />
                {c.status && c.status !== "ativo" && (
                  <span style={{ position: "absolute", top: 8, left: 8, background: "var(--warn)", color: "#fff", fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999 }}>
                    {c.status === "indisponivel" ? "indisponível" : c.status}
                  </span>
                )}
              </div>
              <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: 16, color: "var(--accent)", letterSpacing: "-0.02em" }}>
                  {money(c.price)}
                  {p2 && <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}> · R${p2.toLocaleString("pt-BR")}/m²</span>}
                </div>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {c.type && <span className="chip">{c.type}</span>}
                  {c.bedrooms ? <span style={metaPill}>🛏 {c.bedrooms}</span> : null}
                  {c.parking ? <span style={metaPill}>🚗 {c.parking}</span> : null}
                  {area(c.area_total_m2) ? <span style={metaPill}>📐 {area(c.area_total_m2)}</span> : null}
                </div>
                <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
                  {c.neighborhood ?? "sem bairro"} · {c.agency}
                </div>
                {miss.length > 0 && (
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    {miss.map((m) => (
                      <span key={m} style={{ fontSize: 10.5, fontWeight: 600, color: "var(--warn)", border: "1px solid var(--border)", borderRadius: 999, padding: "1px 7px" }}>{m}</span>
                    ))}
                  </div>
                )}
                <div style={{ marginTop: "auto", display: "flex", gap: 10, paddingTop: 6, fontSize: 12, fontWeight: 600 }}>
                  <a href={c.source_url} target="_blank" rel="noreferrer">anúncio ↗</a>
                  <a href={`/mapa?imovel=${c.id}`} target="_blank" rel="noreferrer">mapa ↗</a>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {shown.length === 0 && (
        <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>Nenhum imóvel com esses filtros.</div>
      )}
    </main>
  );
}

const metaPill: React.CSSProperties = {
  display: "inline-block", padding: "2px 8px", borderRadius: 999,
  background: "var(--paper-2)", border: "1px solid var(--border)", color: "var(--muted)",
  fontSize: 11, fontWeight: 600,
};
