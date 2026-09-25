// Die Beleg-Endpunkte.
//
// Duenne Schicht: validieren, Subject aus dem Auth-Kontext nehmen, Repository
// rufen, projizieren. Die Fachlogik bleibt in src/db/receipts.ts und
// src/mastra/receipts/candidate.ts – hier wird nichts entschieden.
//
// Was der Aufrufer zu sehen bekommt, ist bewusst NICHT die Zeile: rawExtraction
// (der komplette Modell-Output) und file_hash verlassen den Dienst nie. Das war
// vorher eine Konvention im Tool, jetzt ist es die Grenze des Dienstes.

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import {
  countReceipts,
  createManualReceipt,
  getReceipt,
  listCategories,
  listReceipts,
  RECEIPT_SORT_FIELDS,
  RECEIPT_SOURCES,
  summarizeReceipts,
  saveReceipt,
  searchReceipts,
  updateReceipt,
  type ReceiptPatch,
} from 'mastra-teamsbot/db/receipts';
import type { ReceiptRow } from 'mastra-teamsbot/db/schema';
import {
  candidateSchema,
  parseAmount,
  parseCurrency,
  parseDate,
} from 'mastra-teamsbot/receipts/candidate';
import { checkNoReceiptAmount, hasReason } from 'mastra-teamsbot/receipts/no-receipt';
import { subjectOf, type AuthState } from '../auth';
import { validate, type ErrorDetail } from '../validate';

type Env = { Variables: { auth: AuthState } };

/** Die Projektion. Identisch zu dem, was die Tools heute zurueckgeben. */
function toView(row: ReceiptRow) {
  return {
    id: row.id,
    merchant: row.merchant,
    merchantAddress: row.merchantAddress,
    merchantTaxId: row.merchantTaxId,
    receiptDate: row.receiptDate,
    receiptTime: row.receiptTime,
    referenceNumber: row.referenceNumber,
    totalAmount: row.totalAmount,
    subtotalAmount: row.subtotalAmount,
    discountAmount: row.discountAmount,
    vatAmount: row.vatAmount,
    vatRate: row.vatRate,
    // char(3) kommt rechtsgepolstert aus Postgres.
    currency: row.currency?.trim() ?? null,
    paymentMethod: row.paymentMethod,
    category: row.category,
    receiptType: row.receiptType,
    confidence: row.confidence,
    issues: Array.isArray(row.issues) ? (row.issues as string[]) : [],
    /**
     * Nur die Anzahl, nicht die Positionen. Die Detailansicht zeigt "3 items";
     * die Positionen selbst braucht heute niemand ausserhalb des Dienstes, und
     * was nicht rausgeht, muss auch nicht versioniert werden.
     */
    lineItemCount: Array.isArray(row.lineItems) ? row.lineItems.length : 0,
    /** null heisst "ohne Beleg erfasst" – siehe schema.ts. */
    fileReference: row.fileReference,
    /** Begründung, warum es keinen Beleg gibt. Nur bei fileReference === null gesetzt. */
    reason: row.reason,
    /** Wann ein Mensch zuletzt einen Fachwert berichtigt hat. null: nie. */
    correctedAt: row.correctedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum als YYYY-MM-DD.');

/**
 * Eingaben eines Menschen, gelesen mit DENSELBEN Parsern wie die Extraktion
 * (candidate.ts). "42,10", "1'234.50" und "CHF 42.10" gehen damit durch,
 * "14.03.2026" ebenso wie "2026-03-14".
 *
 * Was sich nicht lesen laesst, ist ein Fehler und wird nicht still zu null –
 * sonst loescht ein Tippfehler einen Betrag. Leer bleibt der Weg, einen Wert
 * bewusst zu entfernen (siehe emptyToNull unten).
 */
const amountInput = z.string().transform((raw, ctx) => {
  const parsed = parseAmount(raw);
  // numeric(14,2): alles darueber waere ein 500 aus Postgres statt einer
  // Meldung. Kein Beleg dieser Anwendung kommt in die Naehe.
  if (parsed === null || Math.abs(Number(parsed)) >= 1e12) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Betrag nicht lesbar, z. B. 42.10.' });
    return z.NEVER;
  }
  return parsed;
});

const dateInput = z.string().transform((raw, ctx) => {
  const parsed = parseDate(raw);
  // parseDate prueft nur das Muster. Einen 31.02. wuerde erst Postgres
  // ablehnen – mit einem 500 statt einer Meldung.
  const real = parsed !== null && new Date(`${parsed}T00:00:00Z`).toISOString().startsWith(parsed);
  if (!real) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Datum nicht lesbar, z. B. 14.03.2026.' });
    return z.NEVER;
  }
  return parsed;
});

/** Bekannte Schreibweisen (Fr., €) ueber parseCurrency, sonst ein ISO-Code aus drei Buchstaben. */
const currencyInput = z.string().transform((raw, ctx) => {
  const upper = raw.trim().toUpperCase();
  const parsed = parseCurrency(raw) ?? (/^[A-Z]{3}$/.test(upper) ? upper : null);
  if (parsed === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Waehrung als ISO-Code, z. B. CHF.' });
    return z.NEVER;
  }
  return parsed;
});

/** Freitext mit Obergrenze. Getrimmt, damit "  " nicht als gesetzter Wert zaehlt. */
const text = (max: number) => z.string().trim().max(max);

const listQuerySchema = z.object({
  q: z.string().min(1).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  category: z.string().min(1).optional(),
  minAmount: z.string().optional(),
  maxAmount: z.string().optional(),
  /**
   * 200 ist die groesste Seitengroesse der Weboberflaeche. Der Agent fragt
   * deutlich kleinere Seiten – die Grenze steht hier, damit eine geratene
   * Zahl aus der URL keine Vollabfrage wird.
   */
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  /** "receipt" = mit Beleg aus Teams, "none" = im Web ohne Beleg erfasst. */
  source: z.enum(RECEIPT_SOURCES).optional(),
  sort: z.enum(RECEIPT_SORT_FIELDS).optional(),
  dir: z.enum(['asc', 'desc']).optional(),
});

const createSchema = z.object({
  candidate: candidateSchema,
  fileHash: z.string().min(8),
  fileReference: z.string().min(1),
  /**
   * Der unveraenderte Modell-Output. Optional, weil der Tool-Weg
   * ("create-receipt" fuer diktierte Belege) keinen hat – dann wird der
   * Kandidat selbst abgelegt, wie bisher.
   */
  rawExtraction: z.unknown().optional(),
});

/**
 * Korrigierbare Felder. Jedes darf null sein, und ein Leerstring IST null.
 *
 * Das ist dieselbe Regel wie bei der Extraktion (candidate.ts): leer heisst
 * "nicht gesetzt", nicht "0.00" und nicht "". Ohne die Umwandlung landet in
 * `category` ein Leerstring, der in jeder Liste als gesetzte Kategorie
 * mitzaehlt und im Filter-Dropdown als namenlose Zeile auftaucht.
 */
const emptyToNull = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(
    // Auch "   " ist leer: sonst bliebe nach dem Trimmen ein Leerstring stehen.
    value => (typeof value === 'string' && value.trim() === '' ? null : value),
    schema.nullable(),
  );

const patchSchema = z
  .object({
    merchant: emptyToNull(text(200)),
    receiptDate: emptyToNull(dateInput),
    totalAmount: emptyToNull(amountInput),
    currency: emptyToNull(currencyInput),
    vatAmount: emptyToNull(amountInput),
    category: emptyToNull(text(100)),
    receiptType: emptyToNull(text(100)),
    paymentMethod: emptyToNull(text(100)),
    reason: emptyToNull(text(1000)),
  })
  .partial();

/**
 * Ausgabe ohne Beleg.
 *
 * `id` kommt vom Aufrufer: das Formular bekommt sie beim Rendern, damit ein
 * zweites Absenden dieselbe Zeile trifft (siehe createManualReceipt). Eine
 * UUID und nichts anderes – ein frei waehlbarer Schluessel waere ein Weg,
 * gezielt nach fremden ids zu tasten.
 */
const manualSchema = z.object({
  id: z.string().uuid(),
  merchant: emptyToNull(text(200)).optional(),
  receiptDate: dateInput,
  totalAmount: amountInput,
  currency: currencyInput,
  category: emptyToNull(text(100)).optional(),
  reason: text(1000).min(1, 'Ohne Beleg ist eine Begruendung Pflicht.'),
});

/** Verstoss gegen die Grenze ohne Beleg – mit Code, damit die Oberflaeche ihn selbst erklaert. */
function noReceiptViolation(message: string): HTTPException {
  return new HTTPException(400, {
    message,
    cause: { code: 'no_receipt_limit', fields: ['totalAmount'] } satisfies ErrorDetail,
  });
}

export const receiptRoutes = new Hono<Env>()

  /**
   * Beleg schreiben. Upsert gegen (user_id, file_hash) – ein wiederholter
   * Aufruf trifft dieselbe Zeile statt eine zweite anzulegen. Damit ist ein
   * Retry des Agenten unschaedlich.
   */
  .post('/', validate('json', createSchema), async c => {
    const userId = subjectOf(c);
    const body = c.req.valid('json');

    const row = await saveReceipt(userId, {
      candidate: body.candidate,
      fileHash: body.fileHash,
      fileReference: body.fileReference,
      rawExtraction: body.rawExtraction ?? body.candidate,
    });

    return c.json({ receipt: toView(row) }, 201);
  })

  /**
   * Ausgabe ohne Beleg erfassen.
   *
   * Die Betragsgrenze wird hier geprueft und nicht nur im Formular – das
   * Formular zeigt sie an, entscheiden tut der Dienst.
   */
  .post('/manual', validate('json', manualSchema), async c => {
    const userId = subjectOf(c);
    const body = c.req.valid('json');

    const violation = checkNoReceiptAmount(body.totalAmount, body.currency);
    if (violation) throw noReceiptViolation(violation);

    const row = await createManualReceipt(userId, {
      id: body.id,
      merchant: body.merchant ?? null,
      receiptDate: body.receiptDate,
      totalAmount: body.totalAmount,
      currency: body.currency,
      category: body.category ?? null,
      reason: body.reason,
    });
    // Die id gehoert schon jemand anderem. Aussen wie ein Konflikt, ohne zu
    // sagen, wem – eine UUID kollidiert nicht zufaellig.
    if (!row) throw new HTTPException(409, { message: 'Diese Erfassung existiert bereits.' });

    return c.json({ receipt: toView(row) }, 201);
  })

  /**
   * Liste oder Suche, je nachdem ob `q` gesetzt ist. Ein Endpunkt statt zwei:
   * fuer den Aufrufer ist es dieselbe Frage mit einem Filter mehr.
   */
  .get('/', validate('query', listQuerySchema), async c => {
    const userId = subjectOf(c);
    const { q, ...filter } = c.req.valid('query');

    // `count` ist diese Seite, `total` sind alle Treffer unter denselben
    // Filtern. Die Oberflaeche braucht beides: Zeilen zum Anzeigen und die
    // Gesamtzahl fuer Paginierung und Export-Aufschrift. Der Agent liest
    // weiterhin nur `count` – das Feld ist additiv.
    const [rows, total] = await Promise.all([
      q ? searchReceipts(userId, { query: q, ...filter }) : listReceipts(userId, filter),
      countReceipts(userId, { ...filter, query: q }),
    ]);

    return c.json({ receipts: rows.map(toView), count: rows.length, total });
  })

  /**
   * Anzahl und Summe je Waehrung - fuer die Kennzahl auf der Startseite.
   *
   * Eine eigene Abfrage und keine Hochrechnung aus einer Seite: eine Kennzahl,
   * die nur die ersten 50 Zeilen kennt, ist schlicht falsch. Nimmt dieselben
   * Filter wie die Liste.
   */
  .get('/summary', validate('query', listQuerySchema), async c => {
    const { q, ...filter } = c.req.valid('query');
    const byCurrency = await summarizeReceipts(subjectOf(c), { ...filter, query: q });
    return c.json({ byCurrency });
  })

  /**
   * Die vergebenen Kategorien, fuer das Filter-Dropdown.
   *
   * Steht VOR '/:id': Hono probiert die Routen in Registrierungsreihenfolge,
   * sonst faengt der id-Parameter "categories" ab.
   */
  .get('/categories', async c => {
    return c.json({ categories: await listCategories(subjectOf(c)) });
  })

  .get('/:id', async c => {
    const row = await getReceipt(subjectOf(c), c.req.param('id'));
    // Nicht vorhanden und "gehoert jemand anderem" sind von aussen
    // ununterscheidbar. Das ist Absicht: eine geratene id darf nicht
    // verraten, dass sie existiert.
    if (!row) throw new HTTPException(404, { message: 'Beleg nicht gefunden.' });
    return c.json({ receipt: toView(row) });
  })

  .patch('/:id', validate('json', patchSchema), async c => {
    const userId = subjectOf(c);
    const id = c.req.param('id');

    const existing = await getReceipt(userId, id);
    if (!existing) throw new HTTPException(404, { message: 'Beleg nicht gefunden.' });

    const patch = c.req.valid('json') as ReceiptPatch;

    // Ohne Beleg gilt die Regel auch nach dem Erfassen: sonst wuerde aus
    // 12.00 per Korrektur 120.00, und die Grenze haette nur das Formular
    // gesehen. Geprueft wird der Stand NACH dem Patch.
    if (existing.fileReference === null) {
      const merged = { ...existing, ...patch };
      const violation = checkNoReceiptAmount(merged.totalAmount, merged.currency?.trim() ?? null);
      if (violation) throw noReceiptViolation(violation);
      if (!hasReason(merged.reason)) {
        throw new HTTPException(400, {
          message: 'Ohne Beleg ist eine Begruendung Pflicht.',
          cause: { code: 'reason_required', fields: ['reason'] } satisfies ErrorDetail,
        });
      }
    }

    const row = await updateReceipt(userId, id, patch);
    if (!row) throw new HTTPException(404, { message: 'Beleg nicht gefunden.' });

    return c.json({ receipt: toView(row) });
  });
