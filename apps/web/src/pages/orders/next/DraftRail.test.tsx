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
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const seams = vi.hoisted(() => ({
  standing: null as unknown,
  standingFailed: false,
  requestDraftSend: vi.fn(),
  issueDraftSendChallenge: vi.fn(),
  approveMutateAsync: vi.fn(),
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
