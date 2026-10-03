/**
 * WhoIsWriting — the Communications home for Trusted senders and Strangers
 * (ADR 0160 §113, Open item 3). The promises under test are the ones that keep
 * a security register honest: a trust is READ BACK before it is called saved,
 * a failed read is never an empty register, "add as a vendor" never reads as
 * "trusted", and another house's stranger carries no act.
 *
 * The hold is driven by its keyboard path (Enter arms, Enter commits) — the
 * same `commit` as the pointer hold, with no animation-frame clock.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render as rtlRender, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { ProspectDto, SenderReputationDto } from '../../../hooks/queries/usePromotionsQueries';

const h = vi.hoisted(() => ({
  senders: {} as Record<string, unknown>,
  sendersArg: undefined as boolean | undefined,
  strangers: {} as Record<string, unknown>,
  strangersArg: undefined as boolean | undefined,
  setTrust: { mutateAsync: vi.fn(), isPending: false },
  promote: { mutateAsync: vi.fn(), isPending: false },
  putAway: { mutateAsync: vi.fn(), isPending: false },
  restore: { mutateAsync: vi.fn(), isPending: false },
  auth: {} as Record<string, unknown>,
}));

vi.mock('./useSendersDeskData', () => ({
  SENDERS_SERVER_WINDOWS: { PROSPECTS: 100 },
  useSenderRegister: (enabled?: boolean) => {
    h.sendersArg = enabled;
    return h.senders;
  },
  useSetSenderTrust: () => h.setTrust,
  useStrangers: (all: boolean) => {
    h.strangersArg = all;
    return h.strangers;
  },
  usePromoteStranger: () => h.promote,
  usePutAwayStranger: () => h.putAway,
  useRestoreStranger: () => h.restore,
}));
vi.mock('../../../contexts/AuthContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../contexts/AuthContext')>()),
  useAuth: () => h.auth,
}));

import WhoIsWriting from './WhoIsWriting';

// COMMS-W5 (2026-10-01): the section folds to its summary line and opens from
// `?senders=open`. Every test below reads the OPEN section; the fold itself is
// proved at the bottom of this file.
function render(ui: React.ReactElement, at = '/communications?senders=open') {
  return rtlRender(<MemoryRouter initialEntries={[at]}>{ui}</MemoryRouter>);
}

const sender = (over: Partial<SenderReputationDto> = {}): SenderReputationDto => ({
  id: 's-skurnik',
  domain: 'skurnik.com',
  provider_id: 'prov-1',
  trusted: false,
  suspended: false,
  suspended_reason: null,
  injection_signals: 0,
  spam_signals: 1,
  completed_orders: 18,
  score: 0,
  updated_at: '2026-09-09T10:00:00Z',
  ...over,
});
const stranger = (over: Partial<ProspectDto> = {}): ProspectDto => ({
  id: 'p-tuscan',
  restaurant_id: 'r1',
  domain: 'tuscandirect.co',
  sender_email: 'sales@tuscandirect.co',
  sender_name: 'Tuscan Direct Imports',
  subject: 'Spring price list',
  snippet: null,
  body_preview: null,
  capture_reason: 'attachment',
  has_attachments: true,
  attachments: [],
  message_count: 1,
  status: 'open',
  first_seen_at: '2026-09-13T10:00:00Z',
  last_seen_at: '2026-09-15T10:00:00Z',
  ...over,
});

const ok = (data: unknown, refetch = vi.fn()) => ({ data, isLoading: false, isError: false, error: null, refetch });
const arm = (name: string | RegExp) => {
  const b = screen.getByRole('button', { name });
  fireEvent.keyDown(b, { key: 'Enter' });
  fireEvent.keyDown(b, { key: 'Enter' });
};

beforeEach(() => {
  vi.clearAllMocks();
  h.senders = ok([sender()]);
  h.strangers = ok([stranger()]);
  h.strangersArg = undefined;
  h.sendersArg = undefined;
  h.auth = {
    activeRestaurantId: 'r1',
    activeRole: 'owner',
    availableRestaurants: [{ id: 'r1', name: 'Müdavim Brooklyn', city: null, chain_id: null, chain_name: null }],
  };
});

describe('the two registers', () => {
  it('draws both, with the register columns and the reason a stranger was kept', () => {
    render(<WhoIsWriting />);
    expect(screen.getByRole('region', { name: 'Who is writing' })).toBeInTheDocument();
    expect(screen.getByText('skurnik.com')).toBeInTheDocument();
    // COMMS-W30: a long domain wraps instead of pushing the page sideways.
    expect(screen.getByText('skurnik.com').style.overflowWrap).toBe('anywhere');
    expect(screen.getByText(/not trusted · updated 9 Sep/)).toBeInTheDocument();
    expect(screen.getByText(/18 orders · 0 with hidden instructions · 1 spam/)).toBeInTheDocument();
    expect(screen.getByText('Tuscan Direct Imports')).toBeInTheDocument();
    expect(screen.getByText('Tuscan Direct Imports').style.overflowWrap).toBe('anywhere');
    expect(screen.getByText(/<sales@tuscandirect\.co>/).style.overflowWrap).toBe('anywhere');
    expect(screen.getByText('has an attachment')).toBeInTheDocument();
    expect(screen.getByTestId('who-summary')).toHaveTextContent('0 trusted senders · 0 suspended · 1 stranger waiting');
  });

  it('a suspended domain reads suspended and offers the trust act again', () => {
    h.senders = ok([sender({ trusted: true, suspended: true, suspended_reason: 'spoof signal' })]);
    render(<WhoIsWriting />);
    expect(screen.getByText(/suspended · spoof signal/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Trust skurnik.com' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Untrust' })).toBeNull();
  });
});

describe('a failed read is never an empty register', () => {
  it('names the failure in words and leaves the other register alone', () => {
    h.senders = { ...ok(undefined), isError: true, error: { response: { status: 403 } } };
    render(<WhoIsWriting />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Only an owner or manager can see the trusted senders. That does not mean there are none.');
    expect(screen.queryByText(/No senders yet/)).toBeNull();
    expect(screen.getByText('Tuscan Direct Imports')).toBeInTheDocument();
    expect(screen.getByTestId('who-summary')).toHaveTextContent('— trusted senders · — suspended · 1 stranger waiting');
  });

  it('strangers: a failed read offers Retry and says it is not an empty list', () => {
    const refetch = vi.fn();
    h.strangers = { ...ok(undefined, refetch), isError: true, error: { message: 'boom' } };
    render(<WhoIsWriting />);
    expect(screen.getByRole('alert')).toHaveTextContent(/The strangers could not be read \(boom\)\. That does not mean there are none\./);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalled();
  });

  it('a genuinely empty register says so, distinctly', () => {
    h.senders = ok([]);
    h.strangers = ok([]);
    render(<WhoIsWriting />);
    expect(screen.getByText('No senders yet. A vendor appears here once they email the house.')).toBeInTheDocument();
    // COMMS-W32: the empty strangers list no longer claims the lane is "active and listening".
    expect(screen.getByText('No strangers waiting. Mail from vendors you have not added yet lands here.')).toBeInTheDocument();
  });
});

describe('hold to trust', () => {
  it('opens the ask, writes the trust, and reads the register back before saying trusted', async () => {
    const fresh = vi.fn().mockResolvedValue({ isError: false, data: [sender({ trusted: true })] });
    h.senders = ok([sender()], fresh);
    h.setTrust.mutateAsync.mockResolvedValue({ domain: 'skurnik.com', trusted: true });
    render(<WhoIsWriting />);

    fireEvent.click(screen.getByRole('button', { name: 'Trust skurnik.com' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Mudavym will no longer wait for a person before\s+answering it for Müdavim Brooklyn/)).toBeInTheDocument();
    expect(within(dialog).getByText('Completed orders')).toBeInTheDocument();
    // Nothing is written by opening the ask.
    expect(h.setTrust.mutateAsync).not.toHaveBeenCalled();

    arm(/Hold to trust/);
    await waitFor(() => expect(h.setTrust.mutateAsync).toHaveBeenCalledTimes(1));
    expect(h.setTrust.mutateAsync).toHaveBeenCalledWith({ domain: 'skurnik.com', trusted: true, providerId: 'prov-1' });
    expect(fresh).toHaveBeenCalled();
    expect(await within(dialog).findByRole('status')).toHaveTextContent('skurnik.com is trusted');
  });

  it('a 200 the register does not confirm is NOT called saved (the gateway swallows failed upserts)', async () => {
    // The write "succeeds", but the read-back still shows the old state.
    const fresh = vi.fn().mockResolvedValue({ isError: false, data: [sender({ trusted: false })] });
    h.senders = ok([sender()], fresh);
    h.setTrust.mutateAsync.mockResolvedValue({ domain: 'skurnik.com', trusted: true });
    render(<WhoIsWriting />);

    fireEvent.click(screen.getByRole('button', { name: 'Trust skurnik.com' }));
    const dialog = await screen.findByRole('dialog');
    arm(/Hold to trust/);

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/Trusting this domain was not saved.*skurnik\.com did not read back as trusted/);
    expect(within(dialog).queryByRole('status')).toBeNull();
    expect(within(dialog).queryByText('Trusted')).toBeNull();
  });

  it('a failed write says not saved and never seals', async () => {
    h.setTrust.mutateAsync.mockRejectedValue({ response: { status: 403 } });
    render(<WhoIsWriting />);
    fireEvent.click(screen.getByRole('button', { name: 'Trust skurnik.com' }));
    const dialog = await screen.findByRole('dialog');
    arm(/Hold to trust/);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/only an owner or manager/);
    expect(within(dialog).queryByRole('status')).toBeNull();
    // The hold's own seal must not stamp "Trusted" over a write that did not land.
    expect(within(dialog).queryByText('Trusted')).toBeNull();
  });

  it('a second ask does not inherit the first one\'s "trusted" receipt', async () => {
    const fresh = vi.fn().mockResolvedValue({ isError: false, data: [sender({ trusted: true }), sender({ id: 's2', domain: 'winebow.com' })] });
    h.senders = ok([sender(), sender({ id: 's2', domain: 'winebow.com' })], fresh);
    h.setTrust.mutateAsync.mockResolvedValue({});
    render(<WhoIsWriting />);
    fireEvent.click(screen.getByRole('button', { name: 'Trust skurnik.com' }));
    await screen.findByRole('dialog');
    arm(/Hold to trust/);
    await screen.findByRole('status');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Trust winebow.com' }));
    const second = await screen.findByRole('dialog');
    expect(within(second).queryByRole('status')).toBeNull();
  });
});

describe('untrust', () => {
  it('is a plain button (lowering trust needs no hold) and reads back', async () => {
    const fresh = vi.fn().mockResolvedValue({ isError: false, data: [sender({ trusted: false })] });
    h.senders = ok([sender({ trusted: true })], fresh);
    h.setTrust.mutateAsync.mockResolvedValue({});
    render(<WhoIsWriting />);
    fireEvent.click(screen.getByRole('button', { name: 'Untrust' }));
    await waitFor(() => expect(h.setTrust.mutateAsync).toHaveBeenCalledWith({ domain: 'skurnik.com', trusted: false, providerId: 'prov-1' }));
    expect(fresh).toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says so when the register still shows the domain trusted', async () => {
    const fresh = vi.fn().mockResolvedValue({ isError: false, data: [sender({ trusted: true })] });
    h.senders = ok([sender({ trusted: true })], fresh);
    h.setTrust.mutateAsync.mockResolvedValue({});
    render(<WhoIsWriting />);
    fireEvent.click(screen.getByRole('button', { name: 'Untrust' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Untrusting skurnik\.com was not saved/);
  });
});

describe('add as a vendor', () => {
  const open = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Add Tuscan Direct Imports as a vendor' }));
    return screen.findByRole('dialog');
  };

  it('is a plain create, states what it does not do, and reports an add', async () => {
    h.promote.mutateAsync.mockResolvedValue({ promoted: true, providerId: 'v1' });
    render(<WhoIsWriting />);
    const dialog = await open();
    expect(within(dialog).getByText(/It trusts nothing/)).toBeInTheDocument();
    expect(within(dialog).getByText('sales@tuscandirect.co')).toBeInTheDocument();
    // A create, not a hold.
    expect(within(dialog).queryByRole('button', { name: /Hold to/ })).toBeNull();
    expect(h.promote.mutateAsync).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Create the vendor' }));
    await waitFor(() => expect(h.promote.mutateAsync).toHaveBeenCalledWith('p-tuscan'));
    expect(await within(dialog).findByRole('status')).toHaveTextContent(/now a vendor of this house.*Nothing about them is trusted/);
  });

  it('a 200 with promoted:false is not called an add, and the create stays available', async () => {
    h.promote.mutateAsync.mockResolvedValue({ promoted: false });
    render(<WhoIsWriting />);
    const dialog = await open();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create the vendor' }));
    expect(await within(dialog).findByRole('status')).toHaveTextContent(/was not added/);
    expect(within(dialog).getByRole('button', { name: 'Create the vendor' })).toBeInTheDocument();
  });

  it('a reused vendor says no second one was made', async () => {
    h.promote.mutateAsync.mockResolvedValue({ promoted: true, reused: true });
    render(<WhoIsWriting />);
    const dialog = await open();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create the vendor' }));
    expect(await within(dialog).findByRole('status')).toHaveTextContent(/already a vendor of this house \(same email address\), so no second one was made/);
  });

  it('a failure is said in words', async () => {
    h.promote.mutateAsync.mockRejectedValue({ response: { status: 403 } });
    render(<WhoIsWriting />);
    const dialog = await open();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create the vendor' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/The vendor was not saved: only an owner or manager/);
  });
});

describe('put away, and the undo', () => {
  it('puts away, offers Undo, and restores', async () => {
    h.putAway.mutateAsync.mockResolvedValue({ dismissed: true });
    h.restore.mutateAsync.mockResolvedValue({ restored: true });
    render(<WhoIsWriting />);
    fireEvent.click(screen.getByRole('button', { name: 'Put Tuscan Direct Imports away' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Tuscan Direct Imports — put away');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(h.restore.mutateAsync).toHaveBeenCalledWith('p-tuscan'));
  });

  it('a put-away the gateway refused is reported, with no undo offered', async () => {
    h.putAway.mutateAsync.mockResolvedValue({ dismissed: false });
    render(<WhoIsWriting />);
    fireEvent.click(screen.getByRole('button', { name: 'Put Tuscan Direct Imports away' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Putting Tuscan Direct Imports away was not saved/);
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });
});

describe('more than one house', () => {
  const two = [
    { id: 'r1', name: 'Müdavim Brooklyn', city: null, chain_id: null, chain_name: null },
    { id: 'r2', name: 'Müdavim Queens', city: null, chain_id: null, chain_name: null },
  ];

  it('one house shows no scope switch', () => {
    render(<WhoIsWriting />);
    expect(screen.queryByRole('group', { name: 'Whose strangers' })).toBeNull();
    expect(h.strangersArg).toBe(false);
  });

  it('reads this house by default, all houses on request, and a stranger of another house carries no act', () => {
    h.auth = { activeRestaurantId: 'r1', availableRestaurants: two };
    h.strangers = ok([stranger(), stranger({ id: 'p-other', restaurant_id: 'r2', sender_name: 'Bodega Norte', domain: 'bodeganorte.mx' })]);
    render(<WhoIsWriting />);
    expect(h.strangersArg).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'all 2 houses' }));
    expect(h.strangersArg).toBe(true);
    expect(screen.getByText('Müdavim Queens')).toBeInTheDocument();
    expect(screen.getByText(/Belongs to another house/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Bodega Norte as a vendor' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Add Tuscan Direct Imports as a vendor' })).toBeInTheDocument();
  });
});

// COMMS-W35 (founder, 2026-10-01: "A: page + queue back"): the scope is in the
// address, so a refresh or a shared link keeps it.
describe('the scope in the address (COMMS-W35)', () => {
  const two = [
    { id: 'r1', name: 'Müdavim Brooklyn', city: null, chain_id: null, chain_name: null },
    { id: 'r2', name: 'Müdavim Queens', city: null, chain_id: null, chain_name: null },
  ];
  function Where() {
    const l = useLocation();
    return <output data-testid="where">{l.pathname + l.search}</output>;
  }

  it('all houses writes ?senders=all, this house ?senders=open, and Hide drops it', () => {
    h.auth = { activeRestaurantId: 'r1', availableRestaurants: two };
    render(
      <>
        <WhoIsWriting />
        <Where />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'all 2 houses' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/communications?senders=all');
    expect(h.strangersArg).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'this house' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/communications?senders=open');
    expect(h.strangersArg).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'all 2 houses' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/communications$/);
    expect(h.strangersArg).toBe(false);
  });

  it('?senders=all opens it with every house read', () => {
    h.auth = { activeRestaurantId: 'r1', availableRestaurants: two };
    render(<WhoIsWriting />, '/communications?senders=all');
    expect(screen.getByText('Trusted senders')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'all 2 houses' }).getAttribute('aria-pressed')).toBe('true');
    expect(h.strangersArg).toBe(true);
  });
});

describe('the fold (COMMS-W5)', () => {
  it('rests folded to its summary line, and Show opens it', () => {
    render(<WhoIsWriting />, '/communications');
    expect(screen.getByTestId('who-summary')).toBeInTheDocument();
    expect(screen.queryByText('Trusted senders')).toBeNull();
    const show = screen.getByRole('button', { name: 'Show' });
    expect(show.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(show);
    expect(screen.getByText('Trusted senders')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide' }).getAttribute('aria-expanded')).toBe('true');
  });
});

// COMMS-W31: the trusted-senders register and adding a vendor are an owner's or
// manager's (`/senders/*`, `POST prospects/:id/promote`). A staff member is not
// asked to read a refusal as a failure, and is told why the add is held.
describe('a staff member (COMMS-W31)', () => {
  beforeEach(() => {
    h.auth = { ...h.auth, activeRole: 'staff', user: { role: 'owner' } };
  });

  it('is not asked to read the trusted senders, and is told whose they are', () => {
    render(<WhoIsWriting />);
    expect(h.sendersArg).toBe(false);
    expect(screen.getByText('Only an owner or manager sees which senders are trusted.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Trust skurnik.com' })).toBeNull();
  });

  it('sees "Add as a vendor" held with the reason, and can still put a stranger away', () => {
    render(<WhoIsWriting />);
    const add = screen.getByRole('button', { name: 'Add Tuscan Direct Imports as a vendor' });
    expect(add).toBeDisabled();
    expect(add).toHaveAccessibleDescription('Only an owner or manager can add a vendor.');
    expect(screen.getByRole('button', { name: 'Put Tuscan Direct Imports away' })).toBeEnabled();
  });

  it('the role in this house wins over the account-wide one', () => {
    h.auth = { ...h.auth, activeRole: 'manager', user: { role: 'staff' } };
    render(<WhoIsWriting />);
    expect(h.sendersArg).toBe(true);
    expect(screen.getByRole('button', { name: 'Add Tuscan Direct Imports as a vendor' })).toBeEnabled();
    expect(screen.queryByText(/Only an owner or manager/)).toBeNull();
  });
});

// COMMS-W32: the section speaks the house's words — no machinery names.
describe('words (COMMS-W32)', () => {
  it('names no register, lane, quarantine, injection or column', async () => {
    h.senders = ok([sender({ trusted: false })]);
    render(<WhoIsWriting />);
    const section = screen.getByRole('region', { name: 'Who is writing' });
    expect(section.textContent).not.toMatch(/register|triage|lane|quarantine|spoof|injection|inj\.|column|header fields|vendor row/i);
    fireEvent.click(screen.getByRole('button', { name: 'Trust skurnik.com' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).not.toMatch(/register|quarantine|spoof|injection|guardrail|_/i);
    expect(dialog.getAttribute('aria-label') ?? '').not.toMatch(/register|quarantine|spoof/i);
  });
});

describe('a read that fails after it answered (COMMS-W33)', () => {
  // Founder, 2026-10-01: "A: keep, say when". What was last read stays, and the
  // line under it says when that was; a refusal still says why.
  const today = (hh: number, mm: number) => {
    const d = new Date();
    d.setHours(hh, mm, 0, 0);
    return d.getTime();
  };
  const failedAgain = (data: unknown, at: number, refetch = vi.fn(), error: unknown = { response: { status: 500, data: { message: 'Internal server error' } } }) => ({
    ...ok(data, refetch),
    isError: true,
    error,
    dataUpdatedAt: at,
  });

  it('trusted senders keep their rows and say when they are from', () => {
    h.senders = failedAgain([sender({ trusted: true })], today(20, 43));
    render(<WhoIsWriting />);
    expect(screen.getByText('skurnik.com')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('The trusted senders could not be read again (Internal server error). This is as it was at 20:43; there may be more or fewer now.')).toHaveAttribute('role', 'status');
    expect(screen.getByTestId('who-summary')).toHaveTextContent('1 trusted sender · 0 suspended · 1 stranger waiting · as it was at 20:43');
  });

  it('strangers that were none say "none then", not "none", and keep Retry', () => {
    const refetch = vi.fn();
    h.strangers = failedAgain([], today(20, 43), refetch);
    render(<WhoIsWriting />);
    expect(screen.queryByText(/No strangers waiting/)).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('The strangers could not be read again (Internal server error). At 20:43 there were none; there may be some now.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalled();
  });

  it('strangers keep their rows and their acts, with the line and Retry under them', () => {
    h.strangers = failedAgain([stranger()], today(20, 43));
    render(<WhoIsWriting />);
    expect(screen.getByText('Tuscan Direct Imports')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Put Tuscan Direct Imports away' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/^The strangers could not be read again \(Internal server error\)\. This is as it was at 20:43; there may be more or fewer now\. Retry$/);
  });

  it('a refusal after answering is not a blip: it still says why, and the summary does not count', () => {
    h.senders = failedAgain([sender({ trusted: true })], today(20, 43), vi.fn(), { response: { status: 403 } });
    render(<WhoIsWriting />);
    expect(screen.getByRole('alert')).toHaveTextContent('Only an owner or manager can see the trusted senders.');
    expect(screen.queryByText('skurnik.com')).toBeNull();
    expect(screen.getByTestId('who-summary')).toHaveTextContent(/^— trusted senders · — suspended · 1 stranger waiting$/);
  });

  it('the summary says the older of two times', () => {
    h.senders = failedAgain([sender()], today(20, 43));
    h.strangers = failedAgain([stranger()], today(19, 5));
    render(<WhoIsWriting />);
    expect(screen.getByTestId('who-summary')).toHaveTextContent(/· as it was at 19:05$/);
  });
});
