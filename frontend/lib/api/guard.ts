// Aus einem Fehler des Dienstes wird ein Zustand der Oberflaeche.
//
// Jede Seite braucht dieselbe Einteilung, und sie soll an einer Stelle stehen:
// sonst zeigt eine Seite bei einem nicht verknuepften Konto die Erklaerung und
// die naechste eine leere Tabelle.

import { redirect } from "next/navigation";
import "server-only";
import { ApiError, isAuthError, isNotFound, isUnlinkedAccount } from "./client";

export type LoadFailure =
  /** Angemeldet, aber keine Teams-Identitaet dahinter (403/409). */
  | { kind: "unlinked" }
  /** Dienst nicht erreichbar oder unerwarteter Fehler. */
  | { kind: "unavailable"; detail: string };

/**
 * Fehler einordnen.
 *
 * Zwei Faelle verlassen die Funktion NICHT als Rueckgabewert:
 *
 *   401  -> zurueck zur Anmeldung. Ein "bitte neu anmelden"-Kasten waere ein
 *           zusaetzlicher Klick fuer etwas, das der Browser selbst kann.
 *   404  -> gehoert der aufrufenden Seite (notFound()), nicht hierher: nur sie
 *           weiss, ob ein fehlender Beleg eine 404-Seite oder eine leere
 *           Liste bedeutet.
 */
export function classifyFailure(error: unknown): LoadFailure {
  if (isAuthError(error)) redirect("/signin");
  if (isUnlinkedAccount(error)) return { kind: "unlinked" };
  if (isNotFound(error)) throw error;

  const detail =
    error instanceof ApiError
      ? error.message
      : error instanceof Error
        ? error.message
        : String(error);

  // Unerwartete Fehler gehoeren ins Log des Servers, nicht nur auf die Seite.
  console.error("[frontend] Abruf fehlgeschlagen:", error);
  return { kind: "unavailable", detail };
}
