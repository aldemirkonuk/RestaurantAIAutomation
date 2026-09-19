/**
 * "The house's reply, drafted" — the owed act on `/communications`, sealed.
 *
 * THE REGRESSION. The rebuilt page could COUNT drafts waiting and could open
 * none: `data.glance.draftsPending` was a figure with no act behind it. The
 * legacy panel that had the act (`components/orders/DraftEmailApprovalPanel.tsx:130`)
 * sent mail on ONE CLICK against an unsealed route, which is precisely what
 * ADR 0118 forbids. So two things are asserted that fail against everything
 * before today: the panel exists and opens a real draft, and sending it goes
 * through a mint-then-spend seal.
 *
 * The seal's own rules are proved on the gateway (`draft-send-seal.spec.ts`);
 * what is proved here is that the browser cannot get round them — no token, no
 * send, and a refusal returns the die to rest instead of leaving it sealed over
 * a letter that never went.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({ post: vi.fn() }));

vi.mock('@/services/api/client', () => ({
  apiClient: { post: (...a: unknown[]) => api.post(...a) },
  getErrorMessage: (e: unknown) => (e as { message?: string })?.message ?? 'unknown error',
}));

import {
  DraftedReplyPanel,
  kindWords,
  subjectFor,
  warningsOf,
  type DraftedReply,
} from './DraftedReplyPanel';

const REPLY: DraftedReply = {
  id: 'conv-1',
  orderId: 'ord-118',
  orderNumber: 'PO-118',
  wineName: 'Öküzgözü 2022',
  providerName: 'Kavaklıdere',
  providerEmail: 'hasan@kavaklidere.example',
  emailType: 'COUNTER_OFFER',
  roundCount: 2,
  draftContent: 'Dear [Manager Name] placeholder aside — we can take six cases at 2,400.',
  constraintFlags: [
    { code: 'PRICE_ABOVE_LAST', message: 'This is 8% above what they last charged.', severity: 'soft' },
  ],
  createdAt: '2026-09-06T09:00:00.000Z',
};

function draw(over: Partial<React.ComponentProps<typeof DraftedReplyPanel>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onSent = vi.fn();
  const onDiscarded = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <DraftedReplyPanel
        open
        reply={REPLY}
        onClose={() => {}}
        onSent={onSent}
        onDiscarded={onDiscarded}
        {...over}
      />
    </QueryClientProvider>,
  );
  return { onSent, onDiscarded };
}

/** Complete the hold: Enter arms the die, Enter again releases it. */
async function hold() {
  const die = await screen.findByRole('button', { name: /Hold to send it/ });
  fireEvent.keyDown(die, { key: 'Enter' });
  fireEvent.keyDown(die, { key: 'Enter' });
}

beforeEach(() => {
  api.post.mockReset();
  api.post.mockImplementation((path: string) => {
    if (String(path).endsWith('/draft-seal-challenge')) {
      return Promise.resolve({ data: { challenge: 'tok-1', act: 'send_draft' } });
    }
    return Promise.resolve({ data: { conversationId: 'conv-1', sentAt: '2026-09-06T10:00:00.000Z' } });
  });
});

describe('the shape and the primitive', () => {
  it('is a panel — the seal never sits in a popover', () => {
    draw();
    const dialog = screen.getByRole('dialog');
    expect(dialog.closest('.mdv-ovl')).toHaveAttribute('data-shape', 'panel');
    expect(dialog).toHaveAttribute('data-motion', 'settle');
    expect(screen.getByRole('button', { name: 'Leave it waiting' })).toBeInTheDocument();
  });

  it('carries a contract sentence as its label, not a title in disguise', () => {
    draw();
    // TODAY the primitive prefers the title for the accessible name
    // (`Sheet.tsx`: `aria-label={title ? undefined : label}`), so the NAME is
    // the title. The contract sentence is still what `label` holds, and packet
    // 0 makes `label` the accessible name always — at that merge this
    // assertion becomes a `getByRole('dialog', { name: /Holding the seal/ })`.
    expect(screen.getByRole('dialog', { name: /The house's reply, drafted/ })).toBeInTheDocument();
    const scrim = screen.getByRole('button', { name: /^Close .*Holding the seal sends the letter/ });
    expect(scrim).toBeInTheDocument();
    expect(scrim.getAttribute('aria-label')).toMatch(/Leaving sends nothing/);
  });
});

describe('the seal — mint, then spend', () => {
  it('mints over the letter when the hold begins, and sends with the token', async () => {
    const { onSent } = draw();
    await hold();
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));

    const [mintPath, mintBody] = api.post.mock.calls[0] as [string, Record<string, unknown>];
    expect(mintPath).toBe('/procurement/orders/ord-118/draft-seal-challenge');
    expect(mintBody.to).toBe('hasan@kavaklidere.example');
    expect(String(mintBody.content)).toContain('six cases');

    const [sendPath, sendBody, config] = api.post.mock.calls[1] as [
      string,
      Record<string, unknown>,
      { headers?: Record<string, string> },
    ];
    expect(sendPath).toBe('/procurement/orders/ord-118/send-drafted-reply');
    expect(config?.headers?.['X-Seal-Challenge']).toBe('tok-1');
    expect(sendBody.modifiedContent).toBe(mintBody.content);
    await waitFor(() => expect(onSent).toHaveBeenCalled());
  });

  it('sends nothing when the seal is not issued', async () => {
    api.post.mockImplementation((path: string) =>
      String(path).endsWith('/draft-seal-challenge')
        ? Promise.resolve({ data: {} })
        : Promise.resolve({ data: {} }),
    );
    draw();
    await hold();
    await waitFor(() =>
      expect(screen.getByTestId('draft-failure')).toHaveTextContent(
        /The seal was not issued, so nothing was sent/,
      ),
    );
    expect(
      api.post.mock.calls.filter((c: unknown[]) => String(c[0]).endsWith('/send-drafted-reply')),
    ).toHaveLength(0);
  });

  it('says a refused send in the gateway’s own words and adds that nothing was sent', async () => {
    api.post.mockImplementation((path: string) =>
      String(path).endsWith('/draft-seal-challenge')
        ? Promise.resolve({ data: { challenge: 'tok-1' } })
        : Promise.reject(
            Object.assign(new Error('That seal was issued for a different act on this order.'), {
              response: { status: 403 },
            }),
          ),
    );
    draw();
    await hold();
    await waitFor(() =>
      expect(screen.getByTestId('draft-failure')).toHaveTextContent(
        /different act on this order\. Nothing was sent\./,
      ),
    );
  });

  it('cannot be held when there is nowhere to send it', () => {
    draw({ reply: { ...REPLY, providerEmail: null } });
    expect(screen.getByRole('button', { name: /Hold to send it/ })).toBeDisabled();
    expect(screen.getByTestId('draft-seal')).toHaveTextContent(/nowhere to send it/);
  });

  it('cannot be held with an empty letter', () => {
    draw({ reply: { ...REPLY, draftContent: '' } });
    expect(screen.getByTestId('draft-empty')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Hold to send it/ })).toBeDisabled();
  });
});

describe('a draft never looks sent', () => {
  it('renders the engine’s words grey and a person’s edit as ink', () => {
    draw();
    const body = screen.getByTestId('draft-body');
    expect(body).toHaveAttribute('data-ink', 'engine');
    fireEvent.change(body, { target: { value: 'We can take five cases at 2,300.' } });
    expect(screen.getByTestId('draft-body')).toHaveAttribute('data-ink', 'person');
  });

  it('substitutes the manager’s name into the engine’s placeholder', () => {
    draw({ managerName: 'Ayşe' });
    expect((screen.getByTestId('draft-body') as HTMLTextAreaElement).value).toContain('Dear Ayşe');
  });

  it('says nothing about a send until the gateway has answered', () => {
    draw();
    expect(screen.queryByTestId('draft-sent')).toBeNull();
  });
});

describe('the engine’s flags name their rule', () => {
  it('prints each warning with the rule it tripped', () => {
    draw();
    expect(screen.getByTestId('draft-warnings')).toHaveTextContent(
      '8% above what they last charged',
    );
    expect(screen.getByTestId('draft-warnings')).toHaveTextContent('rule PRICE_ABOVE_LAST');
  });

  it('reads warnings out of either shape the gateway sends, and ignores junk', () => {
    expect(warningsOf([{ code: 'A', message: 'x' }])).toHaveLength(1);
    expect(warningsOf({ warnings: [{ code: 'A', message: 'x' }] })).toHaveLength(1);
    expect(warningsOf([{ code: 'A' }, null, 'nope', 7])).toHaveLength(0);
    expect(warningsOf(undefined)).toEqual([]);
    // A message with no code is still worth showing; the code says so.
    expect(warningsOf([{ message: 'x' }])[0].code).toBe('unnamed rule');
  });
});

describe('copies', () => {
  it('refuses what is not an address, and says so instead of dropping it silently', () => {
    draw();
    fireEvent.change(screen.getByTestId('draft-cc-input'), { target: { value: 'not-an-email' } });
    fireEvent.click(screen.getByTestId('draft-cc-add'));
    expect(screen.getByTestId('draft-cc-problem')).toHaveTextContent(/is not an email address/);
    expect(screen.queryByTestId('draft-cc-list')).toBeNull();
  });

  it('carries the copies into both the mint and the send', async () => {
    draw();
    fireEvent.change(screen.getByTestId('draft-cc-input'), { target: { value: 'Ops@House.example' } });
    fireEvent.click(screen.getByTestId('draft-cc-add'));
    await hold();
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    expect((api.post.mock.calls[0][1] as Record<string, unknown>).ccEmails).toEqual([
      'ops@house.example',
    ]);
    expect((api.post.mock.calls[1][1] as Record<string, unknown>).ccEmails).toEqual([
      'ops@house.example',
    ]);
  });
});

describe('throwing it away', () => {
  it('discards against the real route and says so if it could not', async () => {
    api.post.mockRejectedValue(new Error('gone'));
    draw();
    fireEvent.click(screen.getByTestId('draft-discard'));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/procurement/orders/ord-118/discard-draft'),
    );
    await waitFor(() =>
      expect(screen.getByTestId('draft-failure')).toHaveTextContent(/It is still waiting/),
    );
  });
});

describe('the words', () => {
  it('says what kind of letter this is, and shows an unmapped kind as itself', () => {
    expect(kindWords('COUNTER_OFFER')).toBe('a counter-offer');
    expect(kindWords('SOMETHING_NEW')).toBe('something new');
  });

  it('shows the subject the send will derive', () => {
    draw();
    expect(screen.getByTestId('draft-subject')).toHaveTextContent(
      subjectFor(REPLY),
    );
  });

  it('says when there is no address on file rather than leaving it blank', () => {
    draw({ reply: { ...REPLY, providerEmail: null } });
    expect(screen.getByTestId('draft-to')).toHaveTextContent(/no address on file/);
  });
});
