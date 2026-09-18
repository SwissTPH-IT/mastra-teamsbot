// Die Kategorien, in einer Liste.
//
// Gespeichert wird der Schluessel (`meals`), angezeigt die Aufschrift
// ("Meals"). Beides an einer Stelle, weil sonst die Liste "accommodation"
// zeigt und das Formular "Accommodation" - derselbe Wert in zwei Schreibweisen
// sieht nach zwei Kategorien aus.
//
// Kein Freitext: eine Kategorie, die jeder anders schreibt, ist in einer
// Auswertung wertlos. Werte, die nicht in dieser Liste stehen (aus dem
// Teams-Chat oder aus einer aelteren Fassung), werden unveraendert angezeigt
// statt verschluckt.

export const CATEGORIES = [
  { value: "", label: "Not set" },
  { value: "meals", label: "Meals" },
  { value: "travel", label: "Travel / transport" },
  { value: "accommodation", label: "Accommodation" },
  { value: "supplies", label: "Supplies" },
  { value: "other", label: "Other" },
] as const;

export const RECEIPT_TYPES = [
  { value: "", label: "Not set" },
  { value: "receipt", label: "Receipt / till slip" },
  { value: "invoice", label: "Invoice" },
  { value: "ticket", label: "Ticket" },
  { value: "none", label: "No document" },
] as const;

const LABELS = new Map<string, string>(CATEGORIES.map((entry) => [entry.value, entry.label]));

/** Die Aufschrift zu einem gespeicherten Wert. Leer heisst "Not set". */
export function categoryLabel(value: string | null): string {
  if (!value || value.trim() === "") return "Not set";
  return LABELS.get(value) ?? value;
}

const TYPE_LABELS = new Map<string, string>(
  RECEIPT_TYPES.map((entry) => [entry.value, entry.label]),
);

export function receiptTypeLabel(value: string | null): string {
  if (!value || value.trim() === "") return "Not set";
  return TYPE_LABELS.get(value) ?? value;
}
