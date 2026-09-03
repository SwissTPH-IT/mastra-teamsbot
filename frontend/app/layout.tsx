import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

// Bewusst ohne next/font/google: das wuerde beim `next build` im Container
// Schriften von Google laden. Der Stack soll offline baubar bleiben, deshalb
// ein System-Font-Stack (siehe --font-sans in globals.css).

export const metadata: Metadata = {
  title: "Belege",
  description: "Erfasste Belegdaten ansehen, durchsuchen und exportieren",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de">
      <body>
        <div className="min-h-dvh">
          <header className="border-line border-b">
            <div className="mx-auto flex max-w-[1400px] items-baseline gap-3 px-5 py-3">
              <Link href="/belege" className="text-fg text-[15px] font-semibold tracking-tight">
                Belege
              </Link>
              <span className="text-fg-subtle text-xs">Erfasste Belegdaten aller Nutzer</span>
            </div>
          </header>
          <main className="mx-auto max-w-[1400px] px-5 py-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
