/**
 * No rejection leaves the LEGACY orders page without a reason and a proven seal.
 *
 * =============================================================================
 * WHY THIS IS A SOURCE CONTRACT AND NOT A RENDER
 * =============================================================================
 * The sibling of `OrdersLegacySeal.test.ts`, for the same reason: the property
 * is about the WHOLE 3,600-line file — that no control anywhere in it can reach
 * `DELETE /procurement/orders/:id` on its own — and the honest way to assert a
 * statement about a whole file is to read the whole file. What the control it
 * now uses actually does is proven by render in
 * `components/orders/__tests__/SealedRejectDie.test.tsx`.
 *
 * =============================================================================
 * WHAT WAS TRUE BEFORE THIS PASS (measured 2026-09-05, ADR 0125)
 * =============================================================================
 * `handleReject` was `confirm('Are you sure you want to reject this order?')`
 * followed by `apiClient.delete('/procurement/orders/' + orderId)` — with NO
 * reason argument at all, so the one column that records why a house did not
 * buy a wine (`procurement_orders.rejection_reason`) was left null by the only
 * Reject control production shows. Three call sites fired it on a single click.
 * Beside it, Approve had redeemed a one-time seal since 2026-09-04.
 *
 * Every assertion below fails against `git show HEAD:` of this file, which is
 * how it was proven — run with
 * `ORDERS_SOURCE=<pre-fix copy> npx vitest run src/pages/__tests__/OrdersLegacyReject.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ORDERS_SOURCE =
  process.env.ORDERS_SOURCE ?? resolve(__dirname, '../Orders.tsx');

const orders = readFileSync(ORDERS_SOURCE, 'utf8');

/** Lines with the comment stripped, so prose about a route is not a call. */
const codeLines = (src: string) =>
  src
    .split('\n')
    .map((l) => l.replace(/^\s*(\/\/|\*|\/\*).*$/, ''))
    .join('\n');

const code = codeLines(orders);

describe('the legacy page cannot cancel without a seal', () => {
  it('sends no DELETE to the orders route of its own', () => {
    // `apiClient.delete(/procurement/orders/...)` in this file is a cancellation
    // that carries no seal and, as it stood, no reason either.
    expect(code).not.toMatch(/apiClient\.delete\([^)]*procurement\/orders/);
  });

  it('has no `confirm()` standing in for a held gesture', () => {
    // A browser confirm is a click with a second click after it. It proves
    // nothing about a person, records nothing, and cannot carry a seal. Two
    // used to guard a rejection: `handleReject`'s, and `handleBulkReject`'s
    // "Reject N pending order(s)?" — which guarded a handler that called no
    // endpoint at all.
    expect(code).not.toMatch(/\bconfirm\([^)]*[Rr]eject/);
  });

  it('makes no bulk rejection that writes nothing', () => {
    // `handleBulkReject` rewrote local state to `cancelled` and alerted
    // "N order(s) rejected" without calling any endpoint — the twin of the
    // bulk-approve defect ADR 0116's addendum removed. A page may not claim a
    // write it never makes (ADR 0020).
    expect(code).not.toMatch(/handleBulkReject/);
    expect(code).not.toMatch(/order\(s\) rejected/);
  });

  it('renders the one sealed reject control', () => {
    expect(orders).toMatch(/from '\.\.\/components\/orders\/SealedRejectDie'/);
    expect(code).toMatch(/<SealedRejectDie/);
  });
});

describe('every Reject control opens the ceremony rather than performing it', () => {
  it('routes all three call sites through one opener', () => {
    // Two inline row buttons and one context-menu item, measured 2026-09-05.
    const opens = code.match(/openRejectCeremony\(/g) ?? [];
    expect(opens).toHaveLength(3);
  });

  it('leaves no one-click reject handler behind', () => {
    expect(code).not.toMatch(/handleReject/);
  });

  it('names the wine in the ceremony, so the wrong row cannot be cancelled quietly', () => {
    expect(code).toMatch(/wineName/);
    expect(orders).toMatch(/Reject \{rejectOrder\.wineName\}/);
  });
});
