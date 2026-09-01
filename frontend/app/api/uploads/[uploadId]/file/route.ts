// Liefert ein hochgeladenes Belegbild aus, damit Chips und Ergebniskarte eine
// Vorschau zeigen können, ohne das Bild als base64 durch den Chat zu schicken.

import { mastraUrl } from '@/lib/mastra';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ uploadId: string }> },
) {
  const { uploadId } = await params;

  const upstream = await fetch(
    mastraUrl(`/receipts/${encodeURIComponent(uploadId)}/file`),
  );

  if (!upstream.ok) {
    return new Response(null, { status: upstream.status });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') ?? 'application/octet-stream',
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
