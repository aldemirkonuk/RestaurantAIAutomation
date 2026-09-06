/**
 * TeamNext honesty contracts (ADR 0051 + ADR 0089).
 *
 * Written against the state production is actually in: `coverage_templates` is
 * empty, `team_certifications` is empty, and there is no `staff` role. Every
 * assertion below is about a SENTENCE the page prints over nothing.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen , configure } from '@testing-library/react';
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
  timeOff: [] as unknown[],
  myWeek: {} as Record<string, unknown>,
  publishSchedule: vi.fn(() => Promise.resolve({})),
  copyWeek: vi.fn(() => Promise.resolve({})),
  offerCover: vi.fn(() => Promise.resolve({})),
  updateTeamMember: vi.fn(() => Promise.resolve({})),
  week: {} as Record<string, unknown>,
  members: [] as unknown[],
  certs: [] as unknown[],
  templates: [] as unknown[],
  createShift: vi.fn(() => Promise.resolve({})),
  createCoverageTemplate: vi.fn(() => Promise.resolve({})),
  broadcast: vi.fn(() => Promise.resolve({})),
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
  getTimeOff: () => Promise.resolve(api.timeOff),
  getMyWeek: () => Promise.resolve(api.myWeek),
  getMemberPerformance: () => Promise.resolve({ hasData: false }),
  createSchedule: vi.fn(() => Promise.resolve({ id: 'sch1' })),
  publishSchedule: api.publishSchedule,
  copyWeek: api.copyWeek,
  acknowledgeSchedule: vi.fn(() => Promise.resolve({})),
  assignCover: vi.fn(() => Promise.resolve({})),
  createTimeOff: vi.fn(() => Promise.resolve({})),
  reviewTimeOff: vi.fn(() => Promise.resolve({})),
  updateShift: vi.fn(() => Promise.resolve({})),
  deleteShift: vi.fn(() => Promise.resolve(undefined)),
  reportCallout: vi.fn(() => Promise.resolve({})),
  offerCover: api.offerCover,
  createTeamMember: vi.fn(() => Promise.resolve({})),
  updateTeamMember: api.updateTeamMember,
  deleteTeamMember: vi.fn(() => Promise.resolve(undefined)),
  ingestSales: vi.fn(() => Promise.resolve({})),
  ingestSalesBatch: vi.fn(() => Promise.resolve({})),
  getWeek: () => Promise.resolve(api.week),
  getTeamMembers: () => Promise.resolve(api.members),
  getCertifications: () => Promise.resolve(api.certs),
  getCoverageTemplates: () => Promise.resolve(api.templates),
  createCoverageTemplate: api.createCoverageTemplate,
  createShift: api.createShift,
  broadcast: api.broadcast,
}));

const auth = vi.hoisted(() => ({ role: 'owner' as string | null }));

// `/settings-audit` is read through the shared client, so the trail query would
// otherwise reach the network from a unit test. `readable: true` with no rows
// is the state a fresh restaurant is actually in.
vi.mock('../../../services/api/client', () => ({
  apiClient: {
    get: () =>
      Promise.resolve({
        data: {
          entries: [],
          readable: true,
          reason: null,
          oldestAt: null,
          recordingSince: '2026-09-03',
        },
      }),
  },
}));

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    activeRestaurantId: 'r-alpha',
    user: { id: 'u1', restaurantId: 'r-alpha', role: auth.role },
    activeRole: auth.role,
  }),
}));

// The staff fallback is the legacy My Shifts view; its own network calls are
// not what this file is about.
vi.mock('./MyShiftsNext', () => ({ MyShiftsNext: () => <div>My Shifts</div> }));

import TeamNext from './TeamNext';

const member = (id: string, name: string, position: string) => ({
  id,
  restaurant_id: 'r-alpha',
  user_id: null,
  display_name: name,
  email: null,
  phone: null,
  avatar_url: null,
  position,
  employment_type: 'hourly',
  home_location: null,
  hourly_wage: null,
  skills: [],
  hire_date: null,
  status: 'active',
  notes: null,
  role: 'manager',
  accountLinked: false,
});

const shift = (memberId: string | null, date: string) => ({
  id: `s-${memberId}-${date}`,
  restaurant_id: 'r-alpha',
  schedule_id: 'sch1',
  member_id: memberId,
  shift_date: date,
  start_time: '17:00',
  end_time: '23:00',
  role: 'line',
  shift_type: 'regular',
  state: 'assigned',
  note: null,
  labor_cost: null,
});

function weekPayload(over: Record<string, unknown> = {}) {
  return {
    schedule: { id: 'sch1', restaurant_id: 'r-alpha', week_start: '2026-08-31', status: 'draft', published_at: null },
    shifts: [],
    coverage: { days: [], totalGaps: 0 },
    labor: { enabled: false, totalHours: 0 },
    receipts: [],
    settings: { restaurant_id: 'r-alpha', labor_tracking_enabled: false, wage_visible: false, labor_target_pct: 0 },
    ...over,
  };
}

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  auth.role = 'owner';
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.week = weekPayload();
  api.members = [];
  api.certs = [];
  api.templates = [];
  api.createCoverageTemplate.mockClear();
});

/** P1 — an idle engine is not a staffed week. */
describe('the coverage engine says whether it has ever been asked', () => {
  it('does not claim the week is staffed when no coverage rule exists', async () => {
    // production today: 0 coverage_templates, so `gaps` is empty because
    // nothing was ever required — not because everything is covered.
    render(<TeamNext />, { wrapper });
    expect(await screen.findByText(/staffing engine/i)).toBeInTheDocument();
    expect(screen.queryByText(/Every required slot this week is staffed/)).not.toBeInTheDocument();
  });

  it('offers a control that creates the first coverage rule from this page', async () => {
    render(<TeamNext />, { wrapper });
    expect(await screen.findByRole('button', { name: /add coverage rule/i })).toBeInTheDocument();
  });

  it('only claims a staffed week when rules exist and none is unmet', async () => {
    api.templates = [{ id: 't1', role: 'line', day_of_week: null, shift_period: 'pm', min_staff: 1 }];
    render(<TeamNext />, { wrapper });
    expect(await screen.findByText(/Every required slot this week is staffed/)).toBeInTheDocument();
  });
});

/** P8 — a day whose coverage status is `gap` is not "covered". */
describe('the day chips agree with the coverage status', () => {
  it('does not print "covered" on a day the gateway marked as a gap', async () => {
    api.templates = [{ id: 't1', role: 'line', day_of_week: null, shift_period: 'pm', min_staff: 3 }];
    api.week = weekPayload({
      coverage: {
        totalGaps: 1,
        days: [
          // no OPEN shift row, but the coverage rule for the day is unmet
          { date: '2026-09-05', staffed: 1, openShifts: 0, status: 'gap', gaps: [{ role: 'line', period: 'pm', staffed: 1, required: 3 }] },
        ],
      },
    });
    render(<TeamNext />, { wrapper });
    // The day heads render from the calendar, so wait for the COVERAGE to
    // arrive rather than for the date: before the week answers the status line
    // says "reading…", which is a third state and not a claim either way.
    expect(await screen.findByText(/1 rule unmet/)).toBeInTheDocument();
    expect(screen.queryByText('covered')).not.toBeInTheDocument();
  });
});

/** A rule file that did not answer is not an empty one either. */
describe('the coverage rules can say they were not read', () => {
  it('does not claim an idle engine when the rule query failed', async () => {
    const boom = () => Promise.reject(new Error('gateway 500'));
    const mod = await import('../../../services/api/team');
    const spy = vi.spyOn(mod, 'getCoverageTemplates').mockImplementation(boom as never);
    render(<TeamNext />, { wrapper });
    expect(
      await screen.findByText(/whether anything is required this week is\s+unknown/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/staffing engine has never been asked/)).not.toBeInTheDocument();
    spy.mockRestore();
  });
});

/** P1 — an empty credential file is not a clean one. */
describe('the credential file says whether it holds anything', () => {
  it('does not claim every credential is valid when none is on file', async () => {
    render(<TeamNext />, { wrapper });
    expect(await screen.findByText(/No credential is on file/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/Every credential on file is valid through this week/),
    ).not.toBeInTheDocument();
  });
});

/** P3 — a tenant switch must not serve the previous restaurant's week. */
describe('every query key carries the restaurant', () => {
  it('keys the week, roster, credentials and coverage rules by tenant', async () => {
    render(<TeamNext />, { wrapper });
    await screen.findByText(/members/i);
    const keys = client.getQueryCache().getAll().map((q) => JSON.stringify(q.queryKey));
    expect(keys.length).toBeGreaterThanOrEqual(4);
    for (const k of keys) expect(k).toContain('r-alpha');
  });
});

/** P8 — the redesigned surface must split by role the way the legacy one does. */
describe('the redesign has the role split the legacy half already had', () => {
  it('does not hand a non-manager the manager surface or the credential file', async () => {
    auth.role = 'staff';
    api.certs = [
      {
        id: 'c1',
        member_id: 'm1',
        cert_type: 'food-handler',
        issued_at: null,
        expires_at: '2026-08-20',
        doc_url: null,
        status: 'expired',
      },
    ];
    render(<TeamNext />, { wrapper });
    expect(await screen.findByText('My Shifts')).toBeInTheDocument();
    expect(screen.queryByText(/Unfilled — the week's first job/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Credentials that block/)).not.toBeInTheDocument();
  });
});

/** P6 — the schema has no link between a credential and a shift. */
describe('the blocker sentence claims only what the schema supports', () => {
  it('does not assert that an expired credential is required for those shifts', async () => {
    api.members = [member('m1', 'Ayşe', 'Sommelier')];
    api.week = weekPayload({ shifts: [shift('m1', '2026-09-01'), shift('m1', '2026-09-03')] });
    api.certs = [
      {
        id: 'c1',
        member_id: 'm1',
        cert_type: 'food-handler',
        issued_at: null,
        expires_at: '2026-08-20',
        doc_url: null,
        status: 'expired',
      },
    ];
    render(<TeamNext />, { wrapper });
    // The name is on the credential row AND on the grid's member row now.
    await screen.findAllByText(/Ayşe/);
    expect(screen.queryByText(/held by an expired credential/)).not.toBeInTheDocument();
    expect(screen.queryByText(/blocks 2 shifts/)).not.toBeInTheDocument();
    // What IS known: whose credential expired, and how much of their week is
    // exposed if it turns out to be required.
    expect(screen.getByText(/which shifts require it is not recorded/i)).toBeInTheDocument();
  });
});
