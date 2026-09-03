// Die Query-Schicht. Von der UI getrennt: hier steht SQL, dort JSX, und keine
// Komponente baut eine eigene Abfrage.
//
// Jede Funktion nimmt den ReceiptScope als erstes Pflichtargument (siehe
// scope.ts) - das ist die Stelle, an der eine spaetere Berechtigung greift.
// Read-only: es gibt hier bewusst kein insert/update/delete. Korrekturen laufen
// ueber den Teams-Flow.
//
// Auf mastra_*-Tabellen wird nie zugegriffen. Das ist Framework-Zustand von
// Mastra, kein Datenmodell.

import { and, desc, eq, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { receipts, type ReceiptRow } from "mastra-teamsbot/db/schema";
import { getDb } from "../db/client";
import type { ReceiptQuery, SortField } from "./query-params";
import { buildReceiptWhere } from "./where";
import type { ReceiptScope } from "./scope";

export type { ReceiptRow };

const SORT_COLUMNS = {
  receiptDate: receipts.receiptDate,
  totalAmount: receipts.totalAmount,
  createdAt: receipts.createdAt,
  merchant: receipts.merchant,
} as const satisfies Record<SortField, unknown>;

/**
 * ORDER BY inklusive NULLS LAST.
 *
 * Ohne das stehen bei DESC die NULL-Werte oben (Postgres-Default ist DESC NULLS
 * FIRST) - eine Tabelle, die mit lauter leeren Datumszellen anfaengt, waehrend
 * die Daten darunter liegen. `id` als letztes Kriterium macht die Reihenfolge
 * eindeutig; sonst kann dieselbe Zeile bei zwei Seitenaufrufen auf zwei Seiten
 * landen.
 */
function buildOrderBy(query: ReceiptQuery): SQL[] {
  const column = SORT_COLUMNS[query.sort];
  const direction = query.dir === "asc" ? "asc" : "desc";
  return [
    sql`${column} ${sql.raw(direction)} nulls last`,
    query.dir === "asc" ? sql`${receipts.id} asc` : sql`${receipts.id} desc`,
  ];
}

export type ReceiptPage = {
  rows: ReceiptRow[];
  /** Gesamtzahl der Treffer unter denselben Filtern - nicht nur dieser Seite. */
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

/** Eine Seite der Tabelle. Paginierung, Sortierung und Filterung serverseitig. */
export async function listReceipts(scope: ReceiptScope, query: ReceiptQuery): Promise<ReceiptPage> {
  const db = getDb();
  const where = buildReceiptWhere(scope, query);

  const [rows, total] = await Promise.all([
    db
      .select()
      .from(receipts)
      .where(where)
      .orderBy(...buildOrderBy(query))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    countReceipts(scope, query),
  ]);

  return {
    rows,
    total,
    page: query.page,
    pageSize: query.pageSize,
    pageCount: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}

/**
 * Trefferzahl unter denselben Filtern.
 *
 * Wird an zwei Stellen gebraucht: fuer die Paginierung und fuer die Aufschrift
 * des Export-Knopfes ("412 Belege exportieren"). Beide sollen dieselbe Zahl
 * zeigen, deshalb dieselbe Funktion.
 */
export async function countReceipts(scope: ReceiptScope, query: ReceiptQuery): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(receipts)
    .where(buildReceiptWhere(scope, query));

  return row?.count ?? 0;
}

/** Nur der Scope, keine Nutzerfilter - fuer Abfragen auf eine einzelne id. */
const EMPTY_QUERY: ReceiptQuery = {
  q: "",
  from: null,
  to: null,
  sort: "receiptDate",
  dir: "desc",
  page: 1,
  pageSize: 1,
};

/**
 * Ein einzelner Beleg.
 *
 * Laeuft ueber denselben Scope wie die Liste: eine id, die aus dem Scope
 * herausfaellt, ergibt null - nicht die Zeile. Sonst waere die Detailseite das
 * Loch in einem spaeteren Berechtigungsfilter.
 */
export async function getReceipt(scope: ReceiptScope, id: string): Promise<ReceiptRow | null> {
  const db = getDb();
  const scopeOnly = buildReceiptWhere(scope, EMPTY_QUERY);

  const [row] = await db
    .select()
    .from(receipts)
    .where(scopeOnly ? and(eq(receipts.id, id), scopeOnly) : eq(receipts.id, id))
    .limit(1);

  return row ?? null;
}

/** Wie viele Zeilen der Export pro Rundreise zur Datenbank holt. */
const STREAM_BATCH_SIZE = 1_000;

/**
 * Alle Treffer als asynchroner Strom, in Baendern von STREAM_BATCH_SIZE.
 *
 * Fuer den CSV-Export: ein Export ueber mehrere Jahre soll nicht erst
 * vollstaendig im Speicher stehen, bevor das erste Byte rausgeht.
 *
 * Keyset statt OFFSET: ein grosses OFFSET liest die uebersprungenen Zeilen
 * jedes Mal mit, und - wichtiger - zwischen zwei Baendern eingefuegte Zeilen
 * verschieben das Fenster, sodass Zeilen doppelt oder gar nicht im Export
 * landen.
 *
 * Die Sortierung ist hier fest (Belegdatum absteigend) und folgt NICHT der
 * Tabellensortierung. Fuer eine Datei, die in Excel geoeffnet und dort neu
 * sortiert wird, ist die Reihenfolge unerheblich - die FILTER muessen
 * uebereinstimmen, und die tun es, weil buildReceiptWhere dasselbe ist.
 */
export async function* streamReceipts(
  scope: ReceiptScope,
  query: ReceiptQuery,
): AsyncGenerator<ReceiptRow[]> {
  const db = getDb();
  const filter = buildReceiptWhere(scope, query);

  let cursor: { receiptDate: string | null; id: string } | null = null;

  for (;;) {
    const conditions = [filter, buildKeysetCondition(cursor)].filter(
      (condition): condition is SQL => condition !== undefined,
    );

    const batch: ReceiptRow[] = await db
      .select()
      .from(receipts)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(sql`${receipts.receiptDate} desc nulls last`, desc(receipts.id))
      .limit(STREAM_BATCH_SIZE);

    if (batch.length === 0) return;

    yield batch;
    if (batch.length < STREAM_BATCH_SIZE) return;

    const last = batch[batch.length - 1]!;
    cursor = { receiptDate: last.receiptDate, id: last.id };
  }
}

/**
 * "Alles nach diesem Punkt" fuer die Sortierung (receipt_date DESC NULLS LAST,
 * id DESC).
 *
 * Der NULL-Fall braucht zwei Zweige: solange der Cursor auf einer Zeile mit
 * Datum steht, kommen die datumslosen Zeilen noch (sie stehen am Ende); steht
 * er schon in diesem Block, zaehlt nur noch die id. Ein einfaches
 * `receipt_date < cursor` wuerde die datumslosen Zeilen komplett verschlucken,
 * weil jeder Vergleich mit NULL unbekannt ist.
 */
function buildKeysetCondition(
  cursor: { receiptDate: string | null; id: string } | null,
): SQL | undefined {
  if (!cursor) return undefined;

  if (cursor.receiptDate === null) {
    return and(isNull(receipts.receiptDate), lt(receipts.id, cursor.id))!;
  }

  return or(
    lt(receipts.receiptDate, cursor.receiptDate),
    and(eq(receipts.receiptDate, cursor.receiptDate), lt(receipts.id, cursor.id)),
    isNull(receipts.receiptDate),
  )!;
}

/** Fuer /api/healthz: billigste moegliche Pruefung, dass die Datenbank antwortet. */
export async function pingDatabase(): Promise<void> {
  await getDb().execute(sql`select 1`);
}
