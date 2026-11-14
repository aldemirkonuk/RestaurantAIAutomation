/**
 * The house registers say what is known, and only that (r28 /reports audit,
 * gaps 4, 7, 9, 10 and the quadrant half of 14).
 *
 *  - Margin against movement: a good whose movement is not measured (a pour
 *    with no bottle figure, ADR 0297) was drawn at 0 bottles a day, which
 *    reads absence as a slow seller; the server's `counts.unmeasured` was
 *    never shown; the raw key "plowhorse" was printed; and the table stopped
 *    at 40 rows without saying so.
 *  - The room: the note said a table with no check is "drawn at no height",
 *    while the bars draw only tables that took one.
 *  - What to buy back: every good was called a wine, and an unknown on-hand
 *    was printed as 0.
 *  - Figures of record: "compare dollars with days" in a house of any money.
 */
import { describe, expect, it } from 'vitest';
import {
  ledger,
  quadrants,
  quadrantWord,
  restock,
  seats,
  service,
  unservedNote,
  type QuadrantRegister,
  type RestockRegister,
  type SeatsRegister,
  type ServiceRegister,
} from './rp-registers-house';

const ctx = { days: 30, currency: 'TRY' } as never;

const item = (id: string, v: number | null, m: number | null, quadrant: string | null) => ({
  id,
  name: `Good ${id}`,
  velocityPerDay: v,
  marginPerBottle: m,
  marginPct: null,
  quadrant,
});

const QUAD = {
  medians: { velocityPerDay: 0.1, marginPerBottle: 30 },
  counts: { star: 1, plowhorse: 1, puzzle: 0, dog: 0, unclassified: 1, unmeasured: 1 },
  items: [
    item('a', 0.5, 40, 'star'),
    item('b', 0.4, 10, 'plowhorse'),
    item('c', null, 25, null), // costed, movement not measured
    item('d', 0.2, null, null), // moved, no recorded cost
  ],
};
const quad = (raw: unknown) => quadrants.view(quadrants.select(raw) as QuadrantRegister, ctx);

describe('margin against movement — an unmeasured movement is not 0', () => {
  it('[REVERT-FAILS] keeps an unmeasured velocity as unknown, not 0', () => {
    const q = quadrants.select(QUAD) as QuadrantRegister;
    expect(q.items.find((i) => i.id === 'c')!.velocityPerDay).toBeNull();
  });

  it('[REVERT-FAILS] draws no point for a good whose movement is not measured', () => {
    const v = quad(QUAD);
    expect(v.points!.data.map((p) => p.name)).toEqual(['Good a', 'Good b']);
    expect(v.points!.data.some((p) => p.x === 0)).toBe(false);
  });

  it('[REVERT-FAILS] prints the dash for its movement in the table, not 0', () => {
    const row = quad(QUAD).table!.rows.find((r) => r.key === 'c')!;
    expect(row.cells[1]).toBe('—');
  });

  it('[REVERT-FAILS] counts it under "No quadrant" and says why, apart from "no recorded cost"', () => {
    const v = quad(QUAD);
    expect(v.figures.find((f) => f.label === 'No quadrant')!.value).toBe('2');
    expect(v.table!.more).toContain('1 wine has no quadrant because a pour of it carries no bottle figure');
    expect(v.table!.more).toContain('1 wine has no quadrant because no cost was ever recorded');
    expect(v.notes.join(' ')).toContain('it is not drawn at 0 bottles a day');
  });

  it('[REVERT-FAILS] says each quadrant in words, and an unknown key as the dash', () => {
    const cells = quad(QUAD).table!.rows.map((r) => r.cells[3]);
    expect(cells).toEqual(['Star', 'Plowhorse', '—', '—']);
    expect(quadrantWord('dog')).toBe('Dog');
    expect(quadrantWord('puzzle')).toBe('Puzzle');
    expect(quadrantWord('mystery')).toBe('—');
    expect(quadrantWord('toString')).toBe('—');
    expect(quadrantWord(null)).toBe('—');
  });

  it('[REVERT-FAILS] says when the table stops short of the list', () => {
    const many = Array.from({ length: 43 }, (_, i) => item(`r${String(i).padStart(2, '0')}`, 0.1, 20, 'dog'));
    const v = quad({ ...QUAD, counts: { dog: 43 }, items: many });
    expect(v.table!.rows).toHaveLength(40);
    expect(v.table!.more).toBe("Showing 40 of 43, in the register's own order.");
    // A list that fits says nothing about stopping.
    expect(quad({ ...QUAD, counts: { dog: 3 }, items: many.slice(0, 3) }).table!.more).toBeUndefined();
  });
});

describe('the room — the note says what the bars draw', () => {
  const table = (id: string, checks: number) => ({
    tableId: id,
    label: `T${id}`,
    zone: null,
    seats: 4,
    checks,
    revenue: checks * 100,
    covers: checks * 2,
    avgCheck: checks > 0 ? 100 : null,
    revenuePerSeat: null,
    seatUtilization: null,
    wineAttachRate: null,
  });
  const view = (tables: unknown[]) =>
    seats.view(seats.select({ sinceDays: 90, checksInWindow: 9, tables }) as SeatsRegister, ctx);

  it('[REVERT-FAILS] a table with no check is said to be off the bars and in the table', () => {
    const v = view([table('1', 5), table('2', 0)]);
    expect(v.cats!.data.map((d) => d.label)).toEqual(['T1']);
    expect(v.table!.rows.map((r) => r.key)).toEqual(['1', '2']);
    expect(v.notes).toContain('1 mapped table took no check in the window. It is left off the bars, and it is listed in the table.');
    expect(v.notes.join(' ')).not.toMatch(/drawn at no height/);
  });

  it('[REVERT-FAILS] says several the same way, with its verbs agreeing', () => {
    const v = view([table('1', 5), table('2', 0), table('3', 0)]);
    expect(v.notes).toContain('2 mapped tables took no check in the window. They are left off the bars, and they are listed in the table.');
  });
});

describe('what to buy back — goods, and an unknown on-hand is unknown', () => {
  const row = (onHand: unknown) => ({
    id: 'x',
    name: 'Efes Pilsen 50 cl',
    onHand,
    daysOfCover: 3,
    reorderPoint: 12,
    safetyStock: 4,
    stockoutProbability: 0.4,
  });
  const view = (raw: unknown) => restock.view(restock.select(raw) as RestockRegister, ctx);
  const BASE = { params: { serviceLevel: 0.95, leadTimeDays: 7, demandWindowDays: 90 }, skuCount: 3, reorderCount: 1 };

  it('[REVERT-FAILS] an on-hand the register did not send is the dash, never 0', () => {
    const v = view({ ...BASE, reorderList: [row(null)] });
    expect(v.table!.rows[0].cells[1]).toBe('—');
    expect(v.cats!.data[0].full).toBe('Efes Pilsen 50 cl · on hand not known');
    // A real 0 is still 0.
    expect(view({ ...BASE, reorderList: [row(0)] }).table!.rows[0].cells[1]).toBe('0');
  });

  it('[REVERT-FAILS] calls what is on the register goods, not wines', () => {
    const v = view({ ...BASE, reorderList: [row(2)] });
    expect(v.figures[0].label).toBe('Goods on the register');
    expect(v.table!.cols[0].label).toBe('Good');
    expect(view({ ...BASE, reorderList: [] }).say).toBe(
      'Nothing is below its reorder point. That is a real answer about 3 goods, not an empty register.',
    );
    expect(view({ ...BASE, skuCount: 0, reorderList: [] }).say).toMatch(/^No good came back/);
  });

  it('says how many are below the point when the list is cut', () => {
    const v = view({ ...BASE, reorderCount: 30, reorderList: [row(2)] });
    expect(v.table!.more).toBe('30 goods are below their reorder point; the 1 at the highest risk are listed.');
  });
});

describe('figures of record — no currency is named in the graph note', () => {
  it('[REVERT-FAILS] compares money with days, not dollars', () => {
    expect(ledger.graphNote).toContain('would compare money with days');
    expect(ledger.graphNote).not.toMatch(/dollar/);
  });
});

describe('the seats and service tables say when they stop short (r28 gap 14)', () => {
  const table = (id: string, checks: number) => ({
    tableId: id,
    label: `T${id}`,
    zone: null,
    seats: 4,
    checks,
    revenue: checks * 100,
    covers: checks * 2,
    avgCheck: checks > 0 ? 100 : null,
    revenuePerSeat: null,
    seatUtilization: null,
    wineAttachRate: null,
  });
  const seatsView = (tables: unknown[]) =>
    seats.view(seats.select({ sinceDays: 90, checksInWindow: 9, tables }) as SeatsRegister, ctx);
  const server = (i: number) => ({ name: `Server ${i}`, checks: 3, revenue: 300, avgCheck: 100, wineAttachRate: null, tipPct: null, revenuePerCover: null });
  const serviceView = (waiters: unknown[]) =>
    service.view(service.select({ sinceDays: 90, checksInWindow: 9, dataStatus: '', waiters }) as ServiceRegister, ctx);

  it('[REVERT-FAILS] a room of 45 tables prints 40 and says so', () => {
    const tables = Array.from({ length: 45 }, (_, i) => table(String(i), 5));
    const v = seatsView(tables);
    expect(v.table!.rows).toHaveLength(40);
    expect(v.table!.more).toBe("Showing 40 of 45, in the register's own order.");
    expect(seatsView(tables.slice(0, 3)).table!.more).toBeUndefined();
  });

  it('[REVERT-FAILS] 44 servers print 40 and say so', () => {
    const v = serviceView(Array.from({ length: 44 }, (_, i) => server(i)));
    expect(v.table!.rows).toHaveLength(40);
    expect(v.table!.more).toBe("Showing 40 of 44, in the register's own order.");
    expect(serviceView([server(1)]).table!.more).toBeUndefined();
  });

  it('[REVERT-FAILS] never says an unserved table is listed when the table stops before it', () => {
    const tables = [...Array.from({ length: 40 }, (_, i) => table(String(i), 5)), table('x', 0), table('y', 0)];
    expect(seatsView(tables).notes).toContain(
      '2 mapped tables took no check in the window. They are left off the bars, and the table’s first 40 rows do not reach them.',
    );
  });

  it('says how many are listed when the cut falls among them', () => {
    expect(unservedNote(3, 1)).toBe(
      '3 mapped tables took no check in the window. They are left off the bars; 1 of them is listed in the table, and the rest fall past its first 40 rows.',
    );
    expect(unservedNote(1, 0)).toBe(
      '1 mapped table took no check in the window. It is left off the bars, and the table’s first 40 rows do not reach it.',
    );
    expect(unservedNote(1, 1)).toBe('1 mapped table took no check in the window. It is left off the bars, and it is listed in the table.');
  });
});

describe('figures of record — GMROI is said in words (r28 gap 14)', () => {
  const LEDGER = {
    basis: {},
    cogsCoverage: null,
    costOfCostedItems: null,
    gmroi: 2.4,
    tillStock: { goodsOnHand: 10, goodsOnTill: 8, goodsOffTill: 2, offTillValue: null, uncostedOnTill: 1 },
  };
  it('[REVERT-FAILS] names the figure "Return on stock", and no sentence says GMROI', () => {
    const v = ledger.view(ledger.select(LEDGER) as never, ctx);
    const labels = v.figures.map((f) => f.label);
    expect(labels).toContain('Return on stock');
    expect(JSON.stringify({ figures: v.figures, notes: v.notes, say: v.say ?? null })).not.toMatch(/GMROI/);
  });
});
