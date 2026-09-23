import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pepita — Prospecção empresarial",
  description: "Encontre empresas, organize dados públicos e descubra oportunidades comerciais.",
  icons: {
    icon: [
      { url:"/pepita/icon-32.png", sizes:"32x32", type:"image/png" },
      { url:"/pepita/icon-64.png", sizes:"64x64", type:"image/png" }
    ],
    apple: [
      { url:"/pepita/icon-128.png", sizes:"128x128", type:"image/png" }
    ]
  }
};

export default function RootLayout({children}:{children:ReactNode}) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
