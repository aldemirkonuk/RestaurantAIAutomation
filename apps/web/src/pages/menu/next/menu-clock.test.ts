/**
 * Menu r21: a menu's dates are said on the house's clock, not the device's.
 * The instant 2026-11-12T03:05:09Z is 22:05 the evening before in Detroit and
 * 06:05 the same morning in Istanbul -- the same read, two different days.
 */
import { describe, expect, it } from 'vitest';
import { deviceClockNote, houseDay, houseMoment, zoneUsable } from './menu-clock';

const READ = '2026-11-12T03:05:09Z';

describe('menu-clock', () => {
  it('says the day and the minute in the house zone', () => {
    expect(houseDay(READ, 'America/Detroit')).toBe('2026-11-11');
    expect(houseMoment(READ, 'America/Detroit')).toBe('2026-11-11 22:05');
    expect(houseDay(READ, 'Europe/Istanbul')).toBe('2026-11-12');
    expect(houseMoment(READ, 'Europe/Istanbul', true)).toBe('2026-11-12 06:05:09');
  });

  it('midnight is 00, never 24', () => {
    expect(houseMoment('2026-11-12T21:00:00Z', 'Europe/Istanbul')).toBe('2026-11-13 00:00');
  });

  it('with no usable zone, the device clock is used, the same as before', () => {
    const d = new Date(READ);
    const pad = (n: number) => String(n).padStart(2, '0');
    const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    expect(houseMoment(READ, null)).toBe(local);
    expect(houseMoment(READ, 'Mars/Olympus')).toBe(local);
    expect(zoneUsable('Mars/Olympus')).toBe(false);
  });

  it('a value that is not a moment is null', () => {
    expect(houseDay('not a date', 'Europe/Istanbul')).toBeNull();
    expect(houseMoment('', 'Europe/Istanbul')).toBeNull();
  });

  it("says once when the dates are on the device's clock, and why", () => {
    expect(deviceClockNote('Europe/Istanbul', null)).toBeNull();
    expect(deviceClockNote(null, 'the house has no time zone set')).toBe(
      "Dates and times here are on this device's clock: the house has no time zone set. Set the house's time zone in Settings.",
    );
  });
});
