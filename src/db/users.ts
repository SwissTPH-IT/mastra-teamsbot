// Repository für app.users – die Identität hinter einer Teams-userId.
//
// Bewusst getrennt von receipts.ts: dort steht die Mandantenlogik (jede
// Funktion nimmt eine userId und filtert darauf), hier wird die Identität
// selbst geführt. Der Upsert läuft bei jeder Teams-Nachricht, nicht nur bei
// einem Beleg – aadObjectId und Conversation Reference stehen ausschliesslich
// in der eingehenden Activity und sind später nicht mehr zu beschaffen.

import { eq, sql } from 'drizzle-orm';
import { db } from './index';
import { users, type UserRow } from './schema';

/**
 * Die Felder einer Conversation Reference, die für eine proaktive Nachricht
 * gebraucht werden. Als jsonb abgelegt statt als Spalten: das ist eine
 * Bot-Framework-Struktur, die wir nur durchreichen und nie abfragen.
 */
export type ConversationRef = {
  conversationId?: string;
  serviceUrl?: string;
  channelId?: string;
  recipient?: { id?: string; name?: string };
};

export type IdentityInput = {
  teamsUserId: string;
  aadObjectId?: string | null;
  tenantId?: string | null;
  displayName?: string | null;
  conversationRef?: ConversationRef | null;
};

/**
 * Identität festhalten.
 *
 * Upsert, weil die Funktion bei jeder Nachricht läuft. Das `coalesce` in jedem
 * Feld ist der Punkt: liefert Teams ein Feld diesmal nicht mit – bei Gast- und
 * Anonym-Konten kommt die aadObjectId nicht immer –, darf das einen früher
 * bekannten Wert nicht auf NULL zurücksetzen. Ein einfaches `set:` täte genau
 * das.
 */
export async function upsertIdentity(input: IdentityInput): Promise<void> {
  await db
    .insert(users)
    .values({
      teamsUserId: input.teamsUserId,
      aadObjectId: input.aadObjectId ?? null,
      tenantId: input.tenantId ?? null,
      displayName: input.displayName ?? null,
      conversationRef: input.conversationRef ?? null,
    })
    .onConflictDoUpdate({
      target: users.teamsUserId,
      set: {
        aadObjectId: sql`coalesce(excluded.aad_object_id, ${users.aadObjectId})`,
        tenantId: sql`coalesce(excluded.tenant_id, ${users.tenantId})`,
        displayName: sql`coalesce(excluded.display_name, ${users.displayName})`,
        // Die Referenz veraltet: Teams kann serviceUrl und conversationId
        // wechseln. Der neue Wert gewinnt deshalb, solange er nicht leer ist.
        conversationRef: sql`coalesce(excluded.conversation_ref, ${users.conversationRef})`,
        updatedAt: sql`now()`,
      },
    });
}

/** Die Identität zu einer Teams-userId. Für den späteren Reminder-Versand. */
export async function getIdentity(teamsUserId: string): Promise<UserRow | null> {
  const [row] = await db.select().from(users).where(eq(users.teamsUserId, teamsUserId)).limit(1);
  return row ?? null;
}

/**
 * Die Teams-userIds zu einer Entra-Identität.
 *
 * Der Weg, den `resolveScope()` im Frontend später geht: aus `oid` im Token
 * wird die Menge der Belege, die dieser Mensch sehen darf. Eine Liste, weil
 * theoretisch mehrere Teams-Konten auf dieselbe Person zeigen können; ein
 * leeres Ergebnis heisst "sieht nichts", nicht "sieht alles".
 */
export async function findTeamsUserIdsByAadObjectId(aadObjectId: string): Promise<string[]> {
  const rows = await db
    .select({ teamsUserId: users.teamsUserId })
    .from(users)
    .where(eq(users.aadObjectId, aadObjectId));

  return rows.map(row => row.teamsUserId);
}
