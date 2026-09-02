/**
 * The LEGACY half of /team — the Manager Shift Desk, My Shifts, the Ops drawer
 * and the editors — held to the same contract the redesigned half already
 * meets (ADR 0051, ADR 0089):
 *
 *   P2  a message addressed to one person reaches one person, and the page
 *       shows who it reaches BEFORE it is sent.
 *   P4  a dead gateway is not a healthy, empty restaurant.
 *   P5  a mutation that fails says so.
 *   P7  an action that deletes rows asks first.
 *   P8  a tonight figure is about tonight; an unpriced week is not $0.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

const t = vi.hoisted(() => ({
  week: null as unknown,
  weekFails: false,
  members: [] as unknown[],
  membersFail: false,
  certs: [] as unknown[],
  certsFail: false,
  myWeek: null as unknown,
  myWeekFails: false,
  templates: [] as unknown[],
  broadcast: vi.fn(() => Promise.resolve({ notified: 1 })),
  copyWeek: vi.fn(() => Promise.resolve({ copied: 3 })),
  publishSchedule: vi.fn(() => Promise.resolve({})),
  reportCallout: vi.fn(() => Promise.reject(new Error('gateway 500'))),
  assignCover: vi.fn(() => Promise.reject(new Error('gateway 500'))),
  deleteShift: vi.fn(() => Promise.reject(new Error('gateway 500'))),
  deleteTeamMember: vi.fn(() => Promise.reject(new Error('gateway 500'))),
  deleteCoverageTemplate: vi.fn(() => Promise.reject(new Error('gateway 500'))),
  deleteCertification: vi.fn(() => Promise.reject(new Error('gateway 500'))),
  acknowledgeSchedule: vi.fn(() => Promise.reject(new Error('gateway 500'))),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { error: t.toastError, success: t.toastSuccess, info: vi.fn(), warning: vi.fn() },
}));

vi.mock('../../../services/api/calendar', () => ({
  fetchCalendarEvents: () => Promise.resolve([]),
}));

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    activeRestaurantId: 'r-alpha',
    activeRole: 'owner',
    user: { id: 'u1', restaurantId: 'r-alpha', role: 'owner' },
  }),
}));

vi.mock('../../../components/team/InviteTeamDialog', () => ({ InviteTeamDialog: () => null }));
vi.mock('../../../components/team/ShiftImportModal', () => ({ ShiftImportModal: () => null }));
vi.mock('../../../components/layout/RestaurantBranchSwitcher', () => ({
  RestaurantBranchSwitcher: () => null,
}));
vi.mock('../../../components/ui/ExportMenu', () => ({ ExportMenu: () => null }));

vi.mock('../../../services/api/team', () => ({
  getWeek: () => (t.weekFails ? Promise.reject(new Error('gateway 500')) : Promise.resolve(t.week)),
  getMyWeek: () =>
    t.myWeekFails ? Promise.reject(new Error('gateway 500')) : Promise.resolve(t.myWeek),
  getTeamMembers: () =>
    t.membersFail ? Promise.reject(new Error('gateway 500')) : Promise.resolve(t.members),
  getCertifications: () =>
    t.certsFail ? Promise.reject(new Error('gateway 500')) : Promise.resolve(t.certs),
  getCoverageTemplates: () => Promise.resolve(t.templates),
  createCoverageTemplate: vi.fn(() => Promise.resolve({})),
  deleteCoverageTemplate: t.deleteCoverageTemplate,
  createCertification: vi.fn(() => Promise.resolve({})),
  updateCertification: vi.fn(() => Promise.resolve({})),
  deleteCertification: t.deleteCertification,
  copyWeek: t.copyWeek,
  publishSchedule: t.publishSchedule,
  createSchedule: vi.fn(() => Promise.resolve({ id: 'sch1' })),
  acknowledgeSchedule: t.acknowledgeSchedule,
  reportCallout: t.reportCallout,
  offerCover: vi.fn(() => Promise.resolve({ offered: 0, notified: 0 })),
  assignCover: t.assignCover,
  broadcast: t.broadcast,
  createShift: vi.fn(() => Promise.resolve({})),
  updateShift: vi.fn(() => Promise.resolve({})),
  deleteShift: t.deleteShift,
  createTeamMember: vi.fn(() => Promise.resolve({})),
  updateTeamMember: vi.fn(() => Promise.resolve({})),
  deleteTeamMember: t.deleteTeamMember,
  createTimeOff: vi.fn(() => Promise.resolve({})),
  getMemberPerformance: vi.fn(() => Promise.resolve({})),
}));

import { ManagerShiftDesk } from './ManagerShiftDesk';
import { MyShifts } from './MyShifts';
import { OpsRulesPanel } from './OpsRulesPanel';
import { ShiftEditor, MemberEditor } from './editors';
import { todayIso, mondayOf } from './bits';

const member = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id,
  restaurant_id: 'r-alpha',
  user_id: `u-${id}`,
  display_name: name,
  email: `${id}@example.com`,
  phone: null,
  avatar_url: null,
  position: 'line',
  employment_type: 'full_time',
  home_location: null,
  hourly_wage: null,
  skills: [],
  hire_date: null,
  status: 'active',
  notes: null,
  role: 'manager',
  accountLinked: true,
  ...over,
});

const shift = (memberId: string | null, date: string, over: Record<string, unknown> = {}) => ({
  id: `s-${memberId}-${date}`,
  restaurant_id: 'r-alpha',
  schedule_id: 'sch1',
  member_id: memberId,
  shift_date: date,
  start_time: '17:00',
  end_time: '23:00',
  role: 'line',
  shift_type: 'pm',
  state: 'scheduled',
  note: null,
  labor_cost: null,
  shift_breaks: [],
  ...over,
});

function weekPayload(over: Record<string, unknown> = {}) {
  return {
    schedule: {
      id: 'sch1',
      restaurant_id: 'r-alpha',
      week_start: mondayOf(),
      status: 'draft',
      published_at: null,
    },
    shifts: [],
    coverage: { days: [], totalGaps: 0 },
    labor: { enabled: false, totalHours: 0, overtime: [] },
    receipts: [],
    settings: {
      restaurant_id: 'r-alpha',
      labor_tracking_enabled: false,
      wage_visible: true,
      labor_target_pct: 0,
    },
    ...over,
  };
}

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  t.week = weekPayload();
  t.weekFails = false;
  t.members = [];
  t.membersFail = false;
  t.certs = [];
  t.certsFail = false;
  t.templates = [];
  t.myWeek = { member: { id: 'm1', display_name: 'Ada' }, mine: [], open: [], schedule: null, acknowledged: false };
  t.myWeekFails = false;
  for (const fn of Object.values(t) as unknown[]) {
    if (typeof fn === 'function' && 'mockClear' in fn) (fn as { mockClear: () => void }).mockClear();
  }
});

// ── P4 — a dead gateway is not an empty restaurant ─────────────────────────
describe('P4 · a failed read is said in words, not drawn as an empty week', () => {
  beforeEach(() => {
    t.weekFails = true;
    t.membersFail = true;
    t.certsFail = true;
  });

  it('says the gateway could not be reached and claims nothing below it', async () => {
    render(<ManagerShiftDesk />, { wrapper });
    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(/nothing below is claimed|could not be refreshed/i);
  });

  it('does not print "No team members yet" over a failed roster', async () => {
    render(<ManagerShiftDesk />, { wrapper });
    await screen.findByRole('alert');
    expect(screen.queryByText(/No team members yet/)).not.toBeInTheDocument();
  });

  it('does not print a measured 0 active over a failed roster', async () => {
    render(<ManagerShiftDesk />, { wrapper });
    await screen.findByRole('alert');
    expect(screen.queryByText(/^0 active/)).not.toBeInTheDocument();
  });

  it('does not report an all-clear task rail over a failed week', async () => {
    render(<ManagerShiftDesk />, { wrapper });
    await screen.findByRole('alert');
    expect(screen.queryByText(/Nothing needs you right now/)).not.toBeInTheDocument();
  });

  it('does not report publish readiness as Clear over a failed week', async () => {
    render(<ManagerShiftDesk />, { wrapper });
    await screen.findByRole('alert');
    expect(screen.queryAllByText(/^Clear$/)).toHaveLength(0);
  });

  it('My Shifts does not render seven days off over a failed week', async () => {
    t.myWeekFails = true;
    render(<MyShifts />, { wrapper });
    await screen.findByRole('alert');
    expect(screen.queryAllByText(/^Off$/)).toHaveLength(0);
  });
});

// ── P2 — "Message X" reaches X ─────────────────────────────────────────────
describe('P2 · a message addressed to one person reaches one person', () => {
  beforeEach(() => {
    t.members = [member('m1', 'Ayşe Yılmaz'), member('m2', 'Bora Kaya')];
    t.week = weekPayload({ shifts: [shift('m1', todayIso())] });
  });

  it('names the recipients before anything is sent, and sends only to them', async () => {
    render(<ManagerShiftDesk />, { wrapper });
    const chip = await screen.findByRole('button', { name: /5p-11p/i });
    fireEvent.contextMenu(chip);
    fireEvent.click(await screen.findByRole('button', { name: /Message Ayşe/i }));

    // the recipient list is on screen BEFORE the send control is pressed
    const dialog = await screen.findByRole('dialog', { name: /message/i });
    expect(dialog).toHaveTextContent(/Ayşe Yılmaz/);
    expect(dialog).not.toHaveTextContent(/Bora Kaya/);
    expect(t.broadcast).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole('textbox', { name: /message/i }), {
      target: { value: 'Please swap Friday.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send to 1/i }));

    await waitFor(() => expect(t.broadcast).toHaveBeenCalled());
    const oneBody = (t.broadcast.mock.calls as unknown as unknown[][])[0][0] as Record<
      string,
      unknown
    >;
    expect(oneBody).toMatchObject({
      message: 'Please swap Friday.',
      memberIds: ['m1'],
    });
    // ADR 0088 T3: naming BOTH is a 400 before anything is sent, so a targeted
    // message must not also claim the whole restaurant.
    expect(oneBody).not.toHaveProperty('audience');
  });

  it('a crew broadcast says how many people it reaches before it is sent', async () => {
    render(<ManagerShiftDesk />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: /Broadcast crew/i }));
    const dialog = await screen.findByRole('dialog', { name: /message/i });
    expect(dialog).toHaveTextContent(/2/);
    expect(t.broadcast).not.toHaveBeenCalled();
  });

  /**
   * ADR 0088 T3 shipped gateway-first (#256): an omitted `memberIds` stopped
   * meaning "everyone" and became a 400. Until the client named its audience,
   * this control was simply broken in production. Asserted on the BODY, not on
   * "it was called", because a call that 400s is still a call.
   */
  it('a crew broadcast names its audience instead of relying on an omission', async () => {
    render(<ManagerShiftDesk />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: /Broadcast crew/i }));
    await screen.findByRole('dialog', { name: /message/i });
    fireEvent.change(screen.getByRole('textbox', { name: /message/i }), {
      target: { value: 'Family meal at 4.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send to 2/i }));

    await waitFor(() => expect(t.broadcast).toHaveBeenCalled());
    const body = (t.broadcast.mock.calls as unknown as unknown[][])[0][0] as Record<
      string,
      unknown
    >;
    expect(body).toMatchObject({ audience: 'everyone' });
    expect(body.memberIds).toBeUndefined();
  });
});

// ── P7 — one click must not delete a week ──────────────────────────────────
describe('P7 · destructive actions ask first', () => {
  beforeEach(() => {
    t.members = [member('m1', 'Ayşe Yılmaz')];
  });

  it('copy-last-week says it replaces the target week before doing it', async () => {
    render(<ManagerShiftDesk />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: /Copy last week/i }));
    expect(t.copyWeek).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog', { name: /copy last week/i });
    expect(dialog).toHaveTextContent(/cannot be undone/i);
    fireEvent.click(screen.getByRole('button', { name: /replace the week/i }));
    await waitFor(() => expect(t.copyWeek).toHaveBeenCalled());
    // ADR 0088 T7: the gateway 409s a copy that has not said it replaces the
    // target week. The ConfirmSheet above is what earns the flag; without the
    // flag on the wire the confirmed copy never happens at all.
    expect((t.copyWeek.mock.calls as unknown as unknown[][])[0][3]).toMatchObject({
      replaceTarget: true,
    });
  });

  it('re-publish says it clears who has seen the schedule before doing it', async () => {
    t.week = weekPayload({
      schedule: {
        id: 'sch1',
        restaurant_id: 'r-alpha',
        week_start: mondayOf(),
        status: 'published',
        published_at: '2026-09-01',
      },
    });
    render(<ManagerShiftDesk />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: /Re-publish/i }));
    expect(t.publishSchedule).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog', { name: /re-publish/i });
    expect(dialog).toHaveTextContent(/seen/i);

    fireEvent.click(screen.getByRole('button', { name: /re-publish and clear receipts/i }));
    await waitFor(() => expect(t.publishSchedule).toHaveBeenCalled());
    // ADR 0088 T7: a re-publish that would erase read receipts is a 409 unless
    // the body says so. The sheet asked; the wire has to carry the answer.
    expect((t.publishSchedule.mock.calls as unknown as unknown[][])[0][2]).toMatchObject({
      resetReceipts: true,
    });
  });

  /**
   * The other half of the same contract: a FIRST publish destroys nothing, so
   * it must not ask to. Sending `resetReceipts: true` unconditionally would
   * pass the test above while turning the gateway's refusal into decoration.
   */
  it('a first publish asks for no receipt reset', async () => {
    render(<ManagerShiftDesk />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: /Publish week/i }));
    await waitFor(() => expect(t.publishSchedule).toHaveBeenCalled());
    expect((t.publishSchedule.mock.calls as unknown as unknown[][])[0][2]).toBeUndefined();
  });
});

// ── P5 — a failed mutation says so ─────────────────────────────────────────
describe('P5 · every mutation reports its own failure', () => {
  it('a failed call-out toasts', async () => {
    t.members = [member('m1', 'Ayşe Yılmaz')];
    t.week = weekPayload({ shifts: [shift('m1', todayIso())] });
    render(<ManagerShiftDesk />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: /5p-11p/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Report call-out/i }));
    await waitFor(() => expect(t.toastError).toHaveBeenCalled());
  });

  it('a failed shift delete from the editor toasts', async () => {
    render(
      <ShiftEditor shift={shift('m1', todayIso()) as never} members={[]} onClose={() => {}} />,
      { wrapper },
    );
    fireEvent.click(await screen.findByRole('button', { name: /Delete/i }));
    await waitFor(() => expect(t.toastError).toHaveBeenCalled());
  });

  it('a failed member removal toasts', async () => {
    render(
      <MemberEditor member={member('m1', 'Ayşe Yılmaz') as never} ownerCount={2} onClose={() => {}} />,
      { wrapper },
    );
    fireEvent.click(await screen.findByRole('button', { name: /^Remove$/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Yes, Remove/i }));
    await waitFor(() => expect(t.toastError).toHaveBeenCalled());
  });

  it('a failed coverage-rule delete toasts instead of claiming "Rule removed"', async () => {
    t.templates = [{ id: 'tpl1', role: 'line', day_of_week: null, shift_period: 'pm', min_staff: 2 }];
    render(<OpsRulesPanel members={[]} onClose={() => {}} />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: /Delete rule/i }));
    await waitFor(() => expect(t.toastError).toHaveBeenCalled());
    expect(t.toastSuccess).not.toHaveBeenCalledWith('Rule removed');
  });

  it('a failed certification delete toasts', async () => {
    t.certs = [
      { id: 'c1', member_id: 'm1', cert_type: 'food-handler', issued_at: null, expires_at: null, doc_url: null, status: 'valid' },
    ];
    render(<OpsRulesPanel members={[member('m1', 'Ayşe Yılmaz') as never]} onClose={() => {}} />, {
      wrapper,
    });
    fireEvent.click(await screen.findByRole('button', { name: /Certifications/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Delete cert/i }));
    await waitFor(() => expect(t.toastError).toHaveBeenCalled());
  });

  it('a failed acknowledgement toasts', async () => {
    t.myWeek = {
      member: { id: 'm1', display_name: 'Ada' },
      mine: [],
      open: [],
      schedule: { id: 'sch1', week_start: mondayOf(), status: 'published' },
      acknowledged: false,
    };
    render(<MyShifts />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: /Got it/i }));
    await waitFor(() => expect(t.toastError).toHaveBeenCalled());
  });
});

// ── P8 — small, all real ───────────────────────────────────────────────────
describe('P8 · a tonight figure is about tonight, and an unpriced week is unknown', () => {
  it('does not sum null wages into a measured $0', async () => {
    t.members = [member('m1', 'Ayşe Yılmaz')];
    t.week = weekPayload({
      shifts: [shift('m1', todayIso(), { labor_cost: null })],
      labor: { enabled: true, totalHours: 6, overtime: [] },
    });
    render(<ManagerShiftDesk />, { wrapper });
    await screen.findByText(/Tonight labor/i);
    expect(screen.queryByText('$0')).not.toBeInTheDocument();
  });

  it('shows tonight’s count under the tonight board, not the week’s', async () => {
    t.members = [member('m1', 'Ayşe Yılmaz')];
    // one urgent task, and it is NOT tonight: an expired credential.
    t.certs = [
      { id: 'c1', member_id: 'm1', cert_type: 'food-handler', issued_at: null, expires_at: '2026-01-01', doc_url: null, status: 'expired' },
    ];
    render(<ManagerShiftDesk />, { wrapper });
    const cell = (await screen.findByText(/Desk actions/i)).closest('button')!;
    expect(cell).toHaveTextContent(/^Desk actions0 tonight/);
  });

  it('does not offer to assign an arbitrary first roster row', async () => {
    t.members = [member('m1', 'Ayşe Yılmaz'), member('m2', 'Bora Kaya')];
    t.week = weekPayload({ shifts: [shift(null, todayIso(), { state: 'open' })] });
    render(<ManagerShiftDesk />, { wrapper });
    // an unassigned shift lives in the "Open shifts" strip, not in a member row
    fireEvent.click((await screen.findAllByRole('button', { name: /· line$/i }))[0]);
    await screen.findByText(/Shift inspector/i);
    expect(screen.queryByRole('button', { name: /Assign first/i })).not.toBeInTheDocument();
  });
});
