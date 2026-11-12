/**
 * A credit claim's reason and state in the house's words, shared by /receipts
 * (the ledger) and /receiving (the drafted-claim card). A module of its own so
 * a test that mocks the credits API still gets the real words.
 */
import type { CreditState } from './credits';

/** The reason codes (`procurement_credits_reason_check`) in the house's words. */
export const REASON_WORDS: Record<string, string> = {
  overbilled_vs_ship: 'Billed for more than their packing slip shipped',
  qty_short: 'Billed for more than arrived',
  short_shipped: 'Lost between their warehouse and the door',
  damaged: 'Refused at the door',
  price_variance: 'Billed above the agreed price',
  never_ordered: 'Billed for something never ordered',
  other: 'Another reason',
};

export function reasonWords(code: string | null | undefined): string {
  if (!code) return 'No reason recorded';
  return REASON_WORDS[code] ?? `Recorded as “${code}”`;
}

/** What each state means, said so it cannot be mistaken for a sent letter. */
export const STATE_WORDS: Record<CreditState, string> = {
  open: 'Opened — the vendor has not been asked',
  requested: 'Asked — the vendor has been asked for it',
  promised: 'Promised — the vendor said yes; not money yet',
  credited: 'Recovered — settled by a credit memo',
  rejected: 'Refused by the vendor',
  written_off: 'Written off',
};
