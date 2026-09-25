// Der Kurs-Cache (app.exchange_rates) und die Umrechnung einer Position in die
// Währung ihrer Abrechnung.
//
// Geholt werden die Kurse NICHT hier: das Repository spricht mit Postgres und
// mit niemandem sonst. Der API-Dienst fragt missingRates(), holt die Kurse bei
// Frankfurter (api/src/fx.ts) und legt sie mit saveRates() ab. Gerechnet wird
// danach ausschliesslich in Postgres, mit numeric – wie jede andere Summe.

import { and, eq, inArray, isNotNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { db } from './index';
import { exchangeRates, receipts, settlements } from './schema';

/** Ein Kurs, wie er von aussen kommt: 1 base = rate quote am Tag rateDate. */
export type FetchedRate = {
  base: string;
  quote: string;
  /** Der angefragte Tag – das Belegdatum. */
  onDate: string;
  rate: string;
  /** Der Tag, von dem der Kurs tatsächlich stammt. */
  rateDate: string;
};

export type RateRequest = Pick<FetchedRate, 'base' | 'quote' | 'onDate'>;

/**
 * Vorläufig heisst: kann sich noch ändern.
 *
 * Zwei Fälle. Der Kurs stammt von einem früheren Tag als angefragt (der Tag
 * liegt in der Zukunft oder ist noch nicht veröffentlicht, Frankfurter gibt
 * dann den letzten bekannten). Oder er wurde zu früh geholt: der Tageskurs ist
 * ein Mittel aus vielen Zentralbanken, die zu verschiedenen Zeiten
 * veröffentlichen – erst mit zwei Tagen Abstand gilt er als fest.
 * Tage in UTC, wie bei Frankfurter.
 */
export function isProvisionalRate(): SQL<boolean> {
  return sql<boolean>`(${exchangeRates.rateDate} < ${exchangeRates.onDate}
    or (${exchangeRates.fetchedAt} at time zone 'UTC')::date <= ${exchangeRates.onDate} + 1)`;
}

/** Wie oft ein vorläufiger Kurs höchstens neu geholt wird. */
const PROVISIONAL_REFRESH = sql`interval '1 hour'`;

/**
 * Die Join-Bedingung von einer Position zu ihrem Kurs. Setzt voraus, dass
 * `settlements` im selben Query über (id, user_id) an `receipts` hängt.
 */
export function rateJoin(): SQL | undefined {
  return and(
    eq(exchangeRates.base, settlements.currency),
    eq(exchangeRates.quote, receipts.currency),
    eq(exchangeRates.onDate, receipts.receiptDate),
  );
}

/**
 * Der Betrag einer Position in der Abrechnungswährung, auf Rappen gerundet.
 * NULL, wenn er sich nicht rechnen lässt: kein Betrag, keine Währung, kein
 * Datum oder (noch) kein Kurs.
 *
 * Gleiche Währung braucht keinen Kurs – und damit auch kein Datum.
 */
export function convertedAmount(): SQL<string | null> {
  return sql<string | null>`case
    when ${receipts.totalAmount} is null then null
    when ${receipts.currency} = ${settlements.currency} then ${receipts.totalAmount}
    else round(${receipts.totalAmount} / ${exchangeRates.rate}, 2)
  end`;
}

/** Ob die Position fremdwährig ist und ihr Kurs noch vorläufig. */
export function conversionIsProvisional(): SQL<boolean> {
  return sql<boolean>`coalesce(${receipts.currency} <> ${settlements.currency}
    and ${exchangeRates.rate} is not null and ${isProvisionalRate()}, false)`;
}

/**
 * Welche Kurse für diese Abrechnungen fehlen oder zu erneuern sind.
 *
 * `userId` zuerst, wie überall: der Cache selbst ist öffentlich, die Frage
 * "welche Belege liegen worin" nicht.
 */
export async function missingRates(
  userId: string,
  settlementIds: string[],
): Promise<RateRequest[]> {
  if (settlementIds.length === 0) return [];

  const rows = await db
    .selectDistinct({
      base: sql<string>`${settlements.currency}`,
      quote: sql<string>`${receipts.currency}`,
      onDate: sql<string>`${receipts.receiptDate}::text`,
    })
    .from(receipts)
    .innerJoin(
      settlements,
      and(eq(settlements.id, receipts.settlementId), eq(settlements.userId, receipts.userId)),
    )
    .leftJoin(exchangeRates, rateJoin())
    .where(
      and(
        eq(receipts.userId, userId),
        inArray(receipts.settlementId, settlementIds),
        isNotNull(receipts.totalAmount),
        isNotNull(receipts.currency),
        isNotNull(receipts.receiptDate),
        ne(receipts.currency, settlements.currency),
        or(
          sql`${exchangeRates.rate} is null`,
          sql`${isProvisionalRate()} and ${exchangeRates.fetchedAt} < now() - ${PROVISIONAL_REFRESH}`,
        ),
      ),
    );

  // char(3) kommt rechtsgepolstert aus Postgres.
  return rows.map(row => ({ base: row.base.trim(), quote: row.quote.trim(), onDate: row.onDate }));
}

/**
 * Kurse ablegen. Ein vorläufiger wird überschrieben, ein fester nie: sonst
 * könnte sich der Betrag einer eingereichten Abrechnung im Nachhinein ändern.
 */
export async function saveRates(rates: FetchedRate[]): Promise<void> {
  if (rates.length === 0) return;
  await db
    .insert(exchangeRates)
    .values(rates.map(rate => ({ ...rate, fetchedAt: sql`now()` })))
    .onConflictDoUpdate({
      target: [exchangeRates.base, exchangeRates.quote, exchangeRates.onDate],
      set: {
        rate: sql`excluded.rate`,
        rateDate: sql`excluded.rate_date`,
        fetchedAt: sql`excluded.fetched_at`,
      },
      setWhere: isProvisionalRate(),
    });
}
