"use client";

// Mapa do cliente (logado): mostra só a cidade liberada para a conta.
// Busca os imóveis pelo servidor (com o token), que confere a assinatura.

import { useEffect, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/browser";
import Explorer, { type Listing, type PoiPoint } from "../mapa/Explorer";

export default function AppMapa() {
  const [data, setData] = useState<{ listings: Listing[]; pois: PoiPoint[] } | null>(null);
  const [msg, setMsg] = useState("Carregando…");

  useEffect(() => {
    (async () => {
      const sb = getBrowserClient();
      if (!sb) { setMsg("Cadastro ainda não configurado neste ambiente."); return; }
      const { data: { session } } = await sb.auth.getSession();
      if (!session) { window.location.href = "/entrar"; return; }
      const token = session.access_token;

      let slug = new URLSearchParams(window.location.search).get("cidade") ?? "";
      if (!slug) {
        const me = await fetch("/api/account/me", { headers: { authorization: `Bearer ${token}` } }).then((r) => r.json()).catch(() => null);
        slug = me?.subscriptions?.find((s: { city?: { slug?: string } }) => s.city?.slug)?.city?.slug ?? "";
      }
      if (!slug) { setMsg("Nenhuma cidade liberada ainda. Veja o status em Minha conta."); return; }

      const res = await fetch(`/api/account/listings?cidade=${encodeURIComponent(slug)}`, { headers: { authorization: `Bearer ${token}` } });
      if (res.status === 403) { setMsg("Você ainda não tem acesso a esta cidade."); return; }
      if (res.status === 404) { setMsg("Esta cidade ainda não está na base."); return; }
      if (!res.ok) { setMsg("Não foi possível carregar o mapa."); return; }
      const json = await res.json();
      if (!json.listings?.length) { setMsg("A coleta desta cidade ainda não trouxe imóveis. Volte em breve."); return; }
      setData({ listings: json.listings as Listing[], pois: (json.pois ?? []) as PoiPoint[] });
    })();
  }, []);

  if (!data) {
    return (
      <main style={{ maxWidth: 480, margin: "0 auto", padding: "80px 24px", textAlign: "center" }}>
        <p style={{ color: "var(--muted)" }}>{msg}</p>
        <a href="/conta" style={{ fontSize: 14 }}>Minha conta</a>
      </main>
    );
  }
  return <Explorer listings={data.listings} pois={data.pois} chrome="conta" />;
}
