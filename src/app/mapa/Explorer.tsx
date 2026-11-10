"use client";

// ── Mapa de imóveis ───────────────────────────────────────────────────
// Tela única do produto. Filtros simples no topo → lista + mapa → painel de
// detalhe ao clicar. Cada pin é colorido pelo preço por m² em relação à
// mediana do bairro (verde = abaixo, neutro = na média, vermelho = acima).
// Um toggle mostra os pontos de referência (hospital, escola, mercado…).
// Sem score, sem mapa de calor: só o essencial, direto.

import { useEffect, useMemo, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import { normBairro, sortKeyBairro } from "@/lib/neighborhood";

export interface Listing {
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

export interface PoiPoint {
  name: string | null;
  category: string;
  lat: number;
  lng: number;
}

// rótulo amigável por categoria de ponto de referência
const POI_LABEL: Record<string, string> = {
  escola: "Escola", farmacia: "Farmácia", supermercado: "Mercado",
  hospital: "Hospital", saude: "Saúde", padaria: "Padaria",
  banco: "Banco", praca: "Praça", academia: "Academia",
};

// cores dos pins por faixa de preço vs. mediana do bairro
const PRICE_COLOR = { barato: "#4ea884", medio: "#8d8a82", caro: "#e5564b" } as const;
type PriceClass = keyof typeof PRICE_COLOR | "sem";

const PAGE_SIZE = 20;

const fmtPrice = (v: number | null) =>
  v ? "R$ " + v.toLocaleString("pt-BR") : "Sob consulta";
const shortPrice = (v: number | null) =>
  !v ? "—" : v >= 1e6 ? "R$ " + (v / 1e6).toFixed(1) + "M" : v >= 1e3 ? "R$ " + Math.round(v / 1e3) + "k" : "R$ " + v;
const fmtArea = (v: number | null) => (v ? v.toLocaleString("pt-BR") + " m²" : "");
// terreno/sítio usam a área do lote; casa/apê usam a área CONSTRUÍDA quando
// houver (R$/m² de construção), caindo na área total se faltar.
const LAND_TYPE = /terreno|lote|s[ií]tio|ch[áa]cara|fazenda/i;
const areaFor = (d: Listing): number | null =>
  d.type && LAND_TYPE.test(d.type) ? d.area_total_m2 : d.built_area_m2 ?? d.area_total_m2;
const perM2 = (d: Listing) => {
  const a = areaFor(d);
  return d.price && a ? Math.round(d.price / a) : null;
};
// chave de bairro normalizada (une só diferenças de formatação entre sites)
const bkey = (d: Listing) => (d.neighborhood ? normBairro(d.neighborhood) : "");
const isApprox = (d: Listing) =>
  d.geo_method === "bairro" || d.geo_method === "fallback" || (!d.street && !d.cep);

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Foto do imóvel com fallback "sem foto" (a og:image pode falhar).
function Photo({
  src, alt, wrap, label = "sem foto", labelSize = 11,
}: { src: string | null; alt: string; wrap: React.CSSProperties; label?: string; labelSize?: number }) {
  const [err, setErr] = useState(false);
  const ok = src && !err;
  return (
    <div style={{
      background: "var(--paper-2)", overflow: "hidden", flexShrink: 0,
      display: "grid", placeItems: "center", border: "1px solid var(--border)", ...wrap,
    }}>
      {ok ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src!} alt={alt} loading="lazy" onError={() => setErr(true)}
          style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        <span style={{ color: "var(--muted)", fontSize: labelSize }}>{label}</span>
      )}
    </div>
  );
}

export default function Explorer({ listings, pois = [], chrome = "admin" }: { listings: Listing[]; pois?: PoiPoint[]; chrome?: "admin" | "conta" }) {
  // bairros agrupados pela chave normalizada; o rótulo exibido é a grafia mais
  // frequente do grupo (ex.: "Balneário Cambijú (22)" vence "Cambiju (2)").
  const bairroInfo = useMemo(() => {
    const groups = new Map<string, Map<string, number>>(); // chave → (grafia → contagem)
    for (const d of listings) {
      if (!d.neighborhood) continue;
      const k = normBairro(d.neighborhood);
      if (!k) continue;
      const m = groups.get(k) ?? new Map<string, number>();
      m.set(d.neighborhood, (m.get(d.neighborhood) ?? 0) + 1);
      groups.set(k, m);
    }
    const out = new Map<string, { label: string; count: number }>();
    for (const [k, m] of groups) {
      let label = "", best = -1, total = 0;
      for (const [name, c] of m) { total += c; if (c > best) { best = c; label = name; } }
      out.set(k, { label, count: total });
    }
    return out;
  }, [listings]);
  // ordena por "núcleo" do nome (ignora prefixos como Balneário/Bal.), então
  // grafias do mesmo bairro ficam vizinhas na lista sem se fundir.
  const bairros = useMemo(
    () => [...bairroInfo.entries()].sort((a, b) =>
      sortKeyBairro(a[1].label).localeCompare(sortKeyBairro(b[1].label), "pt-BR")
      || a[1].label.localeCompare(b[1].label, "pt-BR"),
    ),
    [bairroInfo],
  );
  const bairroLabel = (d: Listing) => {
    const k = bkey(d);
    return (k && bairroInfo.get(k)?.label) || d.neighborhood || "sem bairro";
  };
  const tipos = useMemo(
    () => [...new Set(listings.map((d) => d.type).filter(Boolean))].sort() as string[],
    [listings],
  );

  // medianas de R$/m² individualizadas por TIPO — terreno compara com terreno,
  // apê com apê (não misturar, senão terreno vira sempre "barato" e apê "caro").
  // Primária: por bairro + tipo; fallback: por tipo na cidade toda. Mínimo de
  // 4 exemplos para a mediana valer.
  const medians = useMemo(() => {
    const byBairroType: Record<string, number[]> = {};
    const byType: Record<string, number[]> = {};
    for (const d of listings) {
      const p = perM2(d);
      if (!p || !d.type) continue;
      (byType[d.type] ??= []).push(p);
      const k = bkey(d);
      if (k) (byBairroType[`${k}||${d.type}`] ??= []).push(p);
    }
    const reduce = (groups: Record<string, number[]>) => {
      const out: Record<string, number> = {};
      for (const [k, arr] of Object.entries(groups)) {
        if (arr.length >= 4) { const m = median(arr); if (m) out[k] = m; }
      }
      return out;
    };
    return { byBairroType: reduce(byBairroType), byType: reduce(byType) };
  }, [listings]);

  // classe de preço de um imóvel vs. a mediana do MESMO tipo
  // (verde = abaixo, neutro = na média, vermelho = acima, sem = sem base).
  function priceClass(d: Listing): { cls: PriceClass; pct: number | null; base: "bairro" | "tipo" | null } {
    const p = perM2(d);
    if (!p || !d.type) return { cls: "sem", pct: null, base: null };
    const k = bkey(d);
    const key = k ? `${k}||${d.type}` : "";
    const med = (key && medians.byBairroType[key]) || medians.byType[d.type];
    const base: "bairro" | "tipo" | null = key && medians.byBairroType[key] ? "bairro" : med ? "tipo" : null;
    if (!med || !base) return { cls: "sem", pct: null, base: null };
    const ratio = p / med;
    const pct = Math.round((ratio - 1) * 100);
    if (ratio <= 0.92) return { cls: "barato", pct, base };
    if (ratio >= 1.08) return { cls: "caro", pct, base };
    return { cls: "medio", pct, base };
  }

  // ── filtros ──
  const [bairro, setBairro] = useState("");
  const [tipo, setTipo] = useState("");
  const [quartos, setQuartos] = useState(0);
  const [pmin, setPmin] = useState("");
  const [pmax, setPmax] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [poisOn, setPoisOn] = useState(false);

  // ── responsivo ──
  const [isMobile, setIsMobile] = useState(false);
  const [mobileView, setMobileView] = useState<"lista" | "mapa">("lista");
  const [filtersOpen, setFiltersOpen] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 760px)");
    const on = () => setIsMobile(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  function pick(id: string) {
    setSelected(id);
    if (window.matchMedia("(max-width: 760px)").matches) setMobileView("mapa");
  }

  const filtered = useMemo(() => {
    const mn = parseInt(pmin.replace(/\D/g, "")) || 0;
    const mx = parseInt(pmax.replace(/\D/g, "")) || Infinity;
    return listings.filter((d) => {
      if (d.price && (d.price < mn || d.price > mx)) return false;
      if (bairro && bkey(d) !== bairro) return false;
      if (tipo && d.type !== tipo) return false;
      if (quartos && (d.bedrooms ?? 0) < quartos) return false;
      return true;
    });
  }, [listings, bairro, tipo, quartos, pmin, pmax]);

  // ── paginação da lista ──
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  useEffect(() => { setPage(1); }, [bairro, tipo, quartos, pmin, pmax]);
  useEffect(() => { setPage((p) => Math.min(p, pageCount)); }, [pageCount]);
  useEffect(() => {
    if (!selected) return;
    const idx = filtered.findIndex((d) => d.id === selected);
    if (idx >= 0) setPage(Math.floor(idx / PAGE_SIZE) + 1);
  }, [selected, filtered]);
  const pageItems = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page],
  );

  const stats = useMemo(() => {
    const precos = filtered.map((d) => d.price).filter(Boolean) as number[];
    const m2s = filtered.map((d) => perM2(d)).filter(Boolean) as number[];
    return {
      count: filtered.length,
      min: precos.length ? Math.min(...precos) : null,
      max: precos.length ? Math.max(...precos) : null,
      medM2: median(m2s),
    };
  }, [filtered]);

  const selectedListing = useMemo(
    () => listings.find((d) => d.id === selected) ?? null,
    [listings, selected],
  );
  const activeFilters =
    (bairro ? 1 : 0) + (tipo ? 1 : 0) + (quartos ? 1 : 0) + (pmin ? 1 : 0) + (pmax ? 1 : 0);

  // ── mapa ──
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const layerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const poiLayerRef = useRef<import("leaflet").LayerGroup | null>(null);
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
      poiLayerRef.current = L.layerGroup().addTo(map);
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

  // pins dos imóveis
  useEffect(() => {
    const L = LRef.current, map = mapRef.current, layer = layerRef.current;
    if (!L || !map || !layer) return;
    layer.clearLayers();
    const pts: [number, number][] = [];
    filtered.forEach((d) => {
      if (d.lat == null || d.lng == null) return;
      const { cls } = priceClass(d);
      const color = cls === "sem" ? "#2a2a2e" : PRICE_COLOR[cls];
      const txt = cls === "sem" ? "#f4f1ea" : "#0a0a0b";
      const approx = isApprox(d);
      const sel = d.id === selected;
      const html = `<div style="background:${color};color:${txt};padding:3px 8px;border-radius:8px;font:700 11px system-ui;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.5);${sel ? "outline:2px solid #d6b25e;outline-offset:2px;" : ""}${approx ? "opacity:.72;border:1px dashed rgba(255,255,255,.6);" : "border:1px solid rgba(0,0,0,.2);"}">${shortPrice(d.price)}</div>`;
      const icon = L.divIcon({ className: "", html, iconSize: [70, 22], iconAnchor: [35, 11] });
      const m = L.marker([d.lat, d.lng], { icon, zIndexOffset: sel ? 1000 : 0 }).addTo(layer);
      m.on("click", () => setSelected(d.id));
      pts.push([d.lat, d.lng]);
    });
    if (!fitted.current && pts.length) {
      map.fitBounds(pts, { padding: [50, 50], maxZoom: 15 });
      fitted.current = true;
    }
  }, [filtered, mapReady, selected, medians]);

  // pontos de referência (hospital, escola, mercado…)
  useEffect(() => {
    const L = LRef.current, map = mapRef.current, layer = poiLayerRef.current;
    if (!L || !map || !layer) return;
    layer.clearLayers();
    if (!poisOn) return;
    pois.forEach((p) => {
      const label = POI_LABEL[p.category] ?? p.category;
      const html = `<div title="${label}${p.name ? " · " + p.name : ""}" style="width:14px;height:14px;border-radius:99px;background:rgba(214,178,94,.22);border:1.5px solid #d6b25e;box-shadow:0 1px 3px rgba(0,0,0,.5);"></div>`;
      const icon = L.divIcon({ className: "", html, iconSize: [14, 14], iconAnchor: [7, 7] });
      L.marker([p.lat, p.lng], { icon, interactive: true }).addTo(layer)
        .bindTooltip(`${label}${p.name ? " · " + p.name : ""}`, { direction: "top" });
    });
  }, [poisOn, pois, mapReady]);

  useEffect(() => {
    if (mapRef.current) {
      const t = setTimeout(() => mapRef.current?.invalidateSize(), 80);
      return () => clearTimeout(t);
    }
  }, [mobileView, isMobile, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    const d = selectedListing;
    if (!map || !d || d.lat == null || d.lng == null) return;
    map.flyTo([d.lat, d.lng], Math.max(map.getZoom(), 15), { duration: 0.6 });
  }, [selectedListing, mapReady]);

  // imóvel vindo por URL (?imovel=<id>)
  useEffect(() => {
    try {
      const id = new URLSearchParams(window.location.search).get("imovel");
      if (id) {
        setSelected(id);
        if (window.matchMedia("(max-width: 760px)").matches) setMobileView("mapa");
      }
    } catch { /* ignora */ }
  }, []);

  function clearFilters() {
    setBairro(""); setTipo(""); setQuartos(0); setPmin(""); setPmax("");
  }

  const sel = selectedListing;
  const selPc = sel ? priceClass(sel) : null;

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

        {isMobile && (
          <button style={sx.menuBtn(filtersOpen || activeFilters > 0)} onClick={() => setFiltersOpen((v) => !v)}>
            Filtros{activeFilters > 0 ? ` (${activeFilters})` : ""} {filtersOpen ? "▲" : "▾"}
          </button>
        )}

        <div style={{ ...sx.filters, ...(isMobile ? { width: "100%", display: filtersOpen ? "flex" : "none" } : {}) }}>
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
            {bairros.map(([k, info]) => (
              <option key={k} value={k}>{info.label} ({info.count})</option>
            ))}
          </select>

          {pois.length > 0 && (
            <button style={sx.menuBtn(poisOn)} onClick={() => setPoisOn((v) => !v)}
              title="Mostrar hospital, escola, mercado e outros pontos de referência">
              Pontos de referência
            </button>
          )}

          {activeFilters > 0 && (
            <button onClick={clearFilters} style={sx.clear}>limpar ({activeFilters})</button>
          )}
        </div>

        <div style={{ flex: 1 }} />
        <a href={chrome === "conta" ? "/conta" : "/admin"} style={{ fontSize: 13, color: "var(--muted)", whiteSpace: "nowrap" }}>
          {chrome === "conta" ? "Conta" : "Painel"}
        </a>
      </header>

      {/* alternância Lista/Mapa (só no celular) */}
      {isMobile && (
        <div style={sx.mobileTabs}>
          <button style={sx.mtab(mobileView === "lista")} onClick={() => setMobileView("lista")}>
            Lista ({stats.count})
          </button>
          <button style={sx.mtab(mobileView === "mapa")} onClick={() => setMobileView("mapa")}>
            Mapa
          </button>
        </div>
      )}

      {/* ───────── Corpo: lista + mapa ───────── */}
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* lista */}
        <aside style={{
          ...sx.list,
          ...(isMobile ? { width: "100%", minWidth: 0, borderRight: "none", display: mobileView === "lista" ? "flex" : "none" } : {}),
        }}>
          <div style={sx.listHead}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <strong style={{ fontSize: 15 }}>{stats.count}</strong>
              <span style={{ color: "var(--muted)", fontSize: 13 }}>imóveis</span>
            </div>
            {stats.min != null && (
              <span style={{ fontSize: 12, color: "var(--muted)" }}>
                {shortPrice(stats.min)}–{shortPrice(stats.max)}
                {stats.medM2 ? ` · R$/m² méd. ${shortPrice(stats.medM2)}` : ""}
              </span>
            )}
          </div>

          <div style={{ padding: "8px 12px 24px", overflow: "auto", flex: 1 }}>
            {filtered.length === 0 && (
              <div style={{ color: "var(--muted)", fontSize: 13, padding: 24, textAlign: "center" }}>
                Nenhum imóvel com esses filtros.
              </div>
            )}
            {pageItems.map((d) => {
              const p2 = perM2(d);
              const pc = priceClass(d);
              const selRow = d.id === selected;
              return (
                <div key={d.id} onClick={() => pick(d.id)} style={sx.card(selRow)}>
                  <div style={{ display: "flex", gap: 11 }}>
                    <Photo src={d.image_url} alt={d.title ?? d.type ?? "Imóvel"}
                      wrap={{ width: 74, height: 74, borderRadius: 10 }} labelSize={9} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                        <div>
                          <div style={{ fontWeight: 800, fontSize: 15, letterSpacing: "-0.02em" }}>
                            {fmtPrice(d.price)}
                          </div>
                          {p2 && <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>R$ {p2.toLocaleString("pt-BR")}/m²</div>}
                        </div>
                        {pc.cls !== "sem" && pc.pct != null && (
                          <span style={{ background: "transparent", color: PRICE_COLOR[pc.cls], border: `1px solid ${PRICE_COLOR[pc.cls]}`, borderRadius: 7, padding: "2px 7px", fontSize: 11, fontWeight: 800, height: "fit-content", whiteSpace: "nowrap" }}>
                            {pc.pct > 0 ? "+" : ""}{pc.pct}%
                          </span>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 7 }}>
                        {d.type && <span style={sx.pill}>{d.type}</span>}
                        {d.bedrooms ? <span style={sx.metaPill}>{d.bedrooms} quartos</span> : null}
                        {d.parking ? <span style={sx.metaPill}>{d.parking} vagas</span> : null}
                        {d.area_total_m2 ? <span style={sx.metaPill}>{fmtArea(d.area_total_m2)}</span> : null}
                      </div>
                      <div style={{ fontSize: 12, marginTop: 7, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {bairroLabel(d)} · {d.agency}{isApprox(d) ? " · local. aprox." : ""}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {pageCount > 1 && (
            <div style={sx.pager}>
              <button style={sx.pagerBtn(page <= 1)} disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))} aria-label="Página anterior">‹</button>
              <span style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 600 }}>
                {page} / {pageCount}
              </span>
              <button style={sx.pagerBtn(page >= pageCount)} disabled={page >= pageCount}
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))} aria-label="Próxima página">›</button>
            </div>
          )}
        </aside>

        {/* mapa */}
        <div style={{
          flex: 1, position: "relative",
          ...(isMobile ? { display: mobileView === "mapa" ? "block" : "none" } : {}),
        }}>
          <div id="exp-map" style={{ position: "absolute", inset: 0 }} />

          {/* legenda das cores */}
          <div style={sx.legend}>
            {([["barato", "abaixo da média"], ["medio", "na média"], ["caro", "acima"]] as const).map(([k, lbl]) => (
              <span key={k} style={sx.legendItem}>
                <span style={{ width: 10, height: 10, borderRadius: 99, background: PRICE_COLOR[k], display: "inline-block" }} />
                {lbl}
              </span>
            ))}
          </div>

          {/* painel de detalhe */}
          {sel && (
            <div style={isMobile ? sx.detailMobile : sx.detail}>
              <button style={sx.detailClose} onClick={() => setSelected(null)} aria-label="fechar">✕</button>
              <Photo key={sel.id} src={sel.image_url}
                alt={sel.title ?? sel.type ?? "Imóvel"}
                wrap={{ width: "100%", aspectRatio: "16 / 10", borderRadius: 10, marginBottom: 12 }}
                labelSize={12} label="sem foto" />
              <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
                {sel.title ?? sel.type ?? "Imóvel"}
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.02em", marginTop: 2 }}>
                {fmtPrice(sel.price)}
              </div>
              {perM2(sel) && (
                <div style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 600 }}>
                  R$ {perM2(sel)!.toLocaleString("pt-BR")}/m²
                  {selPc && selPc.cls !== "sem" && selPc.pct != null && (
                    <span style={{ marginLeft: 8, color: PRICE_COLOR[selPc.cls], fontWeight: 800 }}>
                      {selPc.pct > 0 ? "+" : ""}{selPc.pct}% vs. média {selPc.base === "bairro" ? "do bairro" : "do tipo na cidade"} ({sel.type})
                    </span>
                  )}
                </div>
              )}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                {sel.type && <span style={sx.pill}>{sel.type}</span>}
                {sel.bedrooms ? <span style={sx.metaPill}>{sel.bedrooms} quartos</span> : null}
                {sel.suites ? <span style={sx.metaPill}>{sel.suites} suíte(s)</span> : null}
                {sel.parking ? <span style={sx.metaPill}>{sel.parking} vaga(s)</span> : null}
                {sel.area_total_m2 ? <span style={sx.metaPill}>{fmtArea(sel.area_total_m2)}</span> : null}
                {sel.built_area_m2 ? <span style={sx.metaPill}>{fmtArea(sel.built_area_m2)} constr.</span> : null}
              </div>
              <div style={{ fontSize: 13, marginTop: 12, color: "var(--ink)", fontWeight: 600 }}>
                {sel.agency}
              </div>
              <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>
                {[sel.street, sel.neighborhood ? bairroLabel(sel) : null].filter(Boolean).join(", ") || "Endereço não informado"}
                {isApprox(sel) && " · localização aproximada"}
              </div>

              <a href={sel.source_url} target="_blank" rel="noreferrer" className="btn" style={{ marginTop: 14, width: "100%" }}>
                Ver anúncio original
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
  brand: { display: "inline-flex", alignItems: "center", gap: 8, color: "var(--ink)" } as React.CSSProperties,
  logo: {
    display: "grid", placeItems: "center", width: 26, height: 26, borderRadius: 7,
    background: "var(--accent)", color: "var(--on-accent)", boxShadow: "var(--shadow-sm)",
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
  price: { width: 82, padding: "8px 6px", border: "none", background: "transparent", color: "var(--ink)", fontSize: 13 } as React.CSSProperties,
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
  list: {
    width: 380, minWidth: 320, display: "flex", flexDirection: "column",
    borderRight: "1px solid var(--border)", background: "var(--paper)",
  } as React.CSSProperties,
  listHead: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "12px 14px", borderBottom: "1px solid var(--border)", gap: 8, flexWrap: "wrap",
  } as React.CSSProperties,
  card: (sel: boolean) => ({
    border: `1px solid ${sel ? "var(--accent)" : "var(--border)"}`,
    borderRadius: "var(--radius)", padding: 13, marginBottom: 9, cursor: "pointer",
    background: sel ? "var(--accent-weak)" : "var(--paper)",
    boxShadow: sel ? "none" : "var(--shadow-sm)", transition: "border-color .15s ease, background .15s ease",
  }) as React.CSSProperties,
  pill: {
    display: "inline-block", padding: "2px 9px", borderRadius: 999,
    background: "var(--accent-weak)", color: "var(--accent-ink)", fontSize: 11, fontWeight: 600,
    border: "1px solid var(--border)",
  } as React.CSSProperties,
  metaPill: {
    display: "inline-block", padding: "2px 8px", borderRadius: 999,
    background: "var(--paper-2)", border: "1px solid var(--border)", color: "var(--muted)",
    fontSize: 11, fontWeight: 600,
  } as React.CSSProperties,
  pager: {
    display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
    padding: "10px 14px", borderTop: "1px solid var(--border)", background: "var(--paper)",
  } as React.CSSProperties,
  pagerBtn: (disabled: boolean) => ({
    width: 32, height: 32, borderRadius: 8, fontSize: 16, fontWeight: 700, lineHeight: 1,
    border: "1px solid var(--border)", background: "var(--paper)",
    color: disabled ? "var(--border)" : "var(--ink)",
    cursor: disabled ? "default" : "pointer",
  }) as React.CSSProperties,
  mobileTabs: {
    display: "flex", gap: 6, padding: "8px 12px", background: "var(--paper)",
    borderBottom: "1px solid var(--border)", position: "sticky", top: 0, zIndex: 550,
  } as React.CSSProperties,
  mtab: (on: boolean) => ({
    flex: 1, padding: "10px 12px", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer",
    border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`,
    background: on ? "var(--accent)" : "var(--paper)",
    color: on ? "var(--on-accent)" : "var(--muted)",
  }) as React.CSSProperties,
  legend: {
    position: "absolute", left: 16, bottom: 16, zIndex: 450,
    display: "flex", gap: 12, flexWrap: "wrap", padding: "8px 12px",
    background: "color-mix(in srgb, var(--paper) 88%, transparent)",
    border: "1px solid var(--border)", borderRadius: 10, boxShadow: "var(--shadow)",
    fontSize: 11.5, color: "var(--muted)",
  } as React.CSSProperties,
  legendItem: { display: "inline-flex", alignItems: "center", gap: 6 } as React.CSSProperties,
  detail: {
    position: "absolute", top: 16, right: 16, zIndex: 500, width: 300,
    background: "var(--paper)", border: "1px solid var(--border)", borderRadius: 14,
    boxShadow: "var(--shadow-lg)", padding: 16,
  } as React.CSSProperties,
  detailMobile: {
    position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 500,
    maxHeight: "68vh", overflow: "auto",
    background: "var(--paper)", borderTop: "1px solid var(--border)",
    borderRadius: "16px 16px 0 0", boxShadow: "var(--shadow-lg)", padding: 16,
  } as React.CSSProperties,
  detailClose: {
    position: "absolute", top: 10, right: 10, width: 26, height: 26, borderRadius: 7,
    border: "1px solid var(--border)", background: "var(--paper)", color: "var(--muted)",
    cursor: "pointer", fontSize: 12, zIndex: 2,
  } as React.CSSProperties,
};
