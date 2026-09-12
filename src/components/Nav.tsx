// ── Barra de navegação (topo) ─────────────────────────────────────────
// Cabeçalho fixo com a marca e os links principais. Usado em todas as telas
// para dar consistência de SaaS. Server Component (sem estado).

import Link from "next/link";

const links = [
  { href: "/imoveis", label: "Imóveis" },
  { href: "/mapa", label: "Mapa" },
  { href: "/admin", label: "Painel" },
];

export function Brand({ size = 20 }: { size?: number }) {
  return (
    <Link
      href="/"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 9,
        color: "var(--ink)",
        fontWeight: 700,
        fontSize: size,
        letterSpacing: "-0.02em",
      }}
    >
      <span
        aria-hidden
        style={{
          display: "grid",
          placeItems: "center",
          width: size + 8,
          height: size + 8,
          borderRadius: 8,
          background: "var(--accent)",
          color: "#fff",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <svg
          width={size - 4}
          height={size - 4}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="M11 8v6M8 11h6" opacity="0" />
          <path d="m20 20-3.2-3.2" />
        </svg>
      </span>
      Radar Imobiliário
    </Link>
  );
}

export default function Nav() {
  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 40,
        background: "color-mix(in srgb, var(--paper) 85%, transparent)",
        backdropFilter: "saturate(1.6) blur(10px)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <nav
        style={{
          maxWidth: 1080,
          margin: "0 auto",
          padding: "12px 24px",
          display: "flex",
          alignItems: "center",
          gap: 20,
        }}
      >
        <Brand />
        <div style={{ flex: 1 }} />
        <div
          style={{
            display: "flex",
            gap: 4,
            alignItems: "center",
            fontSize: 14,
          }}
        >
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              style={{
                padding: "7px 12px",
                borderRadius: 8,
                color: "var(--muted)",
                fontWeight: 500,
              }}
            >
              {l.label}
            </Link>
          ))}
        </div>
      </nav>
    </header>
  );
}
