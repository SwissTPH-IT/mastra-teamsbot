// Ein Deploy-Schritt, zwei Migrationen: unsere und Mastras.
//
//   npm run db:deploy                        (lokal, aus dem Repo-Root)
//   node .mastra/output/scripts/migrate.mjs  (im Image, als preDeployCommand)
//
// Bewusst plain ESM und ohne Import aus src/: das Build-Artefakt
// .mastra/output bringt pg, drizzle-orm und @mastra/pg bereits mit, damit läuft
// dieses Skript im Laufzeit-Image ohne tsx und ohne zweites node_modules.
//
// Eigener, kurzlebiger Pool: das hier ist ein separater Prozess, der vor dem
// Start des Agenten läuft und danach endet. Er teilt sich nichts mit ihm.

import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { PostgresStore } from '@mastra/pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('[migrate] DATABASE_URL ist nicht gesetzt.');
  process.exit(1);
}

// Liegt neben diesem Skript eine Ebene höher – im Repo (scripts/ -> ./drizzle)
// wie im Image (.mastra/output/scripts/ -> .mastra/output/drizzle).
const migrationsFolder = new URL('../drizzle', import.meta.url).pathname;

const pool = new Pool({
  connectionString,
  max: 2,
  ssl: /sslmode=(require|verify)/.test(connectionString) ? { rejectUnauthorized: false } : undefined,
});

try {
  // 1. Schema "mastra" anlegen, falls es fehlt. PostgresStore legt seine
  //    Tabellen an, aber nicht das Schema darum herum.
  //    "app" wird hier NICHT angelegt – das macht die erste Drizzle-Migration
  //    selbst (CREATE SCHEMA "app" in drizzle/0000_*.sql). Legten wir es vorher
  //    an, schlüge genau dieses Statement mit 42P06 fehl.
  await pool.query('CREATE SCHEMA IF NOT EXISTS mastra');

  // 2. Fachdaten-Migrationen aus drizzle/.
  //    Die Journal-Tabelle liegt in einem eigenen Schema "drizzle": der Migrator
  //    legt sein migrationsSchema per CREATE SCHEMA selbst an, und stünde dort
  //    "app", kollidierte das mit dem CREATE SCHEMA "app" der ersten Migration.
  console.log(`[migrate] Drizzle-Migrationen (Schema "app") aus ${migrationsFolder} …`);
  await migrate(drizzle(pool), { migrationsFolder, migrationsSchema: 'drizzle' });

  // 3. Mastras Schema-Initialisierung als expliziter Schritt.
  //    Bewusst ein Store mit disableInit: false – das in der Referenz
  //    beschriebene CI/CD-Muster. Die Anwendung selbst läuft mit
  //    disableInit: true (src/mastra/storage.ts) und legt nichts mehr an.
  //    https://mastra.ai/reference/storage/postgresql
  console.log('[migrate] Mastra-Schema-Initialisierung (Schema "mastra") …');
  const store = new PostgresStore({
    id: 'mastra-storage-init',
    pool,
    schemaName: 'mastra',
    disableInit: false,
  });
  await store.init();

  console.log('[migrate] Fertig.');
} catch (error) {
  console.error('[migrate] Fehlgeschlagen:', error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
