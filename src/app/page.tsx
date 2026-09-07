// Página de status inicial. Server Component: lê números do banco quando o
// Supabase está configurado; senão, mostra o estado de configuração.

import { getServiceClient } from "@/lib/supabase/server";

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
    <main
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: "64px 24px",
      }}
    >
      <p
        style={{
          fontFamily: "ui-monospace, monospace",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          fontSize: 12,
          color: "var(--accent)",
          margin: 0,
        }}
      >
        Radar Imobiliário
      </p>
      <h1 style={{ fontSize: 34, margin: "8px 0 4px", letterSpacing: "-0.02em" }}>
        Inventário da cidade, numa base só.
      </h1>
      <p style={{ color: "var(--muted)", marginTop: 0 }}>
        Coleta o inventário público de imóveis e disponibiliza para busca e
        inteligência de mercado. Este é o esqueleto do produto.
      </p>

      <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
        <a
          href="/mapa"
          style={{
            display: "inline-block",
            padding: "8px 14px",
            borderRadius: 8,
            background: "var(--accent)",
            color: "#fff",
            fontSize: 14,
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          Ver mapa →
        </a>
        <a
          href="/admin"
          style={{
            display: "inline-block",
            padding: "8px 14px",
            borderRadius: 8,
            background: "transparent",
            border: "1px solid var(--border)",
            color: "var(--ink)",
            fontSize: 14,
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          Painel de coleta
        </a>
      </div>

      {stats ? (
        <div style={{ display: "flex", gap: 12, marginTop: 32 }}>
          {(
            [
              ["Cidades", stats.cities],
              ["Imobiliárias", stats.agencies],
              ["Imóveis", stats.listings],
            ] as const
          ).map(([label, value]) => (
            <div
              key={label}
              style={{
                flex: 1,
                background: "var(--paper)",
                border: "1px solid var(--border)",
                borderRadius: 12,
                padding: 20,
              }}
            >
              <div style={{ fontSize: 30, fontWeight: 700 }}>{value}</div>
              <div style={{ color: "var(--muted)", fontSize: 13 }}>{label}</div>
            </div>
          ))}
        </div>
      ) : (
        <div
          style={{
            marginTop: 32,
            background: "var(--paper)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: 20,
            color: "var(--muted)",
          }}
        >
          <strong style={{ color: "var(--ink)" }}>
            Supabase não configurado.
          </strong>{" "}
          Copie <code>.env.example</code> para <code>.env.local</code>, preencha
          as chaves e rode a migração em <code>supabase/migrations</code>.
        </div>
      )}

      {/* ── Gastos com IA ── */}
      {spend.summary && (
        <section style={{ marginTop: 36 }}>
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
                style={{
                  flex: 1,
                  background: "var(--paper)",
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  padding: 16,
                }}
              >
                <div style={{ fontSize: 20, fontWeight: 700 }}>{usd(value)}</div>
                <div style={{ color: "var(--muted)", fontSize: 12 }}>{label}</div>
              </div>
            ))}
          </div>

          {spend.daily.length > 0 && (
            <div
              style={{
                marginTop: 12,
                background: "var(--paper)",
                border: "1px solid var(--border)",
                borderRadius: 12,
                padding: "8px 16px",
                fontSize: 13,
              }}
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
  );
}
