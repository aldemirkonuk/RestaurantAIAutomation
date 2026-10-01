/**
 * VEN-W14 — what a vendor's mail has told this house, on the vendor sheet.
 *
 * Pinned here: the three parts render in the house's words; a disagreement is
 * "was X, now Y" and never JSON; an offer carries its own currency and never a
 * "$"; any failed read is an error with Try again, never the empty sentence;
 * Confirm is hidden from anyone but an owner or a manager (W14b) and a failed
 * Confirm or search says so on its own line.
 *
 * `apiClient` is mocked, so these assert what this component does with the
 * gateway's answers, never that the gateway gives them.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn() }));
const auth = vi.hoisted(() => ({ role: 'manager' as string | null }));

vi.mock('../../../services/api/client', () => ({
  apiClient: api,
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'unknown error'),
}));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRole: auth.role, user: { role: auth.role } }),
}));

import { LearnedSection } from './LearnedSection';

const BANNED = [
  'Provider',
  'Digital Twin',
  'Actions',
  'knowledge entries',
  'Contradictions',
  'semantically',
  'PROVIDER',
  'RESTAURANT',
  'manual_outreach',
  'turns',
  'Intelligence',
];

const FACTS = {
  logistics: [
    {
      id: 'k1',
      subcategory: null,
      label: 'Delivers Tuesday and Friday',
      attributes: { days: ['Tuesday', 'Friday'] },
      confidence: 0.9,
      verified: false,
      version: 1,
      expiresAt: null,
      updatedAt: '2026-09-12T10:00:00Z',
      createdAt: '2026-09-12T10:00:00Z',
    },
  ],
  financial: [
    {
      id: 'k2',
      subcategory: null,
      label: 'Payment terms',
      attributes: { days: '45 days' },
      confidence: 0.8,
      verified: false,
      version: 2,
      expiresAt: null,
      updatedAt: '2026-09-20T10:00:00Z',
      createdAt: '2026-09-03T10:00:00Z',
    },
    {
      id: 'k3',
      subcategory: null,
      label: 'Minimum order',
      attributes: { amount: 1500, currency: 'usd' },
      confidence: 1,
      verified: true,
      verifiedByName: 'Aslı Kaya',
      version: 1,
      expiresAt: null,
      updatedAt: '2026-09-03T10:00:00Z',
      createdAt: '2026-09-03T10:00:00Z',
    },
  ],
};

const CHANGES = [
  {
    id: 'k2',
    label: 'Payment terms',
    attributes: { days: '45 days' },
    previous_value: { days: '30 days' },
    created_at: '2026-09-03T10:00:00Z',
    updated_at: '2026-09-20T10:00:00Z',
  },
];

const OFFERS = [
  {
    id: 'o1',
    provider_id: 'p1',
    name: 'Barolo',
    promo_type: 'volume_discount',
    description: null,
    conditions: { min_qty: 12 },
    discount_value: { amount: 40, currency: 'EUR' },
    applicable_wines: [],
    applicable_categories: null,
    start_date: null,
    end_date: '2026-10-31',
    is_recurring: false,
    status: 'active',
    times_used: 0,
    savings_realized: 0,
    created_at: '2026-09-15T10:00:00Z',
  },
];

const MESSAGES = [
  {
    id: 'm1',
    message_text: 'Our terms move to net 45 from October.',
    role: 'provider',
    channel: 'email',
    importance_score: 0.5,
    extracted_entities: {},
    language: 'en',
    created_at: '2026-09-20T10:00:00Z',
  },
  {
    id: 'm2',
    message_text: 'Noted, thanks.',
    role: 'restaurant',
    channel: 'email',
    importance_score: 0.2,
    extracted_entities: {},
    language: 'en',
    created_at: '2026-09-21T10:00:00Z',
  },
];

type Answers = {
  knowledge?: unknown;
  contradictions?: unknown;
  promotions?: unknown;
  memory?: unknown;
  fail?: string[];
};

function answer(a: Answers) {
  api.get.mockImplementation((url: string) => {
    const key = url.includes('/knowledge/contradictions')
      ? 'contradictions'
      : url.includes('/knowledge')
        ? 'knowledge'
        : url.includes('/promotions')
          ? 'promotions'
          : url.includes('/conversation-memory')
            ? 'memory'
            : 'unknown';
    if (a.fail?.includes(key)) return Promise.reject(new Error('down'));
    const data =
      key === 'knowledge'
        ? (a.knowledge ?? {})
        : key === 'contradictions'
          ? (a.contradictions ?? [])
          : key === 'promotions'
            ? (a.promotions ?? [])
            : (a.memory ?? []);
    return Promise.resolve({ data });
  });
}

function renderIt() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LearnedSection providerId="p1" providerName="Bir Dagitim" />
    </QueryClientProvider>,
  );
}

function full() {
  answer({ knowledge: FACTS, contradictions: CHANGES, promotions: OFFERS, memory: MESSAGES });
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.role = 'manager';
});

describe('LearnedSection', () => {
  it('loaded: three parts in the house words, ordered by kind, no banned words', async () => {
    full();
    const { container } = renderIt();

    expect(await screen.findByText('What their mail has told us')).toBeInTheDocument();
    expect(screen.getByText('Offers they have sent')).toBeInTheDocument();
    expect(screen.getByText('Messages with them')).toBeInTheDocument();

    const facts = screen.getAllByTestId('learned-fact').map((li) => li.textContent ?? '');
    // money first, delivery after — the kind orders the list
    expect(facts[0]).toContain('Payment terms');
    expect(facts[1]).toContain('Minimum order: 1,500 USD');
    expect(facts[1]).toContain('Confirmed · Aslı Kaya');
    expect(facts[2]).toMatch(/^Delivers Tuesday and Friday(?!:)/);
    expect(facts[2]).toMatch(/from their message of 12 Sep · not confirmed/);

    const msgs = screen.getAllByTestId('learned-message').map((li) => li.textContent ?? '');
    expect(msgs[0]).toMatch(/^Them · email · 20 Sep/);
    expect(msgs[1]).toMatch(/^You · email · 21 Sep/);
    expect(screen.getByRole('searchbox', { name: 'Find in messages' })).toBeInTheDocument();

    const text = container.textContent ?? '';
    for (const w of BANNED) expect(text).not.toContain(w);
    expect(text).not.toMatch(/\w_\w/);
    expect(text).not.toMatch(/[{}]/);
  });

  it('a disagreement reads "was X, now Y" with both dates, never JSON', async () => {
    full();
    renderIt();

    const row = (await screen.findAllByTestId('learned-fact'))[0];
    expect(row).toHaveTextContent('Payment terms: was 30 days, now 45 days');
    expect(row).toHaveTextContent('their message of 20 Sep says otherwise than 3 Sep — check before you rely on it');
    expect(row.textContent).not.toMatch(/[{}"]/);
  });

  it('a disagreement whose values cannot be phrased says a plain sentence, not JSON', async () => {
    answer({
      knowledge: { financial: [{ ...FACTS.financial[0], attributes: { a: 1, b: { c: 2 } } }] },
      contradictions: [{ ...CHANGES[0], attributes: { a: 1, b: { c: 2 } }, previous_value: { x: [1, { y: 2 }] } }],
    });
    renderIt();

    const row = (await screen.findAllByTestId('learned-fact'))[0];
    expect(row).toHaveTextContent('Payment terms: their mail has said two different things');
    expect(row.textContent).not.toMatch(/[{}]/);
  });

  it('an offer shows its own currency and never a "$"', async () => {
    full();
    const { container } = renderIt();

    const offer = (await screen.findAllByTestId('learned-offer'))[0];
    expect(offer).toHaveTextContent('Barolo — 40 EUR off, 12 or more');
    expect(offer).toHaveTextContent('until 31 Oct · from their message of 15 Sep');
    expect(container.textContent).not.toContain('$');
  });

  it('an offer with no stated currency says so rather than guessing', async () => {
    answer({ promotions: [{ ...OFFERS[0], discount_value: { amount: 40 } }] });
    renderIt();

    expect(await screen.findByTestId('learned-offer')).toHaveTextContent('40 (currency not stated) off');
  });

  it('empty: the empty sentence, and only when every read answered', async () => {
    answer({});
    renderIt();

    expect(
      await screen.findByText(
        'Nothing learned from their mail yet. Facts, offers and messages appear here once they write to this house.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('error: any failed read is the error sentence, never the empty one, and Try again refetches', async () => {
    answer({ fail: ['promotions'] });
    renderIt();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'Could not reach what was learned about them — this is not the same as nothing learned.',
    );
    expect(screen.queryByText(/Nothing learned from their mail yet/)).not.toBeInTheDocument();

    const before = api.get.mock.calls.filter(([u]) => String(u).includes('/promotions')).length;
    full();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Offers they have sent')).toBeInTheDocument();
    const after = api.get.mock.calls.filter(([u]) => String(u).includes('/promotions')).length;
    expect(after).toBeGreaterThan(before);
  });

  it('a manager confirms a fact through the verify route', async () => {
    full();
    api.put.mockResolvedValue({ data: {} });
    renderIt();

    fireEvent.click(await screen.findByRole('button', { name: 'Confirm: Delivers Tuesday and Friday' }));

    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/providers/p1/knowledge/k1/verify'));
  });

  it('a failed Confirm says so on its own line', async () => {
    full();
    api.put.mockRejectedValue({
      response: { status: 403, data: { message: 'Confirming is a manager’s or an owner’s decision.' } },
    });
    renderIt();

    fireEvent.click(await screen.findByRole('button', { name: 'Confirm: Delivers Tuesday and Friday' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Confirming is a manager’s or an owner’s decision.');
  });

  it.each(['staff', null])('Confirm is hidden for role %s (W14b)', async (role) => {
    auth.role = role;
    full();
    renderIt();

    await screen.findByText('What their mail has told us');
    expect(screen.queryByRole('button', { name: /^Confirm/ })).not.toBeInTheDocument();
    // what was already confirmed still reads as confirmed
    expect(screen.getByText('Confirmed · Aslı Kaya')).toBeInTheDocument();
  });

  it('the owner sees Confirm too', async () => {
    auth.role = 'owner';
    full();
    renderIt();

    expect(await screen.findByRole('button', { name: 'Confirm: Delivers Tuesday and Friday' })).toBeInTheDocument();
  });

  it('Find in messages: matches replace the list, and a failed search is an error line, not "no match"', async () => {
    full();
    api.post.mockResolvedValueOnce({ data: [MESSAGES[0]] });
    renderIt();

    const box = await screen.findByRole('searchbox', { name: 'Find in messages' });
    fireEvent.change(box, { target: { value: 'net 45' } });
    fireEvent.submit(box.closest('form') as HTMLFormElement);

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/providers/p1/conversation-memory/search', { query: 'net 45' }),
    );
    expect(await screen.findByText(/1 message contains “net 45”/)).toBeInTheDocument();
    expect(screen.getAllByTestId('learned-message')).toHaveLength(1);

    api.post.mockRejectedValueOnce(new Error('down'));
    fireEvent.change(box, { target: { value: 'barolo' } });
    fireEvent.submit(box.closest('form') as HTMLFormElement);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The search could not reach their messages — this is not the same as no match.',
    );
    expect(screen.queryByText(/No message with them contains/)).not.toBeInTheDocument();
  });
});
