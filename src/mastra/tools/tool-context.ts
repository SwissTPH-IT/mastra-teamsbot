// Die eine Stelle, an der ein Tool an die userId kommt.
//
// Sie steht im RequestContext (in Mastra v1 heisst der Mechanismus
// RequestContext, nicht runtimeContext) und wird serverseitig vom Teams-Handler
// gesetzt – aus `message.author.userId` des signierten Bot-Framework-Payloads.
// https://mastra.ai/docs/server/request-context
//
// Warum das nicht als Tool-Input geht: ein Tool-Input füllt das Modell. Damit
// könnte ein Nutzer den Agenten bitten, die Belege eines Kollegen aufzulisten,
// und das Modell hätte die Möglichkeit, dem nachzukommen. Über den
// RequestContext hat es die Möglichkeit nicht.

import type { RequestContext } from '@mastra/core/request-context';

/** Schlüssel im RequestContext. Eine Konstante, damit Setzen und Lesen nicht auseinanderlaufen. */
export const USER_ID_KEY = 'userId';

type MaybeToolContext = { requestContext?: RequestContext } | undefined;

/**
 * Liefert die userId oder wirft.
 *
 * Bewusst kein Default und kein Fallback: ein Tool ohne Nutzerkontext darf keine
 * Daten sehen, nicht "alle Daten". Der Fehler geht als Tool-Fehler an das
 * Modell zurück, das ihn dem Nutzer erklären kann.
 */
export function requireUserId(context: MaybeToolContext): string {
  const userId = context?.requestContext?.get(USER_ID_KEY);

  if (typeof userId !== 'string' || userId.trim() === '') {
    throw new Error(
      'Kein Nutzerkontext vorhanden. Belege können nur in einer Teams-Unterhaltung gelesen ' +
        'oder geschrieben werden.',
    );
  }

  return userId;
}
