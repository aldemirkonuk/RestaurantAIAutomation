/**
 * Notifications — each control writes only what it changed (F-215), the
 * low-stock digest offers only the hours it can go out at (F-216), and a row
 * with a wide control wraps on a phone instead of widening the page (F-182).
 *
 * The component is rendered directly: what is under test is what each control
 * sends, not the page's mounting of the register.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import NotifySection from './NotifySection';
import { Row } from './SectionKit';
import type { SettingsNextData } from './useSettingsNextData';

function prefs(over: Record<string, unknown> = {}) {
  return {
    userId: 'u1',
    email: true,
    push: false,
    sms: false,
    categories: { inventory: true, orders: true, calendar: true, system: true, ai: true },
    quietHours: { enabled: true, startTime: '22:00', endTime: '08:00' },
    lowStock: {
      enabled: true, instantFirstAlert: true, criticalImmediate: true, digestFrequency: 'daily', digestTime: '12:30',
    },
    ordersMode: 'both',
    reportsMode: 'both',
    updatedAt: '2026-10-01T10:00:00Z',
    ...over,
  };
}

function mount() {
  const saveNotif = vi.fn(() => Promise.resolve(true));
  const data = {
    saveNotif,
    writer: { busy: null, failed: null, run: vi.fn(), clear: vi.fn() },
    notif: { status: 'ok', data: prefs(), error: null, reload: vi.fn(), set: vi.fn() },
  } as unknown as SettingsNextData;
  render(<NotifySection data={data} />);
  return { saveNotif };
}

describe('F-215 — notification controls do not overwrite each other', () => {
  it('two low-stock switches flipped before the first answer each send only their own key', () => {
    const { saveNotif } = mount();
    // Both clicks land on the same render: the screen has not heard back yet.
    fireEvent.click(screen.getByRole('switch', { name: 'Instant first alert' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Critical immediate' }));
    expect(saveNotif).toHaveBeenNthCalledWith(1, 'low.first', { lowStock: { instantFirstAlert: false } });
    // Before the fix this carried the stale `instantFirstAlert: true` and
    // switched the first change back on.
    expect(saveNotif).toHaveBeenNthCalledWith(2, 'low.critical', { lowStock: { criticalImmediate: false } });
  });

  it('a quiet-hours time saves once, when the owner leaves the field, and alone', () => {
    const { saveNotif } = mount();
    const start = screen.getByLabelText('Quiet hours start');
    fireEvent.change(start, { target: { value: '07:00' } });
    fireEvent.change(start, { target: { value: '07:30' } });
    expect(saveNotif).not.toHaveBeenCalled();
    fireEvent.blur(start);
    expect(saveNotif).toHaveBeenCalledTimes(1);
    expect(saveNotif).toHaveBeenCalledWith('quiet.start', { quietHours: { startTime: '07:30' } });
  });

  it('leaving a time field unchanged sends nothing', () => {
    const { saveNotif } = mount();
    fireEvent.blur(screen.getByLabelText('Quiet hours end'));
    expect(saveNotif).not.toHaveBeenCalled();
  });
});

describe('F-216 — the digest time is an hour', () => {
  it('offers the twenty-four hours only, and shows a stored 12:30 as the 12:00 it is sent at', () => {
    const { saveNotif } = mount();
    const time = screen.getByLabelText('Digest time') as HTMLSelectElement;
    expect(time.tagName).toBe('SELECT');
    const values = Array.from(time.options).map((o) => o.value);
    expect(values).toHaveLength(24);
    expect(values.every((v) => v.endsWith(':00'))).toBe(true);
    expect(time.value).toBe('12:00');
    fireEvent.change(time, { target: { value: '07:00' } });
    expect(saveNotif).toHaveBeenCalledWith('low.time', { lowStock: { digestTime: '07:00' } });
  });
});

describe('F-182 — a settings row wraps on a phone', () => {
  it('lets a wide control drop under its label rather than holding the row open', () => {
    render(<Row label="Digest" consequence="Sent once a day." control={<span>wide control</span>} />);
    const control = screen.getByText('wide control').parentElement as HTMLElement;
    const row = control.parentElement as HTMLElement;
    expect(row.style.flexWrap).toBe('wrap');
    expect(control.style.maxWidth).toBe('100%');
    expect(control.style.flexShrink).not.toBe('0');
  });
});

describe('F-868 — the quiet-hours clock says the rule the phone push keeps', () => {
  it('with no time zone set, names the country clock first and UTC only after it', () => {
    mount();
    // The push rule reads the house zone, else the country's only zone, else
    // UTC; the old sentence said UTC alone, which a one-zone country never is.
    expect(
      screen.getByText(/Until a time zone is set, the window is read on your country's clock when it has just one, otherwise in UTC\./),
    ).toBeTruthy();
  });
});

describe('F-1338 — your low-stock switches are yours', () => {
  it('says turning yours off quiets you, and no longer that anyone’s choice reaches everyone', () => {
    mount();
    expect(screen.getByText(/reaches your bell and phone only when your own switches want it/)).toBeTruthy();
    expect(screen.queryByText(/an alert goes out if/)).toBeNull();
    expect(screen.getByText('Off means no low-stock alert reaches your bell or phone. Others here still get theirs.')).toBeTruthy();
  });
});
