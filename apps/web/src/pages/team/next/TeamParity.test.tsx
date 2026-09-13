/**
 * The parity build's own contracts (2026-09-04).
 *
 * Every assertion here is about something the desk could not do on the Mudavym
 * layer before this pass, or about a sentence the page must not print. The two
 * that are defects rather than features:
 *
 *   · the roster showed "Team member" for every person in the demo tenant
 *     (3 of 3, measured) because a gateway read named a column `public.users`
 *     does not have; the placeholder is durable in the rows, so the page has to
 *     resolve a name it can stand behind;
 *   · `labor_target_pct` is `numeric(5,2) DEFAULT 28 NOT NULL`, so a stored 28
 *     with no provenance is indistinguishable from nobody choosing one.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within , configure } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// The parity build mounts five queries and eight components on first paint, so
// a settled assertion can take longer than RTL's 1s default — measured at
// ~1.5s for the gap panel. Raised deliberately: the assertions below are
// unchanged, and a flaky timeout would read as a broken page.
configure({ asyncUtilTimeout: 5000 });


const api = vi.hoisted(() => ({
  notes: { weekStart: '2026-08-31', notes: [] as unknown[], readable: true, reason: null } as Record<string, unknown>,
  createTeamNote: vi.fn(() => Promise.resolve({ id: 'n1', addressed: 1, delivered: { inbox: true, push: 1 }, channels: ['inbox', 'push'] })),
  week: {} as Record<string, unknown>,
  members: [] as unknown[],
  certs: [] as unknown[],
  templates: [] as unknown[],
  timeOff: [] as unknown[],
  trail: {
    entries: [] as unknown[],
    readable: true,
    reason: null as string | null,
    oldestAt: null as string | null,
    recordingSince: '2026-09-03',
  },
  broadcast: vi.fn(() => Promise.resolve({ audience: 'selected', recipients: { targeted: 1, notified: 1 }, notified: 1, inbox: true })),
  createShift: vi.fn(() => Promise.resolve({})),
}));

vi.mock('../../../services/api/team', () => ({
  getTeamNotes: () => Promise.resolve(api.notes),
  createTeamNote: api.createTeamNote,
  openTeamNote: vi.fn(() => Promise.resolve({ recorded: true, alreadyOpen: false })),
  /**
   * ADR 0121 — the crew-text leg reads whether this house has a sender. The
   * fixture is the MEASURED state of every house on this deployment: none, and
   * a transport that is not built. A stub reporting a connected sender would
   * make the composer's disabled control look like a bug in the test rather
   * than the product's true answer.
   */
  getTextSenders: () =>
    Promise.resolve({
      senders: { whatsapp: null, sms: null },
      readable: true,
      reason: null,
      transport: {
        built: false,
        words:
          'No provider credential for a per-house sender exists on this deployment.',
      },
      myConsent: { consent: null, readable: true, reason: null },
      crewConsents: 0,
    }),
  getWeek: () => Promise.resolve(api.week),
  getTeamMembers: () => Promise.resolve(api.members),
  getCertifications: () => Promise.resolve(api.certs),
  getCoverageTemplates: () => Promise.resolve(api.templates),
  getTimeOff: () => Promise.resolve(api.timeOff),
  getMyWeek: () => Promise.resolve({}),
  getMemberPerformance: () => Promise.resolve({ hasData: false }),
  createCoverageTemplate: vi.fn(() => Promise.resolve({})),
  createShift: api.createShift,
  updateShift: vi.fn(() => Promise.resolve({})),
  deleteShift: vi.fn(() => Promise.resolve(undefined)),
  reportCallout: vi.fn(() => Promise.resolve({})),
  offerCover: vi.fn(() => Promise.resolve({})),
  assignCover: vi.fn(() => Promise.resolve({})),
  acknowledgeSchedule: vi.fn(() => Promise.resolve({})),
  createSchedule: vi.fn(() => Promise.resolve({ id: 'sch1' })),
  publishSchedule: vi.fn(() => Promise.resolve({})),
  copyWeek: vi.fn(() => Promise.resolve({})),
  createTimeOff: vi.fn(() => Promise.resolve({})),
  reviewTimeOff: vi.fn(() => Promise.resolve({})),
  createTeamMember: vi.fn(() => Promise.resolve({})),
  updateTeamMember: vi.fn(() => Promise.resolve({})),
  deleteTeamMember: vi.fn(() => Promise.resolve(undefined)),
  ingestSales: vi.fn(() => Promise.resolve({})),
  ingestSalesBatch: vi.fn(() => Promise.resolve({})),
  broadcast: api.broadcast,
}));

vi.mock('../../../services/api/client', () => ({
  apiClient: { get: () => Promise.resolve({ data: api.trail }) },
}));

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    activeRestaurantId: 'r1',
    activeRole: 'owner',
    user: { id: 'u1', restaurantId: 'r1', role: 'owner' },
  }),
}));

vi.mock('./MyShiftsNext', () => ({ MyShiftsNext: () => <div>My Shifts</div> }));

import TeamNext from './TeamNext';
import { resolveName, ROSTER_PLACEHOLDER } from './tm-format';
import { readLabourTarget } from './useTeamNextData';

const member = (over: Record<string, unknown> = {}) => ({
  id: 'm1',
  restaurant_id: 'r1',
  user_id: 'u-real',
  display_name: 'Ada Lovelace',
  email: null,
  phone: null,
  avatar_url: null,
  position: 'Sommelier',
  employment_type: 'full_time',
  home_location: null,
  hourly_wage: null,
  skills: [],
  hire_date: null,
  status: 'active',
  notes: null,
  role: 'manager',
  accountLinked: true,
  linkedUser: null,
  ...over,
});

function weekPayload(over: Record<string, unknown> = {}) {
  return {
    schedule: { id: 'sch1', restaurant_id: 'r1', week_start: '2026-08-31', status: 'draft', published_at: null },
    shifts: [],
    coverage: { days: [], totalGaps: 0 },
    labor: { enabled: false, totalHours: 0 },
    receipts: [],
    settings: { restaurant_id: 'r1', labor_tracking_enabled: false, wage_visible: true, labor_target_pct: null, configured: false },
    ...over,
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  api.week = weekPayload();
  api.members = [];
  api.certs = [];
  api.templates = [];
  api.timeOff = [];
  api.trail = { entries: [], readable: true, reason: null, oldestAt: null, recordingSince: '2026-09-03' };
  api.broadcast.mockClear();
});

/* ── the name ────────────────────────────────────────────────────────────── */

describe('a roster row is named, or says it is not', () => {
  it('never renders the gateway placeholder as a name', () => {
    const n = resolveName({ display_name: ROSTER_PLACEHOLDER, email: null, linkedUser: null });
    expect(n.known).toBe(false);
    expect(n.text).toBe('No name on file');
    expect(n.text).not.toBe(ROSTER_PLACEHOLDER);
  });

  it('takes the linked account name when the stored one is the placeholder', () => {
    const n = resolveName({
      display_name: ROSTER_PLACEHOLDER,
      email: null,
      linkedUser: { name: 'Demo User', email: 'demo@example.test' },
    });
    expect(n).toMatchObject({ text: 'Demo User', known: true });
    expect(n.source).toMatch(/linked account/);
  });

  it('renders the resolved name in the grid, not the placeholder', async () => {
    api.members = [
      member({ id: 'm1', display_name: ROSTER_PLACEHOLDER, linkedUser: { name: 'Demo User' } }),
    ];
    render(<TeamNext />, { wrapper });
    expect(await screen.findByText('Demo User')).toBeInTheDocument();
    expect(screen.queryByText(ROSTER_PLACEHOLDER)).not.toBeInTheDocument();
  });
});

/* ── the operating half ──────────────────────────────────────────────────── */

describe('the desk can schedule', () => {
  it('opens the roster sheet from the header and expands a row in place', async () => {
    api.members = [member({ display_name: 'Ada Lovelace' })];
    render(<TeamNext />, { wrapper });
    // The header count is an em dash until the roster answers, so wait for the
    // COUNT rather than for the word — the two are different states.
    fireEvent.click(await screen.findByRole('button', { name: 'People · 1' }));
    const sheet = await screen.findByRole('dialog', { name: 'People' });
    const row = within(sheet).getByRole('button', { expanded: false });
    fireEvent.click(row);
    expect(within(sheet).getByRole('button', { expanded: true })).toBeInTheDocument();
    expect(within(sheet).getByText('Sommelier')).toBeInTheDocument();
  });

  it('opens a shift sheet from an empty cell in the week grid', async () => {
    api.members = [member({ display_name: 'Ada Lovelace' })];
    render(<TeamNext />, { wrapper });
    const adds = await screen.findAllByRole('button', { name: /Add a shift for Ada Lovelace/ });
    fireEvent.click(adds[0]);
    // The overlay's accessible name is ALWAYS its `label` (sketch 103 · 1e,
    // 2026-09-06). It used to be the Fraunces title whenever one existed, which
    // discarded the required `label` on every live row — finder B, D1. Here the
    // title reads "Add a shift" and the label reads "Add shift"; the ear now
    // gets the label. (The label is still a title rather than a contract
    // sentence — the primitive warns about that in dev; rewriting it belongs to
    // the page, not to the primitive.)
    expect(await screen.findByRole('dialog', { name: 'Add shift' })).toBeInTheDocument();
    expect(screen.getByText('Open shift — nobody assigned')).toBeInTheDocument();
  });

  it('names what a re-publish destroys and seals it rather than taking one click', async () => {
    api.week = weekPayload({
      schedule: { id: 'sch1', restaurant_id: 'r1', week_start: '2026-08-31', status: 'published', published_at: '2026-09-01' },
      receipts: [{ member_id: 'm1', seen_at: '2026-09-02T00:00:00Z' }],
    });
    render(<TeamNext />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: /Re-publish/ }));
    const panel = await screen.findByRole('dialog', { name: 'Re-publish this week' });
    expect(within(panel).getByText(/clears every read receipt/)).toBeInTheDocument();
    expect(within(panel).getByText(/\(1 so far\)/)).toBeInTheDocument();
    // The seal, not a plain confirm: this one deletes.
    expect(within(panel).getByText(/Hold to re-publish/)).toBeInTheDocument();
  });

  it('names what copy-week deletes before it runs', async () => {
    api.week = weekPayload({ shifts: [] });
    render(<TeamNext />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: 'Copy last week' }));
    const panel = await screen.findByRole('dialog', { name: 'Copy last week' });
    expect(within(panel).getByText(/all 0 shifts already on it/)).toBeInTheDocument();
    expect(within(panel).getByText(/Hold to replace the week/)).toBeInTheDocument();
  });
});

/* ── the controls that are not real ──────────────────────────────────────── */

describe('a control whose backend does not exist is disabled and says why', () => {
  it('offers no working import', async () => {
    render(<TeamNext />, { wrapper });
    const importBtn = await screen.findByRole('button', { name: /Import a sheet/ });
    expect(importBtn).toBeDisabled();
    expect(screen.getByText(/no import route exists/i)).toBeInTheDocument();
  });
});

/* ── inline comms ────────────────────────────────────────────────────────── */

describe('the crew note is a record, not a memory of this page', () => {
  it('says the register answered and holds nothing, not that this page forgot', async () => {
    render(<TeamNext />, { wrapper });
    // Pre-2026-09-04 this said "No note has been sent FROM THIS PAGE" and had
    // to caption an empty strip "not from here, this session", because
    // `broadcast` left nothing to read back.
    expect(await screen.findByText(/Nothing has been written about/)).toBeInTheDocument();
    expect(screen.queryByText(/from this page/i)).not.toBeInTheDocument();
  });

  it('writes a record against the week rather than firing a broadcast', async () => {
    api.members = [member({ display_name: 'Ada Lovelace' })];
    render(<TeamNext />, { wrapper });
    const openers = await screen.findAllByRole('button', { name: /Write a note/ });
    expect(openers).toHaveLength(2);
    fireEvent.click(openers[1]);
    const sheet = await screen.findByRole('dialog', { name: 'A note to the crew' });
    fireEvent.change(within(sheet).getByRole('textbox'), {
      target: { value: 'Saturday moved to seven.' },
    });
    fireEvent.click(within(sheet).getByRole('button', { name: /Send to 1/ }));
    await vi.waitFor(() => expect(api.createTeamNote).toHaveBeenCalled());
    expect(api.createTeamNote).toHaveBeenCalledWith(
      expect.objectContaining({
        weekStart: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        body: 'Saturday moved to seven.',
        memberIds: ['m1'],
      }),
    );
    // The channel decision is the gateway's now — inbox and push, no mailbox.
    expect(api.broadcast).not.toHaveBeenCalled();
  });

  it('reads a note back with who has opened it, by name', async () => {
    api.members = [member({ display_name: 'Ada Lovelace' })];
    api.notes = {
      weekStart: '2026-08-31',
      readable: true,
      reason: null,
      notes: [
        {
          id: 'n1',
          weekStart: '2026-08-31',
          scheduleId: null,
          body: 'Saturday moved to seven.',
          channels: ['inbox', 'push'],
          createdAt: '2026-08-31T09:00:00Z',
          authorUserId: 'u1',
          recipients: [
            { memberId: 'm1', name: 'Ada Lovelace', openedAt: '2026-08-31T10:00:00Z' },
            { memberId: 'm2', name: 'Bo', openedAt: null },
          ],
          openedCount: 1,
          addressedCount: 2,
        },
      ],
    };
    render(<TeamNext />, { wrapper });
    expect(await screen.findByText('Saturday moved to seven.')).toBeInTheDocument();
    expect(
      screen.getByText(/1 of 2 have opened it: Ada Lovelace/),
    ).toBeInTheDocument();
  });

  it('says the note register could not be read rather than showing a quiet week', async () => {
    api.notes = { weekStart: '2026-08-31', notes: [], readable: false, reason: 'connection reset' };
    render(<TeamNext />, { wrapper });
    expect(
      await screen.findByText(/note register could not be read/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Nothing has been written about/)).not.toBeInTheDocument();
  });

  it('keeps the schedule receipt and the note receipt apart', async () => {
    api.members = [member({ display_name: 'Ada Lovelace' })];
    api.week = weekPayload({
      schedule: { id: 'sch1', restaurant_id: 'r1', week_start: '2026-08-31', status: 'published', published_at: '2026-09-01' },
      receipts: [{ member_id: 'm1', seen_at: '2026-09-02T00:00:00Z' }],
    });
    render(<TeamNext />, { wrapper });
    expect(await screen.findByText(/1 of 1 have opened it: Ada Lovelace\./)).toBeInTheDocument();
    // The caption is what stops "saw the roster" being read as "read the note".
    expect(screen.getByText(/records opening the SCHEDULE/)).toBeInTheDocument();
  });
});

/* ── the record ──────────────────────────────────────────────────────────── */

describe('the labour target is read against its column default', () => {
  it('reads a stored 28 with no provenance as no target at all', () => {
    const r = readLabourTarget(28, false);
    expect(r.pct).toBeNull();
    expect(r.why).toMatch(/column's own default/);
  });

  it('reads a chosen figure as a target, and says nothing records who set it', () => {
    const r = readLabourTarget(31, false);
    expect(r.pct).toBe(31);
    expect(r.why).toMatch(/No column records who set it/);
  });

  it('renders "No target set" on screen for a stored 28 with no provenance', async () => {
    // The pure function is tested above; this is the same rule reaching the
    // DOM. The register row must not print "28%" as though the house chose it,
    // and the labour panel beside it must not measure the week against it.
    api.week = weekPayload({
      labor: {
        enabled: true,
        totalHours: 40,
        totalCost: 1200,
        costComplete: true,
        pricedShifts: 4,
        unpricedShifts: 0,
        // `numeric(5,2) DEFAULT 28 NOT NULL` — a row that exists always carries
        // a number, and 28 is indistinguishable from nobody choosing one.
        targetPct: 28,
        overtime: [],
      },
      settings: {
        restaurant_id: 'r1',
        labor_tracking_enabled: true,
        wage_visible: true,
        labor_target_pct: 28,
        configured: true,
        updated_at: '2026-09-01T08:00:00Z',
      },
    });
    render(<TeamNext />, { wrapper });

    // Wait for the WEEK, not just for the section: before the query answers
    // the target is "no row on file", which is a different sentence about a
    // different state and would let this test pass for the wrong reason.
    // TWO matches on purpose: the register row states it, and the labour panel
    // repeats it where the figure would otherwise have been measured against.
    expect(await screen.findAllByText(/column's own default/)).toHaveLength(2);
    const section = screen.getByRole('region', { name: 'How this desk is configured' });
    expect(within(section).getByText('Labour target')).toBeInTheDocument();
    expect(within(section).getByText(/No target set/)).toBeInTheDocument();
    expect(within(section).getByText(/column's own default/)).toBeInTheDocument();
    // The VALUE column is an em dash, not the stored figure — nowhere in the
    // register does 28 appear as a number this house set.
    expect(within(section).queryByText('28%')).not.toBeInTheDocument();

    // And the week is not measured against it: the labour panel says so too.
    const labour = screen.getByRole('region', { name: 'Labour cost' });
    expect(within(labour).getByText(/no target set/)).toBeInTheDocument();
    expect(within(labour).queryByText(/target 28% of sales/)).not.toBeInTheDocument();
  });

  it('renders a chosen figure as a target, with the author unrecorded', async () => {
    api.week = weekPayload({
      labor: {
        enabled: true,
        totalHours: 40,
        totalCost: 1200,
        costComplete: true,
        pricedShifts: 4,
        unpricedShifts: 0,
        targetPct: 31,
        overtime: [],
      },
      settings: {
        restaurant_id: 'r1',
        labor_tracking_enabled: true,
        wage_visible: true,
        labor_target_pct: 31,
        configured: true,
        updated_at: '2026-09-01T08:00:00Z',
      },
    });
    render(<TeamNext />, { wrapper });
    await screen.findByText(/No column records who set it/);
    const section = screen.getByRole('region', { name: 'How this desk is configured' });
    expect(within(section).getByText('31%')).toBeInTheDocument();
    expect(
      within(section).getByText(/No column records who set it/),
    ).toBeInTheDocument();
  });

  it('renders every stated value with where it is kept and why there is no author', async () => {
    render(<TeamNext />, { wrapper });
    const section = await screen.findByRole('region', { name: 'How this desk is configured' });
    expect(within(section).getByText('Labour tracking')).toBeInTheDocument();
    expect(
      within(section).getAllByText(/team_settings has no author column/).length,
    ).toBeGreaterThan(0);
  });

  it('does not render an empty trail as "nothing ever happened"', async () => {
    render(<TeamNext />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: 'What changed here' }));
    const sheet = await screen.findByRole('dialog', { name: 'What changed here' });
    expect(within(sheet).getByText(/Recording began on/)).toBeInTheDocument();
  });

  it('says the trail could not be read rather than showing it empty', async () => {
    api.trail = {
      entries: [],
      readable: false,
      reason: 'relation does not exist',
      oldestAt: null,
      recordingSince: '2026-09-03',
    };
    render(<TeamNext />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: 'What changed here' }));
    const sheet = await screen.findByRole('dialog', { name: 'What changed here' });
    expect(within(sheet).getByText(/could not be read/)).toBeInTheDocument();
  });
});

/* ── time off ────────────────────────────────────────────────────────────── */

describe('time off distinguishes an empty file from an unread one', () => {
  it('says the file is empty when it answered with nothing', async () => {
    render(<TeamNext />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: /Time off/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Time off' });
    expect(within(sheet).getByText(/No request is on file for anyone/)).toBeInTheDocument();
  });
});
