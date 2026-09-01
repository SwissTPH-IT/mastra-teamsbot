import type { Metadata } from 'next';
import { TooltipProvider } from '@/components/ui/tooltip';
import './globals.css';

// Bewusst ohne next/font/google: das würde beim `next build` im Container
// Schriften von Google laden. Der Stack soll offline baubar bleiben, deshalb
// ein System-Font-Stack (siehe --font-sans/--font-mono in globals.css).

export const metadata: Metadata = {
  title: 'Belegerfassung',
  description: 'Belege hochladen und automatisch auslesen – Mastra receipt-workflow',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de">
      <body className="antialiased">
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
