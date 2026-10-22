/**
 * W54 / F-158 (ADR 0267 option 8, founder: "Keep the door's reason"): a claim's
 * reason has ONE wording, on every page and in the vendor letter.
 *
 * The gateway owns it (`CREDIT_REASON_WORDING` in credit-ledger.ts — the
 * letter's sentence and the scorecard's label read from it). The web cannot
 * import gateway code at runtime, so it keeps a mirror (`REASON_WORDS`), and
 * this test is what keeps the mirror honest: a reason added, dropped or
 * reworded on one side only fails here.
 */
import { describe, expect, it } from 'vitest';
import { REASON_WORDS, reasonWords } from './ReceiptsCredits';
import {
  CREDIT_REASON_WORDING,
  creditReasonLabel,
  doorReason,
  draftClaimFromMatch,
} from '../../../../../api-gateway/src/procurement/documents/credit-ledger';
import { computeMatch } from '../../../../../api-gateway/src/procurement/invoice-match';

describe('one wording for a claim reason, web and gateway', () => {
  it('the web mirror says exactly what the gateway says, reason for reason', () => {
    const gateway = Object.fromEntries(
      Object.entries(CREDIT_REASON_WORDING).map(([code, w]) => [code, w.label]),
    );
    expect(REASON_WORDS).toEqual(gateway);
  });

  it('every reason the door can give has its own words, none of them "damaged"', () => {
    for (const code of ['wrong_item', 'broken', 'temperature'] as const) {
      expect(reasonWords(code)).toBe(CREDIT_REASON_WORDING[code].label);
      expect(reasonWords(code)).not.toBe(reasonWords('damaged'));
    }
    expect(reasonWords('wrong_item')).not.toBe(reasonWords('broken'));
  });

  it('an old damaged row still reads, and says only what it knows', () => {
    expect(reasonWords('damaged')).toBe('Refused or broken at the door');
    expect(creditReasonLabel('damaged')).toBe(reasonWords('damaged'));
  });

  it('an unknown code is shown the same way on both sides', () => {
    expect(reasonWords('made_up')).toBe(creditReasonLabel('made_up'));
    expect(reasonWords(null)).toBe(creditReasonLabel(null));
  });
});

describe('the door reason reaches the claim (the sim case, F-158)', () => {
  // 2 of 24 refused at the door, invoiced for 24 at 22: the verdict is `rejected`.
  const refusal = computeMatch({
    orderedQty: 24,
    poUnitPrice: 22,
    invoiceQty: 24,
    invoiceUnitPrice: 22,
    acceptedQty: 22,
    rejectedQty: 2,
  });

  it('a wrong-item refusal is claimed as a wrong item, and reads so', () => {
    expect(refusal.verdict).toBe('rejected');
    const reason = doorReason([
      { outcome: 'refused', refusal_reason: 'wrong_wine', rejected_qty_bottles: 2 },
    ]);
    const claim = draftClaimFromMatch(refusal, reason)!;
    expect(claim.reason).toBe('wrong_item');
    expect(reasonWords(claim.reason)).toBe('Wrong item, refused at the door');
  });

  it('a broken bottle on an accepted delivery is claimed as broken, not refused', () => {
    const reason = doorReason([
      { outcome: 'accepted', refusal_reason: null, rejected_qty_bottles: 1 },
    ]);
    const claim = draftClaimFromMatch(refusal, reason)!;
    expect(claim.reason).toBe('broken');
    expect(reasonWords(claim.reason)).not.toMatch(/refused/i);
  });
});
