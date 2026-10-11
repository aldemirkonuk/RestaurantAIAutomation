import { AxiosError, AxiosHeaders } from 'axios';
import { afterEach, describe, expect, it } from 'vitest';
import { setHouseCurrency, setHouseLocale } from '@/lib/houseCurrency';
import type { AskFinding, AskFolio, AskReading } from '@/services/api/ask';
import {
  EM,
  askFailure,
  composerProblem,
  fmtCount,
  fmtPeriod,
  fmtWhen,
  fmtValue,
  folioChip,
  folioView,
  groupBook,
  groupShelf,
  newRequestId,
  periodLine,
  provenanceMark,
  traceLine,
} from './ask-format';

function reading(id: string, over: Partial<AskReading> = {}): AskReading {
  return { id, version: 1, title: id, question: `${id}?`, subject: 'none', window: false, meaning: '', ...over };
}

function httpError(status: number | null, data?: unknown, code?: string): AxiosError {
  const e = new AxiosError('Request failed', code);
  if (status !== null) {
    e.response = { status, data, statusText: '', headers: {}, config: { headers: new AxiosHeaders() } };
  }
  return e;
}

const finding: AskFinding = {
  readingId: 'inventory.position',
  readingVersion: 1,
  outcome: 'read',
  reason: null,
  asOf: '2026-09-25T14:14:07Z',
  trace: [{ relation: 'restaurant_inventory', outcome: 'rows', rowsScanned: 206, matchedRows: 1, asOf: '2026-09-25T14:14:07Z' }],
  rows: [
    {
      key: 'r1',
      cells: [
        { id: 'c1', key: 'stock_live', label: 'on hand', value: 7, unit: 'bottle', provenance: 'stated' },
        { id: 'c2', key: 'threshold_min', label: 'threshold', value: 3, unit: null, provenance: 'defaulted' },
        { id: 'c3', key: 'in_transit_quantity', label: 'in transit', value: null, unit: 'bottle', provenance: 'not_recorded' },
      ],
    },
  ],
};

function folio(over: Partial<AskFolio>): AskFolio {
  return {
    id: 'f1',
    origin: 'page',
    utterance: 'How much of the Barolo?',
    status: 'complete',
    reading_id: null,
    reading_version: null,
    reading_args: {},
    reply_kind: null,
    answer: null,
    failure_reason: null,
    previous_folio_id: null,
    created_at: '2026-09-25T14:14:00Z',
    completed_at: '2026-09-25T14:14:08Z',
    reading_chosen_by: 'model',
    pick_model: null,
    compose_model: null,
    ...over,
  };
}

describe('the shelf', () => {
  it('groups by register prefix, keeps catalogue order, drops empty groups', () => {
    const g = groupShelf([reading('orders.open'), reading('inventory.position'), reading('goals.targets'), reading('receipts.verified_line')]);
    expect(g.map((x) => x.title)).toEqual(['Stock', 'Orders & receipts', 'Sales, calendar, vendors, targets']);
    expect(g[1].readings.map((r) => r.id)).toEqual(['orders.open', 'receipts.verified_line']);
    // A staff catalogue (the gateway already filtered it) has no house group.
    expect(groupShelf([reading('inventory.position'), reading('orders.due_today')]).map((x) => x.key)).toEqual(['stock', 'orders']);
  });

  it('says what a reading still needs, in words', () => {
    expect(composerProblem({ subject: 'item', window: false }, { subjectText: ' ', from: '', to: '' })).toBe('Name the item first.');
    expect(composerProblem({ subject: 'order', window: false }, { subjectText: '', from: '', to: '' })).toMatch(/order/);
    expect(composerProblem({ subject: 'none', window: true }, { subjectText: '', from: '2026-09-01', to: '' })).toBe('Give the period as two dates.');
    expect(composerProblem({ subject: 'none', window: true }, { subjectText: '', from: '2026-09-10', to: '2026-09-01' })).toMatch(/ends before/);
    expect(composerProblem({ subject: 'item', window: true }, { subjectText: 'Barolo', from: '2026-09-01', to: '2026-09-10' })).toBeNull();
  });
});

describe('a figure (ADR 0051)', () => {
  it('prints an unknown as the em dash and a measured zero as 0', () => {
    expect(fmtValue({ value: null, unit: 'bottle' })).toBe(EM);
    expect(fmtValue({ value: 0, unit: 'bottle' })).toBe('0 bottle');
    expect(fmtValue({ value: true, unit: null })).toBe('yes');
  });

  it('marks a default nobody set as an assumption', () => {
    expect(provenanceMark('defaulted')).toMatch(/^assumed/);
    expect(provenanceMark('stated')).toBeNull();
    expect(provenanceMark('not_recorded')).toBe('not recorded');
  });

  it('says a withheld count is withheld — never 0, never blank', () => {
    expect(fmtCount('withheld_for_your_role')).toBe('count withheld for your role');
    expect(fmtCount(null)).toBe(EM);
    expect(fmtCount(0)).toBe('0');
    expect(traceLine({ relation: 'procurement_orders', outcome: 'withheld', rowsScanned: 'withheld_for_your_role', matchedRows: 'withheld_for_your_role', asOf: '' })).toMatch(/withheld/);
    expect(traceLine({ relation: 'calendar_events', outcome: 'failed', rowsScanned: null, matchedRows: null, asOf: '', failureCode: '57014' })).toBe(
      'calendar_events · did not answer · 57014',
    );
  });
});

describe('a folio, in words', () => {
  it('a reading answers with its focus cells, resolved inside the Finding', () => {
    const v = folioView(folio({ answer: { kind: 'reading', finding, focus: [{ cellId: 'c1' }, { cellId: 'nope' }, { cellId: 'c2' }] }, reply_kind: 'reading' }));
    expect(v.tone).toBe('answer');
    expect(v.figures.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(v.line).toBeNull();
  });

  it("a role refusal prints the server's own line, not one of the page's", () => {
    const line = 'Refused for your role: this reading carries money.';
    const v = folioView(folio({ answer: { kind: 'not_permitted', reason: 'class_not_visible', readingId: 'goals.targets', line }, reply_kind: 'not_permitted' }));
    expect(v.tone).toBe('refused');
    expect(v.line).toBe(line);
  });

  it('a staff-shaped failed read keeps the withheld line; an owner-shaped one names the reason', () => {
    const staff = folioView(folio({ answer: { kind: 'could_not_read', reason: 'withheld_for_your_role', line: 'Couldn’t read the orders right now.' } }));
    expect(staff.line).toBe('Couldn’t read the orders right now.');
    const owner = folioView(folio({ answer: { kind: 'could_not_read', reason: 'source_limit' } }));
    expect(owner.line).toMatch(/larger than one reading/);
  });

  it('each model-side failure has its own sentence', () => {
    for (const reason of ['model_unavailable', 'spend_ceiling', 'invalid_model_reply', 'role_share_used', 'allowance_unreadable']) {
      const v = folioView(folio({ status: 'failed', answer: { kind: 'could_not_answer', reason } }));
      expect(v.tone).toBe('stopped');
      expect(v.line).not.toMatch(/\(/);
    }
    expect(folioView(folio({ answer: { kind: 'could_not_answer', reason: 'spend_ceiling' } })).line).toMatch(/midnight UTC/);
  });

  it('a clarify offers the matching rows by id', () => {
    const v = folioView(folio({ answer: { kind: 'clarify', reason: 'ambiguous_subject', finding: { ...finding, outcome: 'clarify', choices: [{ id: 'a', label: 'Chardonnay 2021' }] } } }));
    expect(v.tone).toBe('clarify');
    expect(v.choices).toEqual([{ id: 'a', label: 'Chardonnay 2021' }]);
  });

  it('model knowledge is its own paper with no figures', () => {
    const v = folioView(folio({ answer: { kind: 'model_knowledge', sourceLabel: "Not from the house's books", text: 'Lamb and Barolo.' } }));
    expect(v.tone).toBe('knowledge');
    expect(v.knowledge).toBe('Lamb and Barolo.');
    expect(v.figures).toEqual([]);
  });

  it('a pending folio says it is saved, never that it failed', () => {
    const justAsked = new Date('2026-09-25T14:14:30Z');
    const v = folioView(folio({ status: 'pending', answer: null }), justAsked);
    expect(v.tone).toBe('pending');
    expect(folioChip(folio({ status: 'pending', reply_kind: null }), justAsked)).toBe('still answering');
  });

  // F-235: a question cut off mid-answer (a restart) stays pending forever;
  // past twice the page's 60 s wait it says so and offers to ask again.
  it('a pending folio older than twice the answer wait says it was interrupted', () => {
    const pending = folio({ status: 'pending', answer: null });
    expect(folioView(pending, new Date('2026-09-25T14:15:59Z')).tone).toBe('pending');
    const v = folioView(pending, new Date('2026-09-25T14:16:01Z'));
    expect(v.tone).toBe('interrupted');
    expect(v.line).toMatch(/will not arrive/);
    expect(v.line).not.toMatch(/Check again/);
    expect(folioChip(pending, new Date('2026-09-25T14:30:00Z'))).toBe('interrupted');
    // A finished folio is never called interrupted, however old.
    expect(folioView(folio({ answer: { kind: 'could_not_answer', reason: 'model_unavailable' } }), new Date('2026-10-01T00:00:00Z')).tone).toBe('stopped');
  });

  // F-234: the pick was read and paid before the allowance ran out.
  it('a spend ceiling after a paid step never says nothing was charged', () => {
    const v = folioView(folio({ answer: { kind: 'could_not_answer', reason: 'spend_ceiling', earlierCallPaid: true } }));
    expect(v.line).not.toMatch(/nothing was charged/i);
    expect(v.line).toMatch(/charged/);
    expect(v.line).toMatch(/midnight UTC/);
  });

  // F-236: a reading of "today" says which date and whose clock.
  it('a reading of today says the date and the clock it was read on', () => {
    const house = folioView(folio({ answer: { kind: 'reading', finding: { ...finding, day: { date: '2026-09-13', zone: 'America/Los_Angeles' } }, focus: [] } }));
    expect(house.day).toBe('“Today” here is 2026-09-13, on the house\'s clock (America/Los_Angeles).');
    const utc = folioView(folio({ answer: { kind: 'not_in_your_books', reason: 'empty_register', finding: { ...finding, day: { date: '2026-09-14', zone: null } } } }));
    expect(utc.day).toMatch(/2026-09-14 in UTC, because the house has no time zone set/);
    expect(folioView(folio({ answer: { kind: 'reading', finding, focus: [] } })).day).toBeNull();
  });
});

describe('the book', () => {
  it('groups by day, today first', () => {
    const now = new Date(2026, 8, 25, 18, 0);
    const days = groupBook(
      [
        folio({ id: 'a', created_at: new Date(2026, 8, 25, 14, 0).toISOString() }),
        folio({ id: 'b', created_at: new Date(2026, 8, 24, 9, 0).toISOString() }),
        folio({ id: 'c', created_at: 'garbage' }),
      ],
      now,
    );
    expect(days.map((d) => d.heading)).toEqual(['Today', 'Yesterday', 'Date not recorded']);
  });
});

describe('the book reads its days on the house\'s clock, in digits (F-1391)', () => {
  afterEach(() => setHouseLocale(null));

  // 22:00 in New York (the device here) is already 05:00 the next day in Istanbul.
  const now = new Date('2026-09-26T02:00:00Z');

  it('[REVERT-FAILS] heads an older day with an English weekday and the date in the house\'s order', () => {
    setHouseLocale('tr-TR');
    const days = groupBook(
      [
        folio({ id: 'a', created_at: '2026-09-25T22:30:00Z' }),
        folio({ id: 'b', created_at: '2026-09-21T09:00:00Z' }),
      ],
      now,
      'Europe/Istanbul',
    );
    // 01:30 on the 26th in Istanbul is the house's today, though the device still says the 25th.
    expect(days.map((d) => d.heading)).toEqual(['Today', 'Mon, 21/9']);
  });

  it('[REVERT-FAILS] a folio\'s day and clock are the house\'s, in its way of writing them', () => {
    setHouseLocale('tr-TR');
    expect(fmtWhen('2026-09-21T09:00:00Z', now, 'Europe/Istanbul')).toBe('Mon, 21/9, 12:00');
    expect(fmtWhen('2025-09-21T09:00:00Z', now, 'Europe/Istanbul')).toBe('Sun, 21.09.2025, 12:00');
    expect(fmtWhen('2026-09-25T22:30:00Z', now, 'Europe/Istanbul')).toBe('1:30');
  });

  it('with no zone read, the device\'s clock stands in', () => {
    expect(groupBook([folio({ id: 'a', created_at: '2026-09-25T22:30:00Z' })], now, null)[0].heading).toBe('Today');
  });
});

describe('a request that failed (ADR 0051 error states)', () => {
  it('the launch gate is "not opened yet", not an outage', () => {
    const f = askFailure(httpError(503, { message: 'Ask has not launched yet.' }));
    expect(f.kind).toBe('not_open');
    expect(f.message).toMatch(/not opened yet/);
    expect(f.checkAgain).toBe(false);
  });
  it("another 503 carries the server's sentence and may be checked again", () => {
    const f = askFailure(httpError(503, { message: 'The question could not be saved. Nothing was sent for an answer.' }));
    expect(f.kind).toBe('unavailable');
    expect(f.message).toMatch(/could not be saved/);
    expect(f.checkAgain).toBe(true);
  });
  it('a 429 keeps the server’s retry sentence and names both limits', () => {
    const f = askFailure(httpError(429, { message: 'Too many requests. Try again in 12 seconds.' }));
    expect(f.kind).toBe('too_fast');
    expect(f.message).toMatch(/12 seconds/);
    expect(f.message).toMatch(/10 a minute/);
  });
  it('the 60 s budget running out is a timeout that can be checked again', () => {
    const f = askFailure(httpError(null, undefined, 'ECONNABORTED'));
    expect(f.kind).toBe('timeout');
    expect(f.checkAgain).toBe(true);
  });
  it('refusals and rejections say which', () => {
    expect(askFailure(httpError(403, { message: 'Forbidden' })).kind).toBe('refused');
    expect(askFailure(httpError(400, { message: ['utterance must be shorter'] })).message).toBe('utterance must be shorter');
    expect(askFailure(httpError(409, { message: 'This question identity already belongs to a different request.' })).kind).toBe('rejected');
  });
});

// F-1246: a Turkish house reads its figures its own way, not the device's.
describe('a figure in the house\'s formats (F-1246)', () => {
  afterEach(() => {
    setHouseLocale(null);
    setHouseCurrency(undefined);
  });

  it('prints money in its currency, grouped the house\'s way', () => {
    setHouseLocale('tr-TR');
    expect(fmtValue({ value: 12400.5, unit: 'TRY' })).toBe(new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(12400.5));
    expect(fmtValue({ value: 12400.5, unit: 'TRY' })).not.toContain('TRY');
    expect(fmtValue({ value: 1250, unit: 'ml' })).toBe('1.250 ml');
    expect(fmtValue({ value: 2, unit: 'BOX' })).toBe('2 BOX');
  });

  it('names a goal\'s measure and prints its target in that measure\'s unit', () => {
    setHouseLocale('tr-TR');
    setHouseCurrency('TRY');
    expect(fmtValue({ key: 'goal-a:metric_key', value: 'wine_revenue', unit: null })).toBe('Wine revenue');
    expect(fmtValue({ key: 'goal-a:target_value', value: 50000, unit: 'wine_revenue' })).toBe(new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', minimumFractionDigits: 2 }).format(50000));
    expect(fmtValue({ key: 'goal-b:target_value', value: 0.35, unit: 'wine_attach_rate' })).toBe('35%');
    expect(fmtValue({ key: 'goal-c:target_value', value: 1200, unit: 'bottles_sold' })).toBe('1.200 bottles');
    expect(fmtValue({ key: 'goal-d:metric_key', value: 'something_new', unit: null })).toBe('something_new');
  });

  it('prints a recorded instant on the house\'s clock, and says UTC when there is no zone', () => {
    const at = '2026-09-12T21:30:00Z';
    expect(fmtValue({ value: at, unit: null }, 'Europe/Istanbul')).toBe('9/13/2026, 12:30 AM');
    expect(fmtValue({ value: at, unit: null }, null)).toMatch(/9\/12\/2026.*9:30.*UTC$/);
    expect(fmtValue({ value: '2026-09-12', unit: null })).toBe('2026-09-12');
  });

  // F-1322: a Turkish house reads the date in its order, in digits, never "Eyl".
  it('prints a Turkish house\'s instant in digits, day first, keeping the zone', () => {
    setHouseLocale('tr-TR');
    const text = fmtValue({ value: '2026-09-12T21:30:00Z', unit: null }, 'Europe/Istanbul');
    expect(text).toMatch(/^13\.09\.2026/);
    expect(text).toMatch(/ 0?0:30$/);
    expect(text).not.toMatch(/[A-Za-zçğıöşüÇĞİÖŞÜ]/);
  });
});

// F-1247, F-1245: a period reading says which period, and on whose days.
describe('the period a question read', () => {
  it('names the dates from the saved args, one day or a range', () => {
    expect(fmtPeriod({ from: '2026-09-01', to: '2026-09-07' })).toBe('9/1/2026 – 9/7/2026');
    expect(fmtPeriod({ from: '2026-09-12', to: '2026-09-12' })).toBe('9/12/2026');
    expect(fmtPeriod({ subjectText: 'Barolo' })).toBeNull();
    expect(fmtPeriod(undefined)).toBeNull();
  });

  // F-1322: no Turkish month word on an English page (ADR 0207 q7).
  it('names a Turkish house\'s period in digits, day first', () => {
    setHouseLocale('tr-TR');
    try {
      expect(fmtPeriod({ from: '2026-09-01', to: '2026-09-07' })).toBe('01.09.2026 – 07.09.2026');
      expect(fmtPeriod({ from: '2026-09-12', to: '2026-09-12' })).toBe('12.09.2026');
    } finally {
      setHouseLocale(null);
    }
  });

  it('says the house\'s clock, or UTC when the house has no zone', () => {
    expect(periodLine({ period: { from: '2026-09-12', to: '2026-09-12', zone: 'Europe/Istanbul' } })).toMatch(/house's clock \(Europe\/Istanbul\)/);
    expect(periodLine({ period: { from: '2026-09-12', to: '2026-09-12', zone: null } })).toMatch(/counted in UTC, because the house has no time zone set/);
    expect(periodLine({})).toBeNull();
  });
});

describe('a question id', () => {
  it('is a v4 UUID the gateway accepts', () => {
    expect(newRequestId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
