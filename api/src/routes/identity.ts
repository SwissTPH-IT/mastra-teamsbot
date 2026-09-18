// Identitaet festhalten.
//
// Aufrufer ist ausschliesslich der Teams-Handler des Agenten: aadObjectId,
// Tenant und die Conversation Reference stehen nur in der eingehenden
// Bot-Framework-Activity, also kann sie nur er kennen. Deshalb Service-Weg
// only - ein Nutzertoken hat hier nichts zu suchen, es koennte sonst die
// Conversation Reference des eigenen Kontos ueberschreiben und damit
// bestimmen, wohin Erinnerungen gehen.
//
// Der Upsert selbst (mit coalesce pro Feld) liegt unveraendert in
// src/db/users.ts.

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { upsertIdentity } from 'mastra-teamsbot/db/users';
import { subjectOf, type AuthState } from '../auth';
import { validate } from '../validate';

type Env = { Variables: { auth: AuthState } };

const identitySchema = z.object({
  aadObjectId: z.string().nullable().optional(),
  tenantId: z.string().nullable().optional(),
  displayName: z.string().nullable().optional(),
  conversationRef: z
    .object({
      conversationId: z.string().optional(),
      serviceUrl: z.string().optional(),
      channelId: z.string().optional(),
      recipient: z.object({ id: z.string().optional(), name: z.string().optional() }).optional(),
    })
    .nullable()
    .optional(),
});

export const identityRoutes = new Hono<Env>().put('/', validate('json', identitySchema), async c => {
  if (c.get('auth').actor.kind !== 'service') {
    throw new HTTPException(403, { message: 'Identitaeten schreibt nur der Kanal-Dienst.' });
  }

  const body = c.req.valid('json');
  await upsertIdentity({ teamsUserId: subjectOf(c), ...body });

  // Kein Inhalt: der Aufrufer braucht nichts zurueck, und der Handler im
  // Agenten soll deswegen nichts parsen muessen.
  return c.body(null, 204);
});
