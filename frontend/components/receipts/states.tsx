// Die Zustaende, in denen keine Tabelle steht.
//
// Vier verschiedene Gruende, nichts zu sehen - und vier verschiedene Texte.
// Eine gemeinsame "Keine Daten"-Meldung waere die haeufigste Fehlerquelle im
// Support: "leer, weil wir dich nicht kennen" und "leer, weil dein Filter
// nichts trifft" fuehren zu voellig verschiedenen naechsten Schritten.

export function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-line bg-panel flex flex-col items-center gap-3 rounded-[14px] border px-12 py-[72px] text-center">
      {children}
    </div>
  );
}

/**
 * Angemeldet, aber im System unbekannt.
 *
 * Der Dienst antwortet hier mit 403, weil in app.users keine Zeile mit dieser
 * Entra-oid steht. Die Zeile entsteht beim ersten Kontakt im Teams-Chat -
 * deshalb ist der naechste Schritt Teams und nicht diese Oberflaeche.
 */
export function UnlinkedAccount({ name }: { name?: string | null }) {
  return (
    <Panel>
      <div className="text-[18px] font-semibold">
        {name ? `Welcome, ${name.split(" ")[0]}` : "Welcome"} — nothing linked yet
      </div>
      <div className="text-ink-2 max-w-[460px] text-[13.5px] leading-[1.6]">
        Your account is signed in, but no receipts are linked to it. The link is created the first
        time you send a receipt to the expenses bot in Microsoft Teams: take a picture, check the
        extracted data, confirm. After that everything shows up here.
      </div>
      <div className="text-ink-3 max-w-[460px] text-xs leading-[1.55]">
        If you have captured receipts before and still see this, your Teams account and your sign-in
        account are different identities. IT can connect them.
      </div>
    </Panel>
  );
}

/** Verknuepft, aber noch kein Beleg erfasst. Text aus der Vorlage. */
export function NoReceipts() {
  return (
    <Panel>
      <div className="text-[18px] font-semibold">No expenses yet</div>
      <div className="text-ink-2 max-w-[440px] text-[13.5px] leading-[1.6]">
        Photo receipts are captured in the Teams chat: take a picture, check the extracted data,
        send. They appear here right afterwards.
      </div>
    </Panel>
  );
}

/** Belege vorhanden, aber der Filter trifft keinen. Text aus der Vorlage. */
export function NoMatches() {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <div className="text-[15px] font-semibold">Nothing matches this selection</div>
      <div className="text-ink-3 max-w-[400px] text-[13px] leading-[1.55]">
        The period filter uses the receipt date, not the date the item was captured.
      </div>
    </div>
  );
}

/**
 * Der Dienst antwortet nicht.
 *
 * Bewusst mit der technischen Ursache: diese Meldung sieht ein Mensch, der
 * gerade nicht weiterarbeiten kann, und die Frage "liegt es an mir" ist dann
 * die erste. Der Text des Dienstes ist deutsch, deshalb steht er als Detail
 * darunter und nicht als Hauptsatz.
 */
export function ServiceUnavailable({ detail }: { detail?: string }) {
  return (
    <Panel>
      <div className="text-[18px] font-semibold">The receipt service is unavailable</div>
      <div className="text-ink-2 max-w-[460px] text-[13.5px] leading-[1.6]">
        Your receipts are safe — this view just cannot reach the service that holds them. Try again
        in a moment.
      </div>
      {detail ? (
        <div className="text-ink-3 max-w-[460px] font-mono text-[11.5px] break-words">{detail}</div>
      ) : null}
    </Panel>
  );
}
