"use client";

// ── Análise: "o melhor imóvel para X" ─────────────────────────────────
// Você escolhe o objetivo (investir, morar, custo-benefício…) e o sistema
// mostra os melhores imóveis rankeados, com preço justo, desconto e motivos.
// O mapa vira apoio (link "ver no mapa"). É a porta de entrada do produto.

import { useMemo, useState } from "react";
import Link from "next/link";
import Nav from "@/components/Nav";
import { scoreListings, type ScorableListing, type ListingInsight } from "@/lib/scoring/score";
import { SCORE_PROFILES } from "@/lib/scoring/profiles";
import { ITAPOA_COASTLINE } from "@/lib/scoring/coastline";
import { buildReasons } from "@/lib/scoring/reasons";

export interface Item {
  id: string;
  title: string | null;
  type: string | null;
  price: number | null;
  area_total_m2: number | null;
  built_area_m2: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  suites: number | null;
  parking: number | null;
  neighborhood: string | null;
  street: string | null;
  cep: string | null;
  lat: number | null;
  lng: number | null;
  geo_method: string | null;
  image_url: string | null;
  source_url: string;
  agency: string;
}
export interface Poi { category: string; lat: number; lng: number }

// objetivos (mapeiam para os perfis de peso já existentes)
const OBJECTIVES: { id: string; label: string; emoji: string; tagline: string }[] = [
  { id: "investidor", label: "Investir", emoji: "📈", tagline: "melhor oportunidade abaixo do mercado" },
  { id: "moradia", label: "Morar", emoji: "🏠", tagline: "melhor infraestrutura e conveniência" },
  { id: "custo_beneficio", label: "Custo-benefício", emoji: "⚖️", tagline: "melhor equilíbrio geral" },
  { id: "menor_custo", label: "Menor custo", emoji: "💰", tagline: "menor preço por m²" },
];

const money = (v: number | null) => (v ? "R$ " + v.toLocaleString("pt-BR") : "Consulte");
const perM2 = (i: Item) => (i.price && i.area_total_m2 ? Math.round(i.price / i.area_total_m2) : null);
const scoreColor = (s: number) => (s >= 70 ? "#10b981" : s >= 50 ? "#f59e0b" : s >= 35 ? "#f97316" : "#ef4444");
const scoreLabel = (s: number) => (s >= 70 ? "Excelente" : s >= 50 ? "Bom" : s >= 35 ? "Regular" : "Fraco");

function Photo({ src, alt, wrap, labelSize = 12 }: { src: string | null; alt: string; wrap: React.CSSProperties; labelSize?: number }) {
  const [err, setErr] = useState(false);
  const ok = src && !err;
  return (
    <div style={{ background: "var(--paper-2)", overflow: "hidden", flexShrink: 0, display: "grid", placeItems: "center", border: "1px solid var(--border)", ...wrap }}>
      {ok ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src!} alt={alt} loading="lazy" onError={() => setErr(true)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        <span style={{ color: "var(--muted)", fontSize: labelSize }}>sem foto</span>
      )}
    </div>
  );
}

function DiscountChip({ pct }: { pct: number | null }) {
  if (pct == null) return null;
  const good = pct >= 0;
  const v = Math.round(Math.abs(pct) * 100);
  if (v < 3) return <span style={{ ...chip, background: "var(--paper-2)", color: "var(--muted)" }}>no preço de mercado</span>;
  return (
    <span style={{ ...chip, background: good ? "rgba(16,157,118,.12)" : "rgba(212,68,59,.12)", color: good ? "var(--ok)" : "var(--danger)" }}>
      {good ? "▼" : "▲"} {v}% {good ? "abaixo" : "acima"} do mercado
    </span>
  );
}

const TOP_N = 30;

export default function Analise({ items, pois, coastline }: { items: Item[]; pois: Poi[]; coastline?: [number, number][][] }) {
  const coast = useMemo<[number, number][][]>(() => (coastline?.length ? coastline : [ITAPOA_COASTLINE]), [coastline]);
  const [obj, setObj] = useState("investidor");
  const [tipo, setTipo] = useState("");
  const [bairro, setBairro] = useState("");
  const [pmax, setPmax] = useState("");
  const [completeOnly, setCompleteOnly] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const tipos = useMemo(() => [...new Set(items.map((i) => i.type).filter(Boolean))].sort() as string[], [items]);
  const bairros = useMemo(() => [...new Set(items.map((i) => i.neighborhood).filter(Boolean))].sort() as string[], [items]);

  const filtered = useMemo(() => {
    const mx = parseInt(pmax.replace(/\D/g, "")) || Infinity;
    return items.filter((i) => {
      if (completeOnly && (!i.price || !i.area_total_m2)) return false;
      if (tipo && i.type !== tipo) return false;
      if (bairro && i.neighborhood !== bairro) return false;
      if (i.price && i.price > mx) return false;
      return true;
    });
  }, [items, tipo, bairro, pmax, completeOnly]);

  const profile = SCORE_PROFILES.find((p) => p.id === obj) ?? SCORE_PROFILES[0];

  const ranked = useMemo(() => {
    const scorable: ScorableListing[] = filtered.map((i) => ({
      id: i.id, price: i.price, area_total_m2: i.area_total_m2,
      lat: i.lat, lng: i.lng, geo_method: i.geo_method,
      neighborhood: i.neighborhood, type: i.type,
    }));
    const res = scoreListings(scorable, { weights: profile.weights, coastline: coast, pois });
    const byId = new Map(filtered.map((i) => [i.id, i]));
    return res
      .map((r) => ({ item: byId.get(r.id)!, score: r.score, insight: r.insight }))
      .filter((x) => x.item);
  }, [filtered, profile, pois, coast]);

  const top = ranked.slice(0, TOP_N);
  const hero = top[0];
  const rest = top.slice(1);
  const objMeta = OBJECTIVES.find((o) => o.id === obj)!;

  function reasonsFor(item: Item, insight: ListingInsight) {
    return buildReasons({ lat: item.lat, lng: item.lng, insight, pois, coastline: coast });
  }

  return (
    <>
      <Nav />
      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 20px 90px" }}>
        <span className="chip">Análise inteligente</span>
        <h1 style={{ fontSize: 28, margin: "10px 0 4px" }}>Os melhores imóveis da cidade</h1>
        <p style={{ color: "var(--muted)", margin: 0, fontSize: 15 }}>
          Escolha seu objetivo — o Radar ranqueia por preço justo, localização e comércios,
          e mostra <strong>por que</strong> cada um se destaca.
        </p>

        {/* objetivo */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 18 }}>
          {OBJECTIVES.map((o) => {
            const on = o.id === obj;
            return (
              <button key={o.id} onClick={() => setObj(o.id)} style={{
                display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderRadius: 12, cursor: "pointer",
                border: `1.5px solid ${on ? "var(--accent)" : "var(--border)"}`,
                background: on ? "var(--accent)" : "var(--paper)", color: on ? "#fff" : "var(--ink)",
                fontWeight: 700, fontSize: 14.5, boxShadow: on ? "var(--shadow-sm)" : "none",
              }}>
                <span style={{ fontSize: 18 }}>{o.emoji}</span> {o.label}
              </button>
            );
          })}
        </div>
        <p style={{ color: "var(--muted)", margin: "8px 2px 0", fontSize: 13 }}>
          Mostrando o melhor para <strong>{objMeta.label.toLowerCase()}</strong> — {objMeta.tagline}.
        </p>

        {/* filtros (recolhíveis) */}
        <div style={{ marginTop: 14 }}>
          <button onClick={() => setFiltersOpen((v) => !v)} style={{
            padding: "7px 12px", borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: "pointer",
            border: "1px solid var(--border)", background: "var(--paper)", color: "var(--muted)",
          }}>
            ⚙️ Filtros {filtersOpen ? "▲" : "▾"}
          </button>
          {filtersOpen && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              <select style={field} value={tipo} onChange={(e) => setTipo(e.target.value)}>
                <option value="">Tipo: todos</option>
                {tipos.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <select style={field} value={bairro} onChange={(e) => setBairro(e.target.value)}>
                <option value="">Bairro: todos</option>
                {bairros.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
              <input style={{ ...field, width: 150 }} placeholder="Preço máx (R$)" value={pmax} onChange={(e) => setPmax(e.target.value)} inputMode="numeric" />
              <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, cursor: "pointer" }}>
                <input type="checkbox" checked={completeOnly} onChange={(e) => setCompleteOnly(e.target.checked)} style={{ accentColor: "var(--accent)", width: 16, height: 16 }} />
                só com preço e área
              </label>
            </div>
          )}
        </div>

        {ranked.length === 0 ? (
          <div className="card" style={{ padding: 40, textAlign: "center", color: "var(--muted)", marginTop: 20 }}>
            Nenhum imóvel com dados suficientes para ranquear.
            {completeOnly && " Tente desmarcar “só com preço e área”, ou rode o Atualizar em lote no painel."}
          </div>
        ) : (
          <>
            {/* HERO — o #1 */}
            {hero && (() => {
              const it = hero.item;
              const rs = reasonsFor(it, hero.insight);
              return (
                <section className="card" style={{ marginTop: 18, padding: 0, overflow: "hidden", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 0 }}>
                  <div style={{ position: "relative", minHeight: 240 }}>
                    <Photo src={it.image_url} alt={it.title ?? "Imóvel"} wrap={{ width: "100%", height: "100%", minHeight: 240, borderRadius: 0, border: "none" }} />
                    <span style={{ position: "absolute", top: 12, left: 12, background: "var(--accent)", color: "#fff", fontSize: 12.5, fontWeight: 800, padding: "4px 12px", borderRadius: 999, boxShadow: "var(--shadow)" }}>
                      🏆 Melhor para {objMeta.label.toLowerCase()}
                    </span>
                  </div>
                  <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ background: scoreColor(hero.score), color: "#fff", borderRadius: 9, padding: "3px 12px", fontSize: 18, fontWeight: 800 }}>{hero.score}</span>
                      <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 600 }}>{scoreLabel(hero.score)}</span>
                    </div>
                    <div>
                      <div style={{ fontSize: 26, fontWeight: 800, color: "var(--accent)", letterSpacing: "-0.02em" }}>{money(it.price)}</div>
                      {perM2(it) && <div style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 600 }}>R$ {perM2(it)!.toLocaleString("pt-BR")}/m²</div>}
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <DiscountChip pct={hero.insight.discountPct} />
                      {hero.insight.fairPrice != null && <span style={{ ...chip, background: "var(--paper-2)", color: "var(--muted)" }}>justo ~{money(hero.insight.fairPrice)}</span>}
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {it.type && <span style={pill}>{it.type}</span>}
                      {it.bedrooms ? <span style={metaPill}>🛏 {it.bedrooms}</span> : null}
                      {it.parking ? <span style={metaPill}>🚗 {it.parking}</span> : null}
                      {it.area_total_m2 ? <span style={metaPill}>📐 {it.area_total_m2.toLocaleString("pt-BR")} m²</span> : null}
                    </div>
                    {rs.length > 0 && (
                      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 5 }}>
                        {rs.map((r, i) => (
                          <li key={i} style={{ fontSize: 13, display: "flex", gap: 7 }}><span style={{ color: "var(--ok)", fontWeight: 800 }}>✓</span>{r}</li>
                        ))}
                      </ul>
                    )}
                    <div style={{ fontSize: 12.5, color: "var(--muted)" }}>{it.neighborhood ?? "sem bairro"} · {it.agency}</div>
                    <div style={{ display: "flex", gap: 10, marginTop: "auto", paddingTop: 6 }}>
                      <Link href={`/mapa?imovel=${it.id}`} className="btn" style={{ flex: 1, textAlign: "center" }}>Ver no mapa →</Link>
                      <a href={it.source_url} target="_blank" rel="noreferrer" className="btn" style={{ flex: 1, textAlign: "center", background: "var(--paper)", color: "var(--ink)", border: "1px solid var(--border)" }}>Anúncio ↗</a>
                    </div>
                  </div>
                </section>
              );
            })()}

            {/* demais colocados */}
            {rest.length > 0 && (
              <>
                <h2 style={{ fontSize: 16, margin: "26px 0 12px" }}>Próximos melhores</h2>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 14 }}>
                  {rest.map((r, idx) => {
                    const it = r.item;
                    const rs = reasonsFor(it, r.insight).slice(0, 2);
                    return (
                      <div key={it.id} className="card" style={{ padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                        <div style={{ position: "relative" }}>
                          <Photo src={it.image_url} alt={it.title ?? "Imóvel"} wrap={{ width: "100%", aspectRatio: "16 / 10", borderRadius: 0, border: "none" }} />
                          <span style={{ position: "absolute", top: 8, left: 8, background: "rgba(15,30,52,.72)", color: "#fff", fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999 }}>#{idx + 2}</span>
                          <span style={{ position: "absolute", top: 8, right: 8, background: scoreColor(r.score), color: "#fff", fontSize: 13, fontWeight: 800, padding: "2px 9px", borderRadius: 8 }}>{r.score}</span>
                        </div>
                        <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
                          <div style={{ fontWeight: 800, fontSize: 16, color: "var(--accent)", letterSpacing: "-0.02em" }}>{money(it.price)}</div>
                          <DiscountChip pct={r.insight.discountPct} />
                          {rs.length > 0 && (
                            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 3 }}>
                              {rs.map((x, i) => <li key={i} style={{ fontSize: 12, color: "var(--muted)", display: "flex", gap: 6 }}><span style={{ color: "var(--ok)" }}>✓</span>{x}</li>)}
                            </ul>
                          )}
                          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{it.neighborhood ?? "sem bairro"} · {it.agency}</div>
                          <div style={{ marginTop: "auto", display: "flex", gap: 10, paddingTop: 6, fontSize: 12, fontWeight: 600 }}>
                            <Link href={`/mapa?imovel=${it.id}`}>mapa →</Link>
                            <a href={it.source_url} target="_blank" rel="noreferrer">anúncio ↗</a>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 18 }}>
              Ranqueando {filtered.length.toLocaleString("pt-BR")} imóveis · <Link href="/admin/avaliacao">como calculamos a nota</Link>
            </p>
          </>
        )}
      </main>
    </>
  );
}

// ── estilos ──
const field: React.CSSProperties = {
  padding: "8px 10px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)",
  background: "var(--paper)", color: "var(--ink)", fontSize: 13,
};
const chip: React.CSSProperties = {
  display: "inline-block", padding: "3px 10px", borderRadius: 999, fontSize: 11.5, fontWeight: 700,
};
const pill: React.CSSProperties = {
  display: "inline-block", padding: "2px 9px", borderRadius: 999,
  background: "var(--accent-weak)", color: "var(--accent-ink)", fontSize: 11, fontWeight: 600,
};
const metaPill: React.CSSProperties = {
  display: "inline-block", padding: "2px 8px", borderRadius: 999,
  background: "var(--paper-2)", border: "1px solid var(--border)", color: "var(--muted)", fontSize: 11, fontWeight: 600,
};
