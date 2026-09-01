// Serverseitige Adresse des Mastra-Containers.
//
// Der Browser spricht nie direkt mit Mastra: alle Aufrufe laufen über die Route
// Handler unter /app/api/*. Das erspart CORS, hält Mastra im Docker-Netz und
// macht die Adresse zu einer reinen Laufzeit-Variable (bei NEXT_PUBLIC_* wäre
// sie in den Build eingebacken).

export const MASTRA_URL = (
  process.env.MASTRA_URL || 'http://mastra:4111'
).replace(/\/+$/, '');

/** Property-Key des Agents in der Mastra-Instanz – nicht dessen `id`. */
export const RECEIPT_AGENT_ID = process.env.MASTRA_AGENT_ID || 'receiptChatAgent';

export function mastraUrl(path: string): string {
  return `${MASTRA_URL}${path.startsWith('/') ? path : `/${path}`}`;
}
