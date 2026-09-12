// ── Painel de administração (hub) ─────────────────────────────────────
// Dashboard analítico: indicadores, pendências/sugestões e atalhos para todas
// as ferramentas, cada uma com um (i) explicando o que faz.
// Server Component: lê os números do banco (tolerante a tabelas ausentes).

import { getServiceClient } from "@/lib/supabase/server";
import Nav from "@/components/Nav";

export const dynamic = "force-dynamic";

interface Metrics {
  configured: boolean;
  cities: number;
  agencies: number;
  listings: number;
  geoOk: number;
  noGeo: number;
  noPrice: number;
  pois: number;
  audited: number;
  spendTotal: number;
  spendToday: number;
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
      noGeo: 0, noPrice: 0, pois: 0, audited: 0, spendTotal: 0, spendToday: 0,
    };
  }

  const [cities, agencies, listings, geoOk, noPrice, pois] = await Promise.all([
    count(db, "cities"),
    count(db, "agencies"),
    count(db, "listings"),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    count(db, "listings", (q: any) => q.not("lat", "is", null)),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    count(db, "listings", (q: any) => q.is("price", null)),
    count(db, "pois"),
  ]);

  // imóveis já auditados (distintos)
  let audited = 0;
  try {
    const { data } = await db.from("data_audits").select("listing_id").limit(50000);
    audited = new Set((data ?? []).map((r) => r.listing_id as string)).size;
  } catch {
    audited = 0;
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
    noGeo: Math.max(0, listings - geoOk), noPrice, pois, audited, spendTotal, spendToday,
  };
}

const usd = (v: number) => "US$ " + (v < 1 ? v.toFixed(4) : v.toFixed(2));
const n = (v: number) => v.toLocaleString("pt-BR");

interface Tool {
  href: string; icon: string; name: string; desc: string; info: string;
}
const TOOLS: Tool[] = [
  { href: "/imoveis", icon: "🏠", name: "Imóveis (vitrine)", desc: "Ver todos com foto e o que falta",
    info: "Grade estilo portal com foto de cada imóvel, atributos e selos do que está faltando (sem foto, sem preço, sem área, sem localização). Melhor que o mapa para revisar a completude dos dados." },
  { href: "/admin/atualizar", icon: "🔄", name: "Atualizar imóveis", desc: "Revisitar anúncios (preço, foto, status)",
    info: "Revisita os anúncios já coletados (grátis, sem IA): traz preço novo, completa dados que faltavam (incluindo a foto) e marca como indisponível o que saiu do ar. Rode de tempos em tempos." },
  { href: "/mapa", icon: "🗺️", name: "Mapa", desc: "Explorar imóveis, filtrar e ranquear",
    info: "Mapa interativo com busca por tipo, quartos, preço e bairro. Liga o ranking inteligente (proximidade de praia, comércios, R$/m²) e o mapa de calor de comércios. É a tela do corretor." },
  { href: "/admin/coletar", icon: "📥", name: "Coletar imóveis", desc: "Puxar anúncios de uma imobiliária",
    info: "Informe o site de uma imobiliária: o sistema busca os anúncios (grátis) e coleta quantos você escolher, mostrando o custo da IA ao vivo. Use para adicionar uma imobiliária específica." },
  { href: "/admin/coletar-cidade", icon: "🏙️", name: "Coletar cidade", desc: "Varrer a cidade inteira de uma vez",
    info: "Roda a coleta em todas as imobiliárias já descobertas na cidade, em sequência. Ideal para popular a base de uma cidade nova." },
  { href: "/admin/descobrir", icon: "🔎", name: "Descobrir imobiliárias", desc: "Achar imobiliárias via Google",
    info: "Usa o Google Places para listar as imobiliárias de uma cidade e o site de cada uma, salvando-as para depois coletar. Primeiro passo ao abrir uma cidade nova." },
  { href: "/admin/geo", icon: "📍", name: "Corrigir localização", desc: "Geocodificar imóveis sem coordenada",
    info: "Lista imóveis sem posição no mapa. Você ajusta o endereço e re-geocodifica, ou clica no mapa para fixar o ponto manualmente." },
  { href: "/admin/comercios", icon: "🔥", name: "Comércios / mapa de calor", desc: "Coletar escola, farmácia, mercado…",
    info: "Coleta os comércios que valorizam a região (OpenStreetMap, grátis). Alimenta o mapa de calor e a nota de vizinhança de cada imóvel." },
  { href: "/admin/auditoria", icon: "✅", name: "Auditoria por IA", desc: "Conferir e corrigir os dados",
    info: "A IA lê cada anúncio, compara com os dados salvos e corrige o que estiver errado (preço, área, tipo, quartos…). Revise um a um ou em lote; dá para só sugerir antes de aplicar." },
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

  // pendências (só aparecem quando existem de fato)
  const pend: { label: string; href: string; cta: string; tone: "warn" | "accent" }[] = [];
  if (!m.configured) {
    pend.push({ label: "Supabase não configurado — preencha as chaves no servidor.", href: "/admin", cta: "—", tone: "warn" });
  } else {
    if (m.listings === 0) pend.push({ label: "Nenhum imóvel coletado ainda.", href: "/admin/coletar", cta: "Coletar", tone: "accent" });
    if (m.noGeo > 0) pend.push({ label: `${n(m.noGeo)} imóveis sem localização no mapa.`, href: "/admin/geo", cta: "Corrigir", tone: "warn" });
    if (m.listings > 0 && m.audited < m.listings) pend.push({ label: `${n(m.listings - m.audited)} imóveis ainda não revisados pela IA.`, href: "/admin/auditoria", cta: "Auditar", tone: "accent" });
    if (m.noPrice > 0) pend.push({ label: `${n(m.noPrice)} imóveis sem preço.`, href: "/admin/auditoria", cta: "Revisar", tone: "warn" });
    if (m.listings > 0 && m.pois === 0) pend.push({ label: "Comércios ainda não coletados (mapa de calor vazio).", href: "/admin/comercios", cta: "Coletar", tone: "accent" });
  }

  const kpis: { label: string; value: string; sub?: string }[] = [
    { label: "Imóveis", value: n(m.listings) },
    { label: "Imobiliárias", value: n(m.agencies) },
    { label: "Cidades", value: n(m.cities) },
    { label: "Com localização", value: n(m.geoOk), sub: m.listings ? Math.round((m.geoOk / m.listings) * 100) + "%" : undefined },
    { label: "Revisados (IA)", value: n(m.audited), sub: m.listings ? Math.round((m.audited / m.listings) * 100) + "%" : undefined },
    { label: "Comércios", value: n(m.pois) },
    { label: "Gasto IA (total)", value: usd(m.spendTotal) },
    { label: "Gasto IA (hoje)", value: usd(m.spendToday) },
  ];

  return (
    <>
      <Nav />
      <main style={{ maxWidth: 1000, margin: "0 auto", padding: "36px 24px 96px" }}>
        <span className="chip">Painel</span>
        <h1 style={{ fontSize: 30, margin: "12px 0 4px" }}>Central de gestão</h1>
        <p style={{ color: "var(--muted)", marginTop: 0, fontSize: 15 }}>
          Visão geral da base, pendências e todas as ferramentas num só lugar.
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

        {/* Pendências e sugestões */}
        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 16, margin: "0 0 10px" }}>
            Pendências e sugestões {pend.length > 0 && (
              <span style={{ fontSize: 12, fontWeight: 700, color: "#fff", background: "var(--warn)", borderRadius: 999, padding: "1px 8px", verticalAlign: "middle" }}>{pend.length}</span>
            )}
          </h2>
          {pend.length === 0 ? (
            <div className="card" style={{ padding: 16, color: "var(--muted)", fontSize: 14 }}>
              ✅ Tudo em dia — nenhuma pendência detectada.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {pend.map((p, i) => (
                <div key={i} className="card" style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 99, background: p.tone === "warn" ? "var(--warn)" : "var(--accent)", flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 14 }}>{p.label}</span>
                  {p.cta !== "—" && <a href={p.href} className="btn" style={{ padding: "6px 14px", fontSize: 13 }}>{p.cta} →</a>}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Ferramentas */}
        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 16, margin: "0 0 10px" }}>Ferramentas</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
            {TOOLS.map((t) => (
              <a key={t.href} href={t.href} className="card"
                style={{ padding: 16, textDecoration: "none", color: "var(--ink)", display: "block" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 20 }}>{t.icon}</span>
                  <span style={{ fontWeight: 700, fontSize: 15, flex: 1 }}>{t.name}</span>
                  <InfoDot text={t.info} />
                </div>
                <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 6 }}>{t.desc}</div>
              </a>
            ))}
          </div>
          <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 10 }}>
            Passe o mouse no <span style={{ fontStyle: "italic" }}>(i)</span> de cada ferramenta para ver o que ela faz.
          </p>
        </section>
      </main>
    </>
  );
}
