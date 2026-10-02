/**
 * INV-W26 — the email to the vendor, inline in the Order sheet. Founder,
 * 2026-10-01: "Inline draft, then send". Nothing reaches the vendor unread,
 * and every state on the panel is read from the order's conversation rows, the
 * house's approval gate and the draft's send standing — never assumed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const m = vi.hoisted(() => ({
  conversations: { data: [] as unknown[], isPending: false, isError: false } as Record<string, unknown>,
  standing: { data: undefined as unknown, isPending: false, isError: false, error: null } as Record<string, unknown>,
  approveDraft: vi.fn(),
  requestDraftSend: vi.fn(),
  issueDraftSendChallenge: vi.fn(),
  approveOrder: vi.fn(),
  mintOrderSeal: vi.fn(),
  get: vi.fn(),
}));

vi.mock('../../../hooks/queries/useDraftEmailQueries', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useOrderConversations: () => m.conversations,
  useDraftStanding: () => m.standing,
  useApproveDraft: () => ({ mutateAsync: m.approveDraft, isPending: false }),
  requestDraftSend: m.requestDraftSend,
  issueDraftSendChallenge: m.issueDraftSendChallenge,
}));
vi.mock('../../../services/api/orders', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  approveOrder: m.approveOrder,
  mintOrderSeal: m.mintOrderSeal,
}));
vi.mock('../../../services/api/client', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  apiClient: { get: m.get, post: vi.fn() },
}));

import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios';
import OrderLetter, { DRAFT_WAIT_TRIES } from './OrderLetter';

const SEND = { readable: true, maySend: true, mode: 'send', basis: 'owner', grant: null, sentence: null };
const ASK = { readable: true, maySend: false, mode: 'ask', basis: null, grant: null, sentence: 'A manager sends this.' };

function draft(over: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    orderId: 'o1',
    status: 'PENDING_APPROVAL',
    direction: 'OUTBOUND',
    emailType: 'order_inquiry',
    roundCount: 0,
    createdAt: '2026-10-01T12:00:05Z',
    sentAt: null,
    draftContent: 'Dear Enoteca Rossi, please send 4 bottles of Barolo.',
    rollingSummary: null,
    providerEmail: 'orders@rossi.example',
    providerName: 'Enoteca Rossi',
    ...over,
  };
}
function gate(mayApprove: boolean | null, readable = true) {
  return {
    restaurantId: 'r1',
    callerRole: 'staff',
    policySet: true,
    policyNote: '',
    readable,
    reason: null,
    orders:
      mayApprove === null
        ? []
        : [{ orderId: 'o1', requiredRole: 'manager', firedBy: [], reasons: [], untestable: [], mayApprove, sentence: mayApprove ? null : 'Orders over 500 EUR are approved by a manager.' }],
  };
}

function mount(needsApproval = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <OrderLetter orderId="o1" vendorName="Enoteca Rossi" needsApproval={needsApproval} restaurantId="r1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const text = () => document.body.textContent ?? '';
/** Each fireEvent is its own act, so the second Enter sees the armed phase. */
function holdByKeyboard(button: HTMLElement) {
  fireEvent.keyDown(button, { key: 'Enter' });
  fireEvent.keyDown(button, { key: 'Enter' });
}

beforeEach(() => {
  m.conversations = { data: [draft()], isPending: false, isError: false };
  m.standing = { data: { draft: { id: 'c1', send_request: null }, sendOrAsk: SEND }, isPending: false, isError: false, error: null };
  for (const f of [m.approveDraft, m.requestDraftSend, m.issueDraftSendChallenge, m.approveOrder, m.mintOrderSeal, m.get]) f.mockReset();
  m.get.mockResolvedValue({ data: gate(true) });
  m.mintOrderSeal.mockResolvedValue('order-seal');
  m.issueDraftSendChallenge.mockResolvedValue('draft-seal');
  m.approveOrder.mockResolvedValue({});
  m.approveDraft.mockResolvedValue({});
  m.requestDraftSend.mockResolvedValue({ says: 'Asked. Two managers were told.' });
});
afterEach(() => vi.useRealTimers());

describe('OrderLetter — waiting for the AI (INV-W26)', () => {
  it('says the email is being drafted while there is no row yet', () => {
    m.conversations = { data: [], isPending: false, isError: false };
    mount();
    expect(text()).toContain('The AI is drafting the email to Enoteca Rossi…');
  });

  it('stops looking after its tries and says no email has been drafted', async () => {
    vi.useFakeTimers();
    m.conversations = { data: [], isPending: false, isError: false };
    mount();
    for (let i = 0; i < DRAFT_WAIT_TRIES; i += 1) {
      await act(async () => {
        vi.advanceTimersByTime(3_000);
      });
    }
    expect(text()).toContain('No email to Enoteca Rossi has been drafted yet.');
    expect(screen.getByRole('link', { name: 'Open Orders' }).getAttribute('href')).toBe('/orders');
  });

  it('says so when the email cannot be read', () => {
    m.conversations = { data: undefined, isPending: false, isError: true };
    mount();
    expect(text()).toContain('The email to Enoteca Rossi could not be read.');
  });
});

describe('OrderLetter — what was already sent is said as sent (INV-W26)', () => {
  it('names an automatic send, and offers no hold', () => {
    m.conversations = { data: [draft({ status: 'AUTO_SENT', sentAt: '2026-10-01T12:00:09Z' })], isPending: false, isError: false };
    mount();
    expect(text()).toContain('is set to receive this house’s order emails without review, so this email was sent automatically');
    expect(text()).toContain('please send 4 bottles of Barolo');
    expect(screen.queryByRole('button', { name: /Hold to/ })).toBeNull();
  });

  it('names a refusal with its reason', () => {
    m.conversations = { data: [draft({ status: 'SEND_REFUSED', refusalReason: 'the mailbox rejected the address' })], isPending: false, isError: false };
    mount();
    expect(text()).toContain('The email to Enoteca Rossi was not sent: the mailbox rejected the address. It waits on Orders.');
  });
});

describe('OrderLetter — read, edit, then one hold approves and sends (INV-W26)', () => {
  it('shows the draft to edit, and the hold approves the order and sends the edited words', async () => {
    mount();
    const box = screen.getByRole('textbox', { name: 'Draft' }) as HTMLTextAreaElement;
    expect(box.value).toBe('Dear Enoteca Rossi, please send 4 bottles of Barolo.');
    // The minute it was written, in words — never a raw timestamp with seconds.
    const hint = document.getElementById(box.getAttribute('aria-describedby') ?? '');
    expect(hint?.textContent).toMatch(/^Written by the AI (at|on \d{1,2} \w{3} at) \d{2}:\d{2}\. Edit it before you send\.$/);
    fireEvent.change(box, { target: { value: 'Dear Rossi, 4 bottles of Barolo, please.' } });
    const hold = await screen.findByRole('button', { name: 'Hold to approve and send to Enoteca Rossi' });
    holdByKeyboard(hold);
    await waitFor(() => expect(text()).toContain('Sent to Enoteca Rossi. The order is approved on Orders.'));
    expect(m.mintOrderSeal).toHaveBeenCalledWith('o1');
    expect(m.issueDraftSendChallenge).toHaveBeenCalledWith({ orderId: 'o1', body: 'Dear Rossi, 4 bottles of Barolo, please.', to: 'orders@rossi.example', ccEmails: [] });
    expect(m.approveOrder).toHaveBeenCalledWith('o1', undefined, 'order-seal');
    expect(m.approveDraft).toHaveBeenCalledWith({ orderId: 'o1', modifiedContent: 'Dear Rossi, 4 bottles of Barolo, please.', challenge: 'draft-seal' });
    expect(m.approveOrder.mock.invocationCallOrder[0]).toBeLessThan(m.approveDraft.mock.invocationCallOrder[0]);
  });

  it('sends without approving when the order no longer needs it', async () => {
    mount(false);
    holdByKeyboard(await screen.findByRole('button', { name: 'Hold to send to Enoteca Rossi' }));
    await waitFor(() => expect(text()).toContain('Sent to Enoteca Rossi.'));
    expect(m.mintOrderSeal).not.toHaveBeenCalled();
    expect(m.approveOrder).not.toHaveBeenCalled();
  });

  it('sends nothing when the approval is refused', async () => {
    m.approveOrder.mockRejectedValue(new Error('the approval was refused'));
    mount();
    holdByKeyboard(await screen.findByRole('button', { name: 'Hold to approve and send to Enoteca Rossi' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Nothing was approved or sent'));
    expect(m.approveDraft).not.toHaveBeenCalled();
  });

  it('says the order is approved but the email was not sent when only the send fails', async () => {
    m.approveDraft.mockRejectedValue(new Error('the relay refused'));
    mount();
    holdByKeyboard(await screen.findByRole('button', { name: 'Hold to approve and send to Enoteca Rossi' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('The order is approved, but the email was not sent'));
  });

  it('offers no send when the vendor has no email address, and says where to add one', async () => {
    m.conversations = { data: [draft({ providerEmail: null })], isPending: false, isError: false };
    mount();
    await waitFor(() => expect(text()).toContain('has no email address on file, so this email cannot be sent from here.'));
    expect(screen.getByRole('link', { name: 'Add it on Vendors' }).getAttribute('href')).toBe('/vendors');
    // Read once the gate has answered, so a hold that waits on it cannot hide.
    await waitFor(() => expect(m.get).toHaveBeenCalled());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('offers no send to a vendor with no email address on an order that needs no approval', async () => {
    m.conversations = { data: [draft({ providerEmail: null })], isPending: false, isError: false };
    mount(false);
    await waitFor(() => expect(text()).toContain('has no email address on file, so this email cannot be sent from here.'));
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});

describe('OrderLetter — who may approve and send is read, not guessed (INV-W26)', () => {
  it('a person the house does not let approve asks a manager, and approves nothing', async () => {
    m.get.mockResolvedValue({ data: gate(false) });
    mount();
    await waitFor(() => expect(text()).toContain('Orders over 500 EUR are approved by a manager.'));
    holdByKeyboard(screen.getByRole('button', { name: 'Hold to ask a manager to send this email' }));
    await waitFor(() => expect(text()).toContain('Asked. Two managers were told.'));
    expect(m.approveOrder).not.toHaveBeenCalled();
    expect(m.requestDraftSend).toHaveBeenCalledWith({ orderId: 'o1', content: 'Dear Enoteca Rossi, please send 4 bottles of Barolo.', ccEmails: [] });
  });

  it('a person who may approve but not send approves, then asks', async () => {
    m.standing = { data: { draft: { id: 'c1', send_request: null }, sendOrAsk: ASK }, isPending: false, isError: false, error: null };
    mount();
    holdByKeyboard(await screen.findByRole('button', { name: 'Hold to approve it and ask a manager to send the email' }));
    await waitFor(() => expect(text()).toContain('Asked. Two managers were told.'));
    expect(m.approveOrder).toHaveBeenCalledWith('o1', undefined, 'order-seal');
    expect(m.approveDraft).not.toHaveBeenCalled();
  });

  it('says so and offers nothing when the approval gate cannot be read', async () => {
    m.get.mockResolvedValue({ data: gate(true, false) });
    mount();
    await waitFor(() => expect(text()).toContain('Who may approve this order could not be read here'));
    expect(screen.queryByRole('button', { name: /Hold to/ })).toBeNull();
  });

  it('says so and offers nothing when the send standing cannot be read', async () => {
    m.standing = { data: { draft: { id: 'c1', send_request: null }, sendOrAsk: { ...SEND, readable: false } }, isPending: false, isError: false, error: null };
    mount();
    await waitFor(() => expect(text()).toContain('Who may send this email could not be read here'));
    expect(screen.queryByRole('button', { name: /Hold to/ })).toBeNull();
  });
});

describe('OrderLetter — a second draft is named, never sent from here (INV-W26)', () => {
  it('shows the newest draft and names the other one', () => {
    m.conversations = {
      data: [draft({ id: 'c0', createdAt: '2026-10-01T12:00:01Z', draftContent: 'older' }), draft()],
      isPending: false,
      isError: false,
    };
    mount();
    expect((screen.getByRole('textbox', { name: 'Draft' }) as HTMLTextAreaElement).value).toContain('please send 4');
    expect(text()).toContain('Another draft to Enoteca Rossi is waiting on this order. It was not sent from here.');
  });
});

function answered(status: number, message?: unknown): AxiosError {
  const response = { status, statusText: '', headers: {}, config: { headers: new AxiosHeaders() }, data: message === undefined ? {} : { message } } as AxiosResponse;
  return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_RESPONSE', undefined, {}, response);
}
const silent = () => new AxiosError('Network Error', 'ERR_NETWORK', undefined, {}, undefined);

describe('OrderLetter — failures in the house\u2019s words (INV-W31)', () => {
  it('an unanswered send is unknown, says to look before sending again, and re-reads the messages', async () => {
    const reread = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    m.approveDraft.mockRejectedValue(silent());
    mount();
    holdByKeyboard(await screen.findByRole('button', { name: 'Hold to approve and send to Enoteca Rossi' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        'No answer came back, so it is not known whether the email reached Enoteca Rossi. The order is approved. Look at the order’s messages on Orders before sending again, so Enoteca Rossi is not written to twice.',
      ),
    );
    expect(text()).not.toContain('the email was not sent');
    expect(reread.mock.calls.some(([f]) => JSON.stringify(f).includes('o1'))).toBe(true);
    reread.mockRestore();
  });

  it('a refused send says the email was not sent, in plain words', async () => {
    m.approveDraft.mockRejectedValue(answered(403, 'Forbidden resource'));
    mount();
    holdByKeyboard(await screen.findByRole('button', { name: 'Hold to approve and send to Enoteca Rossi' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        'The order is approved, but the email was not sent — this account is not allowed to do that in this house.',
      ),
    );
  });

  it('an approval whose server failed is unknown, and nothing was sent', async () => {
    m.approveOrder.mockRejectedValue(answered(500));
    mount();
    holdByKeyboard(await screen.findByRole('button', { name: 'Hold to approve and send to Enoteca Rossi' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        'The server failed before it could answer, so it is not known whether the order was approved. The email was not sent. Look on Orders before trying again.',
      ),
    );
    expect(m.approveDraft).not.toHaveBeenCalled();
  });

  it('an approval whose server failed on the ask path says nobody was asked', async () => {
    m.standing = { data: { draft: { id: 'c1', send_request: null }, sendOrAsk: ASK }, isPending: false, isError: false, error: null };
    m.approveOrder.mockRejectedValue(answered(502));
    mount();
    holdByKeyboard(await screen.findByRole('button', { name: 'Hold to approve it and ask a manager to send the email' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        'The server failed before it could answer, so it is not known whether the order was approved. Nobody was asked to send the email. Look on Orders before trying again.',
      ),
    );
    expect(m.requestDraftSend).not.toHaveBeenCalled();
  });

  it('an unanswered ask is unknown, and says to look before asking again', async () => {
    m.standing = { data: { draft: { id: 'c1', send_request: null }, sendOrAsk: ASK }, isPending: false, isError: false, error: null };
    m.requestDraftSend.mockRejectedValue(silent());
    mount();
    holdByKeyboard(await screen.findByRole('button', { name: 'Hold to approve it and ask a manager to send the email' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        'No answer came back, so it is not known whether anyone was asked to send the email. The order is approved and nothing was sent. Look on Orders before asking again, so nobody is asked twice.',
      ),
    );
  });

  it('a refused ask with no approval needed says nobody was asked', async () => {
    m.standing = { data: { draft: { id: 'c1', send_request: null }, sendOrAsk: ASK }, isPending: false, isError: false, error: null };
    m.requestDraftSend.mockRejectedValue(answered(409, 'Someone already asked a moment ago.'));
    mount(false);
    holdByKeyboard(await screen.findByRole('button', { name: /Hold to ask/ }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('Nobody was asked; nothing was sent — someone already asked a moment ago.'),
    );
  });

  it('a seal that could not be issued says why in plain words', async () => {
    m.issueDraftSendChallenge.mockRejectedValue(answered(503));
    mount();
    holdByKeyboard(await screen.findByRole('button', { name: 'Hold to approve and send to Enoteca Rossi' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('Nothing was approved or sent — the server failed before it could answer.'),
    );
    expect(m.approveOrder).not.toHaveBeenCalled();
  });

  it('a seal that could not be issued on the ask path says why in plain words', async () => {
    m.standing = { data: { draft: { id: 'c1', send_request: null }, sendOrAsk: ASK }, isPending: false, isError: false, error: null };
    m.mintOrderSeal.mockRejectedValue(answered(503));
    mount();
    holdByKeyboard(await screen.findByRole('button', { name: 'Hold to approve it and ask a manager to send the email' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('Nothing was approved or asked — the server failed before it could answer.'),
    );
    expect(m.approveOrder).not.toHaveBeenCalled();
  });

  it('says why the send standing could not be read in plain words', () => {
    m.standing = { data: undefined, isPending: false, isError: true, error: silent() };
    mount();
    expect(screen.getByTestId('inv-letter-standing').textContent).toContain('(no answer came back)');
    expect(text()).not.toContain('Network Error');
  });
});
