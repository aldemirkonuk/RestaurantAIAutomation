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
import { existsSync, readFileSync } from 'node:fs';
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

describe('the unreachable legacy approval modal is gone', () => {
  /**
   * Deleted 2026-09-05 (p4af). It had been unreachable since `7012cc7a`
   * (2026-05-15) removed its last `setShowApprovalModal(true)`, and every act
   * it offered exists on the rebuilt page: the approval is
   * `pages/orders/next/LedgerRow.tsx` (HoldToApprove), and its "Final Price
   * per Bottle" field was read by nothing at all — the gateway's approve route
   * takes no body.
   */
  it('holds no open flag, no render and no dead price field', () => {
    expect(orders).not.toMatch(/showApprovalModal/);
    expect(orders).not.toMatch(/Final Price per Bottle/);
    expect(orders).not.toMatch(/This figure is not sent: approval writes no price\./);
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

describe('OrderApprovalModal is gone from the tree', () => {
  /**
   * Deleted 2026-09-05 (p4ak), on the founder's call: its three surviving acts
   * — reject with a reason, step through several vendor answers, read the
   * negotiation summary — are now `pages/orders/next/ResponsesSheet.tsx`, so
   * what remained was dead code holding a sealed ceremony nothing could open.
   *
   * Asserted as an ABSENCE OF THE FILE and of every reference to it, not just
   * of the import: a component nothing imports but that still compiles is one
   * `setShow…(true)` away from being live again, and that is exactly how both
   * of these modals survived four months of being unreachable.
   *
   * `sealTarget` is asserted too. Its only two setters were that modal's
   * Confirm handler, so it went with the modal rather than after it — an
   * overlay with no opener left behind is the same fault under a new name.
   */
  it('has no source file left', () => {
    expect(existsSync(resolve(__dirname, '../../components/orders/OrderApprovalModal.tsx'))).toBe(
      false,
    );
  });

  it('is imported, rendered and stated nowhere on the legacy page', () => {
    expect(codeLines(orders)).not.toMatch(/OrderApprovalModal/);
    expect(codeLines(orders)).not.toMatch(/showOrderApprovalModal/);
    expect(codeLines(orders)).not.toMatch(/orderApprovalData/);
    expect(codeLines(orders)).not.toMatch(/allProviderResponses/);
    expect(codeLines(orders)).not.toMatch(/currentApprovalIndex/);
    expect(codeLines(orders)).not.toMatch(/interface OrderApprovalData/);
  });

  it('took the click-to-seal hand-over overlay with it', () => {
    expect(codeLines(orders)).not.toMatch(/sealTarget/);
  });

  it('leaves the bulk bar ceremony untouched', () => {
    // The act the overlay carried lives here, and this must NOT have been
    // deleted along with its caller — an absence test that also deletes the
    // thing it protects proves nothing.
    expect(orders).toMatch(/<SealedApproveDie/);
    expect(orders).toMatch(/afterOrdersSealed/);
  });
});

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
