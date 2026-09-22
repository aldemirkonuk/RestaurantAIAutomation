/**
 * Connect my calendar — the person's own link (ADR 0111, review trail
 * 2026-09-21), through the real hook and the real sheet. Only the gateway
 * calls are doubles, and each records what it was asked, so "opening a page
 * makes nothing" is an observed count, not an assumption.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';

const api = vi.hoisted(() => ({
  getMyCalendarLink: vi.fn(),
  connectMyCalendar: vi.fn(),
  renewMyCalendarLink: vi.fn(),
  stopMyCalendarLink: vi.fn(),
  pickMyCalendarCategories: vi.fn(),
  listHouseCalendarLinks: vi.fn(),
  stopCalendarLinkFor: vi.fn(),
}));

vi.mock('../../../services/api/calendar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/api/calendar')>();
  return { ...actual, ...api };
});

import CalendarLinkSheet from './CalendarLinkSheet';
import { useMyCalendarLink } from '@/components/calendar-link/useMyCalendarLink';

const SECRET = 'f'.repeat(64);
const ADDRESS = `https://api.mudavym.test/api/v1/calendar/feed/${SECRET}.ics`;

function mine(over: Record<string, unknown> = {}) {
  return {
    connected: false,
    createdAt: null,
    issuedAt: null,
    lastFetchedAt: null,
    role: 'staff',
    scope:
      'Your link shows your own shifts and the house calendar you can already see here. Areas are not set up yet, so it cannot narrow to your area.',
    categories: null,
    canPickCategories: false,
    areasModelled: false,
    houseLinkRetired: false,
    ...over,
  };
}

function Harness() {
  const state = useMyCalendarLink();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        open the sheet
      </button>
      {open && <CalendarLinkSheet state={state} onClose={() => setOpen(false)} />}
    </>
  );
}

async function openSheet() {
  render(<Harness />);
  await waitFor(() => expect(api.getMyCalendarLink).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: 'open the sheet' }));
  return screen.findByRole('dialog');
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.getMyCalendarLink.mockResolvedValue(mine());
  api.listHouseCalendarLinks.mockResolvedValue([]);
});

describe('opening never makes a link', () => {
  it('mounting and opening the sheet READ once and write nothing', async () => {
    const dialog = await openSheet();
    await within(dialog).findByText(/your own shifts/i);
    expect(api.getMyCalendarLink).toHaveBeenCalledTimes(1);
    expect(api.connectMyCalendar).not.toHaveBeenCalled();
    expect(api.renewMyCalendarLink).not.toHaveBeenCalled();
    expect(api.stopMyCalendarLink).not.toHaveBeenCalled();
    expect(api.pickMyCalendarCategories).not.toHaveBeenCalled();
  });

  it('a failed read says so and offers a retry — never "not connected"', async () => {
    api.getMyCalendarLink.mockRejectedValueOnce(new Error('gateway down'));
    const dialog = await openSheet();
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/could not be read/i);
    expect(within(dialog).queryByRole('button', { name: 'Connect my calendar' })).toBeNull();
  });
});

describe('connecting shows the address once', () => {
  it('the button makes the link, and the address is shown marked as a secret', async () => {
    api.connectMyCalendar.mockResolvedValue(
      mine({
        connected: true,
        createdAt: '2026-09-21T12:00:00Z',
        issued: {
          feedUrl: `/api/v1/calendar/feed/${SECRET}.ics`,
          absoluteFeedUrl: ADDRESS,
          webcalUrl: ADDRESS.replace('https://', 'webcal://'),
          originSource: 'config',
        },
      }),
    );
    const dialog = await openSheet();
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Connect my calendar' }));

    const address = await within(dialog).findByText(ADDRESS);
    expect(api.connectMyCalendar).toHaveBeenCalledTimes(1);
    expect(address).toHaveAttribute('data-secret', 'credential');
    expect(within(dialog).getByText(/shown only this once/i)).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Open in my calendar app' })).toHaveAttribute(
      'href',
      ADDRESS.replace('https://', 'webcal://'),
    );
  });

  it('a link already made in another window: says it cannot be shown again', async () => {
    api.connectMyCalendar.mockResolvedValue(mine({ connected: true, issued: null }));
    const dialog = await openSheet();
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Connect my calendar' }));
    expect(await within(dialog).findByText(/cannot be shown again/i)).toBeInTheDocument();
  });

  it('a refusal is shown in the gateway’s words', async () => {
    api.connectMyCalendar.mockRejectedValue(new Error('You are not a member of this house.'));
    const dialog = await openSheet();
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Connect my calendar' }));
    expect(await within(dialog).findByText(/not a member of this house/i)).toBeInTheDocument();
  });
});

describe('a connected person', () => {
  beforeEach(() => {
    api.getMyCalendarLink.mockResolvedValue(
      mine({ connected: true, createdAt: '2026-09-21T12:00:00Z' }),
    );
  });

  it('"Get a new link" asks first, then renews', async () => {
    api.renewMyCalendarLink.mockResolvedValue(
      mine({
        connected: true,
        issued: { feedUrl: '/x.ics', absoluteFeedUrl: ADDRESS, webcalUrl: null, originSource: 'config' },
      }),
    );
    const dialog = await openSheet();
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Get a new link' }));
    expect(api.renewMyCalendarLink).not.toHaveBeenCalled();
    expect(within(dialog).getByText(/current link stops/i)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Yes, make a new link' }));
    });
    expect(api.renewMyCalendarLink).toHaveBeenCalledTimes(1);
    expect(await within(dialog).findByText(ADDRESS)).toBeInTheDocument();
  });

  it('"Stop my link" asks first, names the expired notice, then stops', async () => {
    api.stopMyCalendarLink.mockResolvedValue({ revoked: true });
    const dialog = await openSheet();
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Stop my link' }));
    expect(within(dialog).getByText(/Calendar link expired - connect again/)).toBeInTheDocument();
    expect(api.stopMyCalendarLink).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Yes, stop my link' }));
    });
    expect(api.stopMyCalendarLink).toHaveBeenCalledTimes(1);
  });

  it('staff get no category pick and no register of other people', async () => {
    const dialog = await openSheet();
    await within(dialog).findByRole('button', { name: 'Get a new link' });
    expect(within(dialog).queryByText(/what my link shows/i)).toBeNull();
    expect(within(dialog).queryByText(/who has connected/i)).toBeNull();
    expect(api.listHouseCalendarLinks).not.toHaveBeenCalled();
  });
});

describe('owners and managers', () => {
  it('an owner picks categories; the pick is saved only on Save', async () => {
    api.getMyCalendarLink.mockResolvedValue(
      mine({ role: 'owner', connected: true, canPickCategories: true, scope: 'Your link shows everything.' }),
    );
    api.pickMyCalendarCategories.mockResolvedValue(
      mine({ role: 'owner', connected: true, canPickCategories: true, categories: ['deliveries'] }),
    );
    const dialog = await openSheet();
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Deliveries' }));
    expect(api.pickMyCalendarCategories).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save what my link shows' }));
    });
    expect(api.pickMyCalendarCategories).toHaveBeenCalledWith(['deliveries']);
  });

  it('a manager sees who has connected and stops one person’s link after confirming', async () => {
    api.getMyCalendarLink.mockResolvedValue(mine({ role: 'manager', houseLinkRetired: true }));
    api.listHouseCalendarLinks.mockResolvedValue([
      {
        userId: '33333333-3333-4333-8333-333333333333',
        name: 'Ayse',
        createdAt: '2026-09-21T12:00:00Z',
        issuedAt: '2026-09-21T12:00:00Z',
        lastFetchedAt: null,
      },
    ]);
    api.stopCalendarLinkFor.mockResolvedValue({ revoked: true });
    const dialog = await openSheet();

    expect(await within(dialog).findByText(/shared calendar link for this house was switched off/i)).toBeInTheDocument();
    fireEvent.click(await within(dialog).findByRole('button', { name: "Stop Ayse's calendar link" }));
    expect(api.stopCalendarLinkFor).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Yes, stop it' }));
    });
    expect(api.stopCalendarLinkFor).toHaveBeenCalledWith('33333333-3333-4333-8333-333333333333');
  });
});
