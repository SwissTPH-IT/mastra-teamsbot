// Die EINE Stelle, an der aus Scope und Filtern eine WHERE-Bedingung wird.
//
// Absichtlich kein Filter in einer Komponente und keine zweite Variante fuer
// den Export: Ansicht, Detailseite, Zaehlung und CSV rufen alle hier herein.
// Wenn spaeter eine Rolle die sichtbaren Zeilen einschraenkt, reicht dafuer
// resolveScope() in scope.ts - diese Funktion nimmt die Einschraenkung
// automatisch mit.

import { and, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { receipts } from "mastra-teamsbot/db/schema";
import type { ReceiptQuery } from "./query-params";
import type { ReceiptScope } from "./scope";

/**
 * LIKE-Metazeichen im Suchbegriff entschaerfen.
 *
 * Ohne das ist ein eingegebenes "%" ein Platzhalter, der alles trifft, und ein
 * "_" ein Joker fuer ein beliebiges Zeichen. Beides ist in einem Haendlernamen
 * legitimer Text.
 */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export function buildReceiptWhere(scope: ReceiptScope, query: ReceiptQuery): SQL | undefined {
  const conditions: SQL[] = [];

  if (scope.userIds !== "all") {
    // Ein leerer Scope heisst "darf nichts sehen" - nicht "darf alles sehen".
    // inArray mit leerer Liste erzeugt in Drizzle kein gueltiges SQL, deshalb
    // hier explizit.
    conditions.push(
      scope.userIds.length === 0 ? sql`false` : inArray(receipts.userId, [...scope.userIds]),
    );
  }

  if (query.q) {
    const pattern = `%${escapeLikePattern(query.q)}%`;
    // ilike statt lower(...) like: case-insensitive ohne Funktion auf der
    // Spalte. Haendler und Kategorie, wie in der Aufgabe festgelegt.
    conditions.push(or(ilike(receipts.merchant, pattern), ilike(receipts.category, pattern))!);
  }

  // Zeitraum auf receipt_date (dem Belegdatum), NICHT auf created_at (dem
  // Erfassungszeitpunkt). Das sind zwei verschiedene Spalten, und der
  // Unterschied ist fuer die Buchhaltung der entscheidende: ein Beleg vom
  // 31.12. kann am 3.1. erfasst worden sein.
  if (query.from) conditions.push(gte(receipts.receiptDate, query.from));
  if (query.to) conditions.push(lte(receipts.receiptDate, query.to));

  return conditions.length > 0 ? and(...conditions) : undefined;
}
