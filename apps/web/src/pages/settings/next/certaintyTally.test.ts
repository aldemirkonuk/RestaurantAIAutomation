/**
 * The certainty tally — the founder's ship-now interim ("Lane answers batch
 * 2", 2026-09-19 ~09:30Z): "ship the counted sentence now (from data,
 * labelled 'computed here')". Pure-function tests: nothing here renders a
 * component or touches the DOM, which is the whole point of building the
 * tally this way rather than as a `document.querySelectorAll('[data-cert]')`
 * read (see `certaintyTally.ts`'s own docblock).
 *
 * `certaintyTags`/`computeCertaintyTally` are exercised directly against
 * `CertaintyTallyInput` fixtures — the same shapes `CarryingCostSection.test.tsx`,
 * `CurrencySection.test.tsx`, `HoursSection.test.tsx` and `DigestRow.test.tsx`
 * already use for their own registers — rather than through `SettingsNext`,
 * so a change to any other section of that page cannot make this suite flap.
 */
import { describe, expect, it } from 'vitest';
import {
  carryingCostCert,
  certaintyTags,
  certaintyTallyLine,
  certaintyTallySentence,
  computeCertaintyTally,
  currencyCert,
  digestCert,
  hoursOpenCert,
  hoursTimezoneCert,
  notifyCertCount,
  type CertaintyTallyInput,
} from './certaintyTally';

function remote<T>(data: T | null, status: 'idle' | 'loading' | 'ok' | 'error' | 'denied' = 'ok') {
  return { status, data, error: status === 'error' ? 'gateway unreachable' : null, reload: () => {}, set: () => {} };
}

/** Every one of the nine rows answered — 9 of 9. */
function fullInput(): CertaintyTallyInput {
  return {
    houseCarryingCost: remote({
      restaurantId: 'r1', percentPerMonth: 1.2, basis: 'cash + space', readable: true,
      reason: null, statedAt: null, statedBy: null,
    }),
    houseCurrency: remote({
      restaurantId: 'r1', code: 'USD', country: 'US', readable: true,
      reason: null, statedAt: null, statedBy: null,
    }),
    hours: remote({
      restaurantId: 'r1', timezone: 'Europe/Istanbul',
      operatingHours: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
      updatedAt: null,
    }),
    digest: remote({
      stated: true, digestEnabled: true, digestHour: 8, digestMinUrgency: 'now',
      recipientEmail: 'a@b.com', lastSentAt: null,
    }),
    notif: remote({
      userId: 'u1', email: true, push: true, sms: false,
      categories: { inventory: true, orders: true, calendar: true, system: true, ai: true },
      lowStock: { enabled: true, instantFirstAlert: true, criticalImmediate: true, digestFrequency: 'daily' as const, digestTime: '12:00' },
      quietHours: { enabled: false, startTime: '22:00', endTime: '08:00' },
      ordersMode: 'both' as const, reportsMode: 'both' as const,
    }),
  };
}

/** Nothing has loaded yet — every register idle/loading. */
function emptyInput(): CertaintyTallyInput {
  return {
    houseCarryingCost: remote(null, 'loading'),
    houseCurrency: remote(null, 'loading'),
    hours: remote(null, 'loading'),
    digest: remote(null, 'loading'),
    notif: remote(null, 'loading'),
  };
}

describe('the per-row certainty functions — the single source each section imports', () => {
  it('carryingCostCert: manual once a number is typed, unstated otherwise', () => {
    expect(carryingCostCert({ percentPerMonth: 1, basis: null } as never)).toBe('manual');
    expect(carryingCostCert({ percentPerMonth: null, basis: null } as never)).toBe('unstated');
  });

  it('currencyCert: manual once a code is recorded, unstated otherwise', () => {
    expect(currencyCert({ code: 'TRY' } as never)).toBe('manual');
    expect(currencyCert({ code: null } as never)).toBe('unstated');
  });

  it('hoursOpenCert / hoursTimezoneCert', () => {
    expect(hoursOpenCert({ operatingHours: { mon: [] } } as never)).toBe('manual');
    expect(hoursOpenCert({ operatingHours: null } as never)).toBe('unstated');
    expect(hoursTimezoneCert({ timezone: 'UTC' } as never)).toBe('manual');
    expect(hoursTimezoneCert({ timezone: null } as never)).toBe('unstated');
  });

  it('digestCert: unstated in every non-ok state, and in a null-data "ok" (mirrors DigestRow.tsx)', () => {
    expect(digestCert(remote(null, 'idle'))).toBe('unstated');
    expect(digestCert(remote(null, 'loading'))).toBe('unstated');
    expect(digestCert(remote(null, 'denied'))).toBe('unstated');
    expect(digestCert(remote(null, 'error'))).toBe('unstated');
    expect(digestCert(remote(null, 'ok'))).toBe('unstated');
  });

  it('digestCert: manual once stated, unstated once loaded but never answered', () => {
    expect(digestCert(remote({ stated: true } as never, 'ok'))).toBe('manual');
    expect(digestCert(remote({ stated: false } as never, 'ok'))).toBe('unstated');
  });

  it('notifyCertCount: exactly 4 once loaded, 0 otherwise', () => {
    expect(notifyCertCount(remote({} as never, 'ok'))).toBe(4);
    expect(notifyCertCount(remote(null, 'loading'))).toBe(0);
    expect(notifyCertCount(remote(null, 'denied'))).toBe(0);
    expect(notifyCertCount(remote(null, 'error'))).toBe(0);
  });
});

describe('certaintyTags / computeCertaintyTally — from data, never the DOM', () => {
  it('counts all nine rows manual when every register is answered', () => {
    expect(certaintyTags(fullInput())).toEqual(['manual', 'manual', 'manual', 'manual', 'manual', 'manual', 'manual', 'manual', 'manual']);
    expect(computeCertaintyTally(fullInput())).toEqual({ counted: 9, total: 9 });
  });

  it('an unanswered field is on the page but not counted', () => {
    const data = fullInput();
    data.houseCurrency = remote({ ...data.houseCurrency.data!, code: null });
    expect(computeCertaintyTally(data)).toEqual({ counted: 8, total: 9 });
  });

  it('a register still loading is absent from the tally entirely — not "unstated"', () => {
    const data = fullInput();
    data.houseCarryingCost = remote(null, 'loading');
    expect(computeCertaintyTally(data)).toEqual({ counted: 8, total: 8 });
  });

  it('an unreadable register (readable: false) is absent, like a failed read', () => {
    const data = fullInput();
    data.houseCurrency = remote({ ...data.houseCurrency.data!, readable: false });
    expect(computeCertaintyTally(data)).toEqual({ counted: 8, total: 8 });
  });

  it('the digest row is on the page even before it loads (unlike the other four)', () => {
    const data = fullInput();
    data.digest = remote(null, 'loading');
    expect(computeCertaintyTally(data)).toEqual({ counted: 8, total: 9 });
  });

  it('nothing loaded yet → zero and zero', () => {
    expect(computeCertaintyTally(emptyInput())).toEqual({ counted: 0, total: 1 }); // the digest row alone is always present
  });
});

describe('certaintyTallySentence / certaintyTallyLine — the founder\'s exact ask', () => {
  it('names the share and is labelled "computed here"', () => {
    expect(certaintyTallySentence({ counted: 9, total: 9 })).toBe(
      'Stated so far: 9 of 9 certainty-stamped settings — computed here.',
    );
    expect(certaintyTallySentence({ counted: 6, total: 9 })).toBe(
      'Stated so far: 6 of 9 certainty-stamped settings — computed here.',
    );
  });

  it('is null rather than a "0 of 0" claim when the total is zero', () => {
    expect(certaintyTallySentence({ counted: 0, total: 0 })).toBeNull();
  });

  it('certaintyTallyLine composes both steps end to end', () => {
    expect(certaintyTallyLine(fullInput())).toBe(
      'Stated so far: 9 of 9 certainty-stamped settings — computed here.',
    );
  });
});
