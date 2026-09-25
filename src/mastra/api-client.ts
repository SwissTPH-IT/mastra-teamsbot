// Der Weg des Agenten zu den Fachdaten.
//
// Der Agent schreibt und liest Belege nicht mehr direkt über Drizzle, sondern
// über den API-Dienst (api/). Zwei Dinge gewinnt das:
//
//   - Der Agent kann nur, was die API anbietet. Ein Fehler in einem Tool oder
//     eine kreative Idee des Modells kann keine Query ausführen, die es nicht
//     gibt – vorher war der volle Drizzle-Client eine Funktion entfernt.
//   - Jeder Zugriff ist an einer Stelle nachvollziehbar: die API loggt Actor
//     (dieser Dienst) und Subject (der Nutzer) getrennt.
//
// Was NICHT hierüber läuft: app.pending_reviews (der Zeiger Thread -> Run, das
// ist Zustand des Review-Vorgangs, kein Fachdatum) und alles im Schema
// "mastra" – dafür hält der Agent weiterhin seinen eigenen Pool.

import { z } from 'zod';

/**
 * Die Belegform, wie die API sie liefert. Bewusst hier und nicht im Tool: das
 * ist der Vertrag mit dem Dienst. Was davon das Modell sieht, entscheidet das
 * Tool (receipt-db-tools.ts) – das sind zwei verschiedene Fragen.
 */
export const apiReceiptSchema = z.object({
  id: z.string(),
  merchant: z.string().nullable(),
  receiptDate: z.string().nullable(),
  receiptTime: z.string().nullable(),
  referenceNumber: z.string().nullable(),
  totalAmount: z.string().nullable(),
  subtotalAmount: z.string().nullable(),
  vatAmount: z.string().nullable(),
  vatRate: z.string().nullable(),
  currency: z.string().nullable(),
  paymentMethod: z.string().nullable(),
  category: z.string().nullable(),
  receiptType: z.string().nullable(),
  confidence: z.string().nullable(),
  issues: z.array(z.string()),
  /** null bei Ausgaben ohne Beleg (im Web erfasst). */
  fileReference: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ApiReceipt = z.infer<typeof apiReceiptSchema>;

const receiptResponseSchema = z.object({ receipt: apiReceiptSchema });
const receiptListResponseSchema = z.object({
  receipts: z.array(apiReceiptSchema),
  count: z.number(),
});

/**
 * Konfiguration erst beim Aufruf prüfen, nicht beim Import.
 *
 * Beim Import würde ein fehlendes API_URL den ganzen Agenten am Start hindern –
 * auch das Studio und jeden Pfad, der die Belege gar nicht braucht. So
 * scheitert nur der betroffene Tool-Aufruf, und zwar mit einem Satz, der sagt,
 * welche Variable fehlt.
 */
function config(): { baseUrl: string; token: string } {
  const baseUrl = process.env.API_URL;
  const token = process.env.API_SERVICE_TOKEN;

  if (!baseUrl || !token) {
    const missing = [!baseUrl && 'API_URL', !token && 'API_SERVICE_TOKEN'].filter(Boolean);
    throw new Error(
      `Der Belegdienst ist nicht erreichbar: ${missing.join(' und ')} ` +
        `${missing.length > 1 ? 'sind' : 'ist'} nicht gesetzt. ` +
        'Ohne diese Variablen kann der Agent keine Belege lesen oder schreiben.',
    );
  }

  return { baseUrl: baseUrl.replace(/\/+$/, ''), token };
}

/** Wie lange auf die API gewartet wird, bevor der Tool-Aufruf scheitert. */
const TIMEOUT_MS = Number(process.env.API_TIMEOUT_MS) || 15_000;

type RequestOptions = {
  /** Die Teams-userId, in deren Namen gearbeitet wird. Pflicht. */
  userId: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
};

async function request(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT',
  path: string,
  options: RequestOptions,
): Promise<unknown> {
  const { baseUrl, token } = config();
  const url = new URL(`${baseUrl}${path}`);

  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        // Die Mandantenkennung. Sie steht in keinem Tool-Input – das Modell
        // kann sie also nicht setzen. Siehe tools/tool-context.ts.
        'x-subject-user': options.userId,
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    // Netzwerkfehler und Timeout kommen hier an. Die Meldung geht als
    // Tool-Fehler an das Modell und von dort an den Nutzer – deshalb ein Satz,
    // der ohne Stacktrace verständlich ist.
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Der Belegdienst antwortet nicht (${method} ${path}): ${reason}`);
  }

  if (response.status === 204) return undefined;

  const payload = await response.json().catch(() => undefined);

  if (!response.ok) {
    // Die API antwortet einheitlich mit { error: "<Text>" }.
    const message =
      (payload as { error?: string } | undefined)?.error ??
      `HTTP ${response.status} ${response.statusText}`;
    throw new Error(message);
  }

  return payload;
}

export type ConversationRef = {
  conversationId?: string;
  serviceUrl?: string;
  channelId?: string;
  recipient?: { id?: string; name?: string };
};

export const receiptApi = {
  /**
   * Identität festhalten (aadObjectId, Tenant, Conversation Reference).
   *
   * PUT, nicht POST: der Aufruf ist wiederholbar und legt nichts Neues an – er
   * bringt denselben Datensatz auf Stand. Läuft bei jeder Teams-Nachricht.
   */
  async upsertIdentity(input: {
    userId: string;
    aadObjectId?: string | null;
    tenantId?: string | null;
    displayName?: string | null;
    conversationRef?: ConversationRef | null;
  }): Promise<void> {
    const { userId, ...body } = input;
    await request('PUT', '/identity', { userId, body });
  },

  /** Beleg schreiben. Idempotent gegen (userId, fileHash) – ein Retry ist unschädlich. */
  async create(input: {
    userId: string;
    candidate: unknown;
    fileHash: string;
    fileReference: string;
    rawExtraction?: unknown;
  }): Promise<ApiReceipt> {
    const payload = await request('POST', '/receipts', {
      userId: input.userId,
      body: {
        candidate: input.candidate,
        fileHash: input.fileHash,
        fileReference: input.fileReference,
        rawExtraction: input.rawExtraction,
      },
    });
    return receiptResponseSchema.parse(payload).receipt;
  },

  /** Liste oder Suche – mit `q` sucht die API, ohne listet sie. */
  async list(input: {
    userId: string;
    q?: string;
    from?: string;
    to?: string;
    minAmount?: string;
    maxAmount?: string;
    limit?: number;
  }): Promise<{ receipts: ApiReceipt[]; count: number }> {
    const { userId, ...query } = input;
    const payload = await request('GET', '/receipts', { userId, query });
    return receiptListResponseSchema.parse(payload);
  },

  /** Einzelner Beleg, oder null bei 404. */
  async get(userId: string, receiptId: string): Promise<ApiReceipt | null> {
    try {
      const payload = await request('GET', `/receipts/${encodeURIComponent(receiptId)}`, {
        userId,
      });
      return receiptResponseSchema.parse(payload).receipt;
    } catch (error) {
      // "Nicht gefunden" ist für den Aufrufer kein Fehler, sondern eine
      // Antwort. Alles andere bleibt ein Fehler.
      if (error instanceof Error && /nicht gefunden/i.test(error.message)) return null;
      throw error;
    }
  },

  /** Einzelne Felder korrigieren. null, wenn es den Beleg (für diesen Nutzer) nicht gibt. */
  async update(
    userId: string,
    receiptId: string,
    patch: Record<string, string | undefined>,
  ): Promise<ApiReceipt | null> {
    try {
      const payload = await request('PATCH', `/receipts/${encodeURIComponent(receiptId)}`, {
        userId,
        body: patch,
      });
      return receiptResponseSchema.parse(payload).receipt;
    } catch (error) {
      if (error instanceof Error && /nicht gefunden/i.test(error.message)) return null;
      throw error;
    }
  },
};
