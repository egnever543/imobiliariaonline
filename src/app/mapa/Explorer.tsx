"use client";

// ── Explorador de imóveis (ferramenta do corretor) ────────────────────
// Fluxo de busca: barra de filtros no topo (tipo, quartos, preço, bairro,
// imobiliárias) → lista de resultados + mapa → painel de detalhe ao clicar.
// Ranking inteligente e seleção de imobiliárias moram em menus sob demanda,
// para a tela não ficar amontoada.

import { useEffect, useMemo, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import { scoreListings, haversine, type ScorableListing } from "@/lib/scoring/score";
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
  built_area_m2: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  suites: number | null;
  parking: number | null;
  frente_m: number | null;
  comprimento_m: number | null;
  neighborhood: string | null;
  street: string | null;
  cep: string | null;
  lat: number | null;
  lng: number | null;
  geo_method: string | null;
  accepts_permuta: boolean | null;
  is_launch: boolean | null;
  source_url: string;
  agency: string;
}

export interface PoiPoint {
  name: string | null;
  category: string;
  lat: number;
  lng: number;
  rating: number | null;
  weight: number;
}

// rótulo amigável por categoria de POI
const POI_LABEL: Record<string, string> = {
  escola: "escola", farmacia: "farmácia", supermercado: "mercado",
  hospital: "hospital", saude: "saúde", padaria: "padaria",
  banco: "banco", praca: "praça", academia: "academia",
};

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

export default function Explorer({ listings, pois = [] }: { listings: Listing[]; pois?: PoiPoint[] }) {
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
  const [quartos, setQuartos] = useState(0); // mínimo
  const [pmin, setPmin] = useState("");
  const [pmax, setPmax] = useState("");
  const [tab, setTab] = useState<"todos" | "incompleto">("todos");
  useEffect(() => setActiveAg(new Set(agencies)), [agencies]);

  // ── menus sob demanda ──
  const [agOpen, setAgOpen] = useState(false);
  const [rankOpen, setRankOpen] = useState(false);
  const [heatOn, setHeatOn] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  // nota de vizinhança de um imóvel: comércios bons por perto (≤1,2 km),
  // com peso e decaimento por distância. Devolve nota 0–100 + contagens.
  function neighborhood(d: Listing | null) {
    if (!d || d.lat == null || d.lng == null || !pois.length) return null;
    const R = 1200;
    let raw = 0;
    let wsum = 0;
    const counts: Record<string, number> = {};
    for (const p of pois) {
      const dist = haversine(d.lat, d.lng, p.lat, p.lng);
      if (dist > R) continue;
      counts[p.category] = (counts[p.category] ?? 0) + 1;
      raw += p.weight * (1 - dist / R);
      wsum += p.weight;
    }
    if (wsum === 0) return { score: 0, counts };
    // normaliza contra um "bom" de referência (~6 pontos ponderados perto)
    const score = Math.min(100, Math.round((raw / 6) * 100));
    return { score, counts };
  }

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
      if (quartos && (d.bedrooms ?? 0) < quartos) return false;
      if (tab === "incompleto" && !isIncompleto(d)) return false;
      return true;
    });
  }, [listings, activeAg, bairro, tipo, quartos, pmin, pmax, tab]);

  const scores = useMemo(() => {
    if (!scoreOn) return {} as Record<string, { score: number; factors: Record<ScoreFactor, number> }>;
    const scorable: ScorableListing[] = filtered.map((d) => ({
      id: d.id, price: d.price, area_total_m2: d.area_total_m2,
      lat: d.lat, lng: d.lng, geo_method: d.geo_method,
    }));
    const res = scoreListings(scorable, {
      weights,
      coastline: ITAPOA_COASTLINE,
      pois: pois.map((p) => ({ category: p.category, lat: p.lat, lng: p.lng })),
    });
    const m: Record<string, { score: number; factors: Record<ScoreFactor, number> }> = {};
    res.forEach((r) => (m[r.id] = { score: r.score, factors: r.factors }));
    return m;
  }, [scoreOn, filtered, weights, pois]);

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

  const totalIncompleto = useMemo(() => listings.filter(isIncompleto).length, [listings]);
  const selectedListing = useMemo(
    () => listings.find((d) => d.id === selected) ?? null,
    [listings, selected],
  );
  const activeFilters =
    (bairro ? 1 : 0) + (tipo ? 1 : 0) + (quartos ? 1 : 0) + (pmin ? 1 : 0) + (pmax ? 1 : 0) +
    (activeAg.size !== agencies.length ? 1 : 0);

  // ── mapa ──
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const layerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const LRef = useRef<typeof import("leaflet") | null>(null);
  const markersRef = useRef<Record<string, import("leaflet").Marker>>({});
  const heatRef = useRef<import("leaflet").Layer | null>(null);
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

  useEffect(() => {
    const L = LRef.current, map = mapRef.current, layer = layerRef.current;
    if (!L || !map || !layer) return;
    layer.clearLayers();
    markersRef.current = {};
    const pts: [number, number][] = [];
    visible.forEach((d) => {
      if (d.lat == null || d.lng == null) return;
      const color = colors[d.agency] || "#2563eb";
      const approx = isApprox(d);
      const sc = scoreOn ? scores[d.id]?.score : undefined;
      const sel = d.id === selected;
      const html = `<div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
        <div style="background:${color};color:#fff;padding:3px 8px;border-radius:8px;font:700 11px system-ui;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.35);${sel ? "outline:3px solid #fff;outline-offset:1px;" : ""}${approx ? "opacity:.75;border:1px dashed rgba(255,255,255,.9);" : "border:1px solid rgba(255,255,255,.25);"}">${shortPrice(d.price)}</div>
        ${sc != null ? `<div style="background:${scoreColor(sc)};color:#fff;border-radius:5px;padding:0 6px;font:700 9px system-ui;box-shadow:0 1px 3px rgba(0,0,0,.3);">${sc}</div>` : ""}
      </div>`;
      const icon = L.divIcon({ className: "", html, iconSize: [76, sc != null ? 38 : 22], iconAnchor: [38, sc != null ? 19 : 11] });
      const m = L.marker([d.lat, d.lng], { icon, zIndexOffset: sel ? 1000 : 0 }).addTo(layer);
      m.on("click", () => setSelected(d.id));
      markersRef.current[d.id] = m;
      pts.push([d.lat, d.lng]);
    });
    if (!fitted.current && pts.length) {
      map.fitBounds(pts, { padding: [50, 50], maxZoom: 15 });
      fitted.current = true;
    }
  }, [visible, scores, scoreOn, colors, mapReady, selected]);

  // camada de calor (densidade ponderada de comércios bons)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !LRef.current) return;
    let cancelled = false;
    (async () => {
      await import("leaflet.heat");
      if (cancelled || !mapRef.current) return;
      const Lh = LRef.current as unknown as {
        heatLayer: (pts: [number, number, number][], opts: object) => import("leaflet").Layer;
      };
      if (heatRef.current) {
        map.removeLayer(heatRef.current);
        heatRef.current = null;
      }
      if (heatOn && pois.length) {
        const maxW = Math.max(...pois.map((p) => p.weight), 1);
        const pts = pois.map(
          (p) => [p.lat, p.lng, p.weight / maxW] as [number, number, number],
        );
        heatRef.current = Lh.heatLayer(pts, {
          radius: 34,
          blur: 24,
          maxZoom: 16,
          minOpacity: 0.35,
          gradient: { 0.2: "#1d4ed8", 0.45: "#0ea5e9", 0.65: "#10b981", 0.8: "#f59e0b", 1: "#e11d48" },
        }).addTo(map);
      }
    })();
    return () => { cancelled = true; };
  }, [heatOn, pois, mapReady]);

  // imóvel vindo por URL (?imovel=<id>) — abre já selecionado (p/ comparar
  // com o anúncio a partir da auditoria).
  useEffect(() => {
    try {
      const id = new URLSearchParams(window.location.search).get("imovel");
      if (id) setSelected(id);
    } catch {
      /* ignora */
    }
  }, []);

  // voa até o selecionado
  useEffect(() => {
    const map = mapRef.current;
    const d = selectedListing;
    if (!map || !d || d.lat == null || d.lng == null) return;
    map.flyTo([d.lat, d.lng], Math.max(map.getZoom(), 15), { duration: 0.6 });
  }, [selectedListing, mapReady]);

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
    setBairro(""); setTipo(""); setQuartos(0); setPmin(""); setPmax("");
    setActiveAg(new Set(agencies));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "var(--bg)" }}>
      {/* ───────── Barra de filtros (topo) ───────── */}
      <header style={sx.topbar}>
        <a href="/" style={sx.brand}>
          <span style={sx.logo} aria-hidden>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" />
            </svg>
          </span>
          <span style={{ fontWeight: 700, fontSize: 14 }}>Radar</span>
        </a>

        <div style={sx.filters}>
          <select style={sx.field} value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="">Tipo: todos</option>
            {tipos.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>

          <select style={sx.field} value={quartos} onChange={(e) => setQuartos(Number(e.target.value))}>
            <option value={0}>Quartos: qualquer</option>
            {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}+ quartos</option>)}
          </select>

          <div style={sx.priceWrap}>
            <input style={sx.price} placeholder="R$ mín" value={pmin} onChange={(e) => setPmin(e.target.value)} inputMode="numeric" />
            <span style={{ color: "var(--muted)", fontSize: 12 }}>–</span>
            <input style={sx.price} placeholder="R$ máx" value={pmax} onChange={(e) => setPmax(e.target.value)} inputMode="numeric" />
          </div>

          <select style={sx.field} value={bairro} onChange={(e) => setBairro(e.target.value)}>
            <option value="">Bairro: todos</option>
            {bairros.map((b) => (
              <option key={b} value={b}>{b} ({listings.filter((d) => d.neighborhood === b).length})</option>
            ))}
          </select>

          {/* Imobiliárias (dropdown) */}
          <div style={{ position: "relative" }}>
            <button style={sx.menuBtn(agOpen)} onClick={() => { setAgOpen((v) => !v); setRankOpen(false); }}>
              🏢 Imobiliárias ({activeAg.size}/{agencies.length}) ▾
            </button>
            {agOpen && (
              <>
                <div style={sx.backdrop} onClick={() => setAgOpen(false)} />
                <div style={sx.pop}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                    <button style={sx.link} onClick={() => setActiveAg(new Set(agencies))}>todas</button>
                    <button style={sx.link} onClick={() => setActiveAg(new Set())}>nenhuma</button>
                  </div>
                  <div style={{ display: "grid", gap: 4, maxHeight: 260, overflow: "auto" }}>
                    {agencies.map((a) => {
                      const on = activeAg.has(a);
                      return (
                        <label key={a} style={sx.agRow}>
                          <input type="checkbox" checked={on} onChange={() => {
                            const s = new Set(activeAg);
                            if (s.has(a)) s.delete(a); else s.add(a);
                            setActiveAg(s);
                          }} style={{ accentColor: colors[a] }} />
                          <span style={{ width: 8, height: 8, borderRadius: 99, background: colors[a], display: "inline-block" }} />
                          <span style={{ fontSize: 12.5 }}>{a}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Ranking (drawer) */}
          <div style={{ position: "relative" }}>
            <button style={sx.menuBtn(scoreOn || rankOpen)} onClick={() => { setRankOpen((v) => !v); setAgOpen(false); }}>
              🏆 Ordenar{scoreOn ? " · ativo" : ""} ▾
            </button>
            {rankOpen && (
              <>
                <div style={sx.backdrop} onClick={() => setRankOpen(false)} />
                <div style={{ ...sx.pop, width: 300 }}>
                  <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>Ranking inteligente</span>
                    <input type="checkbox" checked={scoreOn} onChange={(e) => setScoreOn(e.target.checked)} style={{ accentColor: "var(--accent)", width: 16, height: 16 }} />
                  </label>
                  {scoreOn && (
                    <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                        {SCORE_PROFILES.map((p) => (
                          <button key={p.id} title={p.desc} onClick={() => applyProfile(p.id)} style={sx.profile(profile === p.id)}>
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
              </>
            )}
          </div>

          {pois.length > 0 && (
            <button style={sx.menuBtn(heatOn)} onClick={() => setHeatOn((v) => !v)}
              title="Mapa de calor de comércios (escola, farmácia, mercado, saúde…)">
              🔥 Comércios
            </button>
          )}

          {activeFilters > 0 && (
            <button onClick={clearFilters} style={sx.clear}>limpar ({activeFilters})</button>
          )}
        </div>

        <div style={{ flex: 1 }} />
        <a href="/admin" style={{ fontSize: 13, color: "var(--muted)", whiteSpace: "nowrap" }}>Painel →</a>
      </header>

      {/* ───────── Corpo: lista + mapa ───────── */}
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* lista */}
        <aside style={sx.list}>
          <div style={sx.listHead}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <strong style={{ fontSize: 15 }}>{stats.count}</strong>
              <span style={{ color: "var(--muted)", fontSize: 13 }}>imóveis</span>
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              {(["todos", "incompleto"] as const).map((t) => (
                <button key={t} onClick={() => setTab(t)} style={sx.seg(tab === t)}>
                  {t === "todos" ? "Todos" : `⚠️ ${totalIncompleto}`}
                </button>
              ))}
            </div>
          </div>
          {stats.min != null && (
            <div style={sx.rangeRow}>
              <span>{shortPrice(stats.min)} – {shortPrice(stats.max)}</span>
              {stats.medM2 && <span>· R$/m² méd. {shortPrice(stats.medM2)}</span>}
            </div>
          )}

          <div style={{ padding: "8px 12px 24px", overflow: "auto", flex: 1 }}>
            {visible.length === 0 && (
              <div style={{ color: "var(--muted)", fontSize: 13, padding: 24, textAlign: "center" }}>
                Nenhum imóvel com esses filtros.
              </div>
            )}
            {visible.map((d) => {
              const p2 = perM2(d);
              const sc = scoreOn ? scores[d.id]?.score : undefined;
              const sel = d.id === selected;
              return (
                <div key={d.id} onClick={() => setSelected(d.id)} style={sx.card(sel)}>
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
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                    {d.type && <span style={sx.pill}>{d.type}</span>}
                    {d.bedrooms ? <span style={sx.metaPill}>🛏 {d.bedrooms}</span> : null}
                    {d.parking ? <span style={sx.metaPill}>🚗 {d.parking}</span> : null}
                    {d.area_total_m2 ? <span style={sx.metaPill}>📐 {fmtArea(d.area_total_m2)}</span> : null}
                  </div>
                  <div style={{ fontSize: 12, marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 7, height: 7, borderRadius: 99, background: colors[d.agency], display: "inline-block" }} />
                    <span style={{ color: "var(--muted)" }}>{d.neighborhood ?? "sem bairro"} · {d.agency}</span>
                    {isApprox(d) && <span style={{ color: "var(--warn)" }}>· 📍</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        {/* mapa */}
        <div style={{ flex: 1, position: "relative" }}>
          <div id="exp-map" style={{ position: "absolute", inset: 0 }} />

          {/* painel de detalhe */}
          {selectedListing && (
            <div style={sx.detail}>
              <button style={sx.detailClose} onClick={() => setSelected(null)} aria-label="fechar">✕</button>
              <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
                {selectedListing.title ?? selectedListing.type ?? "Imóvel"}
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, color: "var(--accent)", letterSpacing: "-0.02em", marginTop: 2 }}>
                {fmtPrice(selectedListing.price)}
              </div>
              {perM2(selectedListing) && (
                <div style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 600 }}>
                  R$ {perM2(selectedListing)!.toLocaleString("pt-BR")}/m²
                </div>
              )}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                {selectedListing.type && <span style={sx.pill}>{selectedListing.type}</span>}
                {selectedListing.bedrooms ? <span style={sx.metaPill}>🛏 {selectedListing.bedrooms} quartos</span> : null}
                {selectedListing.suites ? <span style={sx.metaPill}>🛁 {selectedListing.suites} suíte(s)</span> : null}
                {selectedListing.parking ? <span style={sx.metaPill}>🚗 {selectedListing.parking} vaga(s)</span> : null}
                {selectedListing.area_total_m2 ? <span style={sx.metaPill}>📐 {fmtArea(selectedListing.area_total_m2)}</span> : null}
              </div>
              <div style={{ fontSize: 13, marginTop: 12, display: "flex", alignItems: "center", gap: 7 }}>
                <span style={{ width: 8, height: 8, borderRadius: 99, background: colors[selectedListing.agency], display: "inline-block" }} />
                <span style={{ color: "var(--ink)", fontWeight: 600 }}>{selectedListing.agency}</span>
              </div>
              <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>
                {[selectedListing.street, selectedListing.neighborhood].filter(Boolean).join(", ") || "Endereço não informado"}
                {isApprox(selectedListing) && " · 📍 aproximado"}
              </div>

              {/* nota de vizinhança (comércios por perto) */}
              {(() => {
                const n = neighborhood(selectedListing);
                if (!n) return null;
                const cats = Object.entries(n.counts)
                  .sort((a, b) => b[1] - a[1])
                  .map(([c, q]) => `${q} ${POI_LABEL[c] ?? c}`)
                  .slice(0, 4);
                return (
                  <div style={{ marginTop: 12, padding: 10, borderRadius: 10, background: "var(--paper-2)", border: "1px solid var(--border)" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>Vizinhança (≤1,2 km)</span>
                      <span style={{ background: scoreColor(n.score), color: "#fff", borderRadius: 7, padding: "2px 9px", fontSize: 12.5, fontWeight: 800 }}>{n.score}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>
                      {cats.length ? cats.join(" · ") : "Nenhum comércio mapeado por perto."}
                    </div>
                  </div>
                );
              })()}

              <a href={selectedListing.source_url} target="_blank" rel="noreferrer" className="btn" style={{ marginTop: 14, width: "100%" }}>
                Ver anúncio →
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── estilos ──
const sx = {
  topbar: {
    display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
    padding: "10px 16px", background: "var(--paper)",
    borderBottom: "1px solid var(--border)", zIndex: 600,
  } as React.CSSProperties,
  brand: {
    display: "inline-flex", alignItems: "center", gap: 8, color: "var(--ink)",
  } as React.CSSProperties,
  logo: {
    display: "grid", placeItems: "center", width: 26, height: 26, borderRadius: 7,
    background: "var(--accent)", color: "#fff", boxShadow: "var(--shadow-sm)",
  } as React.CSSProperties,
  filters: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } as React.CSSProperties,
  field: {
    padding: "8px 10px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)",
    background: "var(--paper)", color: "var(--ink)", fontSize: 13, cursor: "pointer",
  } as React.CSSProperties,
  priceWrap: {
    display: "flex", alignItems: "center", gap: 6, padding: "0 4px",
    border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", background: "var(--paper)",
  } as React.CSSProperties,
  price: {
    width: 82, padding: "8px 6px", border: "none", background: "transparent",
    color: "var(--ink)", fontSize: 13,
  } as React.CSSProperties,
  menuBtn: (on: boolean) => ({
    padding: "8px 12px", borderRadius: "var(--radius-sm)", fontSize: 13, fontWeight: 600, cursor: "pointer",
    border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`,
    background: on ? "var(--accent-weak)" : "var(--paper)",
    color: on ? "var(--accent-ink)" : "var(--ink)",
  }) as React.CSSProperties,
  clear: {
    padding: "8px 10px", borderRadius: "var(--radius-sm)", fontSize: 13, fontWeight: 600,
    cursor: "pointer", border: "1px solid var(--border)", background: "transparent", color: "var(--muted)",
  } as React.CSSProperties,
  backdrop: { position: "fixed", inset: 0, zIndex: 40 } as React.CSSProperties,
  pop: {
    position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 50, width: 260,
    background: "var(--paper)", border: "1px solid var(--border)", borderRadius: 12,
    boxShadow: "var(--shadow-lg)", padding: 12,
  } as React.CSSProperties,
  link: { background: "transparent", border: "none", color: "var(--accent)", fontSize: 12, fontWeight: 600, cursor: "pointer", padding: 0 } as React.CSSProperties,
  agRow: { display: "flex", alignItems: "center", gap: 7, padding: "4px 4px", borderRadius: 7, cursor: "pointer" } as React.CSSProperties,
  profile: (on: boolean) => ({
    padding: "5px 11px", borderRadius: 999, fontSize: 11.5, cursor: "pointer", fontWeight: 600,
    border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`,
    background: on ? "var(--accent)" : "transparent",
    color: on ? "#fff" : "var(--muted)",
  }) as React.CSSProperties,
  list: {
    width: 380, minWidth: 320, display: "flex", flexDirection: "column",
    borderRight: "1px solid var(--border)", background: "var(--paper)",
  } as React.CSSProperties,
  listHead: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "12px 14px 8px",
  } as React.CSSProperties,
  rangeRow: {
    display: "flex", gap: 6, padding: "0 14px 10px", fontSize: 12, color: "var(--muted)",
    borderBottom: "1px solid var(--border)",
  } as React.CSSProperties,
  seg: (on: boolean) => ({
    padding: "6px 10px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer",
    border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`,
    background: on ? "var(--accent)" : "var(--paper)",
    color: on ? "#fff" : "var(--muted)",
  }) as React.CSSProperties,
  card: (sel: boolean) => ({
    border: `1px solid ${sel ? "var(--accent)" : "var(--border)"}`,
    borderRadius: "var(--radius)", padding: 13, marginBottom: 9, cursor: "pointer",
    background: sel ? "var(--accent-weak)" : "var(--paper)",
    boxShadow: sel ? "none" : "var(--shadow-sm)", transition: "border-color .15s ease, background .15s ease",
  }) as React.CSSProperties,
  pill: {
    display: "inline-block", padding: "2px 9px", borderRadius: 999,
    background: "var(--accent-weak)", color: "var(--accent-ink)", fontSize: 11, fontWeight: 600,
  } as React.CSSProperties,
  metaPill: {
    display: "inline-block", padding: "2px 8px", borderRadius: 999,
    background: "var(--paper-2)", border: "1px solid var(--border)", color: "var(--muted)",
    fontSize: 11, fontWeight: 600,
  } as React.CSSProperties,
  detail: {
    position: "absolute", top: 16, right: 16, zIndex: 500, width: 300,
    background: "var(--paper)", border: "1px solid var(--border)", borderRadius: 14,
    boxShadow: "var(--shadow-lg)", padding: 16,
  } as React.CSSProperties,
  detailClose: {
    position: "absolute", top: 10, right: 10, width: 26, height: 26, borderRadius: 7,
    border: "1px solid var(--border)", background: "var(--paper)", color: "var(--muted)",
    cursor: "pointer", fontSize: 12,
  } as React.CSSProperties,
};
