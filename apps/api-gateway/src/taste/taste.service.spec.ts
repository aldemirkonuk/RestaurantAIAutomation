import { BadRequestException, NotFoundException } from '@nestjs/common';
import { parseHouseBody, TasteService } from './taste.service';

const RID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const SUBJ = '33333333-3333-4333-8333-333333333333';
const U1 = '44444444-4444-4444-8444-444444444444';
const U2 = '55555555-5555-4555-8555-555555555555';

interface Row { [k: string]: any }
/** A tiny in-memory stand-in for the three tables, honouring eq filters and the unique key. */
function fakeDb(opts: { goods?: Row[]; dishesMissing?: boolean; failFirstInsertWithUnique?: boolean } = {}) {
  const goods = opts.goods ?? [{ id: SUBJ, restaurant_id: RID, kind: 'wine' }];
  const store: Row[] = [];
  let failNext = opts.failFirstInsertWithUnique === true;
  const inserts: Row[] = [];
  const current = () => {
    const best = new Map<string, Row>();
    for (const r of store) {
      const k = [r.restaurant_id, r.subject_kind, r.good_id, r.source, r.stated_by ?? '-'].join('|');
      if (!best.has(k) || best.get(k)!.version < r.version) best.set(k, r);
    }
    return [...best.values()];
  };
  const from = (table: string) => {
    const filters: Array<[string, any]> = [];
    let rows: () => Row[];
    let limit = Infinity;
    let orderDesc: string | null = null;
    const api: any = {
      select: () => api,
      eq: (c: string, v: any) => { filters.push([c, v]); return api; },
      is: () => api,
      order: (c: string, o: { ascending: boolean }) => { if (!o.ascending) orderDesc = c; return api; },
      limit: (n: number) => { limit = n; return api; },
      maybeSingle: async () => {
        const r = run();
        if (r.error) return r;
        return { data: r.data[0] ?? null, error: null };
      },
      insert: async (row: Row) => {
        if (failNext) { failNext = false; return { error: { code: '23505', message: 'duplicate' } }; }
        inserts.push(row);
        store.push({ id: `id${store.length}`, created_at: '2026-11-19T10:00:00Z', ...row });
        return { error: null };
      },
      then: (res: any) => Promise.resolve(run()).then(res),
    };
    const run = (): { data: Row[]; error: any } => {
      if (table === 'dishes' && opts.dishesMissing) return { data: [], error: { code: '42P01', message: 'no relation' } };
      let r = table === 'restaurant_inventory' ? goods : table === 'taste_profile_current' ? current()
        : table === 'taste_profiles' ? store : [];
      r = r.filter((x) => filters.every(([c, v]) => x[c] === v));
      if (orderDesc) r = [...r].sort((a, b) => b[orderDesc!] - a[orderDesc!]);
      return { data: r.slice(0, limit), error: null };
    };
    return api;
  };
  return { db: { getClient: () => ({ from }) } as any, store, inserts };
}
const svc = (f: ReturnType<typeof fakeDb>) => new TasteService(f.db);
const say = { axes: { sour: { v: 6 } }, method: 'line' };

describe('TasteService', () => {
  it('a subject in another house is refused with the code, and nothing is written', async () => {
    const f = fakeDb();
    await expect(svc(f).appendHouse(OTHER, 'good', SUBJ, say, { userId: U1 }))
      .rejects.toMatchObject({ response: { code: 'subject_not_in_house' } });
    expect(f.inserts).toHaveLength(0);
    await expect(svc(f).read(OTHER, 'good', SUBJ)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('the same subject in its own house is accepted (control)', async () => {
    const f = fakeDb();
    await expect(svc(f).appendHouse(RID, 'good', SUBJ, say, { userId: U1 })).resolves.toBeDefined();
  });

  it('a dish is not in a house that has no dishes table: same code', async () => {
    const f = fakeDb({ dishesMissing: true });
    await expect(svc(f).read(RID, 'dish', SUBJ)).rejects.toMatchObject({ response: { code: 'subject_not_in_house' } });
  });

  it('a supply is refused with a sentence, on read and on write', async () => {
    const f = fakeDb({ goods: [{ id: SUBJ, restaurant_id: RID, kind: 'supply' }] });
    await expect(svc(f).appendHouse(RID, 'good', SUBJ, say, { userId: U1 })).rejects.toThrow('A supply is not tasted.');
    await expect(svc(f).read(RID, 'good', SUBJ)).rejects.toBeInstanceOf(BadRequestException);
    expect(f.inserts).toHaveLength(0);
  });

  it('no layers => effective null', async () => {
    const out = await svc(fakeDb()).read(RID, 'good', SUBJ);
    expect(out).toEqual({ subject: { kind: 'good', id: SUBJ }, effective: null, layers: [] });
  });

  it('version goes up per (source, person); a second person starts at 1 and does not replace the first', async () => {
    const f = fakeDb();
    const s = svc(f);
    await s.appendHouse(RID, 'good', SUBJ, say, { userId: U1, name: 'Ada' });
    await s.appendHouse(RID, 'good', SUBJ, { axes: { sour: { v: 7 } }, method: 'line' }, { userId: U1, name: 'Ada' });
    const out = await s.appendHouse(RID, 'good', SUBJ, { axes: { sour: { v: 5 } }, method: 'line' }, { userId: U2, name: 'Bo' });
    expect(f.inserts.map((r) => [r.stated_by, r.version])).toEqual([[U1, 1], [U1, 2], [U2, 1]]);
    expect(out.layers.map((l) => [l.statedByName, l.version]).sort()).toEqual([['Ada', 2], ['Bo', 1]]);
    expect(out.effective!.axes.sour.v).toBeCloseTo(6, 5);
  });

  it('stores the note verbatim and takes the author from the session, not the body', async () => {
    const f = fakeDb();
    const note = '  <b>sharp</b>  & "bright"\nwith a tail  ';
    const body: any = { note, method: 'line', stated_by: U2, stated_by_name: 'Mallory' };
    const out = await svc(f).appendHouse(RID, 'good', SUBJ, body, { userId: U1, name: 'Ada' });
    expect(f.inserts[0].note_text).toBe(note);
    expect(f.inserts[0].stated_by).toBe(U1);
    expect(f.inserts[0].stated_by_name).toBe('Ada');
    expect(out.layers[0]).toMatchObject({ hasNote: true, noteText: note, statedByName: 'Ada' });
  });

  it('retries once when two writers took the same version', async () => {
    const f = fakeDb({ failFirstInsertWithUnique: true });
    await expect(svc(f).appendHouse(RID, 'good', SUBJ, say, { userId: U1 })).resolves.toBeDefined();
    expect(f.inserts).toHaveLength(1);
  });
});

describe('parseHouseBody', () => {
  it('refuses an empty body, an unknown axis and a value outside 0..10', () => {
    expect(() => parseHouseBody({ method: 'line' })).toThrow(BadRequestException);
    expect(() => parseHouseBody({ method: 'line', axes: {} })).toThrow(/Say something/);
    expect(() => parseHouseBody({ method: 'line', axes: { burn: { v: 3 } } })).toThrow(/not a taste axis/);
    expect(() => parseHouseBody({ method: 'line', axes: { sour: { v: 11 } } })).toThrow(/between 0 and 10/);
  });
  it('refuses a missing method, a long note, too many words and an off-list word', () => {
    expect(() => parseHouseBody({ axes: { sour: { v: 3 } } })).toThrow(/how this was described/);
    expect(() => parseHouseBody({ method: 'line', note: 'x'.repeat(2001) })).toThrow(/2000/);
    expect(() => parseHouseBody({ method: 'cata', descriptors: ['zesty'] })).toThrow(/not one of/);
    expect(() => parseHouseBody({ method: 'cata', texture: ['rich'] })).toThrow(/not one of/);
    const all = ['savoury', 'rich', 'fresh', 'bright', 'balanced', 'sharp', 'mellow', 'sweet-and-sour', 'spicy', 'smoky', 'herby', 'tangy'];
    expect(parseHouseBody({ method: 'cata', descriptors: all }).descriptors).toHaveLength(12);
    expect(() => parseHouseBody({ method: 'cata', descriptors: [...all, 'x'] })).toThrow();
  });
  it('keeps a typed 0, attaches the staff prior, leaves unstated axes out', () => {
    const p = parseHouseBody({ method: 'ordinal', axes: { sweet: { v: 0 } } });
    expect(p.axes).toEqual({ sweet: { v: 0, conf: 0.6 } });
  });
});
