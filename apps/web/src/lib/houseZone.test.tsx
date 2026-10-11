/**
 * F-571: the house's zone, read once, decides a page's today and this week.
 * The suite's device zone is America/New_York (src/__tests__/setup.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useState } from 'react';

const said = vi.hoisted(() => ({ zone: null as string | null, fail: false, calls: 0 }));
vi.mock('@/services/api/restaurants', () => ({
  restaurantsApi: {
    getOperatingHours: vi.fn(async () => {
      said.calls += 1;
      if (said.fail) throw new Error('down');
      return { timezone: said.zone };
    }),
  },
}));

import { forgetHouseZones, getHouseZone, houseToday, useHouseZone, useSettleOnHouseDay } from './houseZone';
import { setHouseLocale } from './houseCurrency';
import { mondayOf } from '@/pages/team/next/tm-format';
import { fmtDate, fmtReadTime } from '@/pages/orders/next/format';
import { shortDate } from '@/pages/cellar/next/cellar-format';

const key = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

beforeEach(() => {
  forgetHouseZones();
  said.zone = null;
  said.fail = false;
  said.calls = 0;
  localStorage.setItem('activeRestaurantId', 'r1');
});
afterEach(() => {
  localStorage.removeItem('activeRestaurantId');
});

describe('houseToday', () => {
  // Sunday 20:00 in New York is already Monday 09:00 in Tokyo.
  const now = new Date('2026-09-14T00:00:00Z');

  it("is the house's calendar day, not the device's", () => {
    expect(key(houseToday('Asia/Tokyo', now))).toBe('2026-09-14');
    expect(key(houseToday(null, now))).toBe('2026-09-13');
  });

  it("puts this week on the house's Monday", () => {
    expect(mondayOf(houseToday('Asia/Tokyo', now))).toBe('2026-09-14');
    expect(mondayOf(houseToday(null, now))).toBe('2026-09-07');
  });

  it("falls back to the device's day for a zone this browser cannot read", () => {
    expect(key(houseToday('Not/AZone', now))).toBe('2026-09-13');
  });
});

describe('useHouseZone', () => {
  it('reads the zone once and shares it', async () => {
    said.zone = 'America/Los_Angeles';
    const a = renderHook(() => useHouseZone());
    const b = renderHook(() => useHouseZone());
    expect(a.result.current).toBeUndefined();
    await waitFor(() => expect(a.result.current).toBe('America/Los_Angeles'));
    await waitFor(() => expect(b.result.current).toBe('America/Los_Angeles'));
    expect(said.calls).toBe(1);
  });

  it('says null when the house has no zone, and when the read fails (retried next time)', async () => {
    const none = renderHook(() => useHouseZone());
    await waitFor(() => expect(none.result.current).toBeNull());

    forgetHouseZones();
    said.fail = true;
    const failed = renderHook(() => useHouseZone());
    await waitFor(() => expect(failed.result.current).toBeNull());
    said.fail = false;
    said.zone = 'Asia/Tokyo';
    const again = renderHook(() => useHouseZone());
    await waitFor(() => expect(again.result.current).toBe('Asia/Tokyo'));
  });

  it('a newly recorded zone reaches a reader that is already mounted (F-995)', async () => {
    const mounted = renderHook(() => useHouseZone());
    await waitFor(() => expect(mounted.result.current).toBeNull());
    said.zone = 'Europe/Istanbul';
    forgetHouseZones('r1');
    await waitFor(() => expect(mounted.result.current).toBe('Europe/Istanbul'));
    expect(said.calls).toBe(2);
  });

  it('is null with no house picked, without reading', () => {
    localStorage.removeItem('activeRestaurantId');
    const { result } = renderHook(() => useHouseZone());
    expect(result.current).toBeNull();
    expect(said.calls).toBe(0);
  });
});

describe('useSettleOnHouseDay', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-14T00:00:00Z')); // Sun evening NY, Mon Tokyo
  });
  afterEach(() => vi.useRealTimers());

  it("moves an untouched week to the house's once the zone lands", () => {
    const { result, rerender } = renderHook(({ zone }: { zone: string | null | undefined }) => {
      const [week, setWeek] = useState(() => mondayOf(houseToday(zone)));
      useSettleOnHouseDay(zone, mondayOf, setWeek);
      return week;
    }, { initialProps: { zone: undefined as string | null | undefined } });
    expect(result.current).toBe('2026-09-07');
    rerender({ zone: 'Asia/Tokyo' });
    expect(result.current).toBe('2026-09-14');
  });

  it('leaves a week the person already moved', () => {
    const { result, rerender } = renderHook(({ zone }: { zone: string | null | undefined }) => {
      const [week, setWeek] = useState('2026-08-31');
      useSettleOnHouseDay(zone, mondayOf, setWeek);
      return week;
    }, { initialProps: { zone: undefined as string | null | undefined } });
    rerender({ zone: 'Asia/Tokyo' });
    expect(result.current).toBe('2026-08-31');
  });
});

describe("the date formatters read the house's zone and date order (F-1135, F-1104, F-1344)", () => {
  // 01:30 on 3 March in Istanbul is still the evening of 2 March in New York.
  const late = '2026-03-02T22:30:00Z';

  it('[REVERT-FAILS] /orders and the cellar print the house\'s day once its zone is read', async () => {
    said.zone = 'Europe/Istanbul';
    expect(getHouseZone()).toBeNull();
    expect(fmtDate(late)).toMatch(/^3\/2(\/2026)?$/);
    const h = renderHook(() => useHouseZone());
    await waitFor(() => expect(h.result.current).toBe('Europe/Istanbul'));
    expect(getHouseZone()).toBe('Europe/Istanbul');
    expect(fmtDate(late)).toMatch(/^3\/3(\/2026)?$/);
    expect(shortDate(late)).toBe('3/3/2026');
    setHouseLocale('tr-TR');
    try {
      // Digits, so a Turkish house's words stay English (F-1344).
      expect(fmtDate(late)).toMatch(/^3\/3$|^03\.03\.2026$/);
      expect(fmtReadTime(Date.parse(late))).toMatch(/01:30$/);
    } finally {
      setHouseLocale('en-US');
    }
    // Another house picked: its zone is not this one's.
    localStorage.setItem('activeRestaurantId', 'r2');
    expect(getHouseZone()).toBeNull();
  });

  it('forgets the zone with the read', async () => {
    said.zone = 'Asia/Tokyo';
    const h = renderHook(() => useHouseZone());
    await waitFor(() => expect(h.result.current).toBe('Asia/Tokyo'));
    forgetHouseZones('r1');
    expect(getHouseZone()).toBeNull();
  });
});
