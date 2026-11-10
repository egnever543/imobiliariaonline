"use client";

// Painel da conta do cliente: cidade(s) liberada(s), solicitações pendentes e
// o plano (base para a cobrança mensal, ainda não ativa).

import { useEffect, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/browser";

interface CityRef { name: string; state: string | null; slug: string }
interface Sub { plan: string; status: string; current_period_end: string | null; city: CityRef | null }
interface Req { city_name: string; state: string | null; slug: string; status: string }
interface Me { email: string | null; subscriptions: Sub[]; requests: Req[] }

const REQ_LABEL: Record<string, { txt: string; color: string }> = {
  pendente: { txt: "Solicitada — aguardando liberação", color: "var(--warn)" },
  em_captura: { txt: "Em captura — coletando os imóveis", color: "var(--accent)" },
  disponivel: { txt: "Disponível", color: "var(--ok)" },
  recusada: { txt: "Recusada", color: "var(--danger)" },
};

export default function Conta() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      const sb = getBrowserClient();
      if (!sb) { setErr("Cadastro ainda não configurado neste ambiente."); setLoading(false); return; }
      const { data: { session } } = await sb.auth.getSession();
      if (!session) { window.location.href = "/entrar"; return; }
      const token = session.access_token;

      // vincula a cidade escolhida no cadastro, se ficou pendente
      try {
        const pend = localStorage.getItem("pending_onboard");
        if (pend) {
          await fetch("/api/account/onboard", {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
            body: pend,
          });
          localStorage.removeItem("pending_onboard");
        }
      } catch { /* ignora */ }

      const res = await fetch("/api/account/me", { headers: { authorization: `Bearer ${token}` } });
      if (!res.ok) { setErr("Não foi possível carregar sua conta."); setLoading(false); return; }
      setMe(await res.json());
      setLoading(false);
    })();
  }, []);

  async function sair() {
    const sb = getBrowserClient();
    await sb?.auth.signOut();
    window.location.href = "/";
  }

  return (
    <main style={{ maxWidth: 680, margin: "0 auto", padding: "40px 24px 96px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <a href="/" style={{ fontSize: 13, color: "var(--muted)" }}>← Radar Imobiliário</a>
        <button onClick={sair} className="btn btn-ghost" style={{ padding: "6px 12px", fontSize: 13 }}>Sair</button>
      </div>
      <h1 style={{ fontSize: 28, margin: "16px 0 4px" }}>Minha conta</h1>
      {me?.email && <p style={{ color: "var(--muted)", marginTop: 0, fontSize: 14 }}>{me.email}</p>}

      {loading && <p style={{ color: "var(--muted)" }}>Carregando…</p>}
      {err && <div className="card" style={{ padding: 16, color: "var(--danger)" }}>{err}</div>}

      {me && (
        <>
          {/* Cidades liberadas */}
          <section style={{ marginTop: 24 }}>
            <h2 style={{ fontSize: 16, margin: "0 0 10px" }}>Minhas cidades</h2>
            {me.subscriptions.length === 0 && me.requests.length === 0 && (
              <div className="card" style={{ padding: 16, color: "var(--muted)", fontSize: 14 }}>
                Nenhuma cidade ainda. <a href="/cadastro">Cadastrar uma cidade</a>.
              </div>
            )}
            <div style={{ display: "grid", gap: 10 }}>
              {me.subscriptions.map((s, i) => (
                <div key={i} className="card" style={{ padding: 16, display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700 }}>{s.city ? `${s.city.name}${s.city.state ? " · " + s.city.state : ""}` : "Cidade"}</div>
                    <div style={{ fontSize: 12.5, color: "var(--ok)" }}>Disponível · plano {s.plan} ({s.status})</div>
                  </div>
                  {s.city && <a href={`/app?cidade=${s.city.slug}`} className="btn" style={{ padding: "8px 14px", fontSize: 13 }}>Abrir mapa</a>}
                </div>
              ))}
              {me.requests.filter((r) => r.status !== "disponivel").map((r, i) => {
                const meta = REQ_LABEL[r.status] ?? { txt: r.status, color: "var(--muted)" };
                return (
                  <div key={`r${i}`} className="card" style={{ padding: 16, display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700 }}>{r.city_name}{r.state ? " · " + r.state : ""}</div>
                      <div style={{ fontSize: 12.5, color: meta.color }}>{meta.txt}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Plano / cobrança (base Stripe — ainda não ativa) */}
          <section style={{ marginTop: 28 }}>
            <h2 style={{ fontSize: 16, margin: "0 0 10px" }}>Plano</h2>
            <div className="card" style={{ padding: 16 }}>
              <div style={{ fontWeight: 700 }}>Período de avaliação (grátis)</div>
              <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
                A cobrança mensal será ativada em breve. Você será avisado antes de
                qualquer cobrança.
              </div>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
