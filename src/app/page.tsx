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

export default async function Home() {
  const stats = await loadStats();

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

      <a
        href="/admin"
        style={{
          display: "inline-block",
          marginTop: 12,
          padding: "8px 14px",
          borderRadius: 8,
          background: "var(--accent)",
          color: "#fff",
          fontSize: 14,
          fontWeight: 600,
          textDecoration: "none",
        }}
      >
        Abrir painel de coleta →
      </a>

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
    </main>
  );
}
