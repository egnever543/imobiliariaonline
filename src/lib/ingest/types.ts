// ── Tipos do pipeline de ingestão ─────────────────────────────────────

/** Campos que a IA extrai de um anúncio, ainda "crus" (podem vir string/null). */
export interface ExtractedListing {
  title: string | null;
  type: string | null; // Terreno | Casa | Apartamento | Comercial | ...
  price: number | null;
  price_original: number | null;
  area_total_m2: number | null;
  frente_m: number | null;
  comprimento_m: number | null;
  neighborhood: string | null;
  street: string | null;
  street_number: string | null;
  cep: string | null;
  accepts_permuta: boolean | null;
  description: string | null;
  external_code: string | null;
}

/** Registro canônico, pronto para gravar na tabela `listings`. */
export interface CanonicalListing extends ExtractedListing {
  city_id: string;
  agency_id: string | null;
  source_url: string;
  dedup_key: string | null;
  raw: Record<string, unknown>;
}

/** Configuração de uma coleta para uma imobiliária. */
export interface AgencySource {
  cityId: string;
  agencyId: string | null;
  /** Página de listagem a varrer, ex: https://site.com.br/terrenos */
  listingUrl: string;
  /**
   * Palavras que indicam que um link é uma página de anúncio.
   * Ex: ['terreno', 'imovel', 'casa']. Vazio = aceita qualquer link interno.
   */
  keywords?: string[];
}
