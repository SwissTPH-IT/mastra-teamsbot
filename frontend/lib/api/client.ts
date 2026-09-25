// Der EINE Weg des Frontends zu den Daten.
//
// Variante A: diese Oberflaeche hat keine Datenbankverbindung mehr. Kein Pool,
// kein Drizzle, kein Schema-Import - alles laeuft ueber den Belegdienst (api/).
//
// Zwei Header, beide serverseitig gesetzt:
//
//   Authorization: Bearer <API_SERVICE_TOKEN>   wer ruft   (dieser Dienst)
//   X-Subject-Aad: <oid aus der Session>        fuer wen
//
// Die oid kommt aus dem signierten ID-Token von Entra (siehe auth.ts) und
// NIEMALS aus einem Request des Browsers. Das ist die eine Regel, an der hier
// alles haengt: mit dem Service-Token darf dieser Prozess jedes Subject setzen,
// also darf kein vom Client kommender Wert in diesen Header geraten. Deshalb
// gibt es keine Funktion, die ein Subject als Argument nimmt - es wird immer
// aus der Session gelesen.
//
// Welche Belege daraus werden, entscheidet der Dienst: er loest oid ->
// Teams-userId ueber app.users auf und haengt sie an jedes WHERE. Der frueheren
// Fassung lag ein `ReceiptScope` bei, den man haette weiten koennen. Den gibt
// es nicht mehr: es gibt nichts zu weiten.
//
// Ausschliesslich serverseitig ("server-only"): der Service-Token gehoert nicht
// in den Browser. Ein versehentlicher Import in eine Client-Komponente
// scheitert dadurch beim Build und nicht erst im Betrieb.

import "server-only";
import { auth } from "@/auth";

/**
 * Die Basis-URL des Dienstes - und ob sie ueberhaupt konfiguriert ist.
 *
 * Der Default ist eine Bequemlichkeit fuer die lokale Entwicklung und war in
 * der ersten Fassung eine Falle: fehlte API_URL im Deployment, lief jeder
 * Aufruf gegen localhost und die Oberflaeche meldete "der Dienst antwortet
 * nicht". Das ist die falsche Diagnose fuer eine nicht gesetzte Variable, und
 * sie kostet Stunden. Deshalb wird der Unterschied hier festgehalten und in
 * /api/healthz sichtbar gemacht.
 */
const API_CONFIGURED = !!process.env.API_URL;
const API_URL = (process.env.API_URL ?? "http://localhost:4000").replace(/\/+$/, "");

/** Was /api/healthz ueber die Verbindung zum Dienst berichtet. */
export type ApiReachability = {
  url: string;
  configured: boolean;
  reachable: boolean;
  error?: string;
};

/** Wie lange auf den Dienst gewartet wird, bevor die Seite einen Fehler zeigt. */
const TIMEOUT_MS = Number(process.env.API_TIMEOUT_MS) || 15_000;

/**
 * Ein Fehler mit HTTP-Status, damit die Seiten die Faelle unterscheiden
 * koennen, die verschiedene Oberflaechen brauchen: neu anmelden (401),
 * Konto noch nicht verknuepft (403) und "gibt es nicht" (404).
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Fachlicher Grund, wenn der Dienst einen nennt ("locked", "incomplete", ...). */
    readonly code?: string,
    /**
     * Die Eingabefelder, die der Dienst abgelehnt hat. Zusammen mit `code`
     * formuliert die Oberflaeche damit selbst - der Text in `message` ist Deutsch.
     */
    readonly fields?: string[],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Nicht angemeldet, oder die Session traegt keine oid. */
export function isAuthError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

/**
 * Angemeldet, aber zu diesem Entra-Konto ist keine Teams-Identitaet bekannt.
 *
 * Das ist der haeufigste erste Kontakt: jemand meldet sich im Web an, hat aber
 * noch nie einen Beleg im Teams-Chat erfasst. Der Dienst antwortet dann
 * bewusst mit 403 und nicht mit einer leeren Liste - eine leere Tabelle waere
 * die falsche Erklaerung fuer "wir kennen dich noch nicht". 409 ist der
 * seltene Fall zweier Teams-Konten zu einer Entra-ID; fuer den Nutzer ist
 * beides "das muss jemand einrichten".
 */
export function isUnlinkedAccount(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 403 || error.status === 409);
}

/** Der Dienst hat Eingaben abgelehnt (400). */
export function isRejected(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 400;
}

export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

type RequestOptions = {
  method?: "GET" | "PATCH" | "POST" | "DELETE";
  query?: Record<string, string | number | undefined | null>;
  body?: unknown;
};

function serviceToken(): string {
  const token = process.env.API_SERVICE_TOKEN;
  if (!token) {
    // Beim Start zu pruefen waere verlockend, wuerde aber `next build`
    // scheitern lassen: der Build rendert Seiten vor und hat keine Secrets.
    throw new ApiError(
      500,
      "API_SERVICE_TOKEN is not configured - this instance cannot reach the receipt service.",
    );
  }
  return token;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const session = await auth();

  // Angemeldet, aber ohne oid: kommt vor, wenn der Tenant den Claim nicht
  // mitschickt. Als 401 behandeln - ohne oid gibt es kein Subject, und ein
  // Aufruf ohne Subject waere ein Aufruf ohne Mandantenfilter.
  if (!session?.oid) {
    throw new ApiError(401, "Not signed in.");
  }

  const url = new URL(`${API_URL}${path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? "GET",
      headers: {
        authorization: `Bearer ${serviceToken()}`,
        "x-subject-aad": session.oid,
        ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      // Belegdaten sind pro Nutzer und veraenderlich. Ein Cache-Treffer ueber
      // Nutzergrenzen hinweg waere hier der schlimmste denkbare Fehler.
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    // Netzwerkfehler und Timeout. 503, weil der Dienst nicht erreichbar ist -
    // nicht 500, was nach einem Fehler dieser Anwendung aussieht.
    throw new ApiError(
      503,
      `The receipt service is not responding: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => undefined);

  if (!response.ok) {
    // Der Dienst antwortet einheitlich mit { error: "<Text>" }. Der Text ist
    // Deutsch (so ist der Dienst gebaut) und wird deshalb NICHT durchgereicht,
    // wo die Oberflaeche selbst erklaeren kann - siehe die Empty States.
    const body = payload as { error?: string; code?: string; fields?: string[] } | undefined;
    const message = body?.error ?? `HTTP ${response.status} ${response.statusText}`;
    throw new ApiError(
      response.status,
      message,
      typeof body?.code === "string" ? body.code : undefined,
      Array.isArray(body?.fields) ? body.fields : undefined,
    );
  }

  return payload as T;
}

/**
 * Fuer /api/healthz: erreicht diese Instanz den Belegdienst? Ohne Anmeldung.
 *
 * Wirft nicht, sondern berichtet: der Aufrufer entscheidet, ob daraus ein
 * roter Healthcheck wird. Siehe app/api/healthz/route.ts - die beiden Faelle
 * "Variable fehlt" und "Dienst gerade weg" verlangen verschiedene Antworten.
 */
export async function pingApi(): Promise<ApiReachability> {
  const base: ApiReachability = { url: API_URL, configured: API_CONFIGURED, reachable: false };

  try {
    const response = await fetch(`${API_URL}/healthz`, {
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return response.ok
      ? { ...base, reachable: true }
      : { ...base, error: `HTTP ${response.status} ${response.statusText}` };
  } catch (error) {
    return { ...base, error: error instanceof Error ? error.message : String(error) };
  }
}
