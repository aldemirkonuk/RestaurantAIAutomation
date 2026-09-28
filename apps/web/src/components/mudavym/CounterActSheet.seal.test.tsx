/**
 * The seal leaves /orders — and takes nothing weaker with it.
 *
 * The founder's answer to sketch 119's fork 3 (2026-09-21): a SEALED act may
 * be completed from the counter's sheet on ANY page, with the same
 * HoldToApprove ceremony and the same server seal as the owning page. So these
 * cases are the ones `SealedApproveDie.test.tsx` pins for the legacy Orders
 * page and the dashboard, asked again of the counter's sheet:
 *
 *   1. the seal is minted when the hold BEGINS, before anything is written;
 *   2. the approval carries that minted seal;
 *   3. a mint that fails approves nothing;
 *   4. a gateway refusal is printed and filed as the gateway said it;
 *   5. an order that is not this person's to seal offers no hold at all;
 *   6. a proposal is applied only by ITS seal — minted when the hold begins,
 *      carried into the apply, and never replaced by a click.
 *
 * What is mocked is the network under the ceremony (`mintOrderSeal`, the
 * approve mutation) — the same two seams the existing seal suites mock — never
 * the sheet or the die under test.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beginHold, completeHold } from '../../__tests__/utils/seal';

type ApproveInput = { orderId: string; challenge: string | null };
const approveMock = vi.hoisted(() => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn<(input: ApproveInput) => Promise<unknown>>(async () => ({})),
  isPending: false,
}));
type Mint = (orderId: string) => Promise<string | null>;
const mintMock = vi.hoisted(() => vi.fn<Mint>(async () => 'seal-token'));

vi.mock('@/services/api/orders', () => ({
  mintOrderSeal: (id: string) => mintMock(id),
}));
vi.mock('@/hooks/queries/useOrderQueries', () => ({
  useApproveOrder: () => approveMock,
}));

const proposalSeal = vi.hoisted(() => ({
  mint: vi.fn<(id: string) => Promise<string | null>>(async () => 'proposal-seal'),
  apply: vi.fn<(id: string, challenge: string) => Promise<unknown>>(async () => ({ executed: true })),
}));
vi.mock('../../services/api/askAi', () => ({
  mintProposalSeal: (id: string) => proposalSeal.mint(id),
  applyProposalSealed: (id: string, c: string) => proposalSeal.apply(id, c),
}));

import { CounterActSheet, type CounterActTarget } from './CounterActSheet';
import { getHouseSaid, resetHouseSaid } from '../../lib/mudavym/houseSaid';
import type { CounterRegisterAnswered, HouseCounterRead } from '../../lib/mudavym/counterRead';

const READ: HouseCounterRead = {
  readAt: '2026-09-21T14:02:11Z',
  house: { id: 'h-1', currency: { state: 'recorded', code: 'USD' } },
  role: 'owner',
  registers: [],
};

function orderTarget(act: 'yours' | 'not_yours' = 'yours'): CounterActTarget {
  const register: CounterRegisterAnswered = {
    key: 'orders',
    verb: 'seal',
    state: 'answered',
    readAt: READ.readAt,
    ms: 4,
    count: 1,
    complete: true,
    act,
    rows: [
      {
        id: 'o-1',
        orderNumber: 'ORD-2026-00042',
        vendor: 'Kermit Lynch',
        wine: 'Chablis Vaillons 2023',
        quantity: 12,
        unitType: 'bottle',
        total: 2000,
        status: 'APPROVAL_NEEDED',
        requestedAt: '2026-09-21T09:10:00Z',
      },
    ],
  };
  return { register, row: register.rows[0] };
}

function mount(target: CounterActTarget, onChanged = vi.fn()) {
  render(
    <MemoryRouter>
      <CounterActSheet target={target} read={READ} onClose={vi.fn()} onChanged={onChanged} />
    </MemoryRouter>,
  );
  return { onChanged };
}

const die = () => screen.getByRole('button', { name: /hold to seal/i });

beforeEach(() => {
  resetHouseSaid();
  approveMock.mutateAsync.mockReset();
  approveMock.mutateAsync.mockResolvedValue({});
  mintMock.mockReset();
  mintMock.mockResolvedValue('seal-token');
});

describe('sealing from the counter, on any page', () => {
  it('mints the seal when the hold begins, before anything is written', async () => {
    mount(orderTarget());
    beginHold(die());
    await waitFor(() => expect(mintMock).toHaveBeenCalledWith('o-1'));
    expect(approveMock.mutateAsync).not.toHaveBeenCalled();
  });

  it('approves with the minted seal, files it in The house said, and asks the counter to read again', async () => {
    const { onChanged } = mount(orderTarget());
    completeHold(die());
    await waitFor(() =>
      expect(approveMock.mutateAsync).toHaveBeenCalledWith({ orderId: 'o-1', challenge: 'seal-token' }),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(getHouseSaid()[0]).toMatchObject({ kind: 'sealed', text: 'Order to Kermit Lynch sealed' });
    expect(mintMock).toHaveBeenCalledTimes(1);
  });

  it('approves NOTHING when the seal could not be minted', async () => {
    mintMock.mockResolvedValue(null);
    mount(orderTarget());
    completeHold(die());
    await waitFor(() => expect(mintMock).toHaveBeenCalled());
    // Give the ceremony every chance to (wrongly) proceed.
    await new Promise((r) => setTimeout(r, 20));
    expect(approveMock.mutateAsync).not.toHaveBeenCalled();
    expect(getHouseSaid().some((e) => e.kind === 'sealed')).toBe(false);
  });

  it("files a refusal in the gateway's own words", async () => {
    const refusal = Object.assign(
      new Error('Over the 5,000 ceiling this house set for a manager — an owner has to sign this one.'),
      { response: { status: 403 } },
    );
    approveMock.mutateAsync.mockRejectedValue(refusal);
    mount(orderTarget());
    completeHold(die());
    await waitFor(() => expect(getHouseSaid()[0]?.kind).toBe('refused'));
    expect(getHouseSaid()[0].sub).toBe(refusal.message);
    expect(screen.getByRole('alert').textContent).toContain(refusal.message);
  });

  it('offers no hold on an order that waits on an owner or a manager', () => {
    mount(orderTarget('not_yours'));
    expect(screen.queryByRole('button', { name: /hold to seal/i })).toBeNull();
    expect(screen.getByText(/waits on an owner or a manager/i)).toBeTruthy();
  });
});

function proposalTarget(act: 'yours' | 'not_yours' = 'yours'): CounterActTarget {
  const register: CounterRegisterAnswered = {
    key: 'proposals',
    verb: 'proposed',
    state: 'answered',
    readAt: READ.readAt,
    ms: 3,
    count: 1,
    complete: true,
    act,
    rows: [
      {
        id: 'p-1',
        summary: 'Order 2 cases of Chablis from Kermit Lynch',
        family: 'procurement',
        actionType: 'reorder',
        utterance: 'reorder chablis',
        createdAt: READ.readAt,
      },
    ],
  };
  return { register, row: register.rows[0] };
}

describe('a proposal is applied only by the seal', () => {
  beforeEach(() => {
    proposalSeal.mint.mockReset();
    proposalSeal.mint.mockResolvedValue('proposal-seal');
    proposalSeal.apply.mockReset();
    proposalSeal.apply.mockResolvedValue({ executed: true });
  });

  const hold = () => screen.getByRole('button', { name: /hold to apply this proposal/i });

  it('mints the proposal seal when the hold begins, before anything is applied', async () => {
    mount(proposalTarget());
    beginHold(hold());
    await waitFor(() => expect(proposalSeal.mint).toHaveBeenCalledWith('p-1'));
    expect(proposalSeal.apply).not.toHaveBeenCalled();
  });

  it('applies with the minted seal and files it', async () => {
    const { onChanged } = mount(proposalTarget());
    completeHold(hold());
    await waitFor(() => expect(proposalSeal.apply).toHaveBeenCalledWith('p-1', 'proposal-seal'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(getHouseSaid()[0]).toMatchObject({ kind: 'sealed', text: 'Proposal applied' });
  });

  it('applies NOTHING when the seal could not be minted, and says why', async () => {
    proposalSeal.mint.mockRejectedValue(new Error('Only an owner or a manager may apply a proposal.'));
    mount(proposalTarget());
    completeHold(hold());
    await waitFor(() => expect(proposalSeal.mint).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(proposalSeal.apply).not.toHaveBeenCalled();
    expect(getHouseSaid()[0]).toMatchObject({ kind: 'refused', sub: 'Only an owner or a manager may apply a proposal.' });
  });

  it('offers no hold to a person the proposal does not wait on', () => {
    mount(proposalTarget('not_yours'));
    expect(screen.queryByRole('button', { name: /hold to apply/i })).toBeNull();
    expect(screen.getByText(/applied only by their seal/i)).toBeTruthy();
  });

  it('offers no click-to-apply control from the counter', () => {
    const register: CounterRegisterAnswered = {
      key: 'proposals',
      verb: 'proposed',
      state: 'answered',
      readAt: READ.readAt,
      ms: 3,
      count: 1,
      complete: true,
      act: 'yours',
      rows: [
        {
          id: 'p-1',
          summary: 'Order 2 cases of Chablis from Kermit Lynch',
          family: 'procurement',
          actionType: 'reorder',
          utterance: 'reorder chablis',
          createdAt: READ.readAt,
        },
      ],
    };
    mount({ register, row: register.rows[0] });
    // The only control that can apply it is the hold; nothing clicks it in.
    expect(screen.queryByRole('button', { name: /^(confirm|apply)$/i })).toBeNull();
    expect(screen.getAllByRole('button', { name: /hold to apply this proposal/i })).toHaveLength(1);
    expect(screen.getByText(/applied only by the seal/i)).toBeTruthy();
  });
});
