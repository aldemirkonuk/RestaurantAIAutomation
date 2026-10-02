/**
 * Letters a staff member asked a manager to send (founder answer 3,
 * 2026-09-21). The gateway's rules are proved in
 * communications/letters/house-letters-sealed.spec.ts; what is proved here is
 * that a manager releases the exact letter with ONE hold that mints the seal
 * over it and names the request, that staff are offered nothing to release,
 * and that a failed read is never "nothing waiting".
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../../../services/api/client', () => ({
  apiClient: {
    get: (...a: unknown[]) => api.get(...a),
    post: (...a: unknown[]) => api.post(...a),
  },
  getErrorMessage: (e: unknown) => (e as { message?: string })?.message ?? 'unknown error',
}));

import { LetterRequestsPanel, releaseBody, type LetterRequest } from './LetterRequestsPanel';

const REQ: LetterRequest = {
  id: 'req-1',
  kind: 'house_letter',
  providerId: 'prov-1',
  requestedBy: { userId: 'u-staff', name: 'Ayşe' },
  requestedAt: '2026-09-21T09:00:00.000Z',
  payload: { providerId: 'prov-1', to: 'fikri@fikritarim.com', subject: 'Standing order', body: 'Merhaba', orderId: null },
  state: 'waiting',
};

function draw(canRelease: boolean, more: Partial<Parameters<typeof LetterRequestsPanel>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <LetterRequestsPanel restaurantId="r1" canRelease={canRelease} {...more} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
});

describe('letters waiting for a manager', () => {
  it('a manager releases the exact letter with one hold that mints the seal over it and names the request', async () => {
    api.get.mockResolvedValue({ data: { requests: [REQ] } });
    api.post.mockImplementation(async (path: string) =>
      path.endsWith('seal-challenge') ? { data: { challenge: 'seal-1' } } : { data: { says: 'Queued to leave.' } },
    );
    draw(true);
    const die = await screen.findByRole('button', { name: /Hold to send it as written/ });
    expect(screen.getByTestId('letter-requests')).toHaveTextContent('Ayşe asked to send a letter');
    expect(screen.getByTestId('letter-request-paper')).toHaveTextContent(/To\s*fikri@fikritarim\.com/);
    // COMMS-W30: the card hides overflow, so a long address or subject must wrap or it is cut off.
    const head = [...screen.getByTestId('letter-request-paper').querySelectorAll('span')];
    for (const said of ['fikri@fikritarim.com', 'Standing order']) {
      expect(head.find((s) => s.textContent === said)?.style.overflowWrap).toBe('anywhere');
    }
    expect(screen.getByTestId('letter-request-state')).toHaveTextContent('Ready to send');
    fireEvent.keyDown(die, { key: 'Enter' });
    fireEvent.keyDown(die, { key: 'Enter' });
    const body = releaseBody(REQ);
    expect(body).toEqual({ providerId: 'prov-1', to: 'fikri@fikritarim.com', subject: 'Standing order', body: 'Merhaba', requestId: 'req-1' });
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/communications/letters', body, { headers: { 'X-Seal-Challenge': 'seal-1' } }));
    expect(api.post).toHaveBeenCalledWith('/communications/letters/seal-challenge', body);
    await waitFor(() => expect(screen.getByTestId('letter-requests-says')).toHaveTextContent(/Queued to leave/));
  });

  it('a staff member sees their own waiting letter and nothing to release', async () => {
    api.get.mockResolvedValue({ data: { requests: [REQ] } });
    draw(false);
    await waitFor(() => expect(screen.getByTestId('letter-requests')).toHaveTextContent(/Waiting for an owner or a manager/));
    expect(screen.queryByRole('button', { name: /Hold to send/ })).toBeNull();
  });

  it('an owner or a manager declines with a reason the person who asked reads, and nothing is sent', async () => {
    api.get.mockResolvedValue({ data: { requests: [REQ], viewer: { userId: 'u-manager', mayDecline: true } } });
    api.post.mockResolvedValue({ data: { says: 'Declined. The person who asked was told why, and nothing was sent.' } });
    draw(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Decline' }));
    expect(screen.queryByRole('button', { name: 'Withdraw my request' })).toBeNull();
    // No reason, no decline.
    fireEvent.click(screen.getByRole('button', { name: 'Decline it' }));
    expect(await screen.findByTestId('letter-requests-problem')).toHaveTextContent(/Say why/);
    expect(api.post).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Why\? Ayşe reads this/), { target: { value: ' We ordered this week. ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Decline it' }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/communications/letters/requests/req-1/decline', { reason: 'We ordered this week.' }),
    );
    expect(await screen.findByTestId('letter-requests-says')).toHaveTextContent(/Declined/);
  });

  it('the person who asked may withdraw their own, and is offered no decline', async () => {
    api.get.mockResolvedValue({ data: { requests: [REQ], viewer: { userId: 'u-staff', mayDecline: false } } });
    api.post.mockResolvedValue({ data: { says: 'Withdrawn. It no longer waits for a manager, and nothing was sent.' } });
    draw(false);
    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw my request' }));
    expect(screen.queryByRole('button', { name: 'Decline' })).toBeNull();
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/communications/letters/requests/req-1/withdraw', {}));
    expect(await screen.findByTestId('letter-requests-says')).toHaveTextContent(/Withdrawn/);
  });

  it('nobody else is offered a withdraw', async () => {
    api.get.mockResolvedValue({ data: { requests: [REQ], viewer: { userId: 'u-other', mayDecline: false } } });
    draw(false);
    await screen.findByTestId('letter-requests');
    expect(screen.queryByRole('button', { name: 'Withdraw my request' })).toBeNull();
  });

  it('a letter pulled back inside its undo window says it is waiting again', async () => {
    api.get.mockResolvedValue({ data: { requests: [{ ...REQ, undoneCount: 1 }], viewer: { userId: 'u-manager', mayDecline: true } } });
    draw(true);
    expect(await screen.findByTestId('letter-request-undone')).toHaveTextContent(/pulled back before it left, so it is waiting again/);
  });

  it('a released letter can be pulled back from here inside its window, and a failed pull-back never reads as done', async () => {
    api.get.mockResolvedValue({ data: { requests: [REQ], viewer: { userId: 'u-manager', mayDecline: true } } });
    const dispatchAt = new Date(Date.now() + 120_000).toISOString();
    let cancelFails = true;
    api.post.mockImplementation(async (path: string) => {
      if (path.endsWith('seal-challenge')) return { data: { challenge: 'seal-1' } };
      if (path.endsWith('/cancel')) {
        if (cancelFails) throw new Error('That letter left the queue a moment ago');
        return { data: { says: 'Pulled back. The staff request it released is waiting for an owner or a manager again.' } };
      }
      return { data: { id: 'letter-9', says: 'Queued to leave.', dispatchAt, undoMs: 120_000 } };
    });
    draw(true);
    const die = await screen.findByRole('button', { name: /Hold to send it as written/ });
    fireEvent.keyDown(die, { key: 'Enter' });
    fireEvent.keyDown(die, { key: 'Enter' });
    const pull = await screen.findByRole('button', { name: 'Pull it back' });
    fireEvent.click(pull);
    await waitFor(() => expect(screen.getByTestId('letter-requests-problem')).toHaveTextContent(/NOT pulled back: That letter left the queue/));
    expect(api.post).toHaveBeenCalledWith('/communications/letters/letter-9/cancel');
    cancelFails = false;
    fireEvent.click(screen.getByRole('button', { name: 'Pull it back' }));
    await waitFor(() => expect(screen.getByTestId('letter-requests-says')).toHaveTextContent(/waiting for an owner or a manager again/));
    expect(screen.queryByRole('button', { name: 'Pull it back' })).toBeNull();
  });

  it('a release whose letter has no undo window offers no pull-back', async () => {
    api.get.mockResolvedValue({ data: { requests: [REQ] } });
    api.post.mockImplementation(async (path: string) =>
      path.endsWith('seal-challenge') ? { data: { challenge: 'seal-1' } } : { data: { id: 'letter-9', says: 'Queued to leave.', dispatchAt: new Date(Date.now() + 120_000).toISOString(), undoMs: null } },
    );
    draw(true);
    const die = await screen.findByRole('button', { name: /Hold to send it as written/ });
    fireEvent.keyDown(die, { key: 'Enter' });
    fireEvent.keyDown(die, { key: 'Enter' });
    await waitFor(() => expect(screen.getByTestId('letter-requests-says')).toHaveTextContent(/Queued to leave/));
    expect(screen.queryByRole('button', { name: 'Pull it back' })).toBeNull();
  });

  it('a failed read is a failed read, not an empty list', async () => {
    api.get.mockRejectedValue(new Error('permission denied'));
    draw(true);
    await waitFor(() => expect(screen.getByTestId('letter-requests-unread')).toHaveTextContent(/could not be read/));
    expect(screen.getByTestId('letter-requests-unread')).toHaveTextContent(/That does not mean none are waiting\.$/);
  });
});

// Founder, 2026-09-22, verbatim pick: "Back to waiting (Recommended)".
describe('a released letter that could not be sent', () => {
  it('comes back waiting, with who released it and why it was not sent, for the manager and the person who asked', async () => {
    const failed: LetterRequest = {
      ...REQ,
      lastSendFailure: {
        reason: "the house's mailbox holds no grant to send with.",
        at: '2026-09-22T09:05:00.000Z',
        releasedBy: { userId: 'u-manager', name: 'Mert' },
        count: 1,
      },
    };
    api.get.mockResolvedValue({ data: { requests: [failed] } });
    draw(true);
    expect(await screen.findByTestId('letter-request-send-failed')).toHaveTextContent(
      "Mert released it, but it could not be sent: the house's mailbox holds no grant to send with. It is waiting again. Nothing was sent.",
    );
  });

  it('says nothing about a failure that did not happen', async () => {
    api.get.mockResolvedValue({ data: { requests: [{ ...REQ, lastSendFailure: null }] } });
    draw(false);
    await screen.findByTestId('letter-requests');
    expect(screen.queryByTestId('letter-request-send-failed')).toBeNull();
  });
});

// COMMS-W11 / W11c (walk-through 2026-10-01): an owner in a house with no
// mailbox was told to "wait for an owner or a manager". The card now says
// which step is missing, keeps the hold visible but locked, and reads the
// mailbox again on request; the letter shows as a letter, with nothing added.
describe('a waiting letter in a house with no mailbox', () => {
  const LETTER: LetterRequest = {
    ...REQ,
    payload: { ...REQ.payload, body: 'Hello,\n\nOne case was missing.\nPlease send it Friday.\n\nThanks' },
  };
  const mailbox = { basis: 'owner' as const, checking: false, checkedAt: Date.parse('2026-10-01T09:00:00Z'), recheck: vi.fn() };

  it('tells an owner which step is missing, links to it, and offers no working send', async () => {
    api.get.mockResolvedValue({ data: { requests: [LETTER] } });
    draw(false, { noMailbox: true, mailbox });
    const steps = await screen.findByTestId('letter-request-readiness');
    expect(steps).toHaveTextContent('You may send for this house as the owner.');
    expect(steps).toHaveTextContent('Not yet: This house has no mailbox to send from.');
    expect(screen.getByTestId('letter-request-connect')).toHaveTextContent('Connect a mailbox');
    expect(screen.getByTestId('letter-request-state')).toHaveTextContent('Can’t send yet');
    expect(screen.getByRole('button', { name: /Hold to send it as written/ })).toBeDisabled();
    expect(screen.queryByText(/Waiting for an owner or a manager/)).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
  });

  // COMMS-W16 (founder, 2026-10-01): the connect button opens a small chooser.
  // Only Gmail sending exists, so Outlook and iCloud Mail cannot be pressed.
  it('opens a mailbox chooser: Gmail goes to Google and back, Outlook and iCloud say not yet', async () => {
    api.get.mockResolvedValue({ data: { requests: [LETTER] } });
    draw(false, { noMailbox: true, mailbox });
    fireEvent.click(await screen.findByTestId('letter-request-connect'));
    expect(await screen.findByTestId('mailbox-gmail_send')).toHaveAttribute(
      'href',
      '/authorize/gmail_send?returnPath=%2F',
    );
    expect(screen.getByTestId('mailbox-outlook')).toBeDisabled();
    expect(screen.getByTestId('mailbox-icloud')).toBeDisabled();
    // COMMS-W20b: the house's own mailbox, or an address Mudavym gives (not yet)
    expect(screen.getByTestId('mailbox-mudavym')).toBeDisabled();
    expect(screen.getByTestId('mailbox-mudavym')).toHaveTextContent('@mudavym.comNot yet');
    expect(screen.getByTestId('mailbox-mudavym')).toHaveAttribute('title', expect.stringContaining('name@mudavym.com'));
    expect(screen.getByTestId('mailbox-more')).toHaveAttribute('href', '/connections#sender');
    // No company has granted its app icon yet (COMMS-W16c), so each bar carries the
    // mark that company publishes for sign-in: Google's G, Microsoft's four squares.
    const fills = (id: string) =>
      [...screen.getByTestId(id).querySelectorAll('[fill]')].map((n) => n.getAttribute('fill'));
    expect(fills('mailbox-gmail_send')).toContain('#EA4335');
    expect(fills('mailbox-gmail_send')).not.toContain('#C5221F');
    expect(fills('mailbox-outlook')).toContain('#F25022');
    expect(fills('mailbox-outlook')).not.toContain('#0078D4');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('reads the mailbox again when asked', async () => {
    api.get.mockResolvedValue({ data: { requests: [LETTER] } });
    const recheck = vi.fn();
    draw(false, { noMailbox: true, mailbox: { ...mailbox, recheck } });
    fireEvent.click(await screen.findByRole('button', { name: 'Check again' }));
    expect(recheck).toHaveBeenCalledTimes(1);
  });

  it('shows the letter in the paragraphs and lines it was written in, adding nothing', async () => {
    api.get.mockResolvedValue({ data: { requests: [LETTER] } });
    draw(false, { noMailbox: true, mailbox });
    const paper = await screen.findByTestId('letter-request-paper');
    const paras = [...paper.querySelectorAll('p')].map((p) => p.textContent);
    expect(paras).toEqual(['Hello,', 'One case was missing.\nPlease send it Friday.', 'Thanks']);
    // COMMS-W30: the card hides overflow, so an unbroken run must wrap or it is cut off.
    expect([...paper.querySelectorAll('p')].every((p) => p.style.overflowWrap === 'anywhere')).toBe(true);
  });
});

// COMMS-W33 (founder: "A: keep, say when"): a refresh that fails keeps the
// letters already read; they used to vanish while the page still counted them.
describe('when the letters cannot be read again', () => {
  it('keeps the letters it read, under a line saying when', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let fail = false;
    api.get.mockImplementation(async () => {
      if (fail) throw { response: { status: 500, data: { message: 'Internal server error.' } } };
      return { data: { requests: [REQ] } };
    });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <LetterRequestsPanel restaurantId="r1" canRelease />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByText('Letters waiting for a manager · 1');
    fail = true;
    await act(async () => {
      await qc.refetchQueries();
    });
    expect(screen.getByText('Letters waiting for a manager · 1')).toBeInTheDocument();
    expect(await screen.findByTestId('letter-requests-stale')).toHaveTextContent(
      /^Could not be read again \(Internal server error\)\. This is as it was at \d\d:\d\d; there may be more or fewer now\.$/,
    );
    expect(screen.queryByTestId('letter-requests-unread')).toBeNull();
  });
});

// COMMS-W36 (founder: "Page + queue shared"): the old Dark theme puts
// `.dark` on <html> (a browser that saved it keeps it; #576 took its control
// off /profile), and its `p` rule outranks the house's reset, so a
// paragraph that only inherited its ink turned pale on the paper ground (the
// letter's words measured 1.70:1). Each names the ink it already had. And the
// panel sits under "Waiting on you", so its heading is one level below it.
describe('the ink and the outline (COMMS-W36)', () => {
  const INK1 = 'var(--ink-1, #211C16)';

  it('its heading is a level below "Waiting on you", and the letter’s words name their ink', async () => {
    api.get.mockResolvedValue({ data: { requests: [{ ...REQ, payload: { ...REQ.payload, body: 'Hello,\n\nOne case.' } }] } });
    draw(false);
    const heading = await screen.findByRole('heading', { level: 3, name: 'Letters waiting for a manager · 1' });
    // Only its level changed: the line it had as an h2 is kept, so nothing below it moves.
    expect(heading.style.lineHeight).toBe('2rem');
    expect(heading.style.letterSpacing).toBe('-0.02em');
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
    const paras = [...screen.getByTestId('letter-request-paper').querySelectorAll('p')];
    expect(paras.map((p) => p.textContent)).toEqual(['Hello,', 'One case.']);
    expect(paras.every((p) => p.style.color === INK1)).toBe(true);
  });

  it('what a hold says, and what went wrong, name their ink', async () => {
    api.get.mockResolvedValue({ data: { requests: [REQ], viewer: { userId: 'u-manager', mayDecline: true } } });
    api.post.mockImplementation(async (path: string) => {
      if (path.endsWith('seal-challenge')) return { data: { challenge: 'seal-1' } };
      if (path.endsWith('/cancel')) throw new Error('It left a moment ago');
      return { data: { id: 'letter-9', says: 'Queued to leave.', dispatchAt: new Date(Date.now() + 120_000).toISOString(), undoMs: 120_000 } };
    });
    draw(true);
    const die = await screen.findByRole('button', { name: /Hold to send it as written/ });
    fireEvent.keyDown(die, { key: 'Enter' });
    fireEvent.keyDown(die, { key: 'Enter' });
    expect((await screen.findByTestId('letter-requests-says')).style.color).toBe(INK1);
    fireEvent.click(await screen.findByRole('button', { name: 'Pull it back' }));
    expect((await screen.findByTestId('letter-requests-problem')).style.color).toBe(INK1);
  });
});
