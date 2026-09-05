/**
 * No approval leaves the LEGACY orders page without a proven seal.
 *
 * =============================================================================
 * WHY THIS IS A SOURCE CONTRACT AND NOT A RENDER
 * =============================================================================
 * `pages/Orders.tsx` is 3,600 lines behind six contexts, and the property that
 * matters is not what one control renders — it is that NO control anywhere in
 * the file can reach `POST /procurement/orders/:id/approve` on its own. That is
 * a statement about the whole file, and the honest way to assert it is to read
 * the whole file. The behaviour of the control it now uses is proven by render
 * in `components/orders/__tests__/SealedApproveDie.test.tsx` (13 cases).
 *
 * =============================================================================
 * WHAT WAS TRUE BEFORE THIS PASS (measured 2026-09-04)
 * =============================================================================
 * - `handleBulkApprove` was the ONLY REACHABLE approve control on the page —
 *   nothing in the repo set `showApprovalModal` or `showOrderApprovalModal` to
 *   true, and the row-level "Approve" buttons open the comms drawer. It called
 *   NO endpoint: it rewrote local state to `approved` and alerted "N order(s)
 *   approved!". An absence reported as health, pointed at money.
 * - Cmd/Ctrl+Shift+A ran that same handler, so one keystroke "approved" every
 *   selected order.
 * - The two unreachable modals posted `/approve` through `apiClient` with a
 *   `finalPrice` body the gateway's route does not read at all.
 *
 * Every assertion below fails against `git show HEAD:` of this file, which is
 * how it was proven.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Overridable so the same suite can be run against a pre-fix copy
 * (`git show HEAD:apps/web/src/pages/Orders.tsx > /tmp/x.tsx`) without any git
 * state change in the worktree.
 */
const ORDERS_SOURCE =
  process.env.ORDERS_SOURCE ?? resolve(__dirname, '../Orders.tsx');
const ORDERS_DATA_SOURCE =
  process.env.ORDERS_DATA_SOURCE ?? resolve(__dirname, '../../hooks/useOrdersData.ts');

const orders = readFileSync(ORDERS_SOURCE, 'utf8');
const ordersData = readFileSync(ORDERS_DATA_SOURCE, 'utf8');

/** Lines with the comment stripped, so prose about `/approve` is not a call. */
const codeLines = (src: string) =>
  src
    .split('\n')
    .map((l) => l.replace(/^\s*(\/\/|\*|\/\*).*$/, ''))
    .join('\n');

describe('the legacy page cannot approve without a seal', () => {
  it('posts to no approve route of its own', () => {
    // `apiClient.post(.../approve...)` in this file is an approval that carries
    // no `X-Seal-Challenge` header — the exact call the addendum removed.
    expect(codeLines(orders)).not.toMatch(/apiClient\.post\([^)]*\/approve/);
  });

  it('does not call approveOrder directly either', () => {
    expect(codeLines(orders)).not.toMatch(/ordersApi\.approveOrder|approveOrder\(/);
  });

  it('renders the house ceremony instead', () => {
    expect(orders).toMatch(/import \{ SealedApproveDie \}/);
    expect(orders).toMatch(/<SealedApproveDie/);
  });
});

describe('the bulk approve tells the truth about what it sent', () => {
  it('no longer holds a handler that rewrites status without calling anything', () => {
    expect(codeLines(orders)).not.toMatch(/const handleBulkApprove\s*=/);
  });

  it('claims no approval in an alert', () => {
    // `alert('N order(s) approved!')` over a call that was never made is the
    // single worst line this pass removed.
    expect(codeLines(orders)).not.toMatch(/alert\([^)]*order\(s\) approved/);
    expect(codeLines(orders)).not.toMatch(/alert\('Order approved successfully/);
  });

  it('seals only the selected orders that are still pending and have a server id', () => {
    expect(orders).toMatch(/bulkApprovableIds/);
    expect(orders).toMatch(/status === 'pending_approval'/);
    expect(orders).toMatch(/\.filter\(id => isUuid\(id\)\)/);
  });
});

describe('the keyboard shortcut', () => {
  it('moves focus to the hold rather than approving', () => {
    const shortcut = orders.slice(
      orders.indexOf("e.shiftKey && e.key.toLowerCase() === 'a'"),
    );
    expect(shortcut.slice(0, 400)).toMatch(/bulkDieRef\.current\?\.querySelector\('button'\)\?\.focus\(\)/);
    expect(shortcut.slice(0, 400)).not.toMatch(/handleBulkApprove\(\)/);
  });
});

describe('the price field that was read by nothing', () => {
  it('is disabled and says the approval writes no price', () => {
    expect(orders).toMatch(/This figure is not sent: approval writes no price\./);
  });
});

describe('useOrdersData carries the seal', () => {
  it('takes a challenge and passes it to the mutation', () => {
    expect(ordersData).toMatch(/approveOrder: \(orderId: string, challenge\?: string \| null\)/);
    expect(ordersData).toMatch(/mutateAsync\(\{ orderId, challenge: challenge \?\? null \}\)/);
  });

  it('exposes the mint, so a caller has the whole path from one hook', () => {
    expect(ordersData).toMatch(/mintOrderSeal/);
  });
});
