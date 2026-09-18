// zValidator mit einer Fehlerform.
//
// Ohne Hook antwortet @hono/zod-validator mit seiner eigenen Struktur
// ({ success, error: { issues: [...] } }), waehrend alle anderen Fehler des
// Dienstes { error: "<Text>" } sind. Der Agent-Client liest genau dieses eine
// Feld und gibt es als Tool-Fehler an das Modell weiter – zwei Fehlerformen
// hiessen zwei Auswertungen, und die zweite wuerde irgendwann vergessen.

import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { ZodSchema } from 'zod';

type Target = 'json' | 'query' | 'param' | 'header' | 'form';

export function validate<T extends ZodSchema>(target: Target, schema: T) {
  return zValidator(target, schema, result => {
    if (!result.success) {
      // Feldpfad plus Meldung, kommagetrennt: "candidate.totalAmount: Required".
      // Genug, damit ein Aufrufer den Fehler sieht, ohne den ganzen Zod-Baum.
      const details = result.error.issues
        .map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join(', ');
      throw new HTTPException(400, { message: `Ungueltige Anfrage – ${details}` });
    }
  });
}
