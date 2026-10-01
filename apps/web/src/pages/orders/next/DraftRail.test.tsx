/**
 * The drafted-order rail on /orders says "send or ask" before the hold
 * (founder, 2026-09-21: "Staff ask, manager sends").
 *
 * The gateway rule is proved in procurement/staff-ask-manager-sends.spec.ts;
 * what is proved here is the rail's half: a staff member's hold records a
 * request over the draft's words and never mints a seal, a manager's hold
 * mints and sends, a waiting request is named on the card, and a standing
 * that could not be read leaves the hold disabled.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const seams = vi.hoisted(() => ({
  standing: null as unknown,
  standingFailed: false,
  requestDraftSend: vi.fn(),
  issueDraftSendChallenge: vi.fn(),
  approveMutateAsync: vi.fn(),
  editMutate: vi.fn(),
  drafts: [] as unknown[],
}));

vi.mock('@/hooks/queries/useDraftEmailQueries', () => ({
  activeConversationKeys: { all: ['conversations', 'active'] },
  draftKeys: { all: ['drafts'] },
  useActiveConversations: () => ({ data: seams.drafts }),
  useApproveDraft: () => ({ mutateAsync: seams.approveMutateAsync, isPending: false }),
  issueDraftSendChallenge: (...a: unknown[]) => seams.issueDraftSendChallenge(...a),
  requestDraftSend: (...a: unknown[]) => seams.requestDraftSend(...a),
  useCancelScheduledSend: () => ({ mutate: vi.fn(), isPending: false }),
  useDiscardDraft: () => ({ mutate: vi.fn(), isPending: false }),
  useEditDraft: () => ({ mutate: seams.editMutate, isPending: false }),
  useOrderConversations: () => ({ data: [], isError: false }),
  useDraftStanding: () =>
    seams.standingFailed
      ? { data: undefined, isPending: false, isError: true, error: new Error('network down') }
      : { data: { draft: null, sendOrAsk: seams.standing }, isPending: false, isError: false },
}));

// jsdom has no Element.animate; the rail's reveal is skipped under reduced
// motion, which is also what a person with that preference gets.
vi.mock('@/lib/mudavym/motion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mudavym/motion')>()),
  useReducedMotion: () => true,
}));

import { DraftRail } from './DraftRail';

const DRAFT = {
  id: 'conv-1',
  orderId: 'ord-1',
  providerId: 'p-1',
  emailType: 'COUNTER_OFFER',
  roundCount: 2,
  createdAt: '2026-09-21T09:00:00.000Z',
  constraintFlags: null,
  draftContent: 'Six cases at 2,400, delivered Tuesday.',
  orderNumber: 'PO-1',
  quantity: 6,
  quotedPrice: 400,
  wineName: 'Öküzgözü 2022',
  providerName: 'Kavaklıdere',
  providerEmail: 'hasan@kavaklidere.example',
  subject: 'RE: cases',
  sendRequest: null as unknown,
};

const AS_MANAGER = { readable: true, maySend: true, mode: 'send', basis: 'manager', grant: null, sentence: null };
const AS_STAFF = {
  readable: true,
  maySend: false,
  mode: 'ask',
  basis: null,
  grant: null,
  sentence: 'Your hold will ask a manager to send it; your version is kept exactly as you wrote it.',
};

function draw() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <DraftRail />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: /Öküzgözü 2022/ }));
}

function holdIt(name: RegExp) {
  const die = screen.getByRole('button', { name });
  fireEvent.keyDown(die, { key: 'Enter' });
  fireEvent.keyDown(die, { key: 'Enter' });
}

beforeEach(() => {
  vi.clearAllMocks();
  seams.drafts = [DRAFT];
  seams.standing = AS_MANAGER;
  seams.standingFailed = false;
});

describe('the rail heading, for every role (ORD-W16)', () => {
  it('never tells the reader it waits on THEIR approval — staff cannot give it', () => {
    seams.standing = AS_STAFF;
    draw();
    const rail = screen.getByRole('region', { name: 'Drafted orders awaiting approval' });
    expect(rail).toHaveTextContent('1 waiting');
    expect(rail).toHaveTextContent(
      'Nothing here reaches a vendor until someone who may send it approves it.',
    );
    expect(rail).not.toHaveTextContent(/your approval|awaiting your hand/);
  });
});

describe('the drafted-order rail — send or ask', () => {
  it('a staff member holds to ASK: the draft’s words are requested and no seal is minted', async () => {
    seams.standing = AS_STAFF;
    seams.requestDraftSend.mockResolvedValue({ says: 'Asked. Your version is saved exactly as you wrote it.' });
    draw();
    expect(screen.getByTestId('rail-standing')).toHaveTextContent(/Your hold will ask a manager/);
    holdIt(/Hold to ask a manager to send it/);
    await waitFor(() => expect(seams.requestDraftSend).toHaveBeenCalledOnce());
    expect(seams.requestDraftSend).toHaveBeenCalledWith({
      orderId: 'ord-1',
      content: 'Six cases at 2,400, delivered Tuesday.',
      ccEmails: [],
    });
    expect(seams.issueDraftSendChallenge).not.toHaveBeenCalled();
    expect(seams.approveMutateAsync).not.toHaveBeenCalled();
  });

  it('a manager holds to SEND: mint, then the sealed send', async () => {
    seams.issueDraftSendChallenge.mockResolvedValue('proof-1');
    seams.approveMutateAsync.mockResolvedValue({});
    draw();
    holdIt(/Hold to approve & send to Kavaklıdere/);
    await waitFor(() => expect(seams.approveMutateAsync).toHaveBeenCalledOnce());
    expect(seams.approveMutateAsync.mock.calls[0][0]).toMatchObject({ orderId: 'ord-1', challenge: 'proof-1' });
    expect(seams.requestDraftSend).not.toHaveBeenCalled();
  });

  it('names a waiting request on the card, and releases it over the requester’s copies', async () => {
    seams.drafts = [
      {
        ...DRAFT,
        sendRequest: {
          requestedBy: 'u-staff',
          requestedByName: 'Ayşe',
          requestedAt: '2026-09-21T10:00:00.000Z',
          current: true,
          ccEmails: ['ops@house.example'],
        },
      },
    ];
    seams.issueDraftSendChallenge.mockResolvedValue('proof-1');
    seams.approveMutateAsync.mockResolvedValue({});
    draw();
    expect(screen.getByRole('button', { name: /Öküzgözü 2022/ })).toHaveTextContent(/asked by Ayşe, waiting for a manager/);
    holdIt(/Hold to approve & send/);
    await waitFor(() => expect(seams.approveMutateAsync).toHaveBeenCalledOnce());
    expect(seams.issueDraftSendChallenge.mock.calls[0][0]).toMatchObject({ ccEmails: ['ops@house.example'] });
    expect(seams.approveMutateAsync.mock.calls[0][0]).toMatchObject({ ccEmails: ['ops@house.example'] });
  });

  it('a standing that could not be read leaves the send hold disabled and says so', () => {
    seams.standingFailed = true;
    draw();
    expect(screen.getByRole('button', { name: /Hold to approve & send/ })).toBeDisabled();
    expect(screen.getByTestId('rail-standing')).toHaveTextContent(/network down/);
  });
});

/*
 * ORD-W7, 2026-10-01: the only house draft in production still read
 * "Dear [Provider First Name]" and was signed "[Your Name]". The card names
 * the blanks and keeps both holds shut; the gateway refuses the same letter
 * (apps/api-gateway/src/procurement/unfilled-slots.spec.ts).
 */
describe('a draft with a blank the house did not fill', () => {
  const BLANKED = { ...DRAFT, draftContent: 'Dear [Provider First Name],\n\nSix cases.\n\n[Your Name]' };

  // A hold's mint and send are async: give them a tick to happen, so a
  // "not called" is a fact rather than an assertion that ran too early.
  const settleHold = () => act(async () => { await new Promise((r) => setTimeout(r, 50)); });

  it('names the blanks and will not mint a seal over them', async () => {
    seams.drafts = [BLANKED];
    draw();
    expect(screen.getByTestId('draft-unfilled')).toHaveTextContent(/\[Provider First Name\], \[Your Name\]/);
    holdIt(/Hold to approve & send to Kavaklıdere/);
    await settleHold();
    expect(seams.issueDraftSendChallenge).not.toHaveBeenCalled();
    expect(seams.approveMutateAsync).not.toHaveBeenCalled();
  });

  it('will not ask a manager to send it either', async () => {
    seams.drafts = [BLANKED];
    seams.standing = AS_STAFF;
    draw();
    holdIt(/Hold to ask a manager to send it/);
    await settleHold();
    expect(seams.requestDraftSend).not.toHaveBeenCalled();
  });

  it('says nothing about a draft with no blanks', () => {
    draw();
    expect(screen.queryByTestId('draft-unfilled')).not.toBeInTheDocument();
  });
});

/*
 * ORD-W8, W10, W11 (DASH-W16 a, c, d), 2026-10-01: the order opened on the
 * ledger opens and marks its letter; the words can be edited on the card; and
 * the vendor's answers open from the card.
 */
describe('the card, from the order and for the letter', () => {
  function drawWith(props: Parameters<typeof DraftRail>[0]) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <DraftRail {...props} />
      </QueryClientProvider>,
    );
  }

  it('opens and marks the letter of the order opened on the ledger', () => {
    drawWith({ focusOrderId: 'ord-1' });
    expect(screen.getByTestId('draft-card-ord-1')).toHaveAttribute('data-focused', 'true');
    expect(screen.getByText(/This order.s letter/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Öküzgözü 2022/ })).toHaveAttribute('aria-expanded', 'true');
  });

  it('leaves another order’s letter closed and unmarked', () => {
    drawWith({ focusOrderId: 'ord-other' });
    expect(screen.getByTestId('draft-card-ord-1')).not.toHaveAttribute('data-focused');
    expect(screen.getByRole('button', { name: /Öküzgözü 2022/ })).toHaveAttribute('aria-expanded', 'false');
  });

  it('saves edited words through PATCH …/draft, and shuts the hold while the box is open', async () => {
    seams.issueDraftSendChallenge.mockResolvedValue('proof-1');
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'Edit the words' }));
    const box = screen.getByRole('textbox', { name: /The letter.s words/ });
    expect(screen.getByRole('button', { name: 'Save the words' })).toBeDisabled();
    fireEvent.change(box, { target: { value: 'Dear Hasan, six cases. Ayşe' } });
    holdIt(/Hold to approve & send to Kavaklıdere/);
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(seams.issueDraftSendChallenge).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save the words' }));
    expect(seams.editMutate).toHaveBeenCalledWith(
      { orderId: 'ord-1', content: 'Dear Hasan, six cases. Ayşe' },
      expect.anything(),
    );
  });

  it('keeps the old words without writing anything', () => {
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'Edit the words' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'changed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Keep the old words' }));
    expect(seams.editMutate).not.toHaveBeenCalled();
    expect(screen.getByText('Six cases at 2,400, delivered Tuesday.')).toBeInTheDocument();
  });

  it('opens the vendor’s answers for that order from the card', () => {
    const open = vi.fn();
    const byOrder = vi.fn(() => open);
    drawWith({ onOpenResponses: byOrder });
    fireEvent.click(screen.getByRole('button', { name: /Öküzgözü 2022/ }));
    fireEvent.click(screen.getByTestId('draft-open-responses'));
    expect(byOrder).toHaveBeenCalledWith('ord-1');
    expect(open).toHaveBeenCalledOnce();
  });

  it('offers no answers button when the page cannot open that order', () => {
    drawWith({ onOpenResponses: () => undefined });
    fireEvent.click(screen.getByRole('button', { name: /Öküzgözü 2022/ }));
    expect(screen.queryByTestId('draft-open-responses')).not.toBeInTheDocument();
  });
});
