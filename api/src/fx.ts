// Wechselkurse von Frankfurter (https://frankfurter.dev), selbst gehostet als
// eigener Dienst im Stack.
//
// Die einzige Stelle, die Frankfurter anspricht. Sie holt, was fehlt, und legt
// es in app.exchange_rates ab; gerechnet wird danach nur noch in Postgres
// (src/db/exchange-rates.ts). Eine Abrechnungsansicht fragt Frankfurter also
// nur, wenn ein Kurs noch nicht da oder noch vorläufig ist.
//
// Fehler hier brechen nichts ab. Ist Frankfurter weg oder kennt einen Kurs
// nicht, fehlt der umgerechnete Betrag dieser Position, und die Oberfläche
// sagt das – die Abrechnung bleibt lesbar, nur Einreichen geht dann nicht.

import {
  missingRates,
  saveRates,
  type FetchedRate,
  type RateRequest,
} from 'mastra-teamsbot/db/exchange-rates';

/**
 * Ohne Pfad, ohne /v2: der Dienst selbst. Lokal der Compose-Container; die
 * öffentliche Instanz (https://api.frankfurter.dev) geht auch, dann hängt
 * aber jede neue Abrechnung an einem fremden Dienst.
 */
const FRANKFURTER_URL = (process.env.FRANKFURTER_URL ?? 'http://localhost:8080').replace(/\/+$/, '');

/** Mehr hält eine Seitenanzeige nicht auf. Was übrig bleibt, kommt beim nächsten Aufruf. */
const BUDGET_MS = 5_000;
const REQUEST_TIMEOUT_MS = 3_000;
const CONCURRENCY = 4;

/**
 * Was Frankfurter gerade nicht liefern konnte, nicht sofort wieder fragen.
 * Im Prozessspeicher, weil es nur Last spart: nach einem Neustart fragt der
 * Dienst eben einmal mehr. Ein frisch gestarteter Frankfurter antwortet
 * während seines ersten Backfills mit 404 – deshalb nicht für immer.
 */
const MISS_TTL_MS = 15 * 60_000;
const misses = new Map<string, number>();

const keyOf = (request: RateRequest) => `${request.base}/${request.quote}/${request.onDate}`;

/**
 * Ein Kurs: 1 base = rate quote am Tag onDate. null, wenn Frankfurter ihn
 * nicht hat (404: Tag ohne Daten; 422: Währung unbekannt).
 *
 * Kein Provider-Filter: Frankfurter mittelt über seine Quellen und hat damit
 * auch Tageskurse für Wochenenden und für Währungen, die die EZB nicht führt
 * (KES, TZS, XOF, …).
 */
async function fetchRate(request: RateRequest, signal: AbortSignal): Promise<FetchedRate | null> {
  const url =
    `${FRANKFURTER_URL}/v2/rate/${encodeURIComponent(request.base)}/` +
    `${encodeURIComponent(request.quote)}?date=${request.onDate}`;
  const response = await fetch(url, { signal, headers: { accept: 'application/json' } });
  if (response.status === 404 || response.status === 422) return null;
  if (!response.ok) throw new Error(`Frankfurter ${response.status} fuer ${keyOf(request)}`);

  const body = (await response.json()) as { date?: unknown; rate?: unknown };
  if (typeof body.date !== 'string' || typeof body.rate !== 'number' || !(body.rate > 0)) {
    throw new Error(`Frankfurter: unerwartete Antwort fuer ${keyOf(request)}`);
  }
  return {
    ...request,
    // Als String, damit der Wert unverändert in numeric landet. Ein number
    // kann das nicht verfälschen – Frankfurter liefert ohnehin nur ~5 Stellen.
    rate: String(body.rate),
    rateDate: body.date,
  };
}

/**
 * Fehlende und vorläufige Kurse für diese Abrechnungen holen und ablegen.
 *
 * Vor jeder Ansicht und vor dem Einreichen. Wirft nie: siehe oben.
 */
export async function ensureRates(userId: string, settlementIds: string[]): Promise<void> {
  try {
    const now = Date.now();
    const pending = (await missingRates(userId, settlementIds)).filter(request => {
      const missedAt = misses.get(keyOf(request));
      return missedAt === undefined || now - missedAt > MISS_TTL_MS;
    });
    if (pending.length === 0) return;

    const deadline = AbortSignal.timeout(BUDGET_MS);
    const fetched: FetchedRate[] = [];
    let next = 0;

    const worker = async () => {
      while (next < pending.length && !deadline.aborted) {
        const request = pending[next++]!;
        try {
          const rate = await fetchRate(
            request,
            AbortSignal.any([deadline, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
          );
          if (rate) {
            fetched.push(rate);
            misses.delete(keyOf(request));
          } else {
            misses.set(keyOf(request), Date.now());
          }
        } catch (error) {
          if (deadline.aborted) return;
          misses.set(keyOf(request), Date.now());
          console.warn(
            `[api] Wechselkurs ${keyOf(request)} nicht geholt:`,
            error instanceof Error ? error.message : error,
          );
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker));
    await saveRates(fetched);
  } catch (error) {
    console.error('[api] Wechselkurse konnten nicht aktualisiert werden:', error);
  }
}
