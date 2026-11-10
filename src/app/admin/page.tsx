// ── Painel de administração ───────────────────────────────────────────
// Visão geral enxuta: indicadores da base, situação dos imóveis, pendências
// e as poucas ferramentas que existem. Server Component (lê do banco, tolera
// tabelas ausentes). Sem emoji, no padrão preto/branco/dourado.

import { getServiceClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/supabase/paginate";
import Nav from "@/components/Nav";

export const dynamic = "force-dynamic";

interface Metrics {
  configured: boolean;
  cities: number;
  agencies: number;
  listings: number;
  geoOk: number;
  noGeo: number;
  pois: number;
  spendTotal: number;
  spendToday: number;
  statuses: Record<string, number>;
  activeListings: number;
  indispo: number;
}

async function count(
  db: ReturnType<typeof getServiceClient>,
  table: string,
  build?: (q: ReturnType<ReturnType<typeof getServiceClient>["from"]>["select"]) => unknown,
): Promise<number> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = db.from(table).select("id", { count: "exact", head: true });
    if (build) q = build(q);
    const { count } = await q;
    return count ?? 0;
  } catch {
    return 0;
  }
}

async function load(): Promise<Metrics> {
  let db: ReturnType<typeof getServiceClient>;
  try {
    db = getServiceClient();
  } catch {
    return {
      configured: false, cities: 0, agencies: 0, listings: 0, geoOk: 0,
      noGeo: 0, pois: 0, spendTotal: 0, spendToday: 0,
      statuses: {}, activeListings: 0, indispo: 0,
    };
  }

  const [cities, agencies, listings, geoOk, noGeoActive, activeListings, pois] = await Promise.all([
    count(db, "cities"),
    count(db, "agencies"),
    count(db, "listings"),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    count(db, "listings", (q: any) => q.not("lat", "is", null)),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    count(db, "listings", (q: any) => q.is("lat", null).eq("status", "ativo")),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    count(db, "listings", (q: any) => q.eq("status", "ativo")),
    count(db, "pois"),
  ]);

  // distribuição por situação (ativo/vendido/alugado…) — paginado
  const statuses: Record<string, number> = {};
  try {
    const rows = await selectAll<{ status: string | null }>((from, to) =>
      db.from("listings").select("status").range(from, to),
    );
    for (const r of rows) {
      const s = (r.status ?? "ativo") || "ativo";
      statuses[s] = (statuses[s] ?? 0) + 1;
    }
  } catch {
    /* coluna status ainda não existe */
  }

  // gasto com IA
  let spendTotal = 0, spendToday = 0;
  try {
    const { data } = await db.from("spend_summary").select("*").single();
    spendTotal = Number((data as { total_usd?: number })?.total_usd ?? 0);
    spendToday = Number((data as { today_usd?: number })?.today_usd ?? 0);
  } catch {
    /* view ausente */
  }

  return {
    configured: true, cities, agencies, listings, geoOk,
    noGeo: noGeoActive, pois, spendTotal, spendToday, statuses,
    activeListings, indispo: statuses["indisponivel"] ?? 0,
  };
}

const usd = (v: number) => "US$ " + (v < 1 ? v.toFixed(4) : v.toFixed(2));
const n = (v: number) => v.toLocaleString("pt-BR");

const STATUS_META: Record<string, { label: string; color: string }> = {
  ativo: { label: "Ativos", color: "#4ea884" },
  vendido: { label: "Vendidos", color: "#e5564b" },
  alugado: { label: "Alugados", color: "#d79a4a" },
  locacao: { label: "Locação", color: "#c9a24a" },
  reservado: { label: "Reservados", color: "#b98cd8" },
  indisponivel: { label: "Indisponíveis", color: "#8d8a82" },
};
const STATUS_ORDER = ["ativo", "vendido", "alugado", "locacao", "reservado", "indisponivel"];

interface Tool { href: string; name: string; desc: string; info: string }

const TOOLS: Tool[] = [
  {
    href: "/admin/coletar", name: "Adicionar imóveis", desc: "Descobrir imobiliárias e coletar a cidade",
    info: "Fluxo de coleta: você informa a cidade, o sistema descobre as imobiliárias, lê cada anúncio e a IA extrai os valores. Mostra o custo da IA ao vivo.",
  },
  {
    href: "/admin/comercios", name: "Pontos de referência", desc: "Coletar hospital, escola, mercado…",
    info: "Coleta os pontos de referência da região (OpenStreetMap, grátis) para aparecerem como referência no mapa.",
  },
  {
    href: "/admin/geo", name: "Corrigir localização", desc: "Fixar no mapa imóveis sem coordenada",
    info: "Lista imóveis sem posição no mapa. Você ajusta o endereço e re-geocodifica, ou clica no mapa para fixar o ponto.",
  },
];

function InfoDot({ text }: { text: string }) {
  return (
    <span title={text} aria-label={text} style={{
      display: "inline-grid", placeItems: "center", width: 16, height: 16, flexShrink: 0,
      borderRadius: 99, border: "1px solid var(--border)", color: "var(--muted)",
      fontSize: 10.5, fontWeight: 700, cursor: "help", fontStyle: "italic",
    }}>i</span>
  );
}

export default async function AdminHub() {
  const m = await load();

  const pend: { label: string; href: string; cta: string; tone: "warn" | "accent" }[] = [];
  if (!m.configured) {
    pend.push({ label: "Supabase não configurado — preencha as chaves no servidor.", href: "/admin", cta: "—", tone: "warn" });
  } else {
    if (m.listings === 0) pend.push({ label: "Nenhum imóvel coletado ainda.", href: "/admin/coletar", cta: "Coletar", tone: "accent" });
    if (m.noGeo > 0) pend.push({ label: `${n(m.noGeo)} imóveis ativos sem localização no mapa.`, href: "/admin/geo", cta: "Corrigir", tone: "warn" });
    if (m.listings > 0 && m.pois === 0) pend.push({ label: "Pontos de referência ainda não coletados.", href: "/admin/comercios", cta: "Coletar", tone: "accent" });
  }

  const kpis: { label: string; value: string; sub?: string }[] = [
    { label: "Imóveis", value: n(m.listings) },
    { label: "Ativos (no mapa)", value: n(m.activeListings), sub: m.listings ? Math.round((m.activeListings / m.listings) * 100) + "%" : undefined },
    { label: "Com localização", value: n(m.geoOk), sub: m.listings ? Math.round((m.geoOk / m.listings) * 100) + "%" : undefined },
    { label: "Pontos de referência", value: n(m.pois) },
  ];

  return (
    <>
      <Nav />
      <main style={{ maxWidth: 1000, margin: "0 auto", padding: "36px 24px 96px" }}>
        <span className="chip">Painel</span>
        <h1 style={{ fontSize: 30, margin: "12px 0 4px" }}>Central de gestão</h1>
        <p style={{ color: "var(--muted)", marginTop: 0, fontSize: 15 }}>
          Visão geral da base e as ferramentas de coleta e manutenção.
        </p>

        {/* KPIs */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginTop: 20 }}>
          {kpis.map((k) => (
            <div key={k.label} className="card" style={{ padding: 16 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums" }}>{k.value}</div>
                {k.sub && <div style={{ fontSize: 12, color: "var(--accent)", fontWeight: 700 }}>{k.sub}</div>}
              </div>
              <div style={{ fontSize: 12.5, color: "var(--muted)" }}>{k.label}</div>
            </div>
          ))}
        </div>

        {/* Linha discreta: números secundários */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px", marginTop: 10, fontSize: 12.5, color: "var(--muted)" }}>
          <span>{n(m.agencies)} imobiliárias</span><span>·</span>
          <span>{n(m.cities)} cidades</span><span>·</span>
          <span>Gasto IA: <strong style={{ color: "var(--ink)" }}>{usd(m.spendTotal)}</strong> total · {usd(m.spendToday)} hoje</span>
        </div>

        {/* Situação dos imóveis */}
        {(() => {
          const entries = Object.entries(m.statuses).filter(([, c]) => c > 0);
          if (entries.length === 0) return null;
          const totalS = entries.reduce((a, [, c]) => a + c, 0);
          const ordered = entries.sort((a, b) => {
            const ia = STATUS_ORDER.indexOf(a[0]); const ib = STATUS_ORDER.indexOf(b[0]);
            return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
          });
          const colorOf = (k: string) => STATUS_META[k]?.color ?? "#8d8a82";
          const labelOf = (k: string) => STATUS_META[k]?.label ?? k;
          return (
            <section style={{ marginTop: 28 }}>
              <h2 style={{ fontSize: 16, margin: "0 0 10px" }}>
                Situação dos imóveis{" "}
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>· só os ativos vão pro mapa</span>
              </h2>
              <div className="card" style={{ padding: 16 }}>
                <div style={{ display: "flex", height: 10, borderRadius: 999, overflow: "hidden", background: "var(--border)" }}>
                  {ordered.map(([k, c]) => (
                    <div key={k} title={`${labelOf(k)}: ${n(c)}`} style={{ width: `${(c / totalS) * 100}%`, background: colorOf(k) }} />
                  ))}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "10px 20px", marginTop: 14 }}>
                  {ordered.map(([k, c]) => (
                    <div key={k} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 3, background: colorOf(k), flexShrink: 0 }} />
                      <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>{n(c)}</span>
                      <span style={{ fontSize: 13, color: "var(--muted)" }}>{labelOf(k)} · {Math.round((c / totalS) * 100)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          );
        })()}

        {/* Pendências */}
        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 16, margin: "0 0 10px" }}>
            Pendências {pend.length > 0 && (
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--on-accent)", background: "var(--warn)", borderRadius: 999, padding: "1px 8px", verticalAlign: "middle" }}>{pend.length}</span>
            )}
          </h2>
          {pend.length === 0 ? (
            <div className="card" style={{ padding: 16, color: "var(--muted)", fontSize: 14 }}>
              Tudo em dia — nenhuma pendência detectada.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {pend.map((p, i) => (
                <div key={i} className="card" style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 99, background: p.tone === "warn" ? "var(--warn)" : "var(--accent)", flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 14 }}>{p.label}</span>
                  {p.cta !== "—" && <a href={p.href} className="btn" style={{ padding: "6px 14px", fontSize: 13 }}>{p.cta}</a>}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Fora do ar */}
        {m.indispo > 0 && (
          <section style={{ marginTop: 20 }}>
            <h2 style={{ fontSize: 16, margin: "0 0 10px" }}>Fora do ar</h2>
            <div className="card" style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ flex: 1, fontSize: 14 }}>
                {n(m.indispo)} imóveis <strong>indisponíveis</strong> (anúncio saiu do ar). Ficam no histórico, fora do mapa.
              </span>
            </div>
          </section>
        )}

        {/* Ferramentas */}
        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 16, margin: "0 0 4px" }}>Ferramentas</h2>
          <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 14px" }}>
            Ver a base fica no <strong>Mapa</strong> (menu do topo). Passe o mouse no <span style={{ fontStyle: "italic" }}>(i)</span> para o que cada uma faz.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
            {TOOLS.map((t) => (
              <a key={t.href} href={t.href} className="card" style={{ padding: 16, textDecoration: "none", color: "var(--ink)", display: "block" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontWeight: 700, fontSize: 15, flex: 1 }}>{t.name}</span>
                  <InfoDot text={t.info} />
                </div>
                <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 6 }}>{t.desc}</div>
              </a>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
