// Nimmt eine Datei aus dem Composer an und legt sie über Mastra im gemeinsamen
// Datenvolumen ab. Zurück kommt die uploadId, mit der der Chat später den
// Workflow startet.

import { mastraUrl } from '@/lib/mastra';

export const maxDuration = 60;

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get('file');

  if (!(file instanceof File)) {
    return Response.json({ error: 'Feld "file" fehlt.' }, { status: 400 });
  }

  // Neu aufbauen statt weiterreichen: so ist der Boundary-Header garantiert
  // konsistent mit dem Body.
  const forwarded = new FormData();
  forwarded.append('file', file, file.name);

  const upstream = await fetch(mastraUrl('/receipts/upload'), {
    method: 'POST',
    body: forwarded,
  });

  const payload = await upstream.json().catch(() => ({
    error: 'Unerwartete Antwort vom Mastra-Server.',
  }));

  return Response.json(payload, { status: upstream.status });
}
