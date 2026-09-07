// ── Extração via JSON-LD (schema.org) ─────────────────────────────────
// Muitos sites de imobiliária publicam os dados do imóvel em
// <script type="application/ld+json">. Quando presente, é a forma mais
// confiável e barata de extrair (sem IA). Busca o HTML cru e faz o parse.

import type { ExtractedListing } from "./types";

const REALESTATE_TYPE =
  /(RealEstate|Residence|Apartment|House|SingleFamily|Villa|Place|Accommodation|Product|Offer|Home|Land)/i;

function toNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  let s = v.replace(/[^0-9.,-]/g, "");
  if (!s) return null;
  const hasComma = s.includes(",");
  const dots = (s.match(/\./g) || []).length;
  if (hasComma) {
    // formato BR: "2.480.000,00" -> tira pontos, vírgula vira ponto
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (dots > 1) {
    // vários pontos = separador de milhar: "2.480.000"
    s = s.replace(/\./g, "");
  }
  // um ponto só = decimal (padrão JSON-LD, ex "2480000.00") -> mantém
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

type Node = Record<string, unknown>;

function collect(j: unknown, out: Node[]): void {
  if (Array.isArray(j)) {
    j.forEach((x) => collect(x, out));
  } else if (j && typeof j === "object") {
    const o = j as Node;
    if (o["@graph"]) collect(o["@graph"], out);
    out.push(o);
  }
}

function typeStr(n: Node): string {
  const t = n["@type"];
  return Array.isArray(t) ? t.join(" ") : String(t ?? "");
}

function firstOffer(n: Node): Node | null {
  const off = n.offers;
  if (!off) return null;
  if (Array.isArray(off)) return (off[0] as Node) ?? null;
  if (typeof off === "object") return off as Node;
  return null;
}

function inferType(title: string | null, atType: string): string | null {
  const s = `${title ?? ""} ${atType}`.toLowerCase();
  if (/terreno|lote|land/.test(s)) return "Terreno";
  if (/apart|kitnet|studio|cobertura/.test(s)) return "Apartamento";
  if (/casa|sobrado|singlefamily|house|residence/.test(s)) return "Casa";
  if (/comercial|sala|loja|galp/.test(s)) return "Comercial";
  if (/s[íi]tio|chácara|fazenda/.test(s)) return "Sítio";
  return null;
}

/** Faz o parse dos blocos JSON-LD do HTML e monta um ExtractedListing. */
export function extractJsonLd(html: string): ExtractedListing | null {
  const scripts = [
    ...html.matchAll(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ].map((m) => m[1]);

  const nodes: Node[] = [];
  for (const s of scripts) {
    try {
      collect(JSON.parse(s.trim()), nodes);
    } catch {
      /* ignora bloco inválido */
    }
  }

  // considera só nós de imóvel/produto/oferta
  const cand = nodes.filter((n) => REALESTATE_TYPE.test(typeStr(n)));
  if (!cand.length) return null;

  let price: number | null = null;
  let area: number | null = null;
  let title: string | null = null;
  let description: string | null = null;
  let street: string | null = null;
  let cep: string | null = null;
  let neighborhood: string | null = null;
  let bedrooms: number | null = null;
  let bathrooms: number | null = null;
  let atType = "";

  for (const n of cand) {
    atType += " " + typeStr(n);
    if (title == null && typeof n.name === "string") title = n.name;
    if (description == null && typeof n.description === "string")
      description = n.description;

    if (price == null) {
      const off = firstOffer(n);
      price = toNum(off?.price ?? n.price ?? (off?.priceSpecification as Node)?.price);
    }
    if (area == null) {
      const fs = n.floorSize as Node | number | undefined;
      area = toNum(typeof fs === "object" ? fs?.value : fs);
    }
    if (bedrooms == null) bedrooms = toNum(n.numberOfBedrooms ?? n.numberOfRooms);
    if (bathrooms == null)
      bathrooms = toNum(n.numberOfBathroomsTotal ?? n.numberOfBathrooms);
    const addr = n.address as Node | undefined;
    if (addr && typeof addr === "object") {
      if (street == null && typeof addr.streetAddress === "string")
        street = addr.streetAddress;
      if (cep == null && addr.postalCode != null) cep = String(addr.postalCode);
      if (neighborhood == null && typeof addr.addressLocality === "string")
        neighborhood = addr.addressLocality;
    }
  }

  // só vale a pena se tiver ao menos preço ou área
  if (price == null && area == null) return null;

  return {
    title,
    type: inferType(title, atType),
    price,
    price_original: null,
    area_total_m2: area,
    frente_m: null,
    comprimento_m: null,
    neighborhood,
    street,
    street_number: null,
    cep,
    accepts_permuta: null,
    description,
    external_code: null,
    bedrooms,
    bathrooms,
    suites: null,
    parking: null,
    built_area_m2: null,
    condo_fee: null,
    is_launch: null,
  };
}

/** Busca o HTML cru de um anúncio e tenta extrair via JSON-LD. */
export async function fetchJsonLd(
  url: string,
  timeoutMs = 12_000,
): Promise<ExtractedListing | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; radar-imobiliario/0.1; +https://vercel.app)",
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const html = await res.text();
    return extractJsonLd(html);
  } catch {
    return null;
  }
}
