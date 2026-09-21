import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pepita — Prospecção empresarial",
  description: "Encontre empresas, organize dados públicos e descubra oportunidades comerciais."
};

export default function RootLayout({children}:{children:ReactNode}) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
