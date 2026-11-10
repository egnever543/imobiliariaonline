// Página inicial. Server Component: lê números da base quando o Supabase está
// configurado; senão, mostra o estado de configuração. Minimalista, sem emoji.

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

export default async function Home() {
  const stats = await loadStats();

  return (
    <>
      <Nav />
      <main style={{ maxWidth: 1080, margin: "0 auto", padding: "56px 24px 96px" }}>
        {/* ── Hero ── */}
        <span className="chip">Inteligência imobiliária</span>
        <h1 style={{ fontSize: "clamp(32px, 5vw, 50px)", margin: "16px 0 8px", maxWidth: 640 }}>
          O inventário de imóveis da cidade, num mapa só.
        </h1>
        <p style={{ color: "var(--muted)", marginTop: 0, fontSize: 17, maxWidth: 560 }}>
          Reunimos o inventário público de imóveis de uma cidade e mostramos tudo
          num mapa limpo — com os pontos de referência do bairro e o preço de cada
          imóvel em relação à média da região.
        </p>

        <div style={{ display: "flex", gap: 12, marginTop: 24, flexWrap: "wrap" }}>
          <a href="/cadastro" className="btn">Criar conta</a>
          <a href="/entrar" className="btn btn-ghost">Entrar</a>
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
                ["Cidades", stats.cities],
                ["Imobiliárias", stats.agencies],
                ["Imóveis", stats.listings],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="card" style={{ padding: 22 }}>
                <div
                  style={{
                    fontSize: 34,
                    fontWeight: 800,
                    letterSpacing: "-0.03em",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {value.toLocaleString("pt-BR")}
                </div>
                <div style={{ color: "var(--muted)", fontSize: 13.5 }}>{label}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="card" style={{ marginTop: 44, padding: 22, color: "var(--muted)" }}>
            <strong style={{ color: "var(--ink)" }}>Supabase não configurado.</strong>{" "}
            Copie <code>.env.example</code> para <code>.env.local</code>, preencha as
            chaves e rode as migrações em <code>supabase/migrations</code>.
          </div>
        )}
      </main>
    </>
  );
}
