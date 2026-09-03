// Ein Ort für die Modellwahl. Format: "<provider>/<model>" (Mastra Model Router).
// Über MASTRA_MODEL umschaltbar, ohne Code-Änderung – siehe .env.example.
//
// Der Fallback muss vision-fähig sein: Belegerfassung und Teams-Agent bekommen
// Bilder als Input.
export const DEFAULT_MODEL = 'openai/gpt-4o-mini';

export const model = process.env.MASTRA_MODEL || DEFAULT_MODEL;

