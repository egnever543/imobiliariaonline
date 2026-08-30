import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Radar Imobiliário",
  description:
    "Inteligência de mercado imobiliário: o inventário da cidade em uma base única e buscável.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
