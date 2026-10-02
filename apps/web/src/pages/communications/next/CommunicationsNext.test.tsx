/**
 * CommunicationsNext render contract — the MERGE verdict's promises: the
 * glance strip answers only from settled queries (EM otherwise), rows stay
 * short with prose inside the expansion, an AI draft can never look sent
 * (prc-02), and the template sheet says what is going on before anything else.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { ProcurementHistoryItem } from '../../../hooks/queries/useConversationQueries';

const mockData = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

// Only the HOOK is replaced. `COMMS_SERVER_WINDOWS` passes through from the real
// module so the strip's floor note reads the same register the guard checks —
// a mock that restated the cap would be a second, silently-drifting copy of it.
vi.mock('./useCommsNextData', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useCommsNextData')>()),
  useCommsNextData: () => mockData.current,
}));

// ADR 0118 — the two legacy builders are no longer mounted from this page, so
// there is nothing to stub for them. What the page owns now is the composer and
// the house library; both are proved in their own files, and here they are
// stubbed so this file stays a test of the PAGE.
// COMMS-W34: "Leave with words" stands for Escape, a click outside or Close on
// a changed letter — the sheet hands its words to the page, then closes.
const HELD_LETTER = vi.hoisted(() => ({
  to: { providerId: 'p1', providerName: 'Bodega Álvaro', email: 'orders@bodega.example' },
  subject: 'Standing order',
  body: 'Six cases, as every week.',
  insights: [],
  templateId: '',
}));
// Each mount of the composer gets a number, so a test can see that Discard
// gave the page a fresh, empty composer rather than the one still holding words.
const composerMounts = vi.hoisted(() => ({ n: 0 }));
// What the composer hands back when left; a test may swap it for its own words.
const mockHeld = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }));
vi.mock('./Compose/ComposeSheet', async () => {
  const { useState } = await import('react');
  return { ComposeSheet: function ComposeSheet({
    open,
    prefill,
    onClose,
    onHold,
  }: {
    open: boolean;
    prefill?: { draftId?: string; subject?: string; body?: string } | null;
    onClose: () => void;
    onHold?: (w: typeof HELD_LETTER) => void;
  }) {
    const [mount] = useState(() => ++composerMounts.n);
    return open ? (
      <div data-testid="composer" data-draft={prefill?.draftId ?? ''} data-body={prefill?.body ?? ''} data-mount={mount}>
        <button
          type="button"
          onClick={() => {
            onHold?.((mockHeld.current ?? HELD_LETTER) as typeof HELD_LETTER);
            onClose();
          }}
        >
          Leave with words
        </button>
      </div>
    ) : null;
  } };
});

// ADR 0230 — the drafts list is its own module; only its hook is replaced, so
// the list's own three states render for real.
const mockDrafts = vi.hoisted(() => ({
  current: { drafts: [], failed: false, error: null, refetch: () => {} } as {
    drafts: unknown[] | null;
    failed: boolean;
    error: string | null;
    refetch: () => void;
    withheld?: boolean;
  },
}));
vi.mock('./Compose/HouseDrafts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./Compose/HouseDrafts')>()),
  useHouseDrafts: () => mockDrafts.current,
}));
const HELD_TEMPLATE = vi.hoisted(() => ({
  draft: { name: 'Price ask', category: 'price_query', subject: '', body: 'Could you quote' },
  opened: { name: '', category: 'price_query', subject: '', body: '' },
}));
vi.mock('./TemplateSheet', () => ({
  TemplateSheet: ({
    onClose,
    onHold,
    held,
  }: {
    onClose: () => void;
    onHold?: (h: typeof HELD_TEMPLATE) => void;
    held?: typeof HELD_TEMPLATE | null;
  }) => (
    <div data-testid="letter-library" data-held={held?.draft.body ?? ''}>
      <button
        type="button"
        onClick={() => {
          onHold?.(HELD_TEMPLATE);
          onClose();
        }}
      >
        Leave the template
      </button>
    </div>
  ),
}));
// The letters staff asked a manager to send (founder answer 3) are proved in
// LetterRequests.test.tsx; here the panel is stubbed and its standing is fixed.
const mockLetters = vi.hoisted(() => ({
  current: {
    data: { requests: [] as unknown[] } as { requests: unknown[] } | undefined,
    isError: false,
    dataUpdatedAt: 0,
    refetch: () => {},
  } as { data: { requests: unknown[] } | undefined; isError: boolean; dataUpdatedAt: number; refetch: () => void },
}));
vi.mock('./LetterRequestsPanel', () => ({
  LetterRequestsPanel: () => <div data-testid="letter-requests-stub" />,
  useLetterRequests: () => mockLetters.current,
}));
vi.mock('./Compose/useComposeData', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./Compose/useComposeData')>()),
  useLetterSenderStanding: () => ({ restaurantId: 'r1', canRelease: true }),
  // COMMS-W23: the pull-back itself is proved in QueuedPullBack.test.tsx.
  useQueuedLetters: () => ({ restaurantId: 'r1', queued: [], failed: false }),
}));

// ADR 0160 §113 Open item 3: senders and strangers live on this page now. The
// section is proved in `WhoIsWriting.test.tsx`; here it is a stub so this file
// stays a test of the PAGE and needs no auth context.
vi.mock('./WhoIsWriting', () => ({
  default: () => <section aria-label="Who is writing" data-testid="who-is-writing" />,
}));

import CommunicationsNext from './CommunicationsNext';
import { communicationsTour } from '../../../guidance/content/communications';

// The template sheet persists through `useTemplates` (P1), so the page tree now
// needs a query client. A fresh one per render keeps the tests independent.
function render(ui: React.ReactElement, at = '/communications') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(
    <MemoryRouter initialEntries={[at]}>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  );
}

function item(over: Partial<ProcurementHistoryItem>): ProcurementHistoryItem {
  return {
    id: 'c1',
    orderId: 'o1',
    providerId: 'p1',
    direction: 'OUTBOUND',
    emailType: 'PRICE_INQUIRY',
    status: 'SENT',
    roundCount: 1,
    createdAt: '2026-08-29T10:00:00Z',
    sentAt: '2026-08-29T10:00:00Z',
    draftContent: 'Dear Bodega, could you hold 6 at $18.40?',
    constraintFlags: null,
    rollingSummary: null,
    relayRefusalReason: null,
    orderNumber: 'PO-014',
    quantity: 6,
    wineName: 'Albariño 2022',
    providerName: 'Bodega Álvaro',
    ...over,
  };
}

const noFailures = {
  history: false,
  drafts: false,
};

const base = {
  rows: [] as ProcurementHistoryItem[],
  glance: { draftsPending: 1, sentLast30: 9, repliesLast30: 4 },
  // The drafts THEMSELVES, added 2026-09-06 with the drafted-reply panel: the
  // strip's figure and this list come from one read, so a mock that carries the
  // count and not the rows is a mock of a state the hook cannot produce.
  drafts: [] as unknown[],
  draftsKnown: true,
  hasData: true,
  isError: false,
  errorMessage: '',
  failed: { ...noFailures },
  failedSources: [] as string[],
  refetch: vi.fn(),
};

beforeEach(() => {
  mockData.current = { ...base };
  mockLetters.current = { data: { requests: [] }, isError: false, dataUpdatedAt: 0, refetch: () => {} };
  mockDrafts.current = { drafts: [], failed: false, error: null, refetch: () => {} };
});

describe('CommunicationsNext', () => {
  it('shows the glance strip from settled queries and EM for unanswered ones', () => {
    mockData.current = {
      ...base,
      glance: { draftsPending: 1, sentLast30: null, repliesLast30: null },
    };
    render(<CommunicationsNext />);
    expect(screen.getByText('Replies · 30 days')).toBeInTheDocument();
    // COMMS-W3: no figure counts a list the page does not show
    expect(screen.queryByText('Threads')).toBeNull();
    // two unanswered figures render as em dashes, never zeros
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  it('keeps the row short and the prose inside the expansion', () => {
    mockData.current = { ...base, rows: [item({})] };
    render(<CommunicationsNext />);
    expect(screen.getByText('Bodega Álvaro')).toBeInTheDocument();
    expect(screen.queryByText(/could you hold 6/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Bodega Álvaro'));
    expect(screen.getByText(/could you hold 6/)).toBeInTheDocument();
    // COMMS-W30: a pasted link or any unbroken run wraps inside the row, never
    // pushing the page sideways (measured live: 1067px of sideways scroll).
    expect(screen.getByText(/could you hold 6/).style.overflowWrap).toBe('anywhere');
  });

  it('says why a draft was held in words, never the rule code, and links its order (COMMS-W22)', () => {
    mockData.current = {
      ...base,
      rows: [
        item({
          status: 'PENDING_APPROVAL',
          constraintFlags: { hard: ['C-20', 'C-21', 'C-99'], annotating: [], soft_warnings: [], is_sensitive: false },
        }),
      ],
    };
    render(<CommunicationsNext />);
    fireEvent.click(screen.getByText('Bodega Álvaro'));
    expect(
      screen.getByText(
        'Held because its tone is heated, it holds personal details, and a rule this page has no words for yet.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/C-2[01]|C-99/)).toBeNull();
    expect(screen.getByRole('link', { name: 'order PO-014' })).toHaveAttribute('href', '/orders/o1');
  });

  it('an order number with no order id stays plain text (COMMS-W22)', () => {
    mockData.current = { ...base, rows: [item({ orderId: null })] };
    render(<CommunicationsNext />);
    fireEvent.click(screen.getByText('Bodega Álvaro'));
    expect(screen.getByText(/order PO-014/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /order PO-014/ })).toBeNull();
  });

  it('only a queued house letter carries the pull-back, without opening the row (COMMS-W23)', () => {
    mockData.current = {
      ...base,
      rows: [
        item({ id: 'q1', status: 'HOUSE_QUEUED' }),
        item({ id: 's1', status: 'SENT' }),
        item({ id: 'i1', status: 'HOUSE_QUEUED', direction: 'INBOUND' }),
      ],
    };
    render(<CommunicationsNext />);
    expect(screen.getAllByTestId('book-queued')).toHaveLength(1);
  });

  it('a draft can never look sent', () => {
    mockData.current = { ...base, rows: [item({ status: 'PENDING_APPROVAL' })] };
    render(<CommunicationsNext />);
    expect(screen.getByText('AI draft · not sent')).toBeInTheDocument();
    expect(screen.queryByText(/^Sent$/)).not.toBeInTheDocument();
  });

  // ADR 0099, founder 2026-09-21: a 400/403/422 relay refusal CLOSES the
  // draft ("Close, no retry") and the manager sees why on the draft. The chip
  // says it did not leave; the gateway's sentence is on the chip as a tooltip
  // AND printed in the opened row, since a tooltip never shows on touch.
  it('a relay refusal says Not sent and shows the gateway\'s sentence', () => {
    const said =
      "gateway refused the send: HTTP 403 — Conversation c1 is not one of this house's conversations. Nothing was sent.";
    mockData.current = {
      ...base,
      rows: [item({ status: 'RELAY_REFUSED', relayRefusalReason: said })],
    };
    render(<CommunicationsNext />);
    const chip = screen.getByText('Not sent');
    expect(chip).toHaveAttribute('title', said);
    expect(screen.queryByText(/^Sent$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/refused on the way out/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Bodega Álvaro'));
    expect(screen.getByText(/Not sent — it was refused on the way out: gateway refused the send: HTTP 403/)).toBeInTheDocument();
    // COMMS-W30: a long refusal reason wraps inside the row.
    expect(screen.getByText(/refused on the way out/).style.overflowWrap).toBe('anywhere');
    // COMMS-W27: the page's own words carry no engineer word; the reason is the server's, verbatim.
    expect(screen.queryByText(/relay/)).toBeNull();
  });

  it('APPROVED is approval, never dispatch (the audit blocker case)', () => {
    mockData.current = { ...base, rows: [item({ status: 'APPROVED' })] };
    render(<CommunicationsNext />);
    expect(screen.getByText('Approved · not sent')).toBeInTheDocument();
    expect(screen.queryByText(/^Sent$/)).not.toBeInTheDocument();
  });

  it('a truncated history window renders the sent figure as a floor', () => {
    mockData.current = {
      ...base,
      glance: { draftsPending: 1, sentLast30: 97, repliesLast30: 3, sentLast30Truncated: true },
    };
    render(<CommunicationsNext />);
    expect(screen.getByText('≥97')).toBeInTheDocument();
  });

  // ── ADR 0118: the legacy builders are retired from the rebuilt page ───────
  it('opens the house composer, not a template builder', () => {
    render(<CommunicationsNext />);
    expect(screen.queryByTestId('composer')).toBeNull();
    fireEvent.click(screen.getByText('Write a letter'));
    expect(screen.getByTestId('composer')).toBeInTheDocument();
  });

  it('opens the house letter library', () => {
    render(<CommunicationsNext />);
    fireEvent.click(screen.getByText("The house's letter templates"));
    expect(screen.getByTestId('letter-library')).toBeInTheDocument();
  });

  it('offers no template workshop at all', () => {
    render(<CommunicationsNext />);
    expect(screen.queryByText('Email template workshop')).toBeNull();
    expect(screen.queryByText('SMS template workshop')).toBeNull();
  });

  /**
   * The retirement as a RULE, not a habit.
   *
   * The two legacy builders still exist and the legacy `/communications` still
   * mounts them — that is ADR 0042's byte-for-byte promise and it is deliberate.
   * What must not come back is a rebuilt page importing them: the flag was
   * supposed to retire them, and a single `lazy(() => import(...))` slipped back
   * into any `next` file would quietly un-retire them with nothing failing.
   * Reading the source is the only check that can see that.
   */
  it('no rebuilt page imports the legacy template builders', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const { join } = await import('node:path');
    const root = join(process.cwd(), 'src', 'pages');
    const offenders: string[] = [];
    const walk = (dir: string, insideNext: boolean) => {
      // withFileTypes: the kind comes back WITH the entry, so there is no
      // separate stat of the same path to go stale between check and read.
      for (const dirent of readdirSync(dir, { withFileTypes: true })) {
        const entry = dirent.name;
        const full = join(dir, entry);
        if (dirent.isDirectory()) {
          walk(full, insideNext || entry === 'next');
          continue;
        }
        if (!insideNext || !/\.tsx?$/.test(entry)) continue;
        if (/\.test\.tsx?$/.test(entry)) continue;
        const source = readFileSync(full, 'utf8');
        // An IMPORT, not a mention: this file's own header explains what was
        // retired and names both builders, and a substring match would flag
        // the explanation as the offence.
        if (
          /(?:from|import\()\s*['"][^'"]*components\/documents\/(?:Gmail|SMS)TemplateBuilder/.test(
            source,
          )
        ) {
          offenders.push(full);
        }
      }
    };
    walk(root, false);
    expect(offenders).toEqual([]);
  });

  // ── ADR 0160 §113, Open item 3: senders and strangers moved here ──────────
  it('mounts the who-is-writing section (trust and add-vendor moved here from /promotions)', () => {
    render(<CommunicationsNext />);
    expect(screen.getByTestId('who-is-writing')).toBeInTheDocument();
  });

  /**
   * The sender and stranger reads must key their caches by house. The shared
   * `usePromotionsQueries` hooks do not (`['sender-reputation']`, `['prospects']`
   * are bare) and the house switcher does not clear the query cache — so a
   * value import of them here would show one house's trust ledger under another,
   * with a "Hold to trust" on it. Types may be imported; hooks may not.
   */
  it('no file here imports a HOOK from the un-keyed promotions queries', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const { join } = await import('node:path');
    const dir = join(process.cwd(), 'src', 'pages', 'communications', 'next');
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const dirent of readdirSync(d, { withFileTypes: true })) {
        const full = join(d, dirent.name);
        if (dirent.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(dirent.name) && !/\.test\.tsx?$/.test(dirent.name)) {
          const source = readFileSync(full, 'utf8');
          if (/import\s+(?!type\b)[^;]*from\s*['"][^'"]*usePromotionsQueries['"]/.test(source)) offenders.push(full);
        }
      }
    };
    walk(dir);
    expect(offenders).toEqual([]);
  });

  it('says a gateway failure in words', () => {
    mockData.current = {
      ...base,
      hasData: false,
      isError: true,
      errorMessage: 'down',
      failed: { ...noFailures, history: true },
      failedSources: ['the conversation book'],
    };
    render(<CommunicationsNext />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Part of this page could not be read: the conversation book. That does not mean there is nothing there.',
    );
    // COMMS-W33: the book says its own failure where its rows would be.
    expect(screen.getByTestId('book-unread')).toHaveTextContent(
      'The conversation book could not be read (down). That does not mean nothing was written.',
    );
  });

  // ── ADR 0083, amended 2026-09-25 (founder: "amend ADR 0083") ─────────────
  // The house page names the three sources it owns. The report schedules (a
  // table no migration creates) and the Gmail watch (deployment plumbing, now
  // on the admin desk) are not on it, so neither can raise its banner.
  it('does not render the schedules card, the schedules figure or the Gmail watch line', () => {
    render(<CommunicationsNext />);
    expect(screen.queryByText(/Report schedules/i)).toBeNull();
    expect(screen.queryByText(/Scheduled reports/i)).toBeNull();
    expect(screen.queryByText(/Saved schedules could not be loaded/i)).toBeNull();
    expect(screen.queryByText(/Gmail inbound watch/i)).toBeNull();
    expect(screen.queryByText(/NOT configured/i)).toBeNull();
    // healthy owned sources: no banner at all
    expect(screen.queryByRole('alert')).toBeNull();
  });

  // ── P4: every figure can say it failed, not only the history ──────────────
  it('a failed figure is distinguishable from an unanswered one', () => {
    mockData.current = {
      ...base,
      glance: { draftsPending: null, sentLast30: 9, repliesLast30: 2 },
      drafts: [],
      draftsKnown: false,
      failed: { ...noFailures, drafts: true },
      failedSources: ['the replies the house has written'],
    };
    render(<CommunicationsNext />);
    // the failed figure names its failure
    expect(screen.getByLabelText('Waiting on you: could not be read')).toBeInTheDocument();
    // the answered ones do not
    expect(screen.queryByLabelText(/Sent · 30 days: could not be/i)).toBeNull();
  });

  it('the banner names every failed owned source, not only the conversation book', () => {
    mockData.current = {
      ...base,
      glance: { draftsPending: null, sentLast30: null, repliesLast30: null },
      hasData: false,
      isError: true,
      errorMessage: 'history 500',
      drafts: [],
      draftsKnown: false,
      failed: { history: true, drafts: true },
      failedSources: ['the conversation book', 'the replies the house has written'],
    };
    render(<CommunicationsNext />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(
      'Part of this page could not be read: the conversation book and the replies the house has written. That does not mean there is nothing there.',
    );
    // COMMS-W33: no protocol, no bare dash standing for a word, no "in flight".
    expect(alert.querySelector('span')?.textContent).not.toMatch(/status code|in flight|—/);
    // and the retry is reachable when something other than the history failed
    expect(screen.getByText('Try again')).toBeInTheDocument();
  });

  // ── COMMS-W4 (2026-10-01): the rail says nothing about a channel it lacks ──
  it('the rail holds the two write acts and no paragraph about SMS', () => {
    render(<CommunicationsNext />);
    expect(screen.getByText('Write to a vendor')).toBeInTheDocument();
    expect(screen.queryByText(/SMS/)).toBeNull();
    expect(screen.queryByText(/stage for the messaging channel/i)).toBeNull();
  });

  // ── COMMS-W2 (2026-10-01): one place for everything waiting on a person ──
  it('counts the three waiting lists in one figure, and the heading agrees', () => {
    mockLetters.current = { ...mockLetters.current, data: { requests: [{ id: 'r1' }] } };
    mockDrafts.current = { ...mockDrafts.current, drafts: [
      { id: 'D1', providerId: 'p1', providerName: 'Bodega Álvaro', orderId: null, subject: 'A letter', to: 'v@x.example', category: null, creditId: null, body: 'Hello', createdAt: '2026-09-25T09:00:00Z' },
    ] };
    mockData.current = { ...base, drafts: [{ id: 'a1', orderId: 'o1' }, { id: 'a2', orderId: 'o2' }] };
    render(<CommunicationsNext />);
    expect(screen.getByText('Waiting on you · 4')).toBeInTheDocument();
    expect(screen.getByLabelText('Waiting on you')).toContainElement(screen.getByTestId('letter-requests-stub'));
  });

  it('says when an order’s draft stands in front of older ones (COMMS-W24)', () => {
    mockData.current = {
      ...base,
      drafts: [
        { id: 'a1', orderId: 'o1', orderNumber: 'PO-014', providerName: 'Bodega Álvaro', wineName: null, replaces: 1 },
        { id: 'a2', orderId: 'o2', orderNumber: 'PO-015', providerName: 'Cave Ruiz', wineName: null, replaces: 0 },
      ],
    };
    render(<CommunicationsNext />);
    expect(screen.getAllByTestId('draft-replaces')).toHaveLength(1);
    expect(screen.getByTestId('draft-replaces').textContent).toBe(
      'An earlier draft for this order was replaced by this one.',
    );
  });

  it('the waiting figure is unknown while any of its lists is unanswered', () => {
    mockDrafts.current = { ...mockDrafts.current, drafts: null };
    render(<CommunicationsNext />);
    expect(screen.getByText('Waiting on you · —')).toBeInTheDocument();
    expect(screen.queryByText('Nothing is waiting on you.')).toBeNull();
  });

  it('says plainly when nothing is waiting, once every list has answered', () => {
    render(<CommunicationsNext />);
    expect(screen.getByText('Waiting on you · 0')).toBeInTheDocument();
    expect(screen.getByText('Nothing is waiting on you.')).toBeInTheDocument();
  });
  // ── ADR 0084 put inbound vendor replies on this page; ADR 0083's row could
  //    not render one. All three of these throw on the merged tree. ──────────
  //
  // The fixture is the shape `conversation-ledger.spec.ts` asserts the gateway
  // returns for production's ten inbound rows: `direction: 'INBOUND'`,
  // `outbound_email_type` NULL, and `status` the column DEFAULT 'DRAFT' that
  // the inbound writer never sets.
  const inbound = () =>
    item({
      id: 'in-0',
      direction: 'INBOUND',
      emailType: null,
      status: 'DRAFT',
      orderId: null,
      orderNumber: null,
      quantity: null,
      wineName: null,
      draftContent: 'Vendor reply number 0',
    });

  it('renders an inbound vendor reply, which has no outbound email type', () => {
    mockData.current = { ...base, rows: [inbound()] };
    render(<CommunicationsNext />);
    expect(screen.getByText('Bodega Álvaro')).toBeInTheDocument();
    expect(screen.getByText(/Vendor reply/)).toBeInTheDocument();
  });

  it('never calls a vendor’s own reply an unsent AI draft', () => {
    mockData.current = { ...base, rows: [inbound()] };
    render(<CommunicationsNext />);
    // 'DRAFT' is the DEFAULT on an inbound row, not a lifecycle claim about it.
    expect(screen.queryByText('AI draft · not sent')).toBeNull();
    expect(screen.getByText('Received')).toBeInTheDocument();
  });

  it('renders a row whose status is null, and does not invent one for it', () => {
    // ADR 0084's deny-list admits `status.is.null` on purpose; the mapper
    // passes it straight through as `status: row.status`.
    mockData.current = { ...base, rows: [item({ status: null })] };
    render(<CommunicationsNext />);
    expect(screen.getByText('Bodega Álvaro')).toBeInTheDocument();
    expect(screen.getByText('no status recorded')).toBeInTheDocument();
    expect(screen.queryByText(/^Sent$/)).toBeNull();
    expect(screen.queryByText('AI draft · not sent')).toBeNull();
  });

  it('a house draft in the book is "Drafted · not sent", never sent (ADR 0230)', () => {
    mockData.current = { ...base, rows: [item({ status: 'HOUSE_DRAFT', emailType: 'HOUSE_LETTER' })] };
    render(<CommunicationsNext />);
    expect(screen.getByText('Drafted · not sent')).toBeInTheDocument();
    expect(screen.queryByText(/^Sent$/)).toBeNull();
    expect(screen.queryByText('AI draft · not sent')).toBeNull();
  });
});

describe('drafted letters (ADR 0230)', () => {
  const DRAFT = {
    id: 'D1',
    providerId: 'p1',
    providerName: 'Bodega Álvaro',
    orderId: null,
    subject: 'Credit request — invoice INV-77',
    to: 'orders@bodega.example',
    category: 'invoice_mismatch',
    creditId: 'c1',
    body: 'We are asking for a credit.',
    createdAt: '2026-09-25T09:00:00Z',
  };
  beforeEach(() => {
    mockDrafts.current = { drafts: [], failed: false, error: null, refetch: () => {} };
  });

  it('lists a waiting draft and opens it in the composer', () => {
    mockDrafts.current = { ...mockDrafts.current, drafts: [DRAFT] };
    render(<CommunicationsNext />);
    fireEvent.click(screen.getByText('Credit request — invoice INV-77'));
    expect(screen.getByTestId('composer').getAttribute('data-draft')).toBe('D1');
  });

  it("the credit's link opens its draft", () => {
    mockDrafts.current = { ...mockDrafts.current, drafts: [DRAFT] };
    render(<CommunicationsNext />, '/communications?draft=D1');
    expect(screen.getByTestId('composer').getAttribute('data-draft')).toBe('D1');
  });

  it('a link to a letter that is no longer a draft says so', () => {
    render(<CommunicationsNext />, '/communications?draft=D1');
    expect(screen.queryByTestId('composer')).toBeNull();
    expect(screen.getByText(/no longer a draft/)).toBeInTheDocument();
  });

  it('a failed drafts read is unknown, not none', () => {
    mockDrafts.current = { drafts: null, failed: true, error: 'boom', refetch: () => {} };
    render(<CommunicationsNext />);
    expect(screen.getByText('The drafted letters could not be read (boom). That does not mean none are waiting.')).toBeInTheDocument();
    expect(screen.queryByText('No drafted letters are waiting.')).toBeNull();
  });

  it('for a staff member the drafts are not theirs: no card, no failure, and the link says whose they are (COMMS-W31)', () => {
    mockDrafts.current = { drafts: [], withheld: true, failed: false, error: null, refetch: () => {} };
    render(<CommunicationsNext />, '/communications?draft=D1');
    expect(screen.getByText('The letter this link points to is opened by an owner or manager of this house.')).toBeInTheDocument();
    expect(screen.queryByText(/no longer a draft/)).toBeNull();
    expect(screen.queryByText('Drafted, not sent')).toBeNull();
    expect(screen.queryByText(/unknown, not none/)).toBeNull();
  });
});

// COMMS-W19: the house counter's "Replies waiting" act links here with
// `?reply=<orderId>` (shared batch 2, DASH-W16e).
describe('the counter link to a waiting reply', () => {
  const waiting = {
    id: 'a1',
    orderId: 'o1',
    orderNumber: 'PO-014',
    wineName: 'Albariño 2022',
    providerName: 'Bodega Álvaro',
    providerEmail: 'v@x.example',
    emailType: 'PRICE_INQUIRY',
    roundCount: 1,
    draftContent: 'Dear Bodega, could you hold 6 at $18.40?',
    createdAt: '2026-10-01T09:00:00Z',
    subject: 'Albariño 2022',
  };

  it('opens that order\'s drafted reply, as clicking its row does', () => {
    mockData.current = { ...base, drafts: [waiting] };
    render(<CommunicationsNext />, '/communications?reply=o1');
    expect(screen.getByText("The house's reply, drafted")).toBeInTheDocument();
    expect(screen.queryByTestId('reply-link-missing')).toBeNull();
  });

  it('says so when that reply is no longer waiting, and the note can be put away', () => {
    mockData.current = { ...base, drafts: [waiting] };
    render(<CommunicationsNext />, '/communications?reply=o9');
    expect(screen.queryByText("The house's reply, drafted")).toBeNull();
    expect(screen.getByTestId('reply-link-missing')).toHaveTextContent('That reply is no longer waiting.');
    fireEvent.click(screen.getByText('Dismiss'));
    expect(screen.queryByTestId('reply-link-missing')).toBeNull();
  });

  it('says the lookup failed, not that the reply is gone, when the drafts did not load', () => {
    mockData.current = { ...base, drafts: [], draftsKnown: false, failed: { ...noFailures, drafts: true } };
    render(<CommunicationsNext />, '/communications?reply=o1');
    expect(screen.getByTestId('reply-link-missing')).toHaveTextContent('could not be looked up');
    expect(screen.queryByText(/no longer waiting/)).toBeNull();
  });

  it('does not call a reply it opened "gone" once it is sent and leaves the list', () => {
    mockData.current = { ...base, drafts: [waiting] };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = () => (
      <MemoryRouter initialEntries={['/communications?reply=o1']}>
        <QueryClientProvider client={qc}>
          <CommunicationsNext />
        </QueryClientProvider>
      </MemoryRouter>
    );
    const { rerender } = rtlRender(tree());
    expect(screen.getByText("The house's reply, drafted")).toBeInTheDocument();
    mockData.current = { ...base, drafts: [] };
    rerender(tree());
    expect(screen.queryByTestId('reply-link-missing')).toBeNull();
  });

  it('drops the link from the address when the reply is closed', () => {
    mockData.current = { ...base, drafts: [waiting] };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function Where() {
      const l = useLocation();
      return <output data-testid="where">{l.pathname + l.search}</output>;
    }
    rtlRender(
      <MemoryRouter initialEntries={['/communications?reply=o1']}>
        <QueryClientProvider client={qc}>
          <CommunicationsNext />
          <Where />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(screen.getByTestId('where')).toHaveTextContent('/communications?reply=o1');
    fireEvent.click(screen.getAllByRole('button', { name: 'Leave it waiting' })[0]);
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/communications$/);
  });

  it('says nothing while the drafts are still being read', () => {
    mockData.current = { ...base, drafts: [], draftsKnown: false };
    render(<CommunicationsNext />, '/communications?reply=o1');
    expect(screen.queryByTestId('reply-link-missing')).toBeNull();
  });
});

// COMMS-W33 (founder, 2026-10-01: "A: keep, say when"). A page left open whose
// reads then fail keeps what it read, and every part says when that was.
describe('a read that fails after it answered (COMMS-W33)', () => {
  const AT = new Date();
  AT.setHours(20, 43, 0, 0);
  const at = AT.getTime();
  const reply = { id: 'a1', orderId: 'o1', orderNumber: 'PO-014', providerName: 'Bodega Álvaro', wineName: null, replaces: 0 };

  it('the book keeps its rows and figures and says when they are from', () => {
    mockData.current = {
      ...base,
      rows: [item({})],
      isError: true,
      hasData: true,
      errorMessage: 'Internal server error',
      historyAt: at,
      failed: { ...noFailures, history: true },
    };
    render(<CommunicationsNext />);
    expect(screen.getByLabelText('Sent · 30 days: 9 as it was at 20:43. It could not be read again.')).toHaveTextContent('9');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Part of this page could not be read again just now: the conversation book. What you see is as it was at 20:43.',
    );
    expect(screen.getByTestId('book-unread')).toHaveTextContent(
      'The conversation book could not be read again (Internal server error). This is as it was at 20:43; there may be more or fewer now.',
    );
    expect(screen.getByText('Bodega Álvaro')).toBeInTheDocument();
  });

  it('the replies it read stay openable, under a line saying when, and the figure agrees', () => {
    mockData.current = { ...base, drafts: [reply], failed: { ...noFailures, drafts: true }, draftsError: 'boom', draftsAt: at };
    render(<CommunicationsNext />);
    expect(screen.getByTestId('open-drafted-reply')).toBeEnabled();
    expect(screen.getByTestId('drafts-stale')).toHaveTextContent(
      'Could not be read again (boom). This is as it was at 20:43; there may be more or fewer now.',
    );
    expect(screen.queryByText(/none can be opened/)).toBeNull();
    // one line under the rows, never a second one claiming there were none
    expect(screen.queryByTestId('drafts-unread')).toBeNull();
    expect(screen.getByLabelText('Waiting on you: 1 as it was at 20:43. It could not be read again.')).toBeInTheDocument();
  });

  it('a zero that could not be read again is not "nothing waiting"', () => {
    mockData.current = { ...base, drafts: [], failed: { ...noFailures, drafts: true }, draftsError: 'boom', draftsAt: at };
    render(<CommunicationsNext />);
    expect(screen.queryByText('Nothing is waiting on you.')).toBeNull();
    expect(screen.getByTestId('drafts-unread')).toHaveTextContent(
      'The replies the house has written could not be read again (boom). At 20:43 there were none; there may be some now.',
    );
  });

  it('a first read that failed says so, and a link to a reply is "could not be looked up"', () => {
    mockData.current = { ...base, drafts: [], draftsKnown: false, failed: { ...noFailures, drafts: true }, draftsError: 'boom' };
    render(<CommunicationsNext />, '/communications?reply=o1');
    expect(screen.getByTestId('drafts-unread')).toHaveTextContent(
      'The replies the house has written could not be read (boom). That does not mean none are waiting.',
    );
    expect(screen.getByTestId('reply-link-missing')).toHaveTextContent(
      'That reply could not be looked up: the replies the house has written could not be read.',
    );
  });

  it('a link to a reply is not called gone when the replies could not be read again', () => {
    mockData.current = { ...base, drafts: [reply], failed: { ...noFailures, drafts: true }, draftsError: 'boom', draftsAt: at };
    render(<CommunicationsNext />, '/communications?reply=o9');
    expect(screen.queryByText('That reply is no longer waiting.')).toBeNull();
    expect(screen.getByTestId('reply-link-missing')).toHaveTextContent('could not be looked up');
  });

  it('"Try again" re-reads every read on the page', () => {
    const book = vi.fn();
    const letters = vi.fn();
    const drafted = vi.fn();
    const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    mockData.current = { ...base, refetch: book, drafts: [], draftsKnown: false, failed: { ...noFailures, drafts: true }, draftsError: 'boom' };
    mockLetters.current = { ...mockLetters.current, refetch: letters };
    mockDrafts.current = { ...mockDrafts.current, refetch: drafted };
    render(<CommunicationsNext />);
    fireEvent.click(screen.getByText('Try again'));
    expect(book).toHaveBeenCalledTimes(1);
    expect(letters).toHaveBeenCalledTimes(1);
    expect(drafted).toHaveBeenCalledTimes(1);
    const keys = invalidate.mock.calls.map(([f]) => JSON.stringify((f as { queryKey?: unknown })?.queryKey));
    expect(keys).toEqual(expect.arrayContaining(['["comms-senders"]', '["comms-strangers"]', '["house-letter-queued"]']));
    invalidate.mockRestore();
  });
});

describe('words left in a sheet stay on the page (COMMS-W34)', () => {
  const DRAFT = {
    id: 'D1',
    providerId: 'p1',
    providerName: 'Bodega Álvaro',
    orderId: null,
    subject: 'Credit request — invoice INV-77',
    to: 'orders@bodega.example',
    category: 'invoice_mismatch',
    creditId: 'c1',
    body: 'We are asking for a credit.',
    createdAt: '2026-09-25T09:00:00Z',
  };
  beforeEach(() => {
    mockData.current = { ...base };
    mockDrafts.current = { drafts: [], failed: false, error: null, refetch: () => {} };
    mockHeld.current = null;
  });

  it("a drafted letter's stub quotes the paragraph that was changed, not the draft's opening", () => {
    mockDrafts.current = { ...mockDrafts.current, drafts: [DRAFT] };
    mockHeld.current = { ...HELD_LETTER, subject: DRAFT.subject, body: `${DRAFT.body}\n\nFor both bottles, please.` };
    render(<CommunicationsNext />);
    fireEvent.click(screen.getByText('Credit request — invoice INV-77'));
    fireEvent.click(screen.getByText('Leave with words'));
    const stub = screen.getByRole('group', { name: 'Held here · unwritten' });
    expect(stub).toHaveTextContent('“For both bottles, please.”');
    expect(stub).not.toHaveTextContent('We are asking for a credit.');
  });

  it('a letter left with words is held under Write a letter, and Resume opens it again', () => {
    render(<CommunicationsNext />);
    expect(screen.queryByRole('group', { name: 'Held here · unwritten' })).toBeNull();
    fireEvent.click(screen.getByText('Write a letter'));
    fireEvent.click(screen.getByText('Leave with words'));
    expect(screen.queryByTestId('composer')).toBeNull();
    const stub = screen.getByRole('group', { name: 'Held here · unwritten' });
    expect(stub).toHaveTextContent('Standing order — Six cases, as every week.');
    expect(stub).toHaveTextContent('To Bodega Álvaro. Not sent. Kept on this page until you leave it.');
    fireEvent.click(screen.getByText('Resume'));
    expect(screen.getByTestId('composer')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Held here · unwritten' })).toBeNull();
    // The stub (and its Resume button) is gone; the sheet's opener is the row's own button.
    expect(screen.getByText('Write a letter').closest('button')).toHaveFocus();
  });

  it('Discard empties the composer, and Put it back returns the words to it', () => {
    render(<CommunicationsNext />);
    fireEvent.click(screen.getByText('Write a letter'));
    const holding = screen.getByTestId('composer').getAttribute('data-mount');
    fireEvent.click(screen.getByText('Leave with words'));
    fireEvent.click(screen.getByText('Discard'));
    expect(screen.getByText('Discarded · nothing was written')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Write a letter'));
    // A fresh composer, not the one that was still holding the words.
    expect(screen.getByTestId('composer').getAttribute('data-mount')).not.toBe(holding);
    expect(screen.getByTestId('composer').getAttribute('data-body')).toBe('');
    fireEvent.click(screen.getByText('Leave with words'));
    fireEvent.click(screen.getByText('Discard'));
    fireEvent.click(screen.getByText('Put it back'));
    expect(screen.getByRole('group', { name: 'Held here · unwritten' })).toBeInTheDocument();
    fireEvent.click(screen.getByText('Resume'));
    expect(screen.getByTestId('composer').getAttribute('data-body')).toBe('Six cases, as every week.');
  });

  it('changes to a drafted letter are held under that letter, and reopen it with them', () => {
    mockDrafts.current = { ...mockDrafts.current, drafts: [DRAFT] };
    render(<CommunicationsNext />);
    fireEvent.click(screen.getByText('Credit request — invoice INV-77'));
    expect(screen.getByTestId('composer').getAttribute('data-body')).toBe('We are asking for a credit.');
    fireEvent.click(screen.getByText('Leave with words'));
    const stub = screen.getByRole('group', { name: 'Held here · unwritten' });
    expect(stub.closest('li')).toHaveTextContent('Credit request — invoice INV-77');
    expect(stub).toHaveTextContent('The drafted letter itself stays as it was');
    expect(screen.getByText('Discard my changes')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Resume'));
    expect(screen.getByTestId('composer').getAttribute('data-draft')).toBe('D1');
    expect(screen.getByTestId('composer').getAttribute('data-body')).toBe('Six cases, as every week.');
    expect(screen.getByText('Credit request — invoice INV-77').closest('button')).toHaveFocus();
  });

  it('discarded changes to a drafted letter reopen it as it was drafted', () => {
    mockDrafts.current = { ...mockDrafts.current, drafts: [DRAFT] };
    render(<CommunicationsNext />);
    fireEvent.click(screen.getByText('Credit request — invoice INV-77'));
    fireEvent.click(screen.getByText('Leave with words'));
    fireEvent.click(screen.getByText('Discard my changes'));
    fireEvent.click(screen.getByText('Credit request — invoice INV-77'));
    expect(screen.getByTestId('composer').getAttribute('data-body')).toBe('We are asking for a credit.');
  });

  it('discarded changes to a drafted letter can be put back inside the window', () => {
    mockDrafts.current = { ...mockDrafts.current, drafts: [DRAFT] };
    render(<CommunicationsNext />);
    fireEvent.click(screen.getByText('Credit request — invoice INV-77'));
    fireEvent.click(screen.getByText('Leave with words'));
    fireEvent.click(screen.getByText('Discard my changes'));
    expect(screen.getByText('Discarded · nothing was written')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Put it back'));
    fireEvent.click(screen.getByText('Resume'));
    expect(screen.getByTestId('composer').getAttribute('data-body')).toBe('Six cases, as every week.');
  });

  it('a held letter and a held template sit side by side as two stubs, each with its own identity', () => {
    // Each hold counts from 1 in its own store; the two stubs are siblings, so
    // their keys must not collide (seen live: React's duplicate-key warning).
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<CommunicationsNext />);
    fireEvent.click(screen.getByText('Write a letter'));
    fireEvent.click(screen.getByText('Leave with words'));
    fireEvent.click(screen.getByText("The house's letter templates"));
    fireEvent.click(screen.getByText('Leave the template'));
    expect(screen.getAllByRole('group', { name: 'Held here · unwritten' })).toHaveLength(2);
    expect(err.mock.calls.flat().join(' ')).not.toMatch(/same key/);
    err.mockRestore();
  });

  it('an unsaved template is held under the templates, said as not saved, and handed back on Resume', () => {
    render(<CommunicationsNext />);
    fireEvent.click(screen.getByText("The house's letter templates"));
    expect(screen.getByTestId('letter-library').getAttribute('data-held')).toBe('');
    fireEvent.click(screen.getByText('Leave the template'));
    const stub = screen.getByRole('group', { name: 'Held here · unwritten' });
    expect(stub).toHaveTextContent('Price ask — Could you quote');
    expect(stub).toHaveTextContent('Not saved. Kept on this page until you leave it.');
    fireEvent.click(screen.getByText('Resume'));
    expect(screen.getByTestId('letter-library').getAttribute('data-held')).toBe('Could you quote');
    expect(screen.getByText("The house's letter templates").closest('button')).toHaveFocus();
    expect(screen.queryByRole('group', { name: 'Held here · unwritten' })).toBeNull();
  });
});

// COMMS-W35 (founder, 2026-10-01: "A: page + queue back"). What is open is in
// the address its links already use, so a refresh or a shared link keeps it.
describe('what the address keeps (COMMS-W35)', () => {
  const DRAFT = {
    id: 'D1',
    providerId: 'p1',
    providerName: 'Bodega Álvaro',
    orderId: null,
    subject: 'Credit request — invoice INV-77',
    to: 'orders@bodega.example',
    category: 'invoice_mismatch',
    creditId: 'c1',
    body: 'We are asking for a credit.',
    createdAt: '2026-09-25T09:00:00Z',
  };
  const waiting = {
    id: 'a1',
    orderId: 'o1',
    orderNumber: 'PO-014',
    wineName: 'Albariño 2022',
    providerName: 'Bodega Álvaro',
    providerEmail: 'v@x.example',
    emailType: 'PRICE_INQUIRY',
    roundCount: 1,
    draftContent: 'Dear Bodega, could you hold 6 at $18.40?',
    createdAt: '2026-10-01T09:00:00Z',
    subject: 'Albariño 2022',
  };
  function Where() {
    const l = useLocation();
    return <output data-testid="where">{l.pathname + l.search}</output>;
  }
  const qc = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (client: QueryClient, at = '/communications') => (
    <MemoryRouter initialEntries={[at]}>
      <QueryClientProvider client={client}>
        <CommunicationsNext />
        <Where />
      </QueryClientProvider>
    </MemoryRouter>
  );
  beforeEach(() => {
    mockData.current = { ...base };
    mockDrafts.current = { drafts: [], failed: false, error: null, refetch: () => {} };
    mockHeld.current = null;
  });

  it('a drafted letter opened from its row is in the address until it closes', () => {
    mockDrafts.current = { ...mockDrafts.current, drafts: [DRAFT] };
    rtlRender(tree(qc()));
    fireEvent.click(screen.getByText('Credit request — invoice INV-77'));
    expect(screen.getByTestId('where')).toHaveTextContent('/communications?draft=D1');
    fireEvent.click(screen.getByText('Leave with words'));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/communications$/);
    // Resume writes it again; the held words still come back with it.
    fireEvent.click(screen.getByText('Resume'));
    expect(screen.getByTestId('where')).toHaveTextContent('/communications?draft=D1');
    expect(screen.getByTestId('composer').getAttribute('data-body')).toBe('Six cases, as every week.');
  });

  it('a letter sent from its sheet is not called "no longer a draft" while the sheet is still open', () => {
    mockDrafts.current = { ...mockDrafts.current, drafts: [DRAFT] };
    const client = qc();
    const { rerender } = rtlRender(tree(client));
    fireEvent.click(screen.getByText('Credit request — invoice INV-77'));
    mockDrafts.current = { ...mockDrafts.current, drafts: [] };
    rerender(tree(client));
    expect(screen.getByTestId('composer')).toBeInTheDocument();
    expect(screen.queryByText(/no longer a draft/)).toBeNull();
  });

  it('a drafted reply opened from its row is in the address until it closes, and sending it is not a lost link', () => {
    mockData.current = { ...base, drafts: [waiting] };
    const client = qc();
    const { rerender } = rtlRender(tree(client));
    fireEvent.click(screen.getByTestId('open-drafted-reply'));
    expect(screen.getByTestId('where')).toHaveTextContent('/communications?reply=o1');
    mockData.current = { ...base, drafts: [] };
    rerender(tree(client));
    expect(screen.queryByTestId('reply-link-missing')).toBeNull();
    mockData.current = { ...base, drafts: [waiting] };
    rerender(tree(client));
    fireEvent.click(screen.getAllByRole('button', { name: 'Leave it waiting' })[0]);
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/communications$/);
  });
});

// COMMS-W36 (founder: "Page + queue shared", "Visible label"): the title names
// its own ink, so the old Dark theme a browser may still keep (`html.dark`,
// no control left since #576) cannot turn it pale on paper (it
// measured 1.13:1); the two lists inside "Waiting on you" are a level below
// it; and the conversation book, the one region a heading list skipped, has
// the house's small label.
describe('the outline and the title’s ink (COMMS-W36)', () => {
  beforeEach(() => {
    mockData.current = { ...base };
    mockDrafts.current = { drafts: [], failed: false, error: null, refetch: () => {} };
  });

  it('the title names its own ink', () => {
    render(<CommunicationsNext />);
    expect(screen.getByRole('heading', { level: 1, name: 'Communications' }).style.color).toBe('var(--ink-1, #211C16)');
  });

  it('reads as one outline: the waiting lists under "Waiting on you", the book labelled', () => {
    mockData.current = { ...base, drafts: [{ id: 'a1', orderId: 'o1' }, { id: 'a2', orderId: 'o2' }] };
    render(<CommunicationsNext />);
    // Only its level changed: the line it had as an h2 is kept, so nothing below it moves.
    expect(screen.getByRole('heading', { level: 3, name: 'The house has written · 2 waiting' }).style.lineHeight).toBe('2rem');
    expect(screen.queryByRole('heading', { level: 2, name: /The house has written/ })).toBeNull();
    const book = screen.getByRole('region', { name: 'Conversation book' });
    expect(within(book).getByRole('heading', { level: 2, name: 'The conversation book' })).toBe(
      within(book).getAllByRole('heading')[0],
    );
  });
});

// COMMS-W38 (founder: "#571's order, step 2 widened"): the tour keeps #571's job
// order; its second step points at the whole waiting region, so on a day with no
// drafted reply no step drops out ("Drafts waiting" is drawn only while one waits).
describe('the tour finds every step (COMMS-W38)', () => {
  beforeEach(() => {
    mockData.current = { ...base };
    mockDrafts.current = { drafts: [], failed: false, error: null, refetch: () => {} };
  });

  it('every step’s element is on the page with nothing drafted', () => {
    const { container } = render(<CommunicationsNext />);
    expect(container.querySelector('section[aria-label="Drafts waiting"]')).toBeNull();
    expect(communicationsTour.steps.map((s) => s.element)).toEqual([
      'section[aria-label="Conversation book"]',
      'section[aria-label="Waiting on you"]',
      '[data-tour="comms-write"]',
      'section[aria-label="Who is writing"]',
    ]);
    for (const step of communicationsTour.steps) {
      expect(container.querySelector(step.element), step.element).not.toBeNull();
    }
    expect(container.querySelector('[data-tour="comms-write"]')?.textContent).toMatch(/Write a letter/);
  });
});
