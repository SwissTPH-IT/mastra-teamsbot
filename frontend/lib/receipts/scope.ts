// Der Einhaengepunkt fuer eine spaetere Berechtigungspruefung.
//
// Diese Oberflaeche ist unauthentifiziert (siehe README, "Kein Login"). Der
// Scope bedeutet heute immer "alle Nutzer" - die Stelle existiert trotzdem,
// weil jede Abfrage sie als Pflichtargument entgegennimmt. Kommt Auth dazu,
// wird ausschliesslich resolveScope() ersetzt; kein Aufrufer aendert sich, und
// insbesondere laeuft der CSV-Export durch dieselbe Stelle wie die Ansicht.

/**
 * Welche Zeilen der Aufrufer sehen darf.
 *
 * `'all'` heisst: keine Einschraenkung. Eine Liste von userIds waere die
 * Variante, die eine Rolle spaeter setzt (z. B. nur die eigenen Belege, oder
 * die eines Teams).
 */
export type ReceiptScope = {
  userIds: "all" | readonly string[];
};

/** Der komplette Scope. Solange es kein Login gibt, ist das der einzige Fall. */
export const ALL_USERS: ReceiptScope = { userIds: "all" };

/**
 * Der Scope des aktuellen Requests.
 *
 * Bewusst async, obwohl heute nichts darin await-et: eine echte Implementierung
 * liest Session oder Token und ist damit asynchron. Waere die Funktion synchron,
 * muesste beim Nachruesten jeder Aufrufer angefasst werden.
 */
export async function resolveScope(): Promise<ReceiptScope> {
  return ALL_USERS;
}
