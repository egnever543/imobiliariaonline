"use client";

// Marketing: marca do cliente + calendário de posts gerados a partir dos
// imóveis. A arte aparece como preview (estilo post); a arte final do Canva
// entra numa etapa seguinte. Logado (Supabase Auth).

import { useEffect, useState, useCallback } from "react";
import { getBrowserClient } from "@/lib/supabase/browser";

interface Brand {
  agency_name?: string | null; logo_url?: string | null; primary_color?: string | null;
  phone?: string | null; creci?: string | null; instagram?: string | null;
}
interface Listing {
  id: string; type: string | null; price: number | null;
  area_total_m2: number | null; built_area_m2: number | null;
  bedrooms: number | null; parking: number | null; neighborhood: string | null;
  image_url: string | null; source_url: string;
}
interface Post {
  id: string; scheduled_for: string; caption: string | null; status: string;
  art_url: string | null; listing: Listing | null;
}

const fmtPrice = (v: number | null) => (v ? "R$ " + Number(v).toLocaleString("pt-BR") : "Sob consulta");
const fmtDate = (s: string) => new Date(s + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" });

const input: React.CSSProperties = {
  width: "100%", padding: "9px 11px", borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border)", background: "var(--paper)", color: "var(--ink)", fontSize: 14,
};
const lbl: React.CSSProperties = { fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 };

export default function Marketing() {
  const [token, setToken] = useState<string | null>(null);
  const [brand, setBrand] = useState<Brand>({ primary_color: "#d6b25e" });
  const [posts, setPosts] = useState<Post[]>([]);
  const [count, setCount] = useState(6);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);

  const authFetch = useCallback((url: string, init: RequestInit = {}) =>
    fetch(url, { ...init, headers: { ...(init.headers || {}), authorization: `Bearer ${token}`, "content-type": "application/json" } }),
    [token]);

  useEffect(() => {
    (async () => {
      const sb = getBrowserClient();
      if (!sb) { setMsg("Cadastro ainda não configurado neste ambiente."); setLoading(false); return; }
      const { data: { session } } = await sb.auth.getSession();
      if (!session) { window.location.href = "/entrar"; return; }
      setToken(session.access_token);
    })();
  }, []);

  const loadAll = useCallback(async () => {
    const [b, c] = await Promise.all([
      authFetch("/api/marketing/brand").then((r) => r.json()).catch(() => ({})),
      authFetch("/api/marketing/calendar").then((r) => r.json()).catch(() => ({})),
    ]);
    if (b.brand) setBrand({ primary_color: "#d6b25e", ...b.brand });
    setPosts(c.posts ?? []);
    setLoading(false);
  }, [authFetch]);

  useEffect(() => { if (token) loadAll(); }, [token, loadAll]);

  async function saveBrand() {
    setBusy(true); setMsg("");
    const res = await authFetch("/api/marketing/brand", { method: "POST", body: JSON.stringify(brand) });
    setBusy(false);
    setMsg(res.ok ? "Marca salva." : "Erro ao salvar a marca.");
  }

  async function gerar() {
    setBusy(true); setMsg("");
    const res = await authFetch("/api/marketing/calendar", { method: "POST", body: JSON.stringify({ count }) });
    const j = await res.json();
    setBusy(false);
    if (!res.ok) { setMsg("Erro: " + (j.error ?? "falha ao gerar")); return; }
    setMsg(`${j.created} posts gerados.`);
    loadAll();
  }

  async function trocar(id: string) {
    await authFetch("/api/marketing/calendar", { method: "PATCH", body: JSON.stringify({ id, regenerate: true }) });
    loadAll();
  }
  async function remover(id: string) {
    await authFetch(`/api/marketing/calendar?id=${id}`, { method: "DELETE" });
    setPosts((ps) => ps.filter((p) => p.id !== id));
  }
  async function saveCaption(id: string, caption: string) {
    await authFetch("/api/marketing/calendar", { method: "PATCH", body: JSON.stringify({ id, caption }) });
  }

  return (
    <main style={{ maxWidth: 1000, margin: "0 auto", padding: "40px 24px 96px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <a href="/conta" style={{ fontSize: 13, color: "var(--muted)" }}>← Minha conta</a>
      </div>
      <span className="chip">Marketing</span>
      <h1 style={{ fontSize: 30, margin: "12px 0 4px" }}>Calendário de posts</h1>
      <p style={{ color: "var(--muted)", marginTop: 0, fontSize: 15 }}>
        O sistema monta um cronograma de posts a partir dos seus imóveis. Ajuste
        a marca, gere o calendário e troque o que não gostar. A arte final (Canva)
        entra numa próxima etapa.
      </p>

      {loading && <p style={{ color: "var(--muted)" }}>Carregando…</p>}

      {!loading && (
        <>
          {/* Marca */}
          <section style={{ marginTop: 20 }}>
            <h2 style={{ fontSize: 16, margin: "0 0 10px" }}>Sua marca</h2>
            <div className="card" style={{ padding: 16, display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
              <div><label style={lbl}>Nome da imobiliária</label><input style={input} value={brand.agency_name ?? ""} onChange={(e) => setBrand({ ...brand, agency_name: e.target.value })} /></div>
              <div><label style={lbl}>Telefone / WhatsApp</label><input style={input} value={brand.phone ?? ""} onChange={(e) => setBrand({ ...brand, phone: e.target.value })} /></div>
              <div><label style={lbl}>CRECI</label><input style={input} value={brand.creci ?? ""} onChange={(e) => setBrand({ ...brand, creci: e.target.value })} /></div>
              <div><label style={lbl}>Instagram</label><input style={input} value={brand.instagram ?? ""} onChange={(e) => setBrand({ ...brand, instagram: e.target.value })} placeholder="@suaimobiliaria" /></div>
              <div><label style={lbl}>URL do logo (opcional)</label><input style={input} value={brand.logo_url ?? ""} onChange={(e) => setBrand({ ...brand, logo_url: e.target.value })} placeholder="https://…" /></div>
              <div>
                <label style={lbl}>Cor da marca</label>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input type="color" value={brand.primary_color ?? "#d6b25e"} onChange={(e) => setBrand({ ...brand, primary_color: e.target.value })} style={{ width: 44, height: 38, border: "1px solid var(--border)", borderRadius: 8, background: "var(--paper)" }} />
                  <input style={input} value={brand.primary_color ?? ""} onChange={(e) => setBrand({ ...brand, primary_color: e.target.value })} />
                </div>
              </div>
            </div>
            <div style={{ marginTop: 10 }}>
              <button className="btn" disabled={busy} onClick={saveBrand}>Salvar marca</button>
            </div>
          </section>

          {/* Gerar */}
          <section style={{ marginTop: 28 }}>
            <h2 style={{ fontSize: 16, margin: "0 0 10px" }}>Gerar calendário</h2>
            <div className="card" style={{ padding: 16, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <label style={{ fontSize: 14, color: "var(--muted)" }}>Quantos posts</label>
              <input type="number" min={1} max={30} value={count} onChange={(e) => setCount(Number(e.target.value))} style={{ ...input, width: 80 }} />
              <button className="btn" disabled={busy} onClick={gerar}>{busy ? "Gerando…" : "Gerar posts automáticos"}</button>
              <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Agenda em dias alternados a partir de amanhã. Depois é só trocar o que não gostar.</span>
            </div>
          </section>

          {msg && <p style={{ marginTop: 12, fontSize: 14, color: "var(--muted)" }}>{msg}</p>}

          {/* Calendário */}
          <section style={{ marginTop: 24 }}>
            <h2 style={{ fontSize: 16, margin: "0 0 10px" }}>Seus posts {posts.length > 0 && <span style={{ color: "var(--muted)", fontWeight: 400 }}>({posts.length})</span>}</h2>
            {posts.length === 0 ? (
              <div className="card" style={{ padding: 16, color: "var(--muted)", fontSize: 14 }}>Nenhum post ainda. Gere o calendário acima.</div>
            ) : (
              <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
                {posts.map((p) => (
                  <PostCard key={p.id} post={p} brand={brand}
                    onTrocar={() => trocar(p.id)} onRemover={() => remover(p.id)}
                    onCaption={(c) => saveCaption(p.id, c)} />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}

function PostCard({ post, brand, onTrocar, onRemover, onCaption }: {
  post: Post; brand: Brand; onTrocar: () => void; onRemover: () => void; onCaption: (c: string) => void;
}) {
  const l = post.listing;
  const [caption, setCaption] = useState(post.caption ?? "");
  const color = brand.primary_color || "#d6b25e";
  const specs = [l?.bedrooms ? `${l.bedrooms} quartos` : "", l?.parking ? `${l.parking} vagas` : "",
    l?.area_total_m2 || l?.built_area_m2 ? `${(l?.area_total_m2 ?? l?.built_area_m2)!.toLocaleString("pt-BR")} m²` : ""].filter(Boolean);

  return (
    <div className="card" style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>{fmtDate(post.scheduled_for)}</div>

      {/* preview estilo post (quadrado) */}
      <div style={{ position: "relative", aspectRatio: "1 / 1", borderRadius: 10, overflow: "hidden", background: "var(--paper-2)", border: "1px solid var(--border)" }}>
        {l?.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={l.image_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <div style={{ display: "grid", placeItems: "center", height: "100%", color: "var(--muted)", fontSize: 12 }}>sem foto</div>
        )}
        {/* faixa topo: marca */}
        <div style={{ position: "absolute", top: 8, left: 8, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ background: color, color: "#111", fontSize: 11, fontWeight: 800, padding: "3px 8px", borderRadius: 6 }}>
            {brand.agency_name || "Sua Imobiliária"}
          </span>
        </div>
        {/* overlay inferior */}
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "28px 12px 10px",
          background: "linear-gradient(to top, rgba(0,0,0,.82), rgba(0,0,0,.35) 60%, transparent)" }}>
          <div style={{ color: "#fff", fontSize: 11, opacity: .85 }}>{l?.type ?? "Imóvel"}{l?.neighborhood ? ` · ${l.neighborhood}` : ""}</div>
          <div style={{ color, fontSize: 22, fontWeight: 900, letterSpacing: "-0.02em", lineHeight: 1.1 }}>{fmtPrice(l?.price ?? null)}</div>
          {specs.length > 0 && <div style={{ color: "#fff", fontSize: 11, marginTop: 3, opacity: .9 }}>{specs.join(" · ")}</div>}
          <div style={{ color: "#fff", fontSize: 10, marginTop: 6, opacity: .8 }}>
            {[brand.phone, brand.creci ? `CRECI ${brand.creci}` : "", brand.instagram].filter(Boolean).join("  ·  ")}
          </div>
        </div>
      </div>

      {/* legenda editável */}
      <textarea value={caption} onChange={(e) => setCaption(e.target.value)} onBlur={() => onCaption(caption)} rows={3}
        style={{ ...input, resize: "vertical", fontSize: 12.5, lineHeight: 1.4 }} />

      <div style={{ display: "flex", gap: 6 }}>
        <button className="btn btn-ghost" style={{ flex: 1, padding: "6px 10px", fontSize: 12.5 }} onClick={onTrocar}>Trocar imóvel</button>
        {l && <a className="btn btn-ghost" style={{ padding: "6px 10px", fontSize: 12.5 }} href={l.source_url} target="_blank" rel="noreferrer">Anúncio</a>}
        <button className="btn btn-ghost" style={{ padding: "6px 10px", fontSize: 12.5, color: "var(--danger)" }} onClick={onRemover}>✕</button>
      </div>
    </div>
  );
}
