// ── Como o Radar avalia os imóveis ────────────────────────────────────
// Página explicativa (estática) do ranking inteligente: fatores, "preço
// justo", oferta, confiança e perfis. Serve para o usuário entender de onde
// vem a nota de cada imóvel.

import Nav from "@/components/Nav";
import { SCORE_PROFILES } from "@/lib/scoring/profiles";

export const dynamic = "force-dynamic";

const FACTORS: { icon: string; name: string; desc: string }[] = [
  { icon: "🏷️", name: "Oferta (preço justo)", desc: "Compara o R$/m² do imóvel com a mediana de imóveis parecidos (mesmo bairro e tipo). Abaixo da mediana = oferta melhor. É o fator mais importante para investir." },
  { icon: "🏖️", name: "Praia", desc: "Distância até a linha de costa da cidade. Quanto mais perto, maior a nota (satura em ~5 km)." },
  { icon: "📍", name: "Comércios (POIs)", desc: "Proximidade de escola, farmácia, mercado, saúde, padaria… Cada categoria tem uma distância ideal e um peso de importância." },
  { icon: "💰", name: "R$/m² na cidade", desc: "Preço por m² comparado a toda a cidade (não só ao bairro). Complementa a Oferta." },
  { icon: "📐", name: "Área", desc: "Tamanho do imóvel em relação aos demais do conjunto." },
  { icon: "📌", name: "Geo", desc: "Peso menor. Reflete a precisão da localização (endereço exato > rua > CEP > bairro)." },
];

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div className="card" style={{ padding: 18, ...style }}>{children}</div>;
}

export default function AvaliacaoDocs() {
  return (
    <>
      <Nav />
      <main style={{ maxWidth: 860, margin: "0 auto", padding: "36px 20px 96px" }}>
        <span className="chip">Ranking inteligente</span>
        <h1 style={{ fontSize: 30, margin: "12px 0 4px" }}>Como o Radar avalia os imóveis</h1>
        <p style={{ color: "var(--muted)", marginTop: 0, fontSize: 15 }}>
          Cada imóvel recebe uma nota de 0 a 100. A nota nasce de fatores objetivos,
          combinados segundo o objetivo (investir, morar…). Nada é opinião: tudo vem
          dos dados coletados.
        </p>

        {/* Como a nota é montada */}
        <section style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 17, margin: "0 0 10px" }}>1. Os fatores</h2>
          <div style={{ display: "grid", gap: 10 }}>
            {FACTORS.map((f) => (
              <Card key={f.name} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <span style={{ fontSize: 22, lineHeight: 1 }}>{f.icon}</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14.5 }}>{f.name}</div>
                  <div style={{ fontSize: 13.5, color: "var(--muted)", marginTop: 3 }}>{f.desc}</div>
                </div>
              </Card>
            ))}
          </div>
        </section>

        {/* Preço justo */}
        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 17, margin: "0 0 10px" }}>2. O “preço justo”</h2>
          <Card>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55 }}>
              Para cada imóvel, o Radar calcula quanto <strong>imóveis parecidos</strong> custam
              por m² e usa a <strong>mediana</strong> como referência:
            </p>
            <ul style={{ margin: "10px 0", paddingLeft: 18, fontSize: 14, lineHeight: 1.6 }}>
              <li>Primeiro tenta comparar com o <strong>mesmo bairro + mesmo tipo</strong> (ex.: terrenos no Centro);</li>
              <li>se houver poucos comparáveis (menos de 5), cai para o <strong>mesmo tipo na cidade</strong>;</li>
              <li>por fim, a cidade toda.</li>
            </ul>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55 }}>
              O <strong>preço justo estimado</strong> = mediana do R$/m² do grupo × área do imóvel.
              A diferença entre o preço anunciado e esse valor vira a nota de <strong>Oferta</strong>:
              um imóvel <strong>20% abaixo</strong> do esperado tende a 100; no preço esperado, ~50;
              <strong> 20% acima</strong>, perto de 0.
            </p>
          </Card>
        </section>

        {/* Confiança */}
        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 17, margin: "0 0 10px" }}>3. Confiança do dado (não é mérito)</h2>
          <Card>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55 }}>
              A <strong>confiança</strong> mede o quão completo/preciso é o cadastro daquele imóvel
              (tem preço? tem área? a localização é exata ou aproximada?). Ela aparece como um
              selo à parte no painel do imóvel — <strong>não</strong> entra como qualidade do
              imóvel, para não penalizar um bom imóvel só porque falta um dado. Rodar
              <em> “Atualizar imóveis”</em> melhora a confiança da base.
            </p>
          </Card>
        </section>

        {/* Perfis */}
        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 17, margin: "0 0 10px" }}>4. Perfis (para quê você quer o imóvel)</h2>
          <p style={{ color: "var(--muted)", marginTop: 0, fontSize: 14 }}>
            O mesmo imóvel muda de nota conforme o objetivo — cada perfil dá pesos diferentes aos fatores.
            Dá para ajustar os pesos manualmente no mapa (menu “Ordenar”).
          </p>
          <div style={{ display: "grid", gap: 10 }}>
            {SCORE_PROFILES.map((p) => (
              <Card key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14.5 }}>{p.label}</div>
                  <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>{p.desc}</div>
                </div>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", justifyContent: "flex-end", maxWidth: 320 }}>
                  {Object.entries(p.weights)
                    .filter(([, v]) => v > 0)
                    .sort((a, b) => b[1] - a[1])
                    .map(([k, v]) => (
                      <span key={k} style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", border: "1px solid var(--border)", borderRadius: 999, padding: "1px 8px" }}>
                        {k} {v}%
                      </span>
                    ))}
                </div>
              </Card>
            ))}
          </div>
        </section>

        {/* Onde vejo */}
        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 17, margin: "0 0 10px" }}>5. Onde isso aparece</h2>
          <Card>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55 }}>
              No <a href="/mapa">mapa</a>, ligue <strong>“🏆 Ordenar → Ranking inteligente”</strong> e
              escolha um perfil. A lista passa a ser ordenada pela nota, cada pin ganha um selo
              colorido e, ao clicar num imóvel, o painel mostra o <strong>preço justo</strong>, o
              <strong> desconto/ágio</strong>, os <strong>motivos</strong> (“25% abaixo do bairro”,
              “escola por perto”, “praia a 600 m”) e a <strong>confiança</strong>.
            </p>
          </Card>
        </section>

        {/* Próximos passos */}
        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 17, margin: "0 0 10px" }}>Próximos passos (roadmap)</h2>
          <Card style={{ background: "var(--paper-2)" }}>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, lineHeight: 1.7 }}>
              <li><strong>Yield</strong> (rentabilidade): coletar anúncios de aluguel para estimar aluguel ÷ preço.</li>
              <li><strong>Valorização</strong>: usar o histórico de preços (snapshots) para detectar tendência por bairro.</li>
              <li><strong>Liquidez</strong>: usar os status (vendido/alugado) para medir quanto e quão rápido cada bairro vende.</li>
              <li><strong>“Destaques da cidade”</strong>: uma tela com o TOP 3 por objetivo e o porquê em linguagem natural.</li>
            </ul>
          </Card>
        </section>

        <p style={{ marginTop: 28 }}>
          <a href="/admin" style={{ fontSize: 13, color: "var(--muted)" }}>← voltar ao painel</a>
        </p>
      </main>
    </>
  );
}
