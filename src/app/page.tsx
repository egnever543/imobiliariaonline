// Página de status inicial. Server Component: lê números do banco quando o
// Supabase está configurado; senão, mostra o estado de configuração.

import { getServiceClient } from "@/lib/supabase/server";
import Nav from "@/components/Nav";

export const dynamic = "force-dynamic";

interface Stats {
  cities: number;
  agencies: number;
  listings: number;
}

async function loadStats(): Promise<Stats | null> {
  try {
    const db = getServiceClient();
    const [cities, agencies, listings] = await Promise.all([
      db.from("cities").select("id", { count: "exact", head: true }),
      db.from("agencies").select("id", { count: "exact", head: true }),
      db.from("listings").select("id", { count: "exact", head: true }),
    ]);
    return {
      cities: cities.count ?? 0,
      agencies: agencies.count ?? 0,
      listings: listings.count ?? 0,
    };
  } catch {
    return null;
  }
}

interface Spend {
  total_usd: number;
  today_usd: number;
  week_usd: number;
  ai_count: number;
  jsonld_count: number;
}
interface Daily {
  dia: string;
  ia: number;
  jsonld: number;
  usd: number;
}

async function loadSpend(): Promise<{ summary: Spend | null; daily: Daily[] }> {
  try {
    const db = getServiceClient();
    const [s, d] = await Promise.all([
      db.from("spend_summary").select("*").single(),
      db.from("spend_daily").select("*").limit(7),
    ]);
    return {
      summary: (s.data as Spend) ?? null,
      daily: (d.data as Daily[]) ?? [],
    };
  } catch {
    return { summary: null, daily: [] };
  }
}

const usd = (v: number | string) => {
  const n = Number(v) || 0;
  return "US$ " + n.toFixed(n < 1 ? 4 : 2);
};

export default async function Home() {
  const [stats, spend] = await Promise.all([loadStats(), loadSpend()]);

  return (
    <>
      <Nav />
      <main
        style={{
          maxWidth: 1080,
          margin: "0 auto",
          padding: "56px 24px 96px",
        }}
      >
        {/* ── Hero ── */}
        <span className="chip">Inteligência imobiliária</span>
        <h1
          style={{
            fontSize: "clamp(32px, 5vw, 50px)",
            margin: "16px 0 8px",
            maxWidth: 620,
          }}
        >
          O inventário de imóveis da cidade, numa base só.
        </h1>
        <p
          style={{
            color: "var(--muted)",
            marginTop: 0,
            fontSize: 17,
            maxWidth: 560,
          }}
        >
          Coletamos o inventário público de imóveis de uma cidade inteira e
          entregamos tudo pronto para busca, mapa e inteligência de mercado.
        </p>

        <div style={{ display: "flex", gap: 12, marginTop: 24, flexWrap: "wrap" }}>
          <a href="/mapa" className="btn">
            Ver mapa →
          </a>
          <a href="/admin" className="btn btn-ghost">
            Painel de coleta
          </a>
        </div>

        {stats ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 14,
              marginTop: 44,
            }}
          >
            {(
              [
                ["Cidades", stats.cities, "🗺️"],
                ["Imobiliárias", stats.agencies, "🏢"],
                ["Imóveis", stats.listings, "🏠"],
              ] as const
            ).map(([label, value, icon]) => (
              <div key={label} className="card" style={{ padding: 22 }}>
                <div style={{ fontSize: 18 }}>{icon}</div>
                <div
                  style={{
                    fontSize: 34,
                    fontWeight: 800,
                    marginTop: 6,
                    letterSpacing: "-0.03em",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {value.toLocaleString("pt-BR")}
                </div>
                <div style={{ color: "var(--muted)", fontSize: 13.5 }}>
                  {label}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div
            className="card"
            style={{ marginTop: 44, padding: 22, color: "var(--muted)" }}
          >
            <strong style={{ color: "var(--ink)" }}>
              Supabase não configurado.
            </strong>{" "}
            Copie <code>.env.example</code> para <code>.env.local</code>,
            preencha as chaves e rode a migração em{" "}
            <code>supabase/migrations</code>.
          </div>
        )}

        {/* ── Gastos com IA ── */}
        {spend.summary && (
          <section style={{ marginTop: 44 }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              marginBottom: 12,
            }}
          >
            <h2 style={{ fontSize: 16, margin: 0 }}>Gastos com IA</h2>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              🟢 {spend.summary.jsonld_count} grátis (JSON-LD) · 🤖{" "}
              {spend.summary.ai_count} por IA
            </span>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            {(
              [
                ["Total", spend.summary.total_usd],
                ["Hoje", spend.summary.today_usd],
                ["7 dias", spend.summary.week_usd],
              ] as const
            ).map(([label, value]) => (
              <div
                key={label}
                className="card"
                style={{ flex: 1, minWidth: 120, padding: 18 }}
              >
                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 800,
                    letterSpacing: "-0.02em",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {usd(value)}
                </div>
                <div style={{ color: "var(--muted)", fontSize: 12 }}>{label}</div>
              </div>
            ))}
          </div>

          {spend.daily.length > 0 && (
            <div
              className="card"
              style={{ marginTop: 12, padding: "8px 16px", fontSize: 13 }}
            >
              {spend.daily.map((d) => (
                <div
                  key={d.dia}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "6px 0",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  <span style={{ color: "var(--muted)" }}>
                    {new Date(d.dia).toLocaleDateString("pt-BR")}
                  </span>
                  <span style={{ color: "var(--muted)" }}>
                    🤖 {d.ia} · 🟢 {d.jsonld}
                  </span>
                  <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                    {usd(d.usd)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
        )}
      </main>
    </>
  );
}
