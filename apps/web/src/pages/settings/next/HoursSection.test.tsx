/**
 * HoursSection render contract — sketch 109A graft B, ADR 0149 row 22.
 *
 * Mounted directly against a `SettingsNextData` fixture, the same way
 * `CarryingCostSection.test.tsx` tests its own register: what is under test
 * is this register's own contract (null vs. closed vs. a real week, the
 * save/clear round trip through `restaurantsApi.putOperatingHours`, and a
 * validation failure surfacing every fault the server named), not the whole
 * page's mounting of it (that stays in `SettingsNext.test.tsx`).
 *
 * Found untested by the settings-review audit (2026-09-18): 322 lines with no
 * dedicated test file, and the page-level fixture never opened the day sheet
 * at all.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SettingsNextData } from './useSettingsNextData';

vi.mock('@/services/api/restaurants', async () => {
  const actual = await vi.importActual<typeof import('@/services/api/restaurants')>(
    '@/services/api/restaurants',
  );
  return {
    ...actual,
    restaurantsApi: { getOperatingHours: vi.fn(), putOperatingHours: vi.fn() },
  };
});

import { HoursSection } from './HoursSection';
import { restaurantsApi } from '@/services/api/restaurants';

const api = vi.mocked(restaurantsApi);

const EMPTY_WEEK = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };

function remote(data: unknown, status = 'ok') {
  return {
    status,
    data,
    error: status === 'error' ? 'gateway unreachable' : null,
    reload: vi.fn(),
    set: vi.fn(),
  };
}

function hoursData(over: Record<string, unknown> = {}) {
  return {
    restaurantId: 'r1',
    timezone: 'Europe/Istanbul',
    operatingHours: null,
    updatedAt: null,
    ...over,
  };
}

function mount(over: Record<string, unknown> = {}) {
  const hours = (over.hours as ReturnType<typeof remote>) ?? remote(hoursData());
  const data = {
    canManage: true,
    restaurantId: 'r1',
    hours,
    ...over,
  } as unknown as SettingsNextData;
  render(<HoursSection data={data} />);
  return { hours: data.hours as ReturnType<typeof remote> };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('when is it open — three states, never collapsed into each other', () => {
  it('unstated hours say "not stated", never "closed"', () => {
    mount();
    expect(
      screen.getByText(/Nobody has recorded when this house opens/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /set hours/i })).toBeInTheDocument();
  });

  it('a real week is summarised by open day, and the control becomes Edit', () => {
    mount({
      hours: remote(
        hoursData({
          operatingHours: { ...EMPTY_WEEK, tue: [{ open: '12:00', close: '23:00' }] },
          updatedAt: '2026-09-06T09:00:00.000Z',
        }),
      ),
    });
    expect(screen.getByText(/Tue 12:00–23:00/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^edit$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /set hours/i })).not.toBeInTheDocument();
  });

  it('a week closed every day reads as closed, not as unstated', () => {
    mount({ hours: remote(hoursData({ operatingHours: EMPTY_WEEK })) });
    expect(screen.getByText(/Closed every day/i)).toBeInTheDocument();
  });
});

function zoneData(over: Record<string, unknown> = {}) {
  return {
    restaurantId: 'r1', zone: 'America/Chicago', source: null, unreadZone: null, country: 'US',
    readable: true, reason: null, statedAt: null, statedBy: null, ...over,
  };
}

const clockCert = () =>
  screen.getByText(/Which clock does it keep\?/).closest('[data-cert]')?.getAttribute('data-cert');

describe('the timezone — read here, set in Time zone (ADR 0207 round 3, ADR 0304)', () => {
  it('prints the stored zone and points at the Time zone row, where it is set', () => {
    mount({ hours: remote(hoursData({ timezone: 'America/Chicago' })) });
    expect(screen.getByText(/America\/Chicago/)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'set in Time zone' });
    expect(link).toHaveAttribute('href', '#st-section-time-zone');
    // ADR 0207's PUT made both of these false.
    expect(screen.queryByText(/no editor exists/i)).toBeNull();
    expect(screen.queryByText(/grepped 2026-09-17/)).toBeNull();
  });

  it('says not recorded rather than assuming one', () => {
    mount({ hours: remote(hoursData({ timezone: null })) });
    expect(screen.getByText(/Not recorded\./i)).toBeInTheDocument();
    expect(clockCert()).toBe('unstated');
  });

  it('tags the clock manual only when a person stands behind this zone', () => {
    const hours = remote(hoursData({ timezone: 'America/Chicago' }));
    mount({ hours, houseTimeZone: remote(zoneData({ source: 'stated' })) });
    expect(clockCert()).toBe('manual');
  });

  it('tags a zone the address gave, or one nobody can attribute, inferred', () => {
    mount({ hours: remote(hoursData({ timezone: 'America/Chicago' })), houseTimeZone: remote(zoneData({ source: 'address' })) });
    expect(clockCert()).toBe('inferred');
  });
});

describe('a stored week that does not parse', () => {
  it('is reported by name, and the hours still read as unstated underneath it', () => {
    mount({ hours: remote(hoursData({ storedHoursErrors: ['missing keys: sun'] })) });
    expect(screen.getByText(/missing keys: sun/)).toBeInTheDocument();
    expect(
      screen.getByText(/Nobody has recorded when this house opens/i),
    ).toBeInTheDocument();
  });
});

describe('a reader who may not change the hours', () => {
  it('sees the state but no editor button', () => {
    mount({ canManage: false });
    expect(screen.queryByRole('button', { name: /set hours/i })).not.toBeInTheDocument();
  });
});

describe('the day sheet — nothing is saved by opening it', () => {
  it('opening it on unknown hours does not arm a one-click all-closed save', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: /set hours/i }));
    expect(screen.getByRole('button', { name: /save hours/i })).toBeInTheDocument();
    expect(api.putOperatingHours).not.toHaveBeenCalled();
  });

  it('Save sends the edited week and the result replaces the register in place', async () => {
    api.putOperatingHours.mockResolvedValue({
      restaurantId: 'r1',
      timezone: 'Europe/Istanbul',
      operatingHours: { ...EMPTY_WEEK, tue: [{ open: '12:00', close: '23:00' }] },
      updatedAt: '2026-09-06T09:00:00.000Z',
    });
    const { hours } = mount();
    await userEvent.click(screen.getByRole('button', { name: /set hours/i }));

    // Every day opens the sheet already "Closed" (a fresh unknown week) — the
    // seven checkboxes render in WEEKDAYS order, so index 1 is Tuesday.
    // Unchecking it arms a default range for that day only.
    const closedBoxes = screen.getAllByLabelText('Closed');
    expect(closedBoxes).toHaveLength(7);
    fireEvent.click(closedBoxes[1]);
    await userEvent.click(screen.getByRole('button', { name: /save hours/i }));

    await waitFor(() =>
      expect(api.putOperatingHours).toHaveBeenCalledWith(
        'r1',
        expect.objectContaining({ tue: [{ open: '12:00', close: '23:00' }] }),
      ),
    );
    expect(hours.set).toHaveBeenCalled();
  });

  it('records the hours as unknown instead — PUTs null, never an all-closed week', async () => {
    api.putOperatingHours.mockResolvedValue({
      restaurantId: 'r1',
      timezone: 'Europe/Istanbul',
      operatingHours: null,
      updatedAt: '2026-09-06T10:00:00.000Z',
    });
    const { hours } = mount({
      hours: remote(
        hoursData({ operatingHours: { ...EMPTY_WEEK, tue: [{ open: '12:00', close: '23:00' }] } }),
      ),
    });
    await userEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    await userEvent.click(
      screen.getByRole('button', { name: /record the hours as unknown instead/i }),
    );

    await waitFor(() => expect(api.putOperatingHours).toHaveBeenCalledWith('r1', null));
    expect(hours.set).toHaveBeenCalled();
  });

  it('a save that fails validation lists every fault the server named, and saves nothing', async () => {
    api.putOperatingHours.mockRejectedValue({
      response: {
        status: 400,
        data: {
          message: 'operating_hours invalid',
          errors: [
            'mon[0].close: not HH:MM (00:00–23:59): "25:00"',
            'tue: ranges overlap or are unsorted (11:00-15:00 then 14:00-22:00)',
          ],
        },
      },
    });
    const { hours } = mount({
      hours: remote(
        hoursData({ operatingHours: { ...EMPTY_WEEK, mon: [{ open: '12:00', close: '23:00' }] } }),
      ),
    });
    await userEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    await userEvent.click(screen.getByRole('button', { name: /save hours/i }));

    const box = await screen.findByRole('alert');
    expect(box).toHaveTextContent('not HH:MM');
    expect(box).toHaveTextContent('ranges overlap');
    expect(hours.set).not.toHaveBeenCalled();
  });
});
