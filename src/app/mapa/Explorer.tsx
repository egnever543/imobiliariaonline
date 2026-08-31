"use client";

// ── Explorador de imóveis ─────────────────────────────────────────────
// Reconstrói o app antigo: mapa + lista + estatísticas + filtros
// (imobiliária, bairro, preço, tipo) + abas Todos/Incompletos + ranking
// com perfis e sliders.

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

const PALETTE = [
  "#3b82f6", "#f59e0b", "#10b981", "#ef4444",
  "#8b5cf6", "#ec4899", "#06b6d4", "#f97316",
];
const FACTORS: { key: ScoreFactor; label: string; icon: string; color: string }[] = [
  { key: "beach", label: "Praia", icon: "🏖️", color: "#06b6d4" },
  { key: "poi", label: "POIs", icon: "📍", color: "#e94560" },
  { key: "pricePerM2", label: "R$/m²", icon: "💰", color: "#10b981" },
  { key: "geoQuality", label: "Geo", icon: "📌", color: "#3b82f6" },
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
    return {
      count: filtered.length,
      min: precos.length ? Math.min(...precos) : null,
      max: precos.length ? Math.max(...precos) : null,
    };
  }, [filtered]);

  const totalIncompleto = useMemo(
    () => listings.filter(isIncompleto).length,
    [listings],
  );

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
      const map = L.map(el, { zoomControl: true }).setView([-26.11, -48.61], 12);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap", maxZoom: 19,
      }).addTo(map);
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
      const color = colors[d.agency] || "#10b981";
      const approx = isApprox(d);
      const sc = scoreOn ? scores[d.id]?.score : undefined;
      const html = `<div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
        <div style="background:${color};color:#fff;padding:2px 7px;border-radius:6px;font:600 11px system-ui;white-space:nowrap;${approx ? "opacity:.7;border:1px dashed #fff;" : ""}">${shortPrice(d.price)}</div>
        ${sc != null ? `<div style="background:${scoreColor(sc)};color:#fff;border-radius:4px;padding:0 5px;font:700 9px system-ui;">${sc}</div>` : ""}
      </div>`;
      const icon = L.divIcon({ className: "", html, iconSize: [70, sc != null ? 36 : 20], iconAnchor: [35, sc != null ? 18 : 10] });
      const p2 = perM2(d);
      const popup = `<div style="font:13px system-ui;min-width:190px;">
        <div style="font-weight:700;">${d.title ?? d.type ?? "Imóvel"}</div>
        <div style="font-size:15px;font-weight:700;color:#14776b;">${fmtPrice(d.price)}${p2 ? ` <span style="font-size:11px;color:#888;font-weight:600;">· R$${p2.toLocaleString("pt-BR")}/m²</span>` : ""}</div>
        <div style="color:#555;">${d.area_total_m2 ? fmtArea(d.area_total_m2) + "<br>" : ""}${d.neighborhood ? d.neighborhood + "<br>" : ""}<b>${d.agency}</b></div>
        ${sc != null ? `<div style="margin-top:4px;color:${scoreColor(sc)};font-weight:700;">Score ${sc} · ${scoreLabel(sc)}</div>` : ""}
        ${approx ? '<div style="color:#b5651d;font-size:11px;">📍 aproximado</div>' : ""}
        <a href="${d.source_url}" target="_blank" rel="noreferrer" style="color:#14776b;">ver anúncio →</a>
      </div>`;
      L.marker([d.lat, d.lng], { icon }).addTo(layer).bindPopup(popup, { maxWidth: 260 });
      pts.push([d.lat, d.lng]);
    });
    if (!fitted.current && pts.length) {
      map.fitBounds(pts, { padding: [40, 40], maxZoom: 15 });
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

  // ── estilos ──
  const S = {
    side: { width: 360, minWidth: 320, height: "100vh", overflow: "auto", borderRight: "1px solid var(--border)", background: "var(--bg)" } as React.CSSProperties,
    pad: { padding: 14 } as React.CSSProperties,
    filterBtn: (on: boolean, c: string) => ({
      padding: "4px 9px", borderRadius: 6, border: `1px solid ${on ? c : "var(--border)"}`,
      background: on ? "var(--paper)" : "transparent", color: on ? "var(--ink)" : "var(--muted)",
      fontSize: 11, cursor: "pointer", fontWeight: 600,
    }) as React.CSSProperties,
    sel: { width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "var(--ink)", fontSize: 13 } as React.CSSProperties,
  };

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      <div style={S.side}>
        <div style={{ ...S.pad, borderBottom: "1px solid var(--border)" }}>
          <a href="/" style={{ fontSize: 12 }}>← início</a> ·{" "}
          <a href="/admin" style={{ fontSize: 12 }}>painel</a>
          <h1 style={{ fontSize: 20, margin: "6px 0 0" }}>Imóveis</h1>
          <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
            {stats.count} imóveis
          </div>
          {/* estatísticas */}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            {[
              ["Imóveis", String(stats.count)],
              ["Menor", shortPrice(stats.min)],
              ["Maior", shortPrice(stats.max)],
            ].map(([l, v]) => (
              <div key={l} style={{ flex: 1, background: "var(--paper)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 6px", textAlign: "center" }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{v}</div>
                <div style={{ fontSize: 10, color: "var(--muted)" }}>{l}</div>
              </div>
            ))}
          </div>
        </div>

        {/* filtros */}
        <div style={{ ...S.pad, borderBottom: "1px solid var(--border)", display: "grid", gap: 10 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {agencies.map((a) => {
              const on = activeAg.has(a);
              return (
                <button key={a} style={S.filterBtn(on, colors[a])}
                  onClick={() => {
                    const s = new Set(activeAg);
                    if (s.has(a)) s.delete(a); else s.add(a);
                    setActiveAg(s);
                  }}>
                  <span style={{ color: colors[a] }}>●</span> {a}
                </button>
              );
            })}
          </div>
          <select style={S.sel} value={bairro} onChange={(e) => setBairro(e.target.value)}>
            <option value="">Todos os bairros</option>
            {bairros.map((b) => (
              <option key={b} value={b}>
                {b} ({listings.filter((d) => d.neighborhood === b).length})
              </option>
            ))}
          </select>
          <select style={S.sel} value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="">Todos os tipos</option>
            {tipos.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input style={S.sel} placeholder="R$ mín" value={pmin} onChange={(e) => setPmin(e.target.value)} />
            <span style={{ fontSize: 12, color: "var(--muted)" }}>até</span>
            <input style={S.sel} placeholder="R$ máx" value={pmax} onChange={(e) => setPmax(e.target.value)} />
          </div>
        </div>

        {/* ranking */}
        <div style={{ ...S.pad, borderBottom: "1px solid var(--border)" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: scoreOn ? 10 : 0 }}>
            <input type="checkbox" checked={scoreOn} onChange={(e) => setScoreOn(e.target.checked)} />
            <span style={{ fontSize: 13, fontWeight: 600 }}>🏆 Ranking inteligente</span>
          </label>
          {scoreOn && (
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {SCORE_PROFILES.map((p) => (
                  <button key={p.id} title={p.desc} onClick={() => applyProfile(p.id)}
                    style={{
                      padding: "4px 9px", borderRadius: 6, fontSize: 11, cursor: "pointer", fontWeight: 600,
                      border: `1px solid ${profile === p.id ? "#10b981" : "var(--border)"}`,
                      background: profile === p.id ? "#10b981" : "transparent",
                      color: profile === p.id ? "#fff" : "var(--muted)",
                    }}>
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
                  <span style={{ fontSize: 11, minWidth: 30, textAlign: "right", color: f.color, fontWeight: 600 }}>{weights[f.key]}%</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* abas */}
        <div style={{ display: "flex", gap: 6, ...S.pad, paddingBottom: 8 }}>
          {(["todos", "incompleto"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              style={{
                flex: 1, padding: "6px 8px", borderRadius: 7, fontSize: 11, fontWeight: 600, cursor: "pointer",
                border: `1px solid ${tab === t ? "#10b981" : "var(--border)"}`,
                background: tab === t ? "#10b981" : "transparent",
                color: tab === t ? "#fff" : "var(--muted)",
              }}>
              {t === "todos" ? "Todos" : `⚠️ Incompletos (${totalIncompleto})`}
            </button>
          ))}
        </div>

        {/* lista */}
        <div style={{ padding: "0 14px 24px" }}>
          {visible.length === 0 && (
            <div style={{ color: "var(--muted)", fontSize: 13, padding: 20, textAlign: "center" }}>
              Nenhum imóvel com esses filtros.
            </div>
          )}
          {visible.map((d) => {
            const p2 = perM2(d);
            const sc = scoreOn ? scores[d.id]?.score : undefined;
            return (
              <div key={d.id}
                onClick={() => { if (d.lat && d.lng && mapRef.current) mapRef.current.setView([d.lat, d.lng], 16); }}
                style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12, marginBottom: 8, cursor: "pointer", background: "var(--paper)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: "#14776b" }}>
                    {fmtPrice(d.price)}
                    {p2 && <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}> · R${p2.toLocaleString("pt-BR")}/m²</span>}
                  </div>
                  {sc != null && (
                    <span style={{ background: scoreColor(sc), color: "#fff", borderRadius: 6, padding: "1px 7px", fontSize: 12, fontWeight: 700, height: "fit-content" }}>{sc}</span>
                  )}
                </div>
                <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>
                  {d.area_total_m2 ? fmtArea(d.area_total_m2) + " · " : ""}{d.neighborhood ?? "sem bairro"}
                </div>
                <div style={{ fontSize: 11, marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ color: colors[d.agency] }}>●</span>
                  <span style={{ color: "var(--muted)" }}>{d.agency}</span>
                  {isApprox(d) && <span style={{ color: "#b5651d" }}>· 📍 aprox.</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div id="exp-map" style={{ flex: 1, height: "100vh" }} />
    </div>
  );
}
