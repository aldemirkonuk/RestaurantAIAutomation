import { describe, expect, it } from 'vitest';
import { houseDay, houseDayInYear, houseSpan, houseYear, knownZone } from './house-day';

/*
 * VEN-W23 (founder, 2026-10-01): a day on the vendor sheet is the HOUSE's own
 * calendar day in English words. The defect: 9:20 pm on Oct 1 in Chicago is
 * 02:20 UTC on Oct 2, and slicing the ISO string printed "2026-10-02".
 */
const EVENING_IN_CHICAGO = '2026-10-02T02:20:00.000Z';

describe('houseDay', () => {
  it('reads a 02:20 UTC moment as the PREVIOUS Chicago day', () => {
    expect(houseDay(EVENING_IN_CHICAGO, 'America/Chicago')).toBe('Oct 1, 2026');
  });

  it('reads the same moment as Oct 2 in Istanbul', () => {
    expect(houseDay(EVENING_IN_CHICAGO, 'Europe/Istanbul')).toBe('Oct 2, 2026');
  });

  it('with no zone (or one Intl does not know) reads UTC and says so', () => {
    expect(houseDay(EVENING_IN_CHICAGO, null)).toBe('Oct 2, 2026 (UTC)');
    expect(houseDay(EVENING_IN_CHICAGO, 'Not/AZone')).toBe('Oct 2, 2026 (UTC)');
    expect(knownZone('Not/AZone')).toBeNull();
  });

  it('an unreadable moment is null, not a date', () => {
    expect(houseDay('nope', 'America/Chicago')).toBeNull();
    expect(houseDay(null, 'America/Chicago')).toBeNull();
  });
});

describe('houseSpan', () => {
  it('inside one year prints the year once, at the end', () => {
    expect(houseSpan('2026-07-03T12:00:00Z', '2026-10-01T12:00:00Z', 'America/Chicago')).toBe(
      'Jul 3 – Oct 1, 2026',
    );
  });

  it('across two years prints both', () => {
    expect(houseSpan('2025-12-03T12:00:00Z', '2026-03-01T12:00:00Z', 'America/Chicago')).toBe(
      'Dec 3, 2025 – Mar 1, 2026',
    );
  });

  it('reads both ends on the house clock and labels UTC when there is no zone', () => {
    expect(houseSpan('2026-07-03T02:20:00Z', EVENING_IN_CHICAGO, 'America/Chicago')).toBe(
      'Jul 2 – Oct 1, 2026',
    );
    expect(houseSpan('2026-07-03T02:20:00Z', EVENING_IN_CHICAGO, null)).toBe('Jul 3 – Oct 2, 2026 (UTC)');
  });
});

describe('houseDayInYear / houseYear', () => {
  it('drops the year only when it is the one the heading names', () => {
    expect(houseDayInYear('2026-08-16T15:00:00Z', 'America/Chicago', 2026)).toBe('Aug 16');
    expect(houseDayInYear('2025-12-16T15:00:00Z', 'America/Chicago', 2026)).toBe('Dec 16, 2025');
    expect(houseDayInYear('2026-08-16T15:00:00Z', 'America/Chicago', null)).toBe('Aug 16, 2026');
  });

  it('the year is the house’s: New Year’s Eve evening in Chicago is still the old year', () => {
    expect(houseYear('2027-01-01T03:00:00Z', 'America/Chicago')).toBe(2026);
    expect(houseYear('2027-01-01T03:00:00Z', null)).toBe(2027);
  });
});
