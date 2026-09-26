import { describe, expect, it } from 'vitest';
import { dateOfGrain, dismissalSentence, firingOf, scopeLabel, scopePromise } from './rec-format';

/**
 * ADR 0191 round 3 — "Each firing is one card". A rule that names no subject
 * and no period is keyed by the period it fired in (the gateway's
 * `firingGrain`); the page reads that back in words and never offers to
 * exclude a firing from the analysis, because it is not a day of data.
 */
describe('a firing, read back', () => {
  it('reads the three firing periods', () => {
    expect(firingOf('fire:day:2026-09-21')).toEqual({ period: 'day', words: 'Mon 21 Sep' });
    expect(firingOf('fire:week:2026-W39')).toEqual({
      period: 'week',
      words: 'the week of Mon 21 Sep',
    });
    expect(firingOf('fire:week:2026-W53')).toEqual({
      period: 'week',
      words: 'the week of Mon 28 Dec',
    });
    expect(firingOf('fire:week:2026-W01')).toEqual({
      period: 'week',
      words: 'the week of Mon 29 Dec',
    });
    expect(firingOf('fire:month:2026-09')).toEqual({ period: 'month', words: 'Sep 2026' });
  });

  it('is not a data grain, and a data grain is not a firing', () => {
    expect(firingOf('d:2026-09-21')).toBeNull();
    expect(firingOf(null)).toBeNull();
    expect(dateOfGrain('fire:day:2026-09-21')).toBeNull();
  });

  it('names the firing on the scope choice and in the promise', () => {
    const f = firingOf('fire:month:2026-09');
    expect(scopeLabel('insight', null, null, f)).toBe('This firing only — Sep 2026');
    expect(scopePromise('insight', null, null, 'vendor_concentration', f)).toMatch(
      /^this firing of it — Sep 2026\. It comes back when the rule fires again/,
    );
    // Without a firing the old words stand.
    expect(scopeLabel('insight', 'Wednesday', '2026-09-02')).toBe('This exact finding — Wed 2 Sep');
  });

  it('says what a dismissed firing silenced, read from the stored key', () => {
    expect(dismissalSentence('vendor_concentration#*#fire:month:2026-09')).toBe(
      'Silenced: one firing of the rule vendor_concentration — Sep 2026. It comes back when the rule fires again.',
    );
    expect(dismissalSentence('vendor_concentration')).toMatch(/entirely/);
  });
});
