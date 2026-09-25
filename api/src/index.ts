// Der Fachdaten-Dienst.
//
// Eigentuemer von app.* – Belege und Abrechnungen. Der
// Mastra-Agent und (spaeter) die Weboberflaeche sprechen nur noch hierueber
// mit der Datenbank; das Schema "mastra" bleibt dagegen beim Agenten, weil
// PostgresStore dafuer eine eigene Verbindung braucht.
//
// Hono, weil Mastra selbst darauf laeuft: dieselben Idiome, und was zwischen
// Agent und Dienst wandert, ist Copy-Paste statt Portierung.

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { logger as requestLogger } from 'hono/logger';
import { sql } from 'drizzle-orm';
import { db } from 'mastra-teamsbot/db';
import { closePool } from 'mastra-teamsbot/db/pool';
import { ReceiptLockedError } from 'mastra-teamsbot/db/receipts';
import { SettlementError } from 'mastra-teamsbot/db/settlements';
import { authenticate, type AuthState } from './auth';
import { identityRoutes } from './routes/identity';
import { receiptRoutes } from './routes/receipts';
import { settlementRoutes } from './routes/settlements';

type Env = { Variables: { auth: AuthState } };

const app = new Hono<Env>();

app.use('*', requestLogger());

/**
 * Nachvollziehbarkeit: wer hat im Namen von wem gearbeitet.
 *
 * Genau das war vorher nicht zu beantworten – ein Tool rief eine Funktion, und
 * im Log stand nichts. Actor und Subject getrennt zu fuehren ist auch die
 * Voraussetzung dafuer, spaeter von Service-Token auf echte Nutzertoken
 * (On-Behalf-Of) zu wechseln, ohne die Endpunkte anzufassen.
 */
const audit: MiddlewareHandler<Env> = async (c, next) => {
  await next();
  const auth = c.get('auth');
  if (!auth) return;
  const actor =
    auth.actor.kind === 'service'
      ? auth.actor.name
      : `${auth.actor.kind}:${auth.actor.aadObjectId}`;
  console.log(
    `[api] ${c.req.method} ${c.req.path} -> ${c.res.status} actor=${actor} subject=${auth.subject}`,
  );
};

// Je Pfad einzeln registriert: app.use() nimmt genau EIN Pfadmuster, eine
// Liste wird als Handler interpretiert und scheitert zur Laufzeit mit
// "handler is not a function". Und '/identity/*' trifft '/identity' nicht mit,
// deshalb beide.
app.use('/receipts/*', authenticate, audit);
app.use('/identity', authenticate, audit);
app.use('/identity/*', authenticate, audit);
app.use('/settlements', authenticate, audit);
app.use('/settlements/*', authenticate, audit);

app.route('/receipts', receiptRoutes);
app.route('/identity', identityRoutes);
app.route('/settlements', settlementRoutes);

/**
 * /healthz, nicht /health – gleiche Namenswahl wie beim Agenten, damit beide
 * Services denselben Pfad im Railway-Healthcheck haben. Prueft die Datenbank
 * mit, sonst meldet ein Dienst "gesund", der nichts lesen kann.
 */
app.get('/healthz', async c => {
  try {
    await db.execute(sql`select 1`);
    return c.json({ status: 'ok' });
  } catch (error) {
    return c.json(
      { status: 'error', error: error instanceof Error ? error.message : String(error) },
      503,
    );
  }
});

/**
 * Eine Fehlerform fuer alle Endpunkte: { error: "<Text>" }.
 *
 * Der Agent-Client liest genau dieses Feld und gibt es als Tool-Fehler an das
 * Modell weiter, das es dem Nutzer erklaeren kann. Unerwartete Fehler werden
 * geloggt, aber nicht nach draussen gegeben – ein Stacktrace ist keine
 * Fehlermeldung.
 */
const SETTLEMENT_ERROR_STATUS = {
  'not-found': 404,
  // Gesperrt und "diese Belege gehen nicht" sind Konflikte mit dem Zustand,
  // keine kaputten Anfragen: dieselbe Anfrage waere gestern gegangen.
  locked: 409,
  'receipts-unavailable': 409,
  // Formal gueltig, fachlich nicht einreichbar.
  empty: 422,
  incomplete: 422,
} as const;

app.onError((error, c) => {
  if (error instanceof HTTPException) {
    return c.json({ error: error.message }, error.status);
  }
  // Fachliche Fehler aus dem Repository. Sie tragen ihre Meldung selbst, weil
  // nur das Repository weiss, WARUM ein Statement 0 Zeilen traf. `code` ist
  // additiv und fuer Aufrufer, die selbst formulieren (die englische
  // Oberflaeche): einen deutschen Satz auszuwerten waere eine Kopplung an
  // seinen Wortlaut.
  if (error instanceof SettlementError) {
    return c.json(
      { error: error.message, code: error.reason },
      SETTLEMENT_ERROR_STATUS[error.reason],
    );
  }
  if (error instanceof ReceiptLockedError) {
    return c.json({ error: error.message, code: 'locked' }, 409);
  }
  console.error('[api] Unerwarteter Fehler:', error);
  return c.json({ error: 'Interner Fehler.' }, 500);
});

app.notFound(c => c.json({ error: `Unbekannter Pfad: ${c.req.path}` }, 404));

const port = Number(process.env.PORT) || 4000;

// 0.0.0.0 ist zwingend: sonst ist der Server nur im Container selbst
// erreichbar und Railways Proxy bekommt keine Verbindung.
const server = serve({ fetch: app.fetch, hostname: '0.0.0.0', port }, info => {
  console.log(`[api] hoert auf http://0.0.0.0:${info.port}`);
});

/**
 * Railway schickt SIGTERM und wartet kurz. Ohne das Schliessen des Pools
 * bleiben Verbindungen offen, bis Postgres sie selbst aufgibt – bei einem
 * Verbindungsbudget von rund 20 ist das nach ein paar Deploys spuerbar.
 */
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    console.log(`[api] ${signal} – beende.`);
    server.close(async () => {
      await closePool();
      process.exit(0);
    });
  });
}

export { app };
