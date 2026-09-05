/**
 * What each kind of one-tap action's "done" actually does — the browser's copy
 * of the gateway's census (`apps/api-gateway/src/one-tap-actions/
 * one-tap-workflow.ts`).
 *
 * WHY A COPY AND NOT AN IMPORT. Pages do not import from the gateway, and a
 * shared package for nine strings would be a build dependency for a sentence.
 * The two are kept in step by `OneTapPanel.test.tsx`, which asserts this table
 * names every type the gateway declares — a drift shows up as a failing test
 * rather than as a control that says one thing and a route that does another.
 *
 * WHY THE BROWSER NEEDS TO KNOW AT ALL. Because a control that offers an act
 * and then receives a refusal has already lied once, in the shape of a live
 * button. ADR 0083: a control whose backend does not exist is rendered disabled
 * with one line saying why, never as a working button. The gateway refuses
 * these too — that is the gate; this is the manners.
 */

export type OneTapDisposition =
  /** A real write, redeemed against a seal before it runs. */
  | { kind: 'workflow'; act: 'deliver' }
  /** Marking it done IS the act: a decision recorded against a name. */
  | { kind: 'record' }
  /** No workflow exists. The control is disabled and says this sentence. */
  | { kind: 'unbuilt'; sentence: string };

export const ONE_TAP_DISPOSITIONS: Record<string, OneTapDisposition> = {
  delivery_confirm: { kind: 'workflow', act: 'deliver' },
  custom: { kind: 'record' },
  low_stock: {
    kind: 'unbuilt',
    sentence:
      'Reordering from here is not built — placing the order needs a vendor and an agreed price this card does not carry, and it would open a priced negotiation with the vendor. Do it in Orders, behind the order seal.',
  },
  price_change: {
    kind: 'unbuilt',
    sentence:
      'Accepting a price from here is not built: no route in this house writes a purchase price yet.',
  },
  stock_receipt: {
    kind: 'unbuilt',
    sentence:
      'Moving shadow stock to live stock is a receiving step — it belongs against an invoice in Receiving.',
  },
  inequality: {
    kind: 'unbuilt',
    sentence: 'Reconciling a discrepancy from here is not built.',
  },
  vintage_sub: {
    kind: 'unbuilt',
    sentence: 'Substituting a vintage from here is not built.',
  },
  gmail_send: {
    kind: 'unbuilt',
    sentence:
      'Sending mail from here is not built, and a card is the wrong place to arm one: a letter cannot be recalled.',
  },
  gmail_contextual: {
    kind: 'unbuilt',
    sentence:
      'Sending mail from here is not built, and a card is the wrong place to arm one: a letter cannot be recalled.',
  },
};

/**
 * An unrecognised type is UNBUILT, never a record. Guessing that an act nobody
 * declared is harmless is how a stub becomes a silent success.
 */
export function dispositionOf(actionType: string | undefined | null): OneTapDisposition {
  const known = ONE_TAP_DISPOSITIONS[String(actionType ?? '').trim()];
  return (
    known ?? {
      kind: 'unbuilt',
      sentence: 'This house does not recognise that act, so nothing here can carry it out.',
    }
  );
}

/** Shown on a delivery card that names no order — real act, nothing to act on. */
export const DELIVERY_WITHOUT_ORDER =
  'This delivery card names no order, so there is nothing to book into stock.';
