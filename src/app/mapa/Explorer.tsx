"use client";

// ── Explorador de imóveis ─────────────────────────────────────────────
// App de mercado: mapa em tela cheia + sidebar de filtros/estatísticas +
// cards de imóvel + ranking inteligente. Visual SaaS (branco/azul), tokens
// de tema, cards com sombra e uma barra flutuante de estatísticas no mapa.

import { useEffect, useMemo, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import { scoreListings, type ScorableListing } from "@/lib/scoring/score";
import {
  SCORE_PROFILES,
  DEFAULT_WEIGHTS,
  type Weights,
  type ScoreFactor,
} from "@/lib/scoring/profiles";
import { ITAPOA_COASTLINE } from "@/lib/scoring/coastline";

export interface Listing {
  id: string;
  title: string | null;
  type: string | null;
  price: number | null;
  price_original: number | null;
  area_total_m2: number | null;
  frente_m: number | null;
  comprimento_m: number | null;
  neighborhood: string | null;
  street: string | null;
  cep: string | null;
  lat: number | null;
  lng: number | null;
  geo_method: string | null;
  accepts_permuta: boolean | null;
  source_url: string;
  agency: string;
}

// paleta de imobiliárias (tons distintos, harmonizados com o azul de marca)
const PALETTE = [
  "#2563eb", "#0ea5e9", "#7c3aed", "#0891b2",
  "#f59e0b", "#e11d48", "#10b981", "#f97316",
];
const FACTORS: { key: ScoreFactor; label: string; icon: string; color: string }[] = [
  { key: "beach", label: "Praia", icon: "🏖️", color: "#0ea5e9" },
  { key: "poi", label: "POIs", icon: "📍", color: "#e11d48" },
  { key: "pricePerM2", label: "R$/m²", icon: "💰", color: "#10b981" },
  { key: "geoQuality", label: "Geo", icon: "📌", color: "#2563eb" },
  { key: "area", label: "Área", icon: "📐", color: "#f59e0b" },
];

const fmtPrice = (v: number | null) =>
  v ? "R$ " + v.toLocaleString("pt-BR") : "Consulte";
const shortPrice = (v: number | null) =>
  !v ? "?" : v >= 1e6 ? "R$" + (v / 1e6).toFixed(1) + "M" : v >= 1e3 ? "R$" + Math.round(v / 1e3) + "k" : "R$" + v;
const fmtArea = (v: number | null) =>
  v ? v.toLocaleString("pt-BR") + " m²" : "";
const perM2 = (d: Listing) =>
  d.price && d.area_total_m2 ? Math.round(d.price / d.area_total_m2) : null;
const isApprox = (d: Listing) =>
  d.geo_method === "bairro" || d.geo_method === "fallback" || (!d.street && !d.cep);
const isIncompleto = (d: Listing) =>
  (!d.street && !d.cep) || !d.area_total_m2 || !d.price ||
  d.geo_method === "bairro" || d.geo_method === "fallback" || !d.lat || !d.lng;
const scoreColor = (s: number) =>
  s >= 70 ? "#10b981" : s >= 50 ? "#f59e0b" : s >= 35 ? "#f97316" : "#ef4444";
const scoreLabel = (s: number) =>
  s >= 70 ? "Excelente" : s >= 50 ? "Bom" : s >= 35 ? "Regular" : "Fraco";

export default function Explorer({ listings }: { listings: Listing[] }) {
  // ── cores por imobiliária ──
  const agencies = useMemo(
    () => [...new Set(listings.map((d) => d.agency))].sort(),
    [listings],
  );
  const colors = useMemo(() => {
    const c: Record<string, string> = {};
    agencies.forEach((a, i) => (c[a] = PALETTE[i % PALETTE.length]));
    return c;
  }, [agencies]);
  const bairros = useMemo(
    () => [...new Set(listings.map((d) => d.neighborhood).filter(Boolean))].sort() as string[],
    [listings],
  );
  const tipos = useMemo(
    () => [...new Set(listings.map((d) => d.type).filter(Boolean))].sort() as string[],
    [listings],
  );

  // ── filtros ──
  const [activeAg, setActiveAg] = useState<Set<string>>(new Set());
  const [bairro, setBairro] = useState("");
  const [tipo, setTipo] = useState("");
  const [pmin, setPmin] = useState("");
  const [pmax, setPmax] = useState("");
  const [tab, setTab] = useState<"todos" | "incompleto">("todos");
  useEffect(() => setActiveAg(new Set(agencies)), [agencies]);

  // ── ranking ──
  const [scoreOn, setScoreOn] = useState(false);
  const [weights, setWeights] = useState<Weights>(DEFAULT_WEIGHTS);
  const [profile, setProfile] = useState<string | null>(null);

  // ── filtragem ──
  const filtered = useMemo(() => {
    const mn = parseInt(pmin.replace(/\D/g, "")) || 0;
    const mx = parseInt(pmax.replace(/\D/g, "")) || Infinity;
    return listings.filter((d) => {
      if (!activeAg.has(d.agency)) return false;
      if (d.price && (d.price < mn || d.price > mx)) return false;
      if (bairro && d.neighborhood !== bairro) return false;
      if (tipo && d.type !== tipo) return false;
      if (tab === "incompleto" && !isIncompleto(d)) return false;
      return true;
    });
  }, [listings, activeAg, bairro, tipo, pmin, pmax, tab]);

  // ── scores ──
  const scores = useMemo(() => {
    if (!scoreOn) return {} as Record<string, { score: number; factors: Record<ScoreFactor, number> }>;
    const scorable: ScorableListing[] = filtered.map((d) => ({
      id: d.id, price: d.price, area_total_m2: d.area_total_m2,
      lat: d.lat, lng: d.lng, geo_method: d.geo_method,
    }));
    const res = scoreListings(scorable, { weights, coastline: ITAPOA_COASTLINE });
    const m: Record<string, { score: number; factors: Record<ScoreFactor, number> }> = {};
    res.forEach((r) => (m[r.id] = { score: r.score, factors: r.factors }));
    return m;
  }, [scoreOn, filtered, weights]);

  const visible = useMemo(() => {
    if (!scoreOn) return filtered;
    return [...filtered].sort(
      (a, b) => (scores[b.id]?.score ?? 0) - (scores[a.id]?.score ?? 0),
    );
  }, [filtered, scoreOn, scores]);

  const stats = useMemo(() => {
    const precos = filtered.map((d) => d.price).filter(Boolean) as number[];
    const m2s = filtered.map((d) => perM2(d)).filter(Boolean) as number[];
    return {
      count: filtered.length,
      min: precos.length ? Math.min(...precos) : null,
      max: precos.length ? Math.max(...precos) : null,
      medM2: m2s.length ? Math.round(m2s.reduce((a, b) => a + b, 0) / m2s.length) : null,
    };
  }, [filtered]);

  const totalIncompleto = useMemo(
    () => listings.filter(isIncompleto).length,
    [listings],
  );

  const activeFilters = (bairro ? 1 : 0) + (tipo ? 1 : 0) + (pmin ? 1 : 0) + (pmax ? 1 : 0);

  // ── mapa ──
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const layerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const LRef = useRef<typeof import("leaflet") | null>(null);
  const fitted = useRef(false);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled) return;
      LRef.current = L;
      const el = document.getElementById("exp-map");
      if (!el || (el as HTMLElement).dataset.init) return;
      (el as HTMLElement).dataset.init = "1";
      const map = L.map(el, { zoomControl: false }).setView([-26.11, -48.61], 12);
      L.control.zoom({ position: "bottomright" }).addTo(map);
      const carto = process.env.NEXT_PUBLIC_CARTO_KEY;
      if (carto) {
        L.tileLayer(
          `https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=${carto}`,
          { subdomains: "abcd", attribution: "&copy; OSM &copy; CARTO", maxZoom: 20 },
        ).addTo(map);
      } else {
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: "&copy; OpenStreetMap",
          maxZoom: 19,
          className: "map-dark",
        }).addTo(map);
      }
      layerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      setMapReady(true);
    })();
    return () => {
      cancelled = true;
      if (mapRef.current) mapRef.current.remove();
      mapRef.current = null;
    };
  }, []);

  // redesenha marcadores
  useEffect(() => {
    const L = LRef.current, map = mapRef.current, layer = layerRef.current;
    if (!L || !map || !layer) return;
    layer.clearLayers();
    const pts: [number, number][] = [];
    visible.forEach((d) => {
      if (d.lat == null || d.lng == null) return;
      const color = colors[d.agency] || "#2563eb";
      const approx = isApprox(d);
      const sc = scoreOn ? scores[d.id]?.score : undefined;
      const html = `<div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
        <div style="background:${color};color:#fff;padding:3px 8px;border-radius:8px;font:700 11px system-ui;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.35);${approx ? "opacity:.75;border:1px dashed rgba(255,255,255,.9);" : "border:1px solid rgba(255,255,255,.25);"}">${shortPrice(d.price)}</div>
        ${sc != null ? `<div style="background:${scoreColor(sc)};color:#fff;border-radius:5px;padding:0 6px;font:700 9px system-ui;box-shadow:0 1px 3px rgba(0,0,0,.3);">${sc}</div>` : ""}
      </div>`;
      const icon = L.divIcon({ className: "", html, iconSize: [76, sc != null ? 38 : 22], iconAnchor: [38, sc != null ? 19 : 11] });
      const p2 = perM2(d);
      const popup = `<div style="font:13px system-ui;min-width:200px;">
        <div style="font-weight:700;margin-bottom:2px;">${d.title ?? d.type ?? "Imóvel"}</div>
        <div style="font-size:16px;font-weight:800;color:#2563eb;">${fmtPrice(d.price)}${p2 ? ` <span style="font-size:11px;color:#94a3b8;font-weight:600;">· R$${p2.toLocaleString("pt-BR")}/m²</span>` : ""}</div>
        <div style="color:#64748b;margin-top:2px;">${d.area_total_m2 ? fmtArea(d.area_total_m2) + " · " : ""}${d.neighborhood ? d.neighborhood : ""}</div>
        <div style="color:#334155;margin-top:2px;"><b>${d.agency}</b></div>
        ${sc != null ? `<div style="margin-top:4px;color:${scoreColor(sc)};font-weight:700;">Score ${sc} · ${scoreLabel(sc)}</div>` : ""}
        ${approx ? '<div style="color:#c2711c;font-size:11px;margin-top:2px;">📍 localização aproximada</div>' : ""}
        <a href="${d.source_url}" target="_blank" rel="noreferrer" style="display:inline-block;margin-top:6px;color:#2563eb;font-weight:600;">ver anúncio →</a>
      </div>`;
      L.marker([d.lat, d.lng], { icon }).addTo(layer).bindPopup(popup, { maxWidth: 280 });
      pts.push([d.lat, d.lng]);
    });
    if (!fitted.current && pts.length) {
      map.fitBounds(pts, { padding: [50, 50], maxZoom: 15 });
      fitted.current = true;
    }
  }, [visible, scores, scoreOn, colors, mapReady]);

  // ── perfis / sliders ──
  function applyProfile(id: string) {
    const p = SCORE_PROFILES.find((x) => x.id === id);
    if (!p) return;
    setProfile(id);
    setWeights({ ...p.weights });
  }
  function setW(key: ScoreFactor, v: number) {
    setProfile("custom");
    setWeights((w) => ({ ...w, [key]: v }));
  }
  function clearFilters() {
    setBairro(""); setTipo(""); setPmin(""); setPmax("");
    setActiveAg(new Set(agencies));
  }

  return (
    <div style={{ display: "flex", height: "100vh", background: "var(--bg)" }}>
      {/* ───────── Sidebar ───────── */}
      <aside style={sx.side}>
        {/* cabeçalho */}
        <div style={{ ...sx.pad, position: "sticky", top: 0, zIndex: 5, background: "var(--paper)", borderBottom: "1px solid var(--border)" }}>
          <a href="/" style={sx.brand}>
            <span style={sx.logo} aria-hidden>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" />
              </svg>
            </span>
            Radar Imobiliário
          </a>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: 12 }}>
            <h1 style={{ fontSize: 19, margin: 0 }}>Imóveis</h1>
            <span className="chip">{stats.count} resultados</span>
          </div>
          {/* estatísticas */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6, marginTop: 12 }}>
            {[
              ["Total", String(stats.count)],
              ["Menor", shortPrice(stats.min)],
              ["Maior", shortPrice(stats.max)],
              ["R$/m²", stats.medM2 ? shortPrice(stats.medM2) : "—"],
            ].map(([l, v]) => (
              <div key={l} style={sx.stat}>
                <div style={{ fontWeight: 800, fontSize: 13.5, letterSpacing: "-0.02em" }}>{v}</div>
                <div style={{ fontSize: 9.5, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{l}</div>
              </div>
            ))}
          </div>
        </div>

        {/* filtros */}
        <div style={{ ...sx.pad, borderBottom: "1px solid var(--border)", display: "grid", gap: 12 }}>
          <div style={sx.rowHead}>
            <span style={sx.secTitle}>Filtros</span>
            {activeFilters > 0 && (
              <button onClick={clearFilters} style={sx.clear}>limpar ({activeFilters})</button>
            )}
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            <select style={sx.sel} value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="">Todos os tipos</option>
              {tipos.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select style={sx.sel} value={bairro} onChange={(e) => setBairro(e.target.value)}>
              <option value="">Todos os bairros</option>
              {bairros.map((b) => (
                <option key={b} value={b}>
                  {b} ({listings.filter((d) => d.neighborhood === b).length})
                </option>
              ))}
            </select>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input style={sx.sel} placeholder="R$ mín" value={pmin} onChange={(e) => setPmin(e.target.value)} />
              <span style={{ fontSize: 12, color: "var(--muted)" }}>—</span>
              <input style={sx.sel} placeholder="R$ máx" value={pmax} onChange={(e) => setPmax(e.target.value)} />
            </div>
          </div>
          {/* imobiliárias */}
          <div>
            <span style={{ ...sx.secTitle, display: "block", marginBottom: 6 }}>Imobiliárias</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {agencies.map((a) => {
                const on = activeAg.has(a);
                return (
                  <button key={a} style={sx.tag(on, colors[a])}
                    onClick={() => {
                      const s = new Set(activeAg);
                      if (s.has(a)) s.delete(a); else s.add(a);
                      setActiveAg(s);
                    }}>
                    <span style={{ width: 7, height: 7, borderRadius: 99, background: colors[a], display: "inline-block", opacity: on ? 1 : 0.4 }} /> {a}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* ranking */}
        <div style={{ ...sx.pad, borderBottom: "1px solid var(--border)" }}>
          <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>🏆 Ranking inteligente</span>
            <input type="checkbox" checked={scoreOn} onChange={(e) => setScoreOn(e.target.checked)} style={{ accentColor: "var(--accent)", width: 16, height: 16 }} />
          </label>
          {scoreOn && (
            <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {SCORE_PROFILES.map((p) => (
                  <button key={p.id} title={p.desc} onClick={() => applyProfile(p.id)}
                    style={sx.profile(profile === p.id)}>
                    {p.label}
                  </button>
                ))}
              </div>
              {FACTORS.map((f) => (
                <div key={f.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, minWidth: 62, color: "var(--muted)" }}>{f.icon} {f.label}</span>
                  <input type="range" min={0} max={100} value={weights[f.key]}
                    onChange={(e) => setW(f.key, parseInt(e.target.value))}
                    style={{ flex: 1, accentColor: f.color }} />
                  <span style={{ fontSize: 11, minWidth: 30, textAlign: "right", color: f.color, fontWeight: 700 }}>{weights[f.key]}%</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* abas */}
        <div style={{ display: "flex", gap: 4, padding: "12px 14px 8px" }}>
          {(["todos", "incompleto"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} style={sx.seg(tab === t)}>
              {t === "todos" ? "Todos" : `⚠️ Incompletos (${totalIncompleto})`}
            </button>
          ))}
        </div>

        {/* lista */}
        <div style={{ padding: "0 14px 24px" }}>
          {visible.length === 0 && (
            <div style={{ color: "var(--muted)", fontSize: 13, padding: 24, textAlign: "center" }}>
              Nenhum imóvel com esses filtros.
            </div>
          )}
          {visible.map((d) => {
            const p2 = perM2(d);
            const sc = scoreOn ? scores[d.id]?.score : undefined;
            return (
              <div key={d.id}
                onClick={() => { if (d.lat && d.lng && mapRef.current) mapRef.current.setView([d.lat, d.lng], 16); }}
                style={sx.card}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--accent)")}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--border)")}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 15, color: "var(--accent)", letterSpacing: "-0.02em" }}>
                      {fmtPrice(d.price)}
                    </div>
                    {p2 && <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>R$ {p2.toLocaleString("pt-BR")}/m²</div>}
                  </div>
                  {sc != null && (
                    <span style={{ background: scoreColor(sc), color: "#fff", borderRadius: 7, padding: "2px 8px", fontSize: 12, fontWeight: 800, height: "fit-content" }}>{sc}</span>
                  )}
                </div>
                {d.type && (
                  <span style={{ ...sx.pill, marginTop: 8 }}>{d.type}</span>
                )}
                <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 8 }}>
                  {d.area_total_m2 ? fmtArea(d.area_total_m2) + " · " : ""}{d.neighborhood ?? "sem bairro"}
                </div>
                <div style={{ fontSize: 11, marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 99, background: colors[d.agency], display: "inline-block" }} />
                  <span style={{ color: "var(--muted)" }}>{d.agency}</span>
                  {isApprox(d) && <span style={{ color: "var(--warn)" }}>· 📍 aprox.</span>}
                </div>
              </div>
            );
          })}
        </div>
      </aside>

      {/* ───────── Mapa ───────── */}
      <div style={{ flex: 1, position: "relative" }}>
        <div id="exp-map" style={{ position: "absolute", inset: 0 }} />
        {/* barra flutuante de contexto */}
        <div style={sx.floatBar}>
          <span style={{ fontWeight: 700, fontSize: 13 }}>{visible.length}</span>
          <span style={{ color: "var(--muted)", fontSize: 12.5 }}>imóveis no mapa</span>
          {stats.min && stats.max && (
            <span style={{ color: "var(--muted)", fontSize: 12.5, borderLeft: "1px solid var(--border)", paddingLeft: 10 }}>
              {shortPrice(stats.min)} – {shortPrice(stats.max)}
            </span>
          )}
          {scoreOn && <span className="chip" style={{ marginLeft: 2 }}>ranking ativo</span>}
        </div>
      </div>
    </div>
  );
}

// ── estilos ──
const sx = {
  side: {
    width: 380, minWidth: 340, height: "100vh", overflow: "auto",
    borderRight: "1px solid var(--border)", background: "var(--paper)",
  } as React.CSSProperties,
  pad: { padding: 14 } as React.CSSProperties,
  brand: {
    display: "inline-flex", alignItems: "center", gap: 9,
    color: "var(--ink)", fontWeight: 700, fontSize: 15, letterSpacing: "-0.02em",
  } as React.CSSProperties,
  logo: {
    display: "grid", placeItems: "center", width: 26, height: 26, borderRadius: 7,
    background: "var(--accent)", color: "#fff", boxShadow: "var(--shadow-sm)",
  } as React.CSSProperties,
  stat: {
    background: "var(--paper-2)", border: "1px solid var(--border)",
    borderRadius: 9, padding: "8px 6px", textAlign: "center",
  } as React.CSSProperties,
  rowHead: { display: "flex", alignItems: "center", justifyContent: "space-between" } as React.CSSProperties,
  secTitle: {
    fontSize: 11, fontWeight: 700, color: "var(--muted)",
    textTransform: "uppercase", letterSpacing: "0.06em",
  } as React.CSSProperties,
  clear: {
    background: "transparent", border: "none", color: "var(--accent)",
    fontSize: 11.5, fontWeight: 600, cursor: "pointer", padding: 0,
  } as React.CSSProperties,
  sel: {
    width: "100%", padding: "9px 10px", borderRadius: "var(--radius-sm)",
    border: "1px solid var(--border)", background: "var(--paper)",
    color: "var(--ink)", fontSize: 13,
  } as React.CSSProperties,
  tag: (on: boolean, c: string) => ({
    display: "inline-flex", alignItems: "center", gap: 6,
    padding: "5px 10px", borderRadius: 999,
    border: `1px solid ${on ? c : "var(--border)"}`,
    background: on ? "var(--accent-weak)" : "transparent",
    color: on ? "var(--ink)" : "var(--muted)",
    fontSize: 11.5, cursor: "pointer", fontWeight: 600,
  }) as React.CSSProperties,
  profile: (on: boolean) => ({
    padding: "5px 11px", borderRadius: 999, fontSize: 11.5, cursor: "pointer", fontWeight: 600,
    border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`,
    background: on ? "var(--accent)" : "transparent",
    color: on ? "#fff" : "var(--muted)",
  }) as React.CSSProperties,
  seg: (on: boolean) => ({
    flex: 1, padding: "8px 8px", borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: "pointer",
    border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`,
    background: on ? "var(--accent)" : "var(--paper)",
    color: on ? "#fff" : "var(--muted)",
  }) as React.CSSProperties,
  card: {
    border: "1px solid var(--border)", borderRadius: "var(--radius)",
    padding: 13, marginBottom: 9, cursor: "pointer", background: "var(--paper)",
    boxShadow: "var(--shadow-sm)", transition: "border-color .15s ease",
  } as React.CSSProperties,
  pill: {
    display: "inline-block", padding: "2px 9px", borderRadius: 999,
    background: "var(--accent-weak)", color: "var(--accent-ink)",
    fontSize: 11, fontWeight: 600,
  } as React.CSSProperties,
  floatBar: {
    position: "absolute", top: 16, left: 16, zIndex: 500,
    display: "flex", alignItems: "center", gap: 10,
    padding: "9px 14px", borderRadius: 999,
    background: "color-mix(in srgb, var(--paper) 90%, transparent)",
    backdropFilter: "saturate(1.6) blur(10px)",
    border: "1px solid var(--border)", boxShadow: "var(--shadow)",
  } as React.CSSProperties,
};
