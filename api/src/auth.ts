// Wer ruft, und fuer wen.
//
// Drei Wege hinein, bewusst asymmetrisch:
//
//   Service + X-Subject-User  ->  der Mastra-Agent. Er darf die Teams-userId
//                      direkt setzen, weil er sie aus einem signierten
//                      Bot-Framework-Payload nimmt (message.author.userId) und
//                      nie aus Modell-Output. Das ist der "Superuser"-Weg: ein
//                      Prozess, dem wir vertrauen, handelt im Namen eines
//                      Nutzers.
//
//   Service + X-Subject-Aad   ->  die Weboberflaeche. Sie kennt nach dem Login
//                      nur die Entra-oid und soll die Teams-userId gar nicht
//                      kennen: die Zuordnung oid -> Beleg-Eigentuemer gehoert
//                      ins System, nicht in den Aufrufer. Deshalb loest die API
//                      sie selbst auf - dasselbe app.users-Mapping wie unten.
//
//   Entra-JWT                 ->  ein angemeldeter Mensch, der direkt gegen die
//                      API ruft. Das Subject kommt aus `oid` IM TOKEN und ist
//                      nicht setzbar: die Subject-Header werden dann ignoriert,
//                      nicht gelesen. Sonst waere die Mandantentrennung eine
//                      Bitte.
//
// Alle drei muenden in denselben Wert: eine Teams-userId, die jede
// Repository-Funktion als erstes Argument bekommt und an jedes WHERE haengt.

import { createRemoteJWKSet, jwtVerify } from 'jose';
import { findTeamsUserIdsByAadObjectId } from 'mastra-teamsbot/db/users';
import type { Context, MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';

const SERVICE_TOKEN = process.env.API_SERVICE_TOKEN;
const ENTRA_TENANT_ID = process.env.ENTRA_TENANT_ID;
const ENTRA_API_AUDIENCE = process.env.ENTRA_API_AUDIENCE;

if (!SERVICE_TOKEN || SERVICE_TOKEN.length < 32) {
  throw new Error(
    'API_SERVICE_TOKEN fehlt oder ist zu kurz (mindestens 32 Zeichen). Ohne ihn kann der ' +
      'Agent nicht schreiben, und ein kurzes Geheimnis ist ratbar.',
  );
}

/** Wer den Aufruf macht. Steht im Audit-Log neben dem Subject. */
export type Actor =
  | { kind: 'service'; name: string }
  /** Ein Dienst, der fuer eine angemeldete Entra-Identitaet handelt (Weboberflaeche). */
  | { kind: 'service-obo'; aadObjectId: string }
  | { kind: 'user'; aadObjectId: string };

export type AuthState = {
  actor: Actor;
  /** Die Teams-userId, in deren Namen gearbeitet wird. */
  subject: string;
};

/**
 * JWKS wird von jose selbst gecacht und bei unbekannter `kid` neu geladen –
 * Entra rotiert seine Signaturschluessel, ein einmal geladener Satz veraltet.
 * Lazy, damit der Dienst auch ohne konfigurierte Entra-Werte startet (dann
 * funktioniert nur der Service-Weg).
 */
let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

function getJwks(): ReturnType<typeof createRemoteJWKSet> {
  if (!ENTRA_TENANT_ID || !ENTRA_API_AUDIENCE) {
    // Nach draussen ist das ein nicht akzeptiertes Token, nicht "Dienst kaputt":
    // ein falsch geratener Service-Token landet hier genauso wie ein echtes
    // Entra-JWT. Die Ursache gehoert ins Log, nicht in die Antwort.
    console.warn('[api] Nutzertoken abgewiesen: ENTRA_TENANT_ID / ENTRA_API_AUDIENCE fehlen.');
    throw new HTTPException(401, { message: 'Token nicht akzeptiert.' });
  }
  jwks ??= createRemoteJWKSet(
    new URL(`https://login.microsoftonline.com/${ENTRA_TENANT_ID}/discovery/v2.0/keys`),
  );
  return jwks;
}

/**
 * Zeitkonstanter Vergleich.
 *
 * Ein `===` auf Geheimnissen bricht beim ersten falschen Zeichen ab und verraet
 * darueber, wie viele Zeichen stimmten. Bei einem Token, das ein Angreifer
 * beliebig oft probieren kann, ist das ein Unterschied.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Die Bruecke aus Phase 1: Entra-Identitaet -> Teams-userId, an der die Belege
 * haengen. Sie liegt hier und nicht beim Aufrufer - wem ein Beleg gehoert,
 * entscheidet das System.
 *
 * Wer sich anmeldet, aber nie ueber Teams erfasst hat, hat in app.users keine
 * Zeile und sieht dann nichts. Das ist richtig so: kein Treffer heisst "darf
 * nichts sehen", nicht "darf alles sehen".
 */
async function subjectForAadObjectId(aadObjectId: string): Promise<string> {
  const teamsUserIds = await findTeamsUserIdsByAadObjectId(aadObjectId);

  if (teamsUserIds.length === 0) {
    throw new HTTPException(403, {
      message:
        'Zu diesem Konto sind keine Belege bekannt. Erfasse zuerst einen Beleg im Teams-Chat.',
    });
  }
  if (teamsUserIds.length > 1) {
    // Kommt heute nicht vor (aad_object_id ist unique). Faellt es doch an,
    // soll es auffallen statt stillschweigend das erste Konto zu nehmen.
    throw new HTTPException(409, {
      message: `Mehrdeutige Identitaet: ${teamsUserIds.length} Teams-Konten zu einer Entra-ID.`,
    });
  }

  return teamsUserIds[0]!;
}

async function resolveUserSubject(token: string): Promise<AuthState> {
  const { payload } = await jwtVerify(token, getJwks(), {
    audience: ENTRA_API_AUDIENCE,
    issuer: `https://login.microsoftonline.com/${ENTRA_TENANT_ID}/v2.0`,
  });

  const aadObjectId = typeof payload.oid === 'string' ? payload.oid : undefined;
  if (!aadObjectId) {
    throw new HTTPException(401, { message: 'Token ohne oid – kein Nutzerbezug.' });
  }

  return {
    actor: { kind: 'user', aadObjectId },
    subject: await subjectForAadObjectId(aadObjectId),
  };
}

/**
 * Authentifizierung fuer alle Nutzer- und Agent-Routen.
 *
 * Reihenfolge ist Absicht: erst pruefen, ob es der Service-Token ist. Ein
 * Entra-JWT wird nur dann als solches behandelt, wenn es NICHT der
 * Service-Token ist – sonst koennte ein Nutzer mit einem selbstgebauten Token
 * in den Service-Zweig geraten.
 */
export const authenticate: MiddlewareHandler<{ Variables: { auth: AuthState } }> = async (
  c,
  next,
) => {
  const header = c.req.header('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : undefined;

  if (!token) {
    throw new HTTPException(401, { message: 'Authorization: Bearer <token> fehlt.' });
  }

  if (timingSafeEqual(token, SERVICE_TOKEN)) {
    const teamsUserId = c.req.header('x-subject-user')?.trim();
    const aadObjectId = c.req.header('x-subject-aad')?.trim();

    // Genau eines von beiden. Beide gleichzeitig waere zweideutig - und ein
    // Aufrufer, der eine Teams-ID UND eine oid schickt, hat entweder einen
    // Fehler oder eine Absicht, die wir nicht erraten wollen.
    if (teamsUserId && aadObjectId) {
      throw new HTTPException(400, {
        message: 'X-Subject-User und X-Subject-Aad zusammen: unklar, wer gemeint ist.',
      });
    }

    if (teamsUserId) {
      c.set('auth', { actor: { kind: 'service', name: 'mastra-agent' }, subject: teamsUserId });
      return next();
    }

    if (aadObjectId) {
      c.set('auth', {
        actor: { kind: 'service-obo', aadObjectId },
        subject: await subjectForAadObjectId(aadObjectId),
      });
      return next();
    }

    throw new HTTPException(400, {
      message:
        'Service-Aufruf ohne Subject: X-Subject-User (Teams-ID) oder X-Subject-Aad (Entra-oid) ' +
        'wird gebraucht, sonst ist unklar, fuer wen gearbeitet werden soll.',
    });
  }

  c.set('auth', await resolveUserSubject(token));
  return next();
};

/**
 * Nur der Service-Token, ohne Subject. Fuer nutzeruebergreifende Endpunkte
 * (spaeter der Reminder-Cron). Ein Nutzertoken kommt hier nicht durch – sonst
 * gaebe es einen Weg um den Mandantenfilter herum.
 */
export const serviceOnly: MiddlewareHandler = async (c, next) => {
  const header = c.req.header('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : undefined;

  if (!token || !timingSafeEqual(token, SERVICE_TOKEN)) {
    throw new HTTPException(403, { message: 'Dieser Endpunkt ist nur fuer Dienste.' });
  }
  return next();
};

/** Das Subject des aktuellen Aufrufs. Wirft, wenn die Middleware nicht lief. */
export function subjectOf(c: Context<{ Variables: { auth: AuthState } }>): string {
  const auth = c.get('auth');
  if (!auth?.subject) {
    throw new HTTPException(500, { message: 'Kein Auth-Kontext – Middleware nicht registriert.' });
  }
  return auth.subject;
}
