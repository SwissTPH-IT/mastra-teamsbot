// Retention anwenden.
//
//   npm run db:prune                       (lokal)
//   node .mastra/output/scripts/prune.mjs  (Railway-Cron-Service, täglich)
//
// Hier – und nur hier – stehen die Retention-Policies. Der Laufzeit-Store in
// src/mastra/storage.ts konfiguriert bewusst keine: `prune()` akzeptiert die
// Policies pro Aufruf ("Replace the store's configured retention policies for
// this call only"), und eine zweite Definition dort würde nur auseinanderlaufen.
//
// prune() ist die eingebaute Umsetzung aus @mastra/pg – kein handgeschriebenes
// DELETE. Sie arbeitet in Batches und meldet über `done: false`, dass noch
// löschbare Zeilen übrig sind; daher die Schleife mit Deckel.

import { Pool } from 'pg';
import { PostgresStore } from '@mastra/pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('[prune] DATABASE_URL ist nicht gesetzt.');
  process.exit(1);
}

/**
 * Die Span-Tabellen wachsen um Grössenordnungen schneller als die Belege: pro
 * Beleg fallen Dutzende Spans an, pro Beleg genau eine Zeile in app.receipts.
 * Deshalb die kürzeste Frist auf spans.
 *
 * workflowSnapshot mit 30d räumt gleichzeitig Reviews auf, die nie beantwortet
 * wurden. app.receipts hat KEINE Retention – Belege bleiben, das ist der Zweck
 * der Anwendung. Über Umgebungsvariablen justierbar, ohne Redeploy des Agenten.
 */
const retention = {
  observability: { spans: { maxAge: process.env.RETENTION_SPANS || '14d' } },
  workflows: { workflowSnapshot: { maxAge: process.env.RETENTION_SNAPSHOTS || '30d' } },
  memory: { messages: { maxAge: process.env.RETENTION_MESSAGES || '180d' } },
};

const MAX_PASSES = 20;

const pool = new Pool({
  connectionString,
  max: 2,
  ssl: /sslmode=(require|verify)/.test(connectionString) ? { rejectUnauthorized: false } : undefined,
});

try {
  const store = new PostgresStore({
    id: 'mastra-storage-prune',
    pool,
    schemaName: 'mastra',
    disableInit: true,
  });

  for (let pass = 1; pass <= MAX_PASSES; pass++) {
    const results = await store.prune({ retention });
    const deleted = results.reduce((sum, r) => sum + r.deleted, 0);
    const done = results.every(r => r.done);

    console.log(`[prune] Durchlauf ${pass}: ${deleted} Zeilen gelöscht, done=${done}`);
    if (done) break;

    if (pass === MAX_PASSES) {
      console.warn(`[prune] Nach ${MAX_PASSES} Durchläufen nicht fertig – der nächste Lauf macht weiter.`);
    }
  }
} catch (error) {
  console.error('[prune] Fehlgeschlagen:', error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
