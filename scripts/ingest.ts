// ── CLI de ingestão ───────────────────────────────────────────────────
// Uso:
//   npm run ingest -- --url "https://site.com.br/terrenos" \
//                     --city itapoa-sc --city-name "Itapoá" --uf SC \
//                     --agency "Nome Imob" --keywords terreno,imovel --limit 5
//
// Carrega variáveis de .env.local automaticamente.

import { readFileSync, existsSync } from "node:fs";
import { ingestAgency } from "../src/lib/ingest/pipeline";
import { getServiceClient } from "../src/lib/supabase/server";

// ── carrega .env.local (loader mínimo, sem dependências) ──────────────
function loadEnv(path = ".env.local") {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnv();

// ── parse de argumentos ───────────────────────────────────────────────
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const url = arg("url");
  const citySlug = arg("city");
  if (!url || !citySlug) {
    console.error(
      "Faltam argumentos. Ex: npm run ingest -- --url <listagem> --city itapoa-sc --city-name Itapoá --uf SC",
    );
    process.exit(1);
  }

  const db = getServiceClient();

  // garante a cidade
  const { data: city, error: cityErr } = await db
    .from("cities")
    .upsert(
      {
        slug: citySlug,
        name: arg("city-name") ?? citySlug,
        state: arg("uf") ?? "",
      },
      { onConflict: "slug" },
    )
    .select("id")
    .single();
  if (cityErr || !city) throw new Error(cityErr?.message ?? "cidade");

  // garante a imobiliária (opcional)
  let agencyId: string | null = null;
  const agencyName = arg("agency");
  if (agencyName) {
    const website = new URL(url).origin;
    const { data: agency, error: agErr } = await db
      .from("agencies")
      .upsert(
        { city_id: city.id, name: agencyName, website, listing_url: url },
        { onConflict: "city_id,website" },
      )
      .select("id")
      .single();
    if (agErr) throw new Error(agErr.message);
    agencyId = agency?.id ?? null;
  }

  const keywords = arg("keywords")?.split(",").map((s) => s.trim()) ?? [];
  const limit = arg("limit") ? Number(arg("limit")) : undefined;

  console.log(`\n▶ Coletando ${url}\n  cidade=${citySlug} limite=${limit ?? "∞"}\n`);

  const result = await ingestAgency(
    { cityId: city.id, agencyId, listingUrl: url, keywords },
    { limit },
  );

  console.log("\n─── Resultado ───");
  console.log(`  links encontrados: ${result.linksFound}`);
  console.log(`  processados:       ${result.processed}`);
  console.log(`  salvos:            ${result.saved}`);
  if (result.errors.length) {
    console.log(`  erros (${result.errors.length}):`);
    result.errors.slice(0, 10).forEach((e) => console.log(`    - ${e}`));
  }
}

main().catch((err) => {
  console.error("Falhou:", err);
  process.exit(1);
});
