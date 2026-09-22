import { describe, expect, it } from 'vitest';
import { allTicks, dayClockOf, dayHead, hoursSentence, unreadRegisters, type DayRegister } from './dayRead';

const ANSWERED_CALENDAR: DayRegister = {
  key: 'calendar',
  state: 'answered',
  readAt: '2026-09-21T14:00:00Z',
  ms: 10,
  count: 1,
  complete: true,
  ticks: [{ id: 'e-1', at: '2026-09-21T19:00:00Z', label: 'Tasting', href: '/calendar?event=e-1' }],
};

const ANSWERED_DELIVERY: DayRegister = {
  key: 'deliveryArrived',
  state: 'answered',
  readAt: '2026-09-21T14:00:00Z',
  ms: 5,
  count: 1,
  complete: true,
  ticks: [{ id: 'delivery-o-1', at: '2026-09-21T16:00:00Z', label: 'Order ORD-1', href: '/orders?highlight=o-1' }],
};

const UNREADABLE_REMINDERS: DayRegister = {
  key: 'reminders',
  state: 'unreadable',
  readAt: '2026-09-21T14:00:00Z',
  ms: 8000,
  status: null,
  sentence: 'Today’s reminders did not answer within 8 s.',
};

describe('dayHead', () => {
  it('counts out of what was actually returned — "N of 3", never a bigger number', () => {
    expect(dayHead([ANSWERED_CALENDAR, ANSWERED_DELIVERY, UNREADABLE_REMINDERS])).toBe(
      '2 of 3 registers · 1 not read',
    );
  });

  it('no registers at all', () => {
    expect(dayHead([])).toBe('no registers read');
  });

  it('everything answered — no trailing clause', () => {
    expect(dayHead([ANSWERED_CALENDAR, ANSWERED_DELIVERY])).toBe('2 of 2 registers');
  });
});

describe('allTicks', () => {
  it('merges ticks across answered registers, sorted by time', () => {
    const ticks = allTicks([ANSWERED_CALENDAR, ANSWERED_DELIVERY, UNREADABLE_REMINDERS]);
    expect(ticks.map((t) => t.id)).toEqual(['delivery-o-1', 'e-1']); // 16:00 before 19:00
  });

  it('a register that did not answer contributes no ticks — never a guess', () => {
    const ticks = allTicks([UNREADABLE_REMINDERS]);
    expect(ticks).toEqual([]);
  });
});

describe('unreadRegisters', () => {
  it('names exactly the registers that did not answer', () => {
    expect(unreadRegisters([ANSWERED_CALENDAR, UNREADABLE_REMINDERS]).map((r) => r.key)).toEqual(['reminders']);
  });
});

describe('hoursSentence', () => {
  it('recorded hours say nothing — the bands speak for themselves', () => {
    expect(hoursSentence({ state: 'recorded', windows: [] })).toBeNull();
  });

  it('not_recorded carries its own sentence when given one', () => {
    expect(hoursSentence({ state: 'not_recorded', windows: [], sentence: 'Hours not set — no prep, doors or close today.' })).toBe(
      'Hours not set — no prep, doors or close today.',
    );
  });

  it('unreadable falls back to a generic sentence when none is given', () => {
    expect(hoursSentence({ state: 'unreadable', windows: [] })).toBe('Hours could not be read.');
  });
});

describe('dayClockOf', () => {
  it('formats in the HOUSE timezone, not the viewer device zone', () => {
    // 2026-09-21T19:00:00Z is 14:00 in America/Chicago (CDT, UTC-5).
    expect(dayClockOf('2026-09-21T19:00:00Z', 'America/Chicago')).toBe('14:00');
  });

  it('falls back to the viewer zone when the house has none, never throwing', () => {
    expect(() => dayClockOf('2026-09-21T19:00:00Z', null)).not.toThrow();
  });

  it('an invalid timezone degrades instead of crashing the line', () => {
    expect(() => dayClockOf('2026-09-21T19:00:00Z', 'Not/AZone')).not.toThrow();
  });

  it('an unparseable instant prints an em dash, not "Invalid Date"', () => {
    expect(dayClockOf('not-a-date', 'America/Chicago')).toBe('—');
  });
});
