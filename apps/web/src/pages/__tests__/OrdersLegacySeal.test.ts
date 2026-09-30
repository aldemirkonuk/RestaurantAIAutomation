/**
 * The rebuilt orders sheet carries the approve/confirm/reject acts with a seal.
 *
 * [2026-09-28, ADR 0149 cutover: this file used to hold the legacy
 * `pages/Orders.tsx` to the seal as a source contract. That page was deleted
 * (CUTOVER-MANIFEST-2026-09-28.md, group `orders`), so only the half about the
 * live `ResponsesSheet.tsx` remains.]
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('the rebuilt page carries the three acts instead', () => {
  const sheet = readFileSync(
    process.env.RESPONSES_SHEET_SOURCE ??
      resolve(__dirname, '../orders/next/ResponsesSheet.tsx'),
    'utf8',
  );

  it('confirms through the same mint the ledger row uses', () => {
    expect(sheet).toMatch(/ordersApi\.mintOrderSeal\(row\.id\)/);
    expect(sheet).toMatch(/onChallenge=\{onChallenge\}/);
  });

  it('rejects through the route that actually exists, with the reason', () => {
    expect(sheet).toMatch(/useCancelOrder/);
    expect(sheet).toMatch(/reasonIsGiven\(reason\)/);
  });

  it('steps between answers on the arrow keys', () => {
    expect(sheet).toMatch(/ArrowRight/);
    expect(sheet).toMatch(/ArrowLeft/);
  });
});
