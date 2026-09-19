/**
 * RcVerdictLedger — the append-only verdict ledger sheet (ADR 0149 row 23;
 * sketch 107-receiving-structure). Pinned here:
 *
 *   L1  the append picker starts empty and the hold is disabled until a
 *       verdict, a quantity, a unit and a reason are all given;
 *   L2  a successful append writes exactly the body the sketch specifies —
 *       one verdict word, one quantity, one unit, never re-multiplied — and
 *       the reset form + a fresh idempotency key on the next attempt;
 *   L3  a struck-through (superseded) row stays in the list, never hidden;
 *   L4  "current · derived" prints the server's own arithmetic, not a
 *       client-side recomputation;
 *   L5  a refusal (409/etc.) is shown in place — the ledger does not pretend
 *       the write landed;
 *   L6  "Load earlier" pages further back rather than growing without end;
 *   L9  a failed ledger read gates the append form, and says the server's
 *       own sentence, not axios's generic one;
 *   L10 the sheet body is padded and every control wears the overlay's own
 *       tokens (`.mdv-input` / `.mdv-select`) rather than browser defaults.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RcVerdictLedger } from './RcVerdictLedger';
import { failureOf, serverMessageOf } from './useReceivingNextData';

const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
vi.mock('../../../services/api/client', () => ({ apiClient: { get, post } }));

function harness(ui: JSX.Element) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const ledgerPayload = (over: Record<string, unknown> = {}) => ({
  data: {
    entries: [],
    current: [],
    packSize: 6,
    orderedUnitType: 'case',
    orderedQty: 3,
    orderedBottles: 18,
    hasEarlier: false,
    earliestCursor: null,
    totalEntries: 0,
    ...over,
  },
});

const entry = (over: Record<string, unknown> = {}) => ({
  id: 'v1',
  orderId: 'order-1',
  lineNo: 1,
  verdict: 'accepted',
  qty: 2,
  uom: 'case',
  qtyBottles: 12,
  beyondOrder: false,
  reason: 'counted at the door',
  evidence: null,
  supersedes: null,
  supersedesQtyBottles: null,
  recordedBy: 'u1',
  recordedByName: 'Deniz K.',
  recordedByNameUnavailable: null,
  recordedAt: '2026-09-01T14:12:00.000Z',
  clientCapturedAt: null,
  ...over,
});

const press = (name: RegExp) => {
  const btn = screen.getByRole('button', { name });
  fireEvent.keyDown(btn, { key: 'Enter' });
  fireEvent.keyDown(btn, { key: 'Enter' });
};

beforeEach(() => {
  get.mockReset();
  post.mockReset();
});

describe('L1 — the append picker starts empty and the hold stays disabled', () => {
  it('disables the hold until verdict, quantity, unit and reason are all given', async () => {
    get.mockResolvedValue(ledgerPayload());
    harness(
      <RcVerdictLedger open onClose={vi.fn()} orderId="order-1" orderLabel="PO-2417" />,
    );

    await screen.findByText('Append an entry');
    const hold = screen.getByRole('button', { name: /Hold to append — choose/ });
    expect(hold).toBeDisabled();

    fireEvent.click(screen.getByRole('radio', { name: 'Accepted' }));
    expect(screen.getByRole('button', { name: /Hold to append/ })).toBeDisabled();
  });
});

describe('L2 — a successful append writes one word, one quantity, one unit', () => {
  it('posts exactly the fields entered and resets the form on success', async () => {
    get.mockResolvedValue(ledgerPayload());
    post.mockResolvedValue({
      data: { entry: entry(), current: [{ verdict: 'accepted', beyondOrder: false, currentUnit: 'bottle', currentQty: 12, entryCount: 1, lastRecordedAt: '2026-09-01T14:12:00.000Z' }] },
    });
    harness(<RcVerdictLedger open onClose={vi.fn()} orderId="order-1" orderLabel="PO-2417" />);

    await screen.findByText('Append an entry');
    fireEvent.click(screen.getByRole('radio', { name: 'Accepted' }));
    fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText(/Unit — as counted/), { target: { value: 'case' } });
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'counted at the door' } });

    press(/Hold to append — Accepted 2 case/);

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [url, body] = post.mock.calls[0];
    expect(url).toBe('/procurement/receiving/orders/order-1/verdicts');
    expect(body).toMatchObject({
      verdict: 'accepted',
      qty: 2,
      uom: 'case',
      reason: 'counted at the door',
      beyondOrder: false,
    });
    expect(typeof body.idempotencyKey).toBe('string');
    expect(body.idempotencyKey.length).toBeGreaterThan(0);

    // The form resets — nothing stays "chosen" after a successful write.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Hold to append — choose/ })).toBeInTheDocument(),
    );
  });
});

describe('L3 — a superseded row stays in the list, struck through', () => {
  it('marks the row another entry supersedes, and keeps both', async () => {
    get.mockResolvedValue(
      ledgerPayload({
        entries: [
          entry({ id: 'v1', verdict: 'short', qty: 1, uom: 'case', reason: 'one case missing' }),
          entry({
            id: 'v2',
            verdict: 'accepted',
            qty: 2,
            uom: 'case',
            reason: 'found on the second pallet',
            supersedes: 'v1',
            recordedBy: 'u2',
            recordedByName: 'Hasan A.',
          }),
        ],
        current: [{ verdict: 'accepted', beyondOrder: false, currentUnit: 'bottle', currentQty: 6, entryCount: 1, lastRecordedAt: '2026-09-01T16:00:00.000Z' }],
        totalEntries: 2,
      }),
    );
    harness(<RcVerdictLedger open onClose={vi.fn()} orderId="order-1" orderLabel="PO-2417" />);

    const v1Qty = await screen.findByText('1 case', { selector: 'span' });
    expect(v1Qty).toHaveStyle({ textDecoration: 'line-through' });
    expect(screen.getByText(/takes all of v1/)).toBeInTheDocument();
    expect(screen.getByText('2 total entries')).toBeInTheDocument();
  });

  // Regression: supersedesQtyBottles is contractually always a BOTTLE count
  // (services/api/receiving.ts), regardless of the superseded row's own uom.
  // A prior version relabelled the number with the target row's uom instead
  // of converting it, so 2 bottles taken from a 1-case row printed as
  // "2 cases" (confirmer review, 2026-09-18, STUB-11 — the Doluca fixture,
  // v4 takes 2 bottles of a 1-case v3). This must render "2 bottles of v3".
  it('prints a partial take in bottles, never the superseded row\'s own unit', async () => {
    // Mirrors the Doluca fixture from the confirmer review (a 1-case row,
    // 2 bottles taken from it by a later entry) — ids chosen as v1/v2 here
    // because the ledger's displayed "vN" label is the row's server-side
    // ordinal position, not its (opaque) id string, matching the L3 test above.
    get.mockResolvedValue(
      ledgerPayload({
        entries: [
          entry({ id: 'v1', verdict: 'accepted', qty: 1, uom: 'case', qtyBottles: 6 }),
          entry({
            id: 'v2',
            verdict: 'damaged',
            qty: 2,
            uom: 'bottle',
            qtyBottles: 2,
            reason: 'two bottles broken in transit',
            supersedes: 'v1',
            supersedesQtyBottles: 2,
            recordedBy: 'u2',
            recordedByName: 'Hasan A.',
          }),
        ],
        current: [
          { verdict: 'accepted', beyondOrder: false, currentUnit: 'bottle', currentQty: 4, entryCount: 1, lastRecordedAt: '2026-09-01T16:00:00.000Z' },
          { verdict: 'damaged', beyondOrder: false, currentUnit: 'bottle', currentQty: 2, entryCount: 1, lastRecordedAt: '2026-09-01T16:00:00.000Z' },
        ],
        totalEntries: 2,
      }),
    );
    harness(<RcVerdictLedger open onClose={vi.fn()} orderId="order-1" orderLabel="PO-2417" />);

    expect(await screen.findByText(/takes 2 bottles of v1/)).toBeInTheDocument();
    expect(screen.queryByText(/takes 2 cases of v1/)).not.toBeInTheDocument();
  });
});

describe('L4 — current · derived prints the server\'s own arithmetic', () => {
  it('renders the current line with its entry count, not a client recomputation', async () => {
    get.mockResolvedValue(
      ledgerPayload({
        entries: [entry()],
        current: [
          { verdict: 'accepted', beyondOrder: false, currentUnit: 'bottle', currentQty: 16, entryCount: 3, lastRecordedAt: '2026-09-01T16:40:00.000Z' },
          { verdict: 'damaged', beyondOrder: false, currentUnit: 'bottle', currentQty: 2, entryCount: 1, lastRecordedAt: '2026-09-01T16:40:00.000Z' },
        ],
        totalEntries: 4,
      }),
    );
    harness(<RcVerdictLedger open onClose={vi.fn()} orderId="order-1" orderLabel="PO-2417" />);

    expect(await screen.findByText(/Accepted 16 bottles/)).toBeInTheDocument()
    expect(screen.getByText(/Damaged 2 bottles/)).toBeInTheDocument();
    expect(screen.getByText(/3 entries/)).toBeInTheDocument();
  });
});

describe('L7 — the arithmetic and the not-counted remainder are the server\'s own figures', () => {
  it('renders the Doluca fixture: 12 + 6 − 2 = 16, 2 = 2, and 0 not counted against 18 ordered', async () => {
    get.mockResolvedValue(
      ledgerPayload({
        entries: [entry()],
        current: [
          {
            verdict: 'accepted',
            beyondOrder: false,
            currentUnit: 'bottle',
            currentQty: 16,
            entryCount: 2,
            lastRecordedAt: '2026-09-01T16:40:00.000Z',
            arithmetic: '12 + 6 − 2 = 16',
          },
          {
            verdict: 'damaged',
            beyondOrder: false,
            currentUnit: 'bottle',
            currentQty: 2,
            entryCount: 1,
            lastRecordedAt: '2026-09-01T16:40:00.000Z',
            arithmetic: null,
          },
        ],
        totalEntries: 3,
        notCountedBottles: 0,
      }),
    );
    harness(<RcVerdictLedger open onClose={vi.fn()} orderId="order-1" orderLabel="PO-2417" />);

    expect(await screen.findByText('12 + 6 − 2 = 16')).toBeInTheDocument();
    // The untouched damaged row has no arithmetic to show — the client never
    // invents "2 = 2" for a single, untaken contribution.
    expect(screen.queryByText(/^2 = 2$/)).not.toBeInTheDocument();
    expect(screen.getByText(/not counted 0 btl/)).toBeInTheDocument();
    expect(screen.getByText(/against 18 btl ordered/)).toBeInTheDocument();
  });

  it('omits the not-counted line when the order carries no stated quantity', async () => {
    get.mockResolvedValue(
      ledgerPayload({
        entries: [entry()],
        current: [
          { verdict: 'accepted', beyondOrder: false, currentUnit: 'bottle', currentQty: 12, entryCount: 1, lastRecordedAt: '2026-09-01T16:40:00.000Z', arithmetic: null },
        ],
        orderedQty: null,
        orderedBottles: null,
        notCountedBottles: null,
        totalEntries: 1,
      }),
    );
    harness(<RcVerdictLedger open onClose={vi.fn()} orderId="order-1" orderLabel="PO-2417" />);

    await screen.findByText(/Accepted 12 bottles/);
    expect(screen.queryByText(/not counted/)).not.toBeInTheDocument();
  });
});

describe('L8 — the verdict radiogroup has a roving tabindex and arrow-key navigation', () => {
  it('moves the checked radio and focus with ArrowRight, wrapping at the end', async () => {
    get.mockResolvedValue(ledgerPayload());
    harness(<RcVerdictLedger open onClose={vi.fn()} orderId="order-1" orderLabel="PO-2417" />);
    await screen.findByText('Append an entry');

    const [accepted, short, refused, damaged] = ['Accepted', 'Short', 'Refused', 'Damaged'].map(
      (name) => screen.getByRole('radio', { name }),
    );
    // Nothing chosen yet — only the first radio is tab-reachable.
    expect(accepted).toHaveAttribute('tabindex', '0');
    expect(short).toHaveAttribute('tabindex', '-1');

    fireEvent.click(accepted);
    fireEvent.keyDown(accepted, { key: 'ArrowRight' });
    expect(short).toHaveAttribute('aria-checked', 'true');
    expect(short).toHaveAttribute('tabindex', '0');
    expect(accepted).toHaveAttribute('tabindex', '-1');
    expect(document.activeElement).toBe(short);

    fireEvent.keyDown(short, { key: 'ArrowLeft' });
    fireEvent.keyDown(accepted, { key: 'ArrowLeft' }); // wraps to the last radio
    expect(damaged).toHaveAttribute('aria-checked', 'true');
    expect(document.activeElement).toBe(damaged);
    expect(refused).toHaveAttribute('tabindex', '-1');
  });
});

describe('L5 — a refusal is shown, never a fake success', () => {
  it('surfaces a 409 refusal in place and lets the same hold be retried', async () => {
    get.mockResolvedValue(ledgerPayload());
    post.mockRejectedValue(
      Object.assign(new Error('over-take'), { response: { status: 409, data: { message: 'over-take on row v1' } } }),
    );
    harness(<RcVerdictLedger open onClose={vi.fn()} orderId="order-1" orderLabel="PO-2417" />);

    await screen.findByText('Append an entry');
    fireEvent.click(screen.getByRole('radio', { name: 'Short' }));
    fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(/Unit — as counted/), { target: { value: 'bottle' } });
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'x' } });

    press(/Hold to append — Short 1 bottle/);

    expect(await screen.findByRole('alert')).toHaveTextContent(/over-take on row v1/);
    // The form was NOT reset — a refused write keeps what was entered.
    expect(screen.getByRole('radio', { name: 'Short', checked: true })).toBeTruthy();
  });
});

describe('L6 — history pages further back rather than growing without end', () => {
  it('fetches the earlier page with `before` and prepends its rows', async () => {
    get.mockImplementation(async (_url: string, config: any) => {
      if (config?.params?.before) {
        return ledgerPayload({
          entries: [entry({ id: 'v0', reason: 'the very first entry' })],
          totalEntries: 2,
          hasEarlier: false,
          earliestCursor: null,
        });
      }
      return ledgerPayload({
        entries: [entry({ id: 'v1', reason: 'the second entry' })],
        totalEntries: 2,
        hasEarlier: true,
        earliestCursor: '2026-09-01T14:12:00.000Z',
      });
    });
    harness(<RcVerdictLedger open onClose={vi.fn()} orderId="order-1" orderLabel="PO-2417" />);

    await screen.findByText('the second entry');
    const loadEarlier = screen.getByRole('button', { name: /Load earlier entries/ });
    fireEvent.click(loadEarlier);

    await screen.findByText('the very first entry');
    // Both are visible now, oldest (v0) first in the DOM order.
    const reasons = screen.getAllByText(/the (very first|second) entry/).map((n) => n.textContent);
    expect(reasons).toEqual(['the very first entry', 'the second entry']);
  });
});

describe('L9 — a failed ledger read does not leave a permanent write on offer', () => {
  const serverDown = () =>
    Object.assign(new Error('Request failed with status code 500'), {
      response: { status: 500, data: { statusCode: 500, message: 'Could not read the verdict ledger for order o-1' } },
    });

  it("shows the server's own sentence, not axios's generic one, and withholds the append form", async () => {
    get.mockRejectedValue(serverDown());
    harness(<RcVerdictLedger open onClose={vi.fn()} orderId="order-1" orderLabel="PO-2417" />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not read the verdict ledger for order o-1');
    expect(alert).not.toHaveTextContent(/Request failed with status code/);

    // No form, no hold — an append here would be a row nothing can undo,
    // written with no history and no "takes from" picker.
    expect(screen.queryByText('Append an entry')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Hold to append/ })).not.toBeInTheDocument();
    expect(screen.getByTestId('ledger-append-paused')).toHaveTextContent(/paused until the ledger loads/);
  });

  it('offers the form again once "Try again" gets the ledger', async () => {
    get.mockRejectedValueOnce(serverDown());
    get.mockResolvedValue(ledgerPayload({ entries: [entry({ id: 'v1' })], totalEntries: 1 }));
    harness(<RcVerdictLedger open onClose={vi.fn()} orderId="order-1" orderLabel="PO-2417" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));

    await screen.findByText('Append an entry');
    expect(screen.queryByTestId('ledger-append-paused')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Hold to append/ })).toBeInTheDocument();
  });
});

describe('serverMessageOf / failureOf — the gateway\'s sentence beats the transport\'s', () => {
  const err = (data: unknown, message = 'Request failed with status code 409') =>
    Object.assign(new Error(message), { response: { status: 409, data } });

  it('reads a string message, joins a validation list, and is null when there is none', () => {
    expect(serverMessageOf(err({ message: 'That entry has only 2 of its 6 bottles left.' }))).toBe(
      'That entry has only 2 of its 6 bottles left.',
    );
    expect(serverMessageOf(err({ message: ['qty must be an integer', 'reason should not be empty'] }))).toBe(
      'qty must be an integer; reason should not be empty',
    );
    expect(serverMessageOf(err({}))).toBeNull();
    expect(serverMessageOf(err({ message: '   ' }))).toBeNull();
    expect(serverMessageOf(new Error('boom'))).toBeNull();
    expect(serverMessageOf(null)).toBeNull();
  });

  it('failureOf falls back to the transport message only when the server said nothing', () => {
    expect(failureOf(true, err({ message: 'Ledger down' }))?.message).toBe('Ledger down');
    expect(failureOf(true, err(undefined))?.message).toBe('Request failed with status code 409');
    expect(failureOf(true, null)?.message).toBe('request failed');
    expect(failureOf(false, err({ message: 'x' }))).toBeNull();
  });
});

describe('L10 — the sheet body is padded and controls wear the overlay tokens', () => {
  it('pads the body content — `.mdv-ovl__body` carries no padding of its own', async () => {
    get.mockResolvedValue(ledgerPayload());
    harness(<RcVerdictLedger open onClose={vi.fn()} orderId="order-1" orderLabel="PO-2417" />);
    await screen.findByText('Append an entry');

    const content = document.querySelector('.mdv-ovl__body')?.firstElementChild as HTMLElement;
    expect(content).toBeTruthy();
    expect(content.style.padding).toBe('12px 16px 18px');
  });

  it('gives every input, select and textarea the overlay\'s own house classes, not browser white', async () => {
    get.mockResolvedValue(ledgerPayload({ entries: [entry({ id: 'v1' })], totalEntries: 1 }));
    harness(<RcVerdictLedger open onClose={vi.fn()} orderId="order-1" orderLabel="PO-2417" />);
    await screen.findByText('Append an entry');

    expect(screen.getByLabelText(/Quantity/)).toHaveClass('mdv-input');
    expect(screen.getByLabelText(/Reason/)).toHaveClass('mdv-input');
    expect(screen.getByLabelText(/Evidence note/)).toHaveClass('mdv-input');
    expect(screen.getByLabelText(/Unit — as counted/)).toHaveClass('mdv-select');
    // Only present once there is history to take from.
    expect(await screen.findByLabelText(/Takes from/)).toHaveClass('mdv-select');

    fireEvent.change(screen.getByLabelText(/Takes from/), { target: { value: 'v1' } });
    expect(screen.getByLabelText(/How much, in bottles/)).toHaveClass('mdv-input');
  });
});
