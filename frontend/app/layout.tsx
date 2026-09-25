import type { Metadata } from "next";
import "./globals.css";

// Bewusst ohne next/font/google: das wuerde beim `next build` im Container
// Schriften von Google laden. Der Stack soll offline baubar bleiben, deshalb
// Inter mit System-Fallback (siehe --font-sans in globals.css).

export const metadata: Metadata = {
  title: "Swiss TPH Expenses",
  description: "Your captured receipts, ready for a settlement",
};

// Die Oberflaechentexte sind englisch (so ist die Vorlage), die Zahlen- und
// Datumsformate schweizerisch (siehe lib/receipts/format.ts). lang="en" ist
// deshalb richtig: es steuert Silbentrennung und Screenreader-Aussprache des
// TEXTES, nicht das Zahlenformat.
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
