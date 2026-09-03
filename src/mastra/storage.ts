// Mastra-Storage: PostgresStore im eigenen Schema "mastra".
//
// Persistiert Threads, Messages, Working Memory, Traces – und vor allem
// mastra_workflow_snapshot, wo der Kandidatensatz eines suspendierten
// Review-Runs liegt. Ohne persistenten Storage lebte der nur im Prozessspeicher
// und wäre nach jedem Railway-Deploy weg; zwischen Vorlage und Antwort in Teams
// können aber Stunden liegen.
//
// Referenz: https://mastra.ai/reference/storage/postgresql

import { PostgresStore } from '@mastra/pg';
import { pool } from '../db/pool';

export const storage = new PostgresStore({
  id: 'mastra-storage',
  // Der gemeinsame Pool aus src/db/pool.ts. Die Referenz beschreibt genau diesen
  // Fall für die Integration mit einem ORM. Konsequenz: store.close() schliesst
  // ihn NICHT, der Lifecycle liegt bei uns.
  pool,
  // Eigenes Schema, damit die mastra_*-Tabellen nicht in public liegen und ein
  // Drizzle-Diff über "app" sie nie sieht.
  schemaName: 'mastra',
  // Keine automatische Tabellenerstellung beim ersten Request nach dem Deploy.
  // Das Schema wird in scripts/migrate.mjs angelegt (npm run db:deploy), also
  // vor dem Start des Agenten. Das ist das in der Referenz beschriebene
  // CI/CD-Muster.
  disableInit: true,
  // Bewusst KEINE retention-Policies hier: sie stehen an genau einer Stelle, in
  // scripts/prune.mjs, das sie pro Aufruf an prune() übergibt. Zwei Definitionen
  // (hier und dort) liefen unweigerlich auseinander.
});
