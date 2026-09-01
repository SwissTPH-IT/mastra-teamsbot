// Reiner Durchleiter zum chatRoute() des Mastra-Servers.
//
// Mastra liefert dort bereits einen AI-SDK-UI-Message-Stream (version: 'v7'),
// genau das Format, das useChatRuntime erwartet. Es gibt hier also nichts zu
// übersetzen – nur den Body hin und den Stream zurück.

import { mastraUrl, RECEIPT_AGENT_ID } from '@/lib/mastra';

export const maxDuration = 300;
// Kein Node-Buffering zwischen Mastra und Browser.
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const upstream = await fetch(mastraUrl(`/chat/${RECEIPT_AGENT_ID}`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: await req.text(),
    // Bricht der Nutzer ab, bricht auch die Generierung ab.
    signal: req.signal,
    // @ts-expect-error -- undici-Option, in den Next-Typen nicht deklariert
    duplex: 'half',
  }).catch((error: unknown) => {
    throw new Error(
      `Mastra unter ${mastraUrl('/chat')} nicht erreichbar: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  });

  if (!upstream.ok) {
    const detail = await upstream.text();
    return Response.json(
      { error: `Mastra antwortete mit ${upstream.status}`, detail },
      { status: upstream.status },
    );
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type':
        upstream.headers.get('Content-Type') ?? 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
