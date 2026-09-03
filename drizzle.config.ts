import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  // Der entscheidende Eintrag: der Diff sieht ausschliesslich das Schema "app".
  // Ohne ihn würde drizzle-kit die von Mastra angelegten mastra_*-Tabellen als
  // "nicht im Schema definiert" betrachten und DROP-Statements dafür vorschlagen.
  schemaFilter: ['app'],
});
