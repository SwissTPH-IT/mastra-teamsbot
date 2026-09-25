// Die Vorlage als Adaptive Card: was der Nutzer sieht, und was er anklicken kann.
//
// Die Karte wird nicht von Hand als Adaptive-Card-JSON gebaut, sondern als
// CardElement des Chat SDK (`Card`, `Fields`, `Actions`, `Button`). Der
// Teams-Adapter übersetzt das in eine Adaptive Card (cardToAdaptiveCard) und
// setzt an jeden Button eine `Action.Submit` mit `data.actionId` – genau der
// Wert, der beim Klick wieder in `chat.onAction` ankommt. Eine handgeschriebene
// Karte müsste dieses Protokoll nachbauen.
//
// Alle Texte, die der Nutzer sieht, sind Englisch – unabhängig davon, in
// welcher Sprache er schreibt oder der Beleg gedruckt ist. Die Teams-Interaktion
// ist durchgehend auf Englisch normalisiert.
//
// Eingabefelder kann eine Karte nicht tragen: der CardChild-Typ des SDK kennt
// nur Text, Felder, Tabellen und Buttons. Das Korrigieren läuft deshalb über
// einen Teams-Dialog (Task Module) – der Button "Adjust" ist ein Button mit
// `actionType: 'modal'`, was der Adapter zu `msteams: { type: 'task/fetch' }`
// macht, und `event.openModal()` beantwortet den Invoke mit dem Dialog.
//
// Doku:
//   Chat SDK Cards/Modals  https://chat-sdk.dev
//   Teams-Adapter          https://chat-sdk.dev/adapters/official/teams

import {
  Actions,
  Button,
  Card,
  CardText,
  DateInput,
  Field,
  Fields,
  Modal,
  Select,
  SelectOption,
  TextInput,
  type CardChild,
  type CardElement,
  type ModalChild,
  type ModalElement,
} from 'chat';
import type { ReceiptCandidate } from '../receipts/candidate';
import { REVIEW_FIELDS, type ReviewField } from '../receipts/candidate';

/**
 * Präfix aller actionIds dieser Karte.
 *
 * Mastra registriert selbst einen Catch-all-`onAction`-Handler für seine
 * Tool-Freigaben (`tool_approve:` / `tool_deny:`) und ignoriert alles andere.
 * Umgekehrt muss unser Handler alles ignorieren, was nicht hier herkommt –
 * daher ein eigenes, eindeutiges Präfix.
 */
const ACTION_PREFIX = 'receipt-review';

export type ReviewAction = 'confirm' | 'edit' | 'cancel';

/**
 * actionId = `receipt-review:<aktion>:<runId>`.
 *
 * Die runId steht mit drin, damit eine alte Karte erkennbar alt ist: schickt
 * jemand einen zweiten Beleg in denselben Thread, zeigt `pending_reviews` auf
 * den neuen Run, und ein Klick auf die alte Karte darf nicht den neuen Beleg
 * bestätigen.
 */
export function actionId(action: ReviewAction, runId: string): string {
  return `${ACTION_PREFIX}:${action}:${runId}`;
}

export function parseActionId(id: string): { action: ReviewAction; runId: string } | null {
  const [prefix, action, ...rest] = id.split(':');
  if (prefix !== ACTION_PREFIX) return null;
  if (action !== 'confirm' && action !== 'edit' && action !== 'cancel') return null;

  const runId = rest.join(':');
  return runId ? { action, runId } : null;
}

/**
 * callbackId des Korrektur-Dialogs – gleiches Schema, plus die Nachrichten-ID
 * der Karte.
 *
 * Die Karte muss nach dem Abschicken des Dialogs entwertet werden, sonst laden
 * ihre Buttons zum zweiten Klick ein. Beim Dialog-Submit ist sie aber nicht mehr
 * greifbar: `ModalSubmitEvent.relatedMessage` bleibt leer, weil der
 * Teams-Adapter kein `fetchMessage` hat. Die callbackId ist das einzige Feld,
 * das den Dialog-Umweg mitmacht – Teams gibt nur `__contextId` und
 * `__callbackId` wieder zurück.
 */
export function editModalCallbackId(runId: string, cardMessageId?: string): string {
  const base = actionId('edit', runId);
  return cardMessageId ? `${base}${MESSAGE_ID_SEPARATOR}${cardMessageId}` : base;
}

export function parseEditModalCallbackId(
  callbackId: string,
): { runId: string; cardMessageId?: string } | null {
  const [ids, cardMessageId] = callbackId.split(MESSAGE_ID_SEPARATOR);
  const parsed = parseActionId(ids);
  if (parsed?.action !== 'edit') return null;
  return cardMessageId ? { runId: parsed.runId, cardMessageId } : { runId: parsed.runId };
}

/** Kommt in keiner runId und in keiner Teams-Nachrichten-ID vor. */
const MESSAGE_ID_SEPARATOR = '~';

/** Die Eingabe-IDs im Dialog sind die Feldnamen des Kandidaten – ohne Umbenennungstabelle. */
export const MODAL_INPUT_IDS = REVIEW_FIELDS;

const NOT_READ = 'not read';

/** Die Währungen, die `parseCurrency()` kennt. Mehr anzubieten wäre gelogen. */
const CURRENCY_CHOICES = ['CHF', 'EUR', 'USD', 'GBP'];

const LABELS: Record<ReviewField, string> = {
  receiptDate: 'Date',
  currency: 'Currency',
  totalAmount: 'Total',
};

const MERCHANT_LABEL = 'Merchant';

/**
 * Die Karte im Thread.
 *
 * Zeigt die drei bestätigungspflichtigen Felder plus den Händler zur
 * Orientierung – ohne ihn ist auf einen Blick nicht klar, um welchen Beleg es
 * geht, wenn jemand mehrere hintereinander schickt.
 */
export function buildReviewCard(payload: {
  candidate: ReceiptCandidate;
  runId: string;
  round: number;
  maxRounds: number;
  isRecheck: boolean;
}): CardElement {
  const { candidate, runId } = payload;

  const children: CardChild[] = [
    Fields([
      Field({ label: MERCHANT_LABEL, value: candidate.merchant ?? NOT_READ }),
      Field({ label: LABELS.receiptDate, value: candidate.receiptDate ?? NOT_READ }),
      Field({ label: LABELS.currency, value: candidate.currency ?? NOT_READ }),
      Field({ label: LABELS.totalAmount, value: candidate.totalAmount ?? NOT_READ }),
    ]),
  ];

  if (candidate.issues.length > 0) {
    children.push(CardText(`⚠️ ${candidate.issues.join('; ')}`, { style: 'muted' }));
  }

  children.push(
    CardText(
      'Are date, currency and total correct? Then **Confirm**. Otherwise **Adjust** – ' +
        'or just reply in this thread if something else is wrong (e.g. the merchant).',
      { style: 'muted' },
    ),
    Actions([
      Button({
        id: actionId('confirm', runId),
        label: 'Confirm & save',
        style: 'primary',
      }),
      // actionType 'modal' -> der Adapter hängt msteams:{type:'task/fetch'} an
      // den Submit, und Teams holt sich den Dialog per Invoke bei uns ab.
      Button({ id: actionId('edit', runId), label: 'Adjust', actionType: 'modal' }),
      Button({ id: actionId('cancel', runId), label: 'Cancel', style: 'danger' }),
    ]),
  );

  return Card({
    title: payload.isRecheck
      ? `Receipt corrected – please check (round ${payload.round} of ${payload.maxRounds})`
      : 'Receipt read – please check',
    children,
  });
}

/**
 * Fallback-Text für Clients, die keine Adaptive Card rendern.
 *
 * Der Adapter schickt bei einer Karte nur die Karte, kein Textfeld – dieser
 * Text ist deshalb für den Fall, dass wir die Karte gar nicht erst loswerden
 * (siehe Fehlerpfad im Handler), und für die Benachrichtigungszeile.
 */
export function reviewFallbackText(candidate: ReceiptCandidate): string {
  return [
    '**Receipt read – please check**',
    candidateSummary(candidate),
    'Reply **"ok"** to confirm, describe a correction, or reply **"cancel"**.',
  ].join('\n\n');
}

/** Die vier Zeilen, die Karte, Fallback-Text und die entwertete Karte gemeinsam haben. */
export function candidateSummary(candidate: ReceiptCandidate): string {
  const line = (label: string, value: string | null) => `- **${label}:** ${value ?? `_${NOT_READ}_`}`;
  return [
    line(MERCHANT_LABEL, candidate.merchant),
    line(LABELS.receiptDate, candidate.receiptDate),
    line(LABELS.currency, candidate.currency),
    line(LABELS.totalAmount, candidate.totalAmount),
  ].join('\n');
}

/**
 * Was an der Stelle der Karte stehen bleibt, nachdem sie beantwortet wurde.
 *
 * Die Karte wird ersetzt statt ergänzt: stehen gebliebene Buttons laden zum
 * zweiten Klick ein, und der zweite Klick findet keinen offenen Review mehr
 * vor – das sähe für den Nutzer nach einem Fehler aus.
 */
export function retiredCardText(
  candidate: ReceiptCandidate,
  outcome: 'confirmed' | 'cancelled' | 'edited',
): string {
  const header = {
    confirmed: '✅ **Confirmed**',
    cancelled: '🚫 **Cancelled** – nothing saved',
    edited: '✅ **Adjusted and confirmed**',
  }[outcome];

  return `${header}\n\n${candidateSummary(candidate)}`;
}

/**
 * Der Korrektur-Dialog.
 *
 * Datum als echtes Datumsfeld (Adaptive `Input.Date`), die Währung als Auswahl
 * – beides Eingaben, bei denen Freitext nur Tippfehler produziert. Der Betrag
 * bleibt ein Textfeld: `Input.Number` kennt je nach Client nur ganze Zahlen
 * bzw. das falsche Dezimaltrennzeichen, und `parseAmount()` versteht ohnehin
 * sowohl "42.10" als auch "42,10".
 *
 * Alle Felder sind optional – leer heisst "kein Wert", nicht "Pflichtfeld
 * vergessen".
 */
export function buildEditModal(payload: {
  candidate: ReceiptCandidate;
  runId: string;
  /** Meldungen aus einem vorherigen, nicht lesbaren Versuch. */
  errors?: Partial<Record<ReviewField, string>>;
  /** Die zuletzt eingegebenen Rohwerte, damit ein Tippfehler nicht alles verwirft. */
  values?: Partial<Record<ReviewField, string>>;
  /** Die Nachricht mit der Karte – sie wird nach dem Abschicken entwertet. */
  cardMessageId?: string;
}): ModalElement {
  const { candidate, runId, errors, values } = payload;
  const initial = (field: ReviewField) => values?.[field] ?? candidate[field] ?? undefined;

  const children: ModalChild[] = [];

  const messages = Object.values(errors ?? {});
  if (messages.length > 0) {
    children.push(CardText(`⚠️ ${messages.join(' ')}`, { style: 'bold' }));
  }

  children.push(
    DateInput({
      id: 'receiptDate',
      label: LABELS.receiptDate,
      initialValue: initial('receiptDate'),
      optional: true,
    }),
    Select({
      id: 'currency',
      label: LABELS.currency,
      initialOption: initial('currency'),
      optional: true,
      options: currencyOptions(initial('currency')).map(value =>
        SelectOption({ label: value, value }),
      ),
    }),
    TextInput({
      id: 'totalAmount',
      label: LABELS.totalAmount,
      initialValue: initial('totalAmount'),
      placeholder: 'e.g. 42.10',
      optional: true,
    }),
  );

  return Modal({
    callbackId: editModalCallbackId(runId, payload.cardMessageId),
    title: 'Adjust receipt',
    submitLabel: 'Apply & save',
    children,
    closeLabel: 'Back',
  });
}

/**
 * Eine Währung, die der Beleg zeigt, aber `parseCurrency()` nicht kennt, würde
 * aus der Auswahl fallen – dann stünde im Dialog ein anderer Wert als in der
 * Karte. Deshalb kommt der aktuelle Wert mit in die Liste.
 */
function currencyOptions(current: string | undefined): string[] {
  if (!current || CURRENCY_CHOICES.includes(current)) return CURRENCY_CHOICES;
  return [current, ...CURRENCY_CHOICES];
}
