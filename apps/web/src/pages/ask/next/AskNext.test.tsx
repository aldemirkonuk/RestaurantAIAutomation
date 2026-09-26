/**
 * AskNext render contract — the three roles, and every way the page can fail
 * to answer (ADR 0145; ADR 0051).
 *
 * The gateway is the one that decides who may see what ("Rules in code,
 * label rows"): the catalogue it sends is already filtered to the role, and a
 * refused question comes back as a SAVED `not_permitted` folio carrying its
 * own line. So these tests mock the gateway's answers per role and pin that
 * the page renders them faithfully — a staff refusal is the server's line,
 * never a 503 and never a line the page wrote.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AxiosError, AxiosHeaders } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AskFolio, AskReading } from '@/services/api/ask';

const auth = vi.hoisted(() => ({ role: 'owner' as 'owner' | 'manager' | 'staff' | null }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'r1', activeRole: auth.role }),
}));

const api = vi.hoisted(() => ({
  catalogue: vi.fn(),
  folios: vi.fn(),
  folio: vi.fn(),
  submit: vi.fn(),
}));
vi.mock('@/services/api/ask', async () => {
  const actual = await vi.importActual<typeof import('@/services/api/ask')>('@/services/api/ask');
  return { ...actual, askApi: api, default: api };
});

import AskNext, { STAFF_LINE } from './AskNext';

function reading(id: string, title: string, over: Partial<AskReading> = {}): AskReading {
  return { id, version: 1, title, question: `${title}?`, subject: 'none', window: false, meaning: `${title} meaning`, ...over };
}

/** What `GET /ask/catalogue` sends each role on main (ROLE_POLICY, reading-data-classes.ts:180-182). */
const OWNER_SHELF = [
  reading('inventory.position', 'The recorded stock', { subject: 'item' }),
  reading('orders.open', 'The open orders'),
  reading('orders.due_today', "Today's deliveries"),
  reading('sales.check_activity', 'The recorded checks', { window: true }),
  reading('goals.targets', 'The posted targets'),
];
const STAFF_SHELF = [reading('inventory.position', 'The recorded stock', { subject: 'item' }), reading('orders.due_today', "Today's deliveries")];

function folio(over: Partial<AskFolio>): AskFolio {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    origin: 'page',
    utterance: 'q',
    status: 'complete',
    reading_id: null,
    reading_version: null,
    reading_args: {},
    reply_kind: null,
    answer: null,
    failure_reason: null,
    previous_folio_id: null,
    created_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    reading_chosen_by: 'model',
    pick_model: null,
    compose_model: null,
    ...over,
  };
}

function httpError(status: number | null, data?: unknown, code?: string): AxiosError {
  const e = new AxiosError('Request failed', code);
  if (status !== null) e.response = { status, data, statusText: '', headers: {}, config: { headers: new AxiosHeaders() } };
  return e;
}

function renderAt(path = '/ask') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/ask" element={<AskNext />} />
          <Route path="/ask/f/:folioId" element={<AskNext />} />
          <Route path="/sommelier" element={<Navigate to="/ask" replace state={{ from: 'sommelier' }} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function ask(text: string) {
  fireEvent.change(screen.getByLabelText('Your question'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.role = 'owner';
  api.catalogue.mockResolvedValue(OWNER_SHELF);
  api.folios.mockResolvedValue([]);
});

describe.each(['owner', 'manager'] as const)('%s', (role) => {
  beforeEach(() => {
    auth.role = role;
  });

  it('sees the whole shelf the gateway sent, grouped by register, and no staff line', async () => {
    renderAt();
    expect(await screen.findByText('The posted targets')).toBeTruthy();
    expect(screen.getByText('Stock')).toBeTruthy();
    expect(screen.getByText('Orders & receipts')).toBeTruthy();
    expect(screen.getByText('Sales, calendar, vendors, targets')).toBeTruthy();
    expect(screen.queryByTestId('ak-staff-line')).toBeNull();
    expect(await screen.findByText('No asks yet in this house.')).toBeTruthy();
  });

  it('reads a reading from the shelf with its period, as a page-chosen Reading', async () => {
    api.submit.mockResolvedValue(
      folio({
        reading_id: 'sales.check_activity',
        reading_version: 1,
        reading_chosen_by: 'page',
        reply_kind: 'reading',
        answer: {
          kind: 'reading',
          focus: [{ cellId: 'c1' }],
          finding: {
            readingId: 'sales.check_activity',
            readingVersion: 1,
            outcome: 'read',
            reason: null,
            asOf: new Date().toISOString(),
            trace: [{ relation: 'pos_checks', outcome: 'rows', rowsScanned: 312, matchedRows: 40, asOf: '' }],
            rows: [{ key: 'r', cells: [{ id: 'c1', key: 'checks', label: 'closed checks', value: 40, unit: null, provenance: 'derived' }] }],
          },
        },
      }),
    );
    renderAt();
    fireEvent.click(await screen.findByText('The recorded checks'));
    const composer = screen.getByRole('group', { name: 'Read: The recorded checks' });
    fireEvent.click(within(composer).getByRole('button', { name: 'Read it' }));
    expect(within(composer).getByRole('alert').textContent).toBe('Give the period as two dates.');
    expect(api.submit).not.toHaveBeenCalled();
    fireEvent.change(within(composer).getByLabelText('From'), { target: { value: '2026-09-01' } });
    fireEvent.change(within(composer).getByLabelText('To'), { target: { value: '2026-09-07' } });
    fireEvent.click(within(composer).getByRole('button', { name: 'Read it' }));
    await waitFor(() => expect(api.submit).toHaveBeenCalledTimes(1));
    const sent = api.submit.mock.calls[0][0];
    expect(sent).toMatchObject({ readingId: 'sales.check_activity', readingVersion: 1, args: { from: '2026-09-01', to: '2026-09-07' } });
    expect(sent.requestId).toMatch(/^[0-9a-f-]{36}$/);
    const doc = await screen.findByRole('article', { name: 'The open folio' });
    const fig = doc.querySelector('.ak-fig');
    expect(fig?.querySelector('b')?.textContent).toBe('40');
    expect(fig?.querySelector('i')?.textContent).toBe('computed from rows');
    expect(within(doc).getByText('pos_checks · 312 scanned · 40 matched')).toBeTruthy();
  });
});

describe('staff (founder, round 6: "Yes, own-work only")', () => {
  beforeEach(() => {
    auth.role = 'staff';
    api.catalogue.mockResolvedValue(STAFF_SHELF);
  });

  it("sees only the shelf the gateway sent for staff, and the approved line", async () => {
    renderAt();
    expect(await screen.findByText("Today's deliveries")).toBeTruthy();
    expect(screen.queryByText('The posted targets')).toBeNull();
    expect(screen.getByTestId('ak-staff-line').textContent).toBe(STAFF_LINE);
  });

  it("a money question comes back as the server's refusal line — saved, never a 503", async () => {
    const line = 'Refused for your role: it does not see money or sales.';
    api.submit.mockResolvedValue(
      folio({ utterance: 'What are our targets?', reading_id: 'goals.targets', reply_kind: 'not_permitted', answer: { kind: 'not_permitted', reason: 'class_not_visible', readingId: 'goals.targets', line } }),
    );
    renderAt();
    await screen.findByText("Today's deliveries");
    ask('What are our targets?');
    const doc = await screen.findByRole('article', { name: 'The open folio' });
    expect(within(doc).getByText('Not for your role')).toBeTruthy();
    expect(within(doc).getByTestId('ak-line').textContent).toBe(line);
    expect(screen.queryByTestId('ak-failure')).toBeNull();
  });

  it('a failed read keeps the withheld line and no size', async () => {
    api.submit.mockResolvedValue(
      folio({ reply_kind: 'could_not_read', answer: { kind: 'could_not_read', reason: 'withheld_for_your_role', line: 'Couldn’t read today’s deliveries right now.' } }),
    );
    renderAt();
    await screen.findByText("Today's deliveries");
    ask("what's coming today");
    expect((await screen.findByTestId('ak-line')).textContent).toBe('Couldn’t read today’s deliveries right now.');
  });
});

describe('ADR 0051: every failure is said in words', () => {
  it('the launch gate says Ask has not opened yet, and offers no retry', async () => {
    api.submit.mockRejectedValue(httpError(503, { statusCode: 503, message: 'Ask has not launched yet.' }));
    renderAt();
    await screen.findByText('The posted targets');
    ask('how much Barolo');
    const f = await screen.findByTestId('ak-failure');
    expect(f.getAttribute('data-kind')).toBe('not_open');
    expect(f.textContent).toMatch(/not opened yet/);
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull();
  });

  it('the rate limit keeps the server sentence', async () => {
    api.submit.mockRejectedValue(httpError(429, { message: 'Too many requests. Try again in 30 seconds.', retryAfter: 30 }));
    renderAt();
    await screen.findByText('The posted targets');
    ask('again');
    expect((await screen.findByTestId('ak-failure')).textContent).toMatch(/30 seconds/);
  });

  it('the 60 s budget running out re-sends the SAME question id on Check again', async () => {
    api.submit.mockRejectedValueOnce(httpError(null, undefined, 'ECONNABORTED'));
    api.submit.mockResolvedValueOnce(folio({ status: 'pending', answer: null }));
    renderAt();
    await screen.findByText('The posted targets');
    ask('slow one');
    expect((await screen.findByTestId('ak-failure')).getAttribute('data-kind')).toBe('timeout');
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(api.submit).toHaveBeenCalledTimes(2));
    expect(api.submit.mock.calls[1][0].requestId).toBe(api.submit.mock.calls[0][0].requestId);
    expect(await screen.findByText('Still being answered')).toBeTruthy();
  });

  it('a book that could not be read is never drawn as an empty book', async () => {
    api.folios.mockRejectedValue(httpError(503, { message: 'The folio book could not be read.' }));
    renderAt();
    expect((await screen.findByTestId('ak-book-failure')).textContent).toMatch(/could not be read/);
    expect(screen.queryByText('No asks yet in this house.')).toBeNull();
  });

  it('a shelf that could not be read says so, and typing still works', async () => {
    api.catalogue.mockRejectedValue(httpError(500, { message: 'boom' }));
    renderAt();
    expect((await screen.findByTestId('ak-shelf-failure')).textContent).toMatch(/Typing a question still works/);
    expect(screen.getByLabelText('Your question')).toBeTruthy();
  });

  it('the book shows its window as a floor at 50', async () => {
    api.folios.mockResolvedValue(Array.from({ length: 50 }, (_, i) => folio({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, utterance: `q${i}` })));
    renderAt();
    expect((await screen.findByTestId('ak-book-floor')).textContent).toMatch(/newest 50/);
  });
});

describe('the book and old folios', () => {
  it('an old folio opens by its address, and a clarify re-asks by the picked id', async () => {
    const id = '22222222-2222-4222-8222-222222222222';
    const clarify = folio({
      id,
      utterance: 'How much Chardonnay?',
      reading_id: 'inventory.position',
      reading_version: 1,
      reading_args: { subjectText: 'Chardonnay' },
      reply_kind: 'clarify',
      answer: {
        kind: 'clarify',
        reason: 'ambiguous_subject',
        finding: { readingId: 'inventory.position', readingVersion: 1, outcome: 'clarify', reason: 'ambiguous_subject', asOf: '', trace: [], rows: [], choices: [{ id: 'item-a', label: 'Chardonnay 2021' }] },
      },
    });
    api.folio.mockResolvedValue(clarify);
    api.folios.mockResolvedValue([clarify]);
    api.submit.mockResolvedValue(folio({ id: '33333333-3333-4333-8333-333333333333', status: 'pending' }));
    renderAt(`/ask/f/${id}`);
    const doc = await screen.findByRole('article', { name: 'The open folio' });
    expect(within(doc).getByText('Which one did you mean?')).toBeTruthy();
    fireEvent.click(within(doc).getByRole('button', { name: 'Chardonnay 2021' }));
    await waitFor(() => expect(api.submit).toHaveBeenCalledTimes(1));
    expect(api.submit.mock.calls[0][0]).toMatchObject({ readingId: 'inventory.position', previousFolioId: id, args: { subjectId: 'item-a' } });
    expect(api.submit.mock.calls[0][0].args.subjectText).toBeUndefined();
  });

  it('/sommelier lands on /ask and says so', async () => {
    renderAt('/sommelier');
    expect(await screen.findByText(/The Sommelier now opens here/)).toBeTruthy();
  });
});
