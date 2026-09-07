// ── Servidor MCP remoto ───────────────────────────────────────────────
// Expõe ferramentas para o Claude (via conector no claude.ai): consultar
// imóveis, estatísticas de mercado, listar/descobrir imobiliárias e coletar.
//
// Autenticação: segredo na query (?key=MCP_SECRET). Adicione o conector no
// claude.ai com a URL:  https://SEU_APP/api/mcp?key=SEU_MCP_SECRET

import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { getServiceClient } from "@/lib/supabase/server";
import { findAgencies } from "@/lib/ingest/places";
import { fingerprint } from "@/lib/ingest/fingerprint";
import { discoverLinks, ingestOne } from "@/lib/ingest/pipeline";
import { estimateCostUSD } from "@/lib/ingest/cost";

export const runtime = "nodejs";
export const maxDuration = 60;

const text = (o: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(o, null, 2) }],
});

async function ensureCity(slug: string, name?: string, uf?: string) {
  const db = getServiceClient();
  const { data } = await db
    .from("cities")
    .upsert({ slug, name: name ?? slug, state: uf ?? "" }, { onConflict: "slug" })
    .select("id")
    .single();
  return data?.id as string | undefined;
}

const handler = createMcpHandler((server) => {
  // ── consultar imóveis ──
  server.registerTool(
    "consultar_imoveis",
    {
      description:
        "Consulta os imóveis já coletados, com filtros opcionais de bairro, tipo e faixa de preço.",
      inputSchema: z.object({
        bairro: z.string().optional(),
        tipo: z.string().optional(),
        preco_min: z.number().optional(),
        preco_max: z.number().optional(),
        limite: z.number().max(200).optional(),
      }),
    },
    async ({ bairro, tipo, preco_min, preco_max, limite }) => {
      const db = getServiceClient();
      let q = db
        .from("listings")
        .select(
          "id,title,type,price,area_total_m2,neighborhood,lat,lng,source_url,agencies(name)",
        )
        .order("first_seen_at", { ascending: false })
        .limit(limite ?? 50);
      if (bairro) q = q.eq("neighborhood", bairro);
      if (tipo) q = q.eq("type", tipo);
      if (preco_min != null) q = q.gte("price", preco_min);
      if (preco_max != null) q = q.lte("price", preco_max);
      const { data, error } = await q;
      return error ? text({ error: error.message }) : text(data);
    },
  );

  // ── estatísticas de mercado ──
  server.registerTool(
    "estatisticas_mercado",
    {
      description:
        "Resumo do mercado: total, faixa de preço, e por bairro (contagem, preço médio e R$/m² médio).",
      inputSchema: z.object({}),
    },
    async () => {
      const db = getServiceClient();
      const { data, error } = await db
        .from("listings")
        .select("price,area_total_m2,neighborhood,type");
      if (error) return text({ error: error.message });
      const rows = data ?? [];
      const precos = rows.map((r) => r.price).filter(Boolean) as number[];
      const byBairro: Record<string, { n: number; somaPreco: number; somaM2: number; nM2: number }> = {};
      const byTipo: Record<string, number> = {};
      rows.forEach((r) => {
        const b = r.neighborhood ?? "(sem bairro)";
        byBairro[b] ??= { n: 0, somaPreco: 0, somaM2: 0, nM2: 0 };
        byBairro[b].n++;
        if (r.price) byBairro[b].somaPreco += r.price;
        if (r.price && r.area_total_m2) {
          byBairro[b].somaM2 += r.price / r.area_total_m2;
          byBairro[b].nM2++;
        }
        const t = r.type ?? "(sem tipo)";
        byTipo[t] = (byTipo[t] ?? 0) + 1;
      });
      const porBairro = Object.entries(byBairro).map(([bairro, v]) => ({
        bairro,
        imoveis: v.n,
        preco_medio: v.n ? Math.round(v.somaPreco / v.n) : null,
        rs_m2_medio: v.nM2 ? Math.round(v.somaM2 / v.nM2) : null,
      }));
      return text({
        total: rows.length,
        preco_min: precos.length ? Math.min(...precos) : null,
        preco_max: precos.length ? Math.max(...precos) : null,
        por_tipo: byTipo,
        por_bairro: porBairro,
      });
    },
  );

  // ── listar imobiliárias ──
  server.registerTool(
    "listar_imobiliarias",
    {
      description:
        "Lista as imobiliárias cadastradas, com a plataforma detectada e a URL de listagem.",
      inputSchema: z.object({}),
    },
    async () => {
      const db = getServiceClient();
      const { data, error } = await db
        .from("agencies")
        .select("name,website,platform,listing_url");
      return error ? text({ error: error.message }) : text(data);
    },
  );

  // ── descobrir imobiliárias (Google Places + fingerprint) ──
  server.registerTool(
    "descobrir_imobiliarias",
    {
      description:
        "Pesquisa as imobiliárias de uma cidade no Google Places, salva-as e detecta a plataforma de cada site.",
      inputSchema: z.object({
        cidade: z.string(),
        uf: z.string(),
        slug: z.string().describe("identificador da cidade, ex: itapoa-sc"),
      }),
    },
    async ({ cidade, uf, slug }) => {
      const cityId = await ensureCity(slug, cidade, uf);
      if (!cityId) return text({ error: "não foi possível criar a cidade" });
      let agencies;
      try {
        agencies = await findAgencies(cidade, uf);
      } catch (e) {
        return text({ error: (e as Error).message });
      }
      const db = getServiceClient();
      const withSite = agencies.filter((a) => a.website).slice(0, 10);
      const report: unknown[] = [];
      const byPlatform: Record<string, number> = {};
      let saved = 0;
      for (const a of withSite) {
        const fp = await fingerprint(a.website!);
        byPlatform[fp.platform] = (byPlatform[fp.platform] ?? 0) + 1;
        const { error } = await db.from("agencies").upsert(
          {
            city_id: cityId,
            name: a.name,
            website: new URL(a.website!).origin,
            platform: fp.platform,
            listing_url: fp.candidateListingUrls[0] ?? null,
            google_place_id: a.place_id,
          },
          { onConflict: "city_id,website" },
        );
        if (!error) saved++;
        report.push({
          name: a.name,
          website: a.website,
          platform: fp.platform,
          hasJsonLd: fp.hasJsonLd,
          likelyJsRendered: fp.likelyJsRendered,
          listing: fp.candidateListingUrls[0] ?? null,
          error: fp.error,
        });
      }
      return text({ found: agencies.length, saved, byPlatform, report });
    },
  );

  // ── coletar imóveis de uma imobiliária ──
  server.registerTool(
    "coletar",
    {
      description:
        "Coleta imóveis de uma página de listagem (Jina + IA). Use um limite pequeno para controlar custo.",
      inputSchema: z.object({
        listingUrl: z.string(),
        slug: z.string(),
        cidade: z.string(),
        uf: z.string(),
        agencia: z.string().optional(),
        keywords: z.array(z.string()).optional(),
        limite: z.number().max(10).optional(),
      }),
    },
    async ({ listingUrl, slug, cidade, uf, agencia, keywords, limite }) => {
      const cityId = await ensureCity(slug, cidade, uf);
      if (!cityId) return text({ error: "cidade" });
      const db = getServiceClient();
      let agencyId: string | null = null;
      if (agencia) {
        const { data } = await db
          .from("agencies")
          .upsert(
            { city_id: cityId, name: agencia, website: new URL(listingUrl).origin, listing_url: listingUrl },
            { onConflict: "city_id,website" },
          )
          .select("id")
          .single();
        agencyId = data?.id ?? null;
      }
      const source = {
        cityId, agencyId, listingUrl, keywords: keywords ?? [],
        cityName: cidade, state: uf,
      };
      const cap = Math.min(limite ?? 3, 10);
      const { total, links } = await discoverLinks(source, cap);
      let saved = 0, inTok = 0, outTok = 0, model = "";
      const erros: string[] = [];
      for (const url of links) {
        const r = await ingestOne(source, url);
        inTok += r.inputTokens; outTok += r.outputTokens; model = r.model || model;
        if (r.saved) saved++;
        else if (r.error) erros.push(`${url}: ${r.error}`);
      }
      return text({
        linksEncontrados: total,
        processados: links.length,
        salvos: saved,
        custoUSD: Number(estimateCostUSD(model, inTok, outTok).toFixed(4)),
        erros,
      });
    },
  );
});

function authed(req: Request): boolean {
  const key = new URL(req.url).searchParams.get("key");
  return !!process.env.MCP_SECRET && key === process.env.MCP_SECRET;
}

async function guarded(req: Request): Promise<Response> {
  if (!authed(req)) return new Response("Not found", { status: 404 });
  return handler(req);
}

export { guarded as GET, guarded as POST, guarded as DELETE };
