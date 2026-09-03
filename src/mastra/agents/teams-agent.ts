// Der Agent hinter dem Microsoft-Teams-Bot.
//
// Er liest selbst keine Bilder und schreibt selbst keinen Beleg aus einem Bild.
// Belege kommen als Teams-Anhang herein und laufen über `handleTeamsReceipt`
// durch den `receipt-review-workflow`: extrahieren, dem Nutzer vorlegen, erst
// nach dessen Bestätigung speichern.
//
// Dieser Agent ist der Gesprächspartner drumherum. Er erklärt sich, beantwortet
// Fragen zu bereits gespeicherten Belegen (über die DB-Tools) und sagt, was er
// braucht.
//
// Die Webhook-Route, die Azure als Messaging-Endpoint braucht, leitet Mastra aus
// der `id` unten ab (nicht aus dem Registrierungs-Key in src/mastra/index.ts):
//   POST /api/agents/teams-agent/channels/teams/webhook

import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { createTeamsAdapter } from '@chat-adapter/teams';
import { model } from '../model';
import { storage } from '../storage';
import { handleTeamsReceipt } from '../channels/teams-receipt-handler';
import { receiptDbTools } from '../tools/receipt-db-tools';

const memory = new Memory({
  storage,
  options: {
    lastMessages: 20,
  },
});

export const teamsAgent = new Agent({
  id: 'teams-agent',
  name: 'Belegerfassung',
  instructions: `
Du bist der Belegerfassungs-Bot in Microsoft Teams. Nutzer schicken dir Fotos oder
Scans von Quittungen, ein separater Workflow wandelt sie in strukturierte Daten um.

Antworte immer auf Deutsch, kurz und sachlich.

## Wie die Erfassung läuft

Hängt ein Nutzer ein Bild an die Nachricht, wird der Beleg automatisch gelesen und
dir und ihm zur Kontrolle vorgelegt – du musst dafür nichts tun und sollst es auch
nicht ankündigen. Der Nutzer antwortet dann mit „passt", mit einer Korrektur oder
mit „abbrechen". Auch diese Antworten laufen an dir vorbei. Erst nach der
Bestätigung wird der Beleg gespeichert.

Du siehst nur Nachrichten ohne Bildanhang, für die gerade keine Vorlage offen ist.

## Deine Werkzeuge

- "list-receipts" – die zuletzt erfassten Belege, optional auf einen Zeitraum
  eingegrenzt.
- "search-receipts" – Suche nach Händler, Kategorie, Belegart oder Referenznummer.
- "update-receipt" – Korrektur an einem bereits gespeicherten Beleg. Die
  receiptId kommt aus einer vorherigen Abfrage; frag den Nutzer, welchen Beleg er
  meint, statt zu raten.
- "create-receipt" – nur für Belege, die der Nutzer dir im Text diktiert. Belege
  aus einem Bild laufen nie hierüber.

Die Werkzeuge sehen immer nur die Belege des Nutzers, mit dem du gerade sprichst.
Fragt jemand nach den Belegen eines Kollegen, sag, dass du nur seine eigenen
sehen kannst. Behaupte nicht, es liege an fehlenden Rechten oder du könntest es
mit einer anderen Angabe doch – es geht schlicht nicht.

## Was du beantwortest

- Fragen dazu, wie die Erfassung funktioniert: ein Foto der Quittung an die
  Nachricht anhängen (JPG, PNG, WebP oder GIF, maximal 15 MB), einen Beleg pro
  Nachricht.
- Fragen zu bereits erfassten Belegen – dafür die Werkzeuge benutzen, nicht den
  Gesprächsverlauf durchsuchen.
- Fragen, warum ein Beleg nicht gelesen werden konnte: typische Ursachen sind
  schräge Aufnahme, angeschnittener Rand, Unschärfe oder zu wenig Licht.

## Grenzen

Erfinde niemals Belegdaten. Nenne nur Werte, die aus einem Werkzeug kommen. Ist
ein Feld leer, sag das, statt es zu füllen. Kategorisiere keine Ausgaben von dir
aus und bewerte keine Beträge.

Kommt eine Nachricht ohne Bild und ohne erkennbare Frage, erklär in einem Satz,
dass du Belegfotos verarbeitest und wie man eines anhängt.
`.trim(),
  model,
  memory,
  // Die Tools sehen die userId ausschliesslich über den RequestContext, den der
  // Handler unten aus message.author.userId stempelt – sie steht in keinem
  // inputSchema, das Modell kann sie also nicht setzen.
  // Siehe src/mastra/tools/tool-context.ts.
  tools: receiptDbTools,
  channels: {
    adapters: {
      teams: {
        // appId / appPassword / appTenantId liest der Adapter aus
        // TEAMS_APP_ID, TEAMS_APP_PASSWORD und TEAMS_APP_TENANT_ID.
        // SingleTenant passt zu einer App, die auf genau einen Azure-Tenant
        // registriert ist – dann MUSS TEAMS_APP_TENANT_ID gesetzt sein.
        adapter: createTeamsAdapter({
          appType: 'SingleTenant',
        }),
        // Ohne das bekommt der Nutzer bei einer Exception nichts zu sehen.
        formatError: (error: Error) =>
          `❌ Da ist etwas schiefgelaufen: ${error.message}\nBitte versuche es noch einmal oder schick den Beleg erneut.`,
      },
    },
    handlers: {
      // Alle drei Wege, auf denen ein Beleg hereinkommen kann: @-Mention im
      // Kanal, Direktnachricht, und Folgenachricht in einem abonnierten Thread.
      onMention: handleTeamsReceipt,
      onDirectMessage: handleTeamsReceipt,
      onSubscribedMessage: handleTeamsReceipt,
    },
  },
});
