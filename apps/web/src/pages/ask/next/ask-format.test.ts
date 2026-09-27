import { AxiosError, AxiosHeaders } from 'axios';
import { describe, expect, it } from 'vitest';
import type { AskFinding, AskFolio, AskReading } from '@/services/api/ask';
import {
  EM,
  askFailure,
  composerProblem,
  fmtCount,
  fmtValue,
  folioChip,
  folioView,
  groupBook,
  groupShelf,
  newRequestId,
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
    const v = folioView(folio({ status: 'pending', answer: null }));
    expect(v.tone).toBe('pending');
    expect(folioChip({ status: 'pending', reply_kind: null })).toBe('still answering');
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

describe('a question id', () => {
  it('is a v4 UUID the gateway accepts', () => {
    expect(newRequestId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
