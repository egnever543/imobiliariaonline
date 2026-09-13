// Revisita um anúncio já coletado (grátis, sem IA) e atualiza o imóvel:
//  - situação (ativo | vendido | alugado | reservado | locacao | indisponivel);
//  - preço (se mudou e continua plausível);
//  - campos que faltavam (área, quartos, foto…).
// Usado tanto pela rota /api/refresh (um a um, pelo painel) quanto pelo cron
// diário (/api/cron), que revisita em lote os anúncios mais desatualizados.

import type { getServiceClient } from "@/lib/supabase/server";
import { fetchListingSignals } from "@/lib/ingest/structured";

type DB = ReturnType<typeof getServiceClient>;

// campos preenchidos só quando estão vazios (não sobrescreve dado bom)
export const FILL_IF_MISSING = [
  "type", "area_total_m2", "built_area_m2", "bedrooms", "bathrooms",
  "suites", "parking", "neighborhood", "image_url",
] as const;

// colunas mínimas que o refresh precisa ler de cada imóvel
export const REFRESH_COLS = "id,source_url,price," + FILL_IF_MISSING.join(",");

export interface RefreshOutcome {
  id: string;
  status: string;
  changed: Record<string, { from: unknown; to: unknown }>;
}

function sanePrice(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 5000 || n > 80_000_000) return null;
  return n;
}

/** Revisita UM imóvel e grava as mudanças. `row` deve conter REFRESH_COLS. */
export async function refreshOne(
  db: DB,
  row: Record<string, unknown> & { id: string; source_url: string },
): Promise<RefreshOutcome> {
  const now = new Date().toISOString();
  const sig = await fetchListingSignals(row.source_url);

  // página não abre mais → provavelmente saiu do ar
  if (!sig) {
    await db.from("listings").update({ status: "indisponivel", last_checked_at: now }).eq("id", row.id);
    return { id: row.id, status: "indisponivel", changed: {} };
  }

  const s = sig.listing as unknown as Record<string, unknown>;
  const changed: RefreshOutcome["changed"] = {};
  // situação detectada
  const patch: Record<string, unknown> = { status: sig.status, last_checked_at: now, last_seen_at: now };
  if (sig.status !== "ativo") changed.status = { from: "ativo", to: sig.status };

  // preço pode mudar
  const newPrice = sanePrice(s.price);
  if (newPrice != null && newPrice !== row.price) {
    changed.price = { from: row.price ?? null, to: newPrice };
    patch.price = newPrice;
  }

  // completa o que faltava
  for (const f of FILL_IF_MISSING) {
    const currentVal = row[f];
    const newVal = s[f];
    if ((currentVal === null || currentVal === undefined || currentVal === "") && newVal != null && newVal !== "") {
      changed[f] = { from: currentVal ?? null, to: newVal };
      patch[f] = newVal;
    }
  }

  await db.from("listings").update(patch).eq("id", row.id);
  if (patch.price != null) {
    db.from("listing_snapshots").insert({ listing_id: row.id, price: patch.price }).then(() => {}, () => {});
  }

  return { id: row.id, status: sig.status, changed };
}
