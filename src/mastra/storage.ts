import { LibSQLStore } from '@mastra/libsql';

// Persistiert Threads, Messages, Working Memory und Traces.
//
// Default ist eine Datei unter /app/data. Lokal/in Docker liegt das im Volume
// ./data (siehe docker-compose.yml) und überlebt Neustarts. Auf Railway ist das
// Dateisystem ohne gemountetes Volume ephemer – dann entweder ein Volume auf
// /app/data legen oder DATABASE_URL auf eine Turso-URL zeigen lassen
// (libsql://…, zusammen mit DATABASE_AUTH_TOKEN). Siehe .env.example.
export const storage = new LibSQLStore({
  id: 'mastra-storage',
  url: process.env.DATABASE_URL || 'file:/app/data/mastra.db',
  // Nur für remote libsql/Turso relevant; bei file:-URLs ignoriert.
  authToken: process.env.DATABASE_AUTH_TOKEN,
});
