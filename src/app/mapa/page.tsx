// Página do mapa. Server Component: busca imóveis com coordenadas e passa
// para o mapa Leaflet (client).

import { getServiceClient } from "@/lib/supabase/server";
import MapClient, { type MapListing } from "./MapClient";

export const dynamic = "force-dynamic";

async function loadListings(): Promise<{ withCoords: MapListing[]; total: number }> {
  try {
    const db = getServiceClient();
    const { data, count } = await db
      .from("listings")
      .select(
        "id,title,type,price,area_total_m2,neighborhood,lat,lng,geo_method,source_url",
        { count: "exact" },
      )
      .not("lat", "is", null)
      .not("lng", "is", null)
      .limit(2000);
    return { withCoords: (data ?? []) as MapListing[], total: count ?? 0 };
  } catch {
    return { withCoords: [], total: 0 };
  }
}

export default async function Mapa() {
  const { withCoords, total } = await loadListings();

  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <MapClient listings={withCoords} />

      {/* Cabeçalho flutuante */}
      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          zIndex: 1000,
          background: "var(--paper)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "10px 14px",
          boxShadow: "0 2px 10px rgba(0,0,0,.2)",
        }}
      >
        <a href="/" style={{ fontSize: 12 }}>
          ← início
        </a>
        <div style={{ fontWeight: 700, fontSize: 15 }}>Mapa de imóveis</div>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>
          {withCoords.length} no mapa
          {total > withCoords.length
            ? ` · ${total - withCoords.length} sem coordenadas`
            : ""}
        </div>
      </div>

      {withCoords.length === 0 && (
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%,-50%)",
            zIndex: 1000,
            background: "var(--paper)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: 24,
            maxWidth: 360,
            textAlign: "center",
            boxShadow: "0 2px 20px rgba(0,0,0,.25)",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6 }}>
            Nenhum imóvel no mapa ainda
          </div>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>
            Colete imóveis no{" "}
            <a href="/admin" style={{ color: "var(--accent)" }}>
              painel
            </a>
            . Cada imóvel coletado é geocodificado e aparece aqui.
          </div>
        </div>
      )}
    </div>
  );
}
