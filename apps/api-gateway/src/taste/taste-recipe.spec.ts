import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { parsePreview, TasteService } from './taste.service';

const RID = '11111111-1111-4111-8111-111111111111';
const COCKTAIL = '33333333-3333-4333-8333-333333333333';
const VER = '66666666-6666-4666-8666-666666666666';

type Row = Record<string, any>;
/** In-memory stand-ins for the tables the roll-up touches. `missing` lists tables that answer 42P01. */
function fakeDb(t: Record<string, Row[]>, missing: string[] = [], failFirstInsert = false) {
  let fail = failFirstInsert;
  const inserts: Row[] = [];
  const from = (table: string) => {
    const eqs: Array<[string, any]> = []; const nulls: string[] = [];
    let desc: string | null = null; let asc: string | null = null; let lim = Infinity;
    const run = () => {
      if (missing.includes(table)) return { data: null, error: { code: '42P01', message: 'no relation' } };
      let src = table === 'taste_profile_current' ? latest(t.taste_profiles ?? []) : t[table] ?? [];
      src = src.filter((r) => eqs.every(([c, v]) => r[c] === v) && nulls.every((c) => r[c] == null));
      if (desc) src = [...src].sort((a, b) => b[desc!] - a[desc!]);
      if (asc) src = [...src].sort((a, b) => a[asc!] - b[asc!]);
      return { data: src.slice(0, lim), error: null };
    };
    const api: any = {
      select: () => api,
      eq: (c: string, v: any) => { eqs.push([c, v]); return api; },
      is: (c: string, v: any) => { if (v === null) nulls.push(c); else eqs.push([c, v]); return api; },
      order: (c: string, o: { ascending: boolean }) => { if (o.ascending) asc = c; else desc = c; return api; },
      limit: (n: number) => { lim = n; return api; },
      maybeSingle: async () => { const r = run(); return r.error ? r : { data: r.data![0] ?? null, error: null }; },
      insert: async (row: Row) => {
        if (fail) { fail = false; return { error: { code: '23505', message: 'dup' } }; }
        inserts.push(row); (t.taste_profiles ??= []).push({ created_at: '2026-11-19T10:00:00Z', ...row });
        return { error: null };
      },
      then: (res: any) => Promise.resolve(run()).then(res),
    };
    return api;
  };
  return { db: { getClient: () => ({ from }) } as any, inserts, t };
}
const latest = (rows: Row[]) => {
  const best = new Map<string, Row>();
  for (const r of rows) { const k = [r.source, r.stated_by ?? '-'].join('|'); if (!best.has(k) || best.get(k)!.version < r.version) best.set(k, r); }
  return [...best.values()];
};
const recipe = (lines: Array<[string, number, string]>, method = 'Shake') => ({
  cocktails: [{ id: COCKTAIL, restaurant_id: RID }],
  recipe_current: [{ cocktail_id: COCKTAIL, restaurant_id: RID, version_id: VER }],
  recipe_versions: [{ id: VER, restaurant_id: RID, method }],
  recipe_lines: lines.map(([label, qty_base, base_unit], i) => ({ version_id: VER, restaurant_id: RID, position: i + 1, label, qty_base, base_unit })),
});
const sour: Array<[string, number, string]> = [['Bourbon', 600, 'ml10'], ['Lemon juice', 225, 'ml10'], ['Simple syrup', 150, 'ml10']];

describe('TasteService.rollupSubject', () => {
  it('writes one recipe layer, as nobody, computed, with how much it understood', async () => {
    const f = fakeDb(recipe(sour));
    const out = await new TasteService(f.db).rollupSubject(RID, 'cocktail', COCKTAIL);
    expect(f.inserts).toHaveLength(1);
    const row = f.inserts[0];
    expect(row).toMatchObject({ source: 'recipe', method: 'computed', stated_by: null, version: 1, cocktail_id: COCKTAIL });
    expect(row.axes.sour.v).toBeGreaterThan(5);
    expect(row.ext.rollup).toMatchObject({ lines: 3, classPrior: 3, unknown: 0 });
    expect(out.rollup.dilution).toBeCloseTo(0.27, 2);
    expect(out.layers[0]).toMatchObject({ source: 'recipe', basis: expect.objectContaining({ lines: 3 }) });
    expect(out.effective?.axes.sour).toBeDefined();
  });
  it('reads grams and milligram lines, and a count has no weight', async () => {
    const f = fakeDb(recipe([['Lamb mince', 150000, 'mg'], ['Salt', 1200, 'mg'], ['Sumac', 1000, 'each_milli']], 'Pan sear'));
    f.t.cocktails = []; f.t.dishes = [{ id: COCKTAIL, restaurant_id: RID }];
    f.t.recipe_current_dish = [{ dish_id: COCKTAIL, restaurant_id: RID, version_id: VER }];
    const out = await new TasteService(f.db).rollupSubject(RID, 'dish', COCKTAIL);
    expect(out.rollup).toMatchObject({ kind: 'dish', lines: 3, unquantified: 1, dilution: null });
    expect(f.inserts[0].dish_id).toBe(COCKTAIL);
  });
  it('adds nothing when the same recipe is worked out again', async () => {
    const f = fakeDb(recipe(sour));
    const s = new TasteService(f.db);
    await s.rollupSubject(RID, 'cocktail', COCKTAIL);
    await s.rollupSubject(RID, 'cocktail', COCKTAIL);
    expect(f.inserts).toHaveLength(1);
  });
  it('adds version 2 when the recipe changed', async () => {
    const f = fakeDb(recipe(sour));
    const s = new TasteService(f.db);
    await s.rollupSubject(RID, 'cocktail', COCKTAIL);
    f.t.recipe_lines[1].qty_base = 300;
    await s.rollupSubject(RID, 'cocktail', COCKTAIL);
    expect(f.inserts.map((i) => i.version)).toEqual([1, 2]);
  });
  it('looks again once when two writers took the same version', async () => {
    const f = fakeDb(recipe(sour), [], true);
    await new TasteService(f.db).rollupSubject(RID, 'cocktail', COCKTAIL);
    expect(f.inserts).toHaveLength(1);
  });
  it('refuses a good, a foreign cocktail and a recipe with no lines, each in a sentence', async () => {
    const s = (t: any) => new TasteService(fakeDb(t).db);
    await expect(s(recipe(sour)).rollupSubject(RID, 'good', COCKTAIL)).rejects.toThrow(BadRequestException);
    await expect(s({ ...recipe(sour), cocktails: [{ id: COCKTAIL, restaurant_id: 'other' }] }).rollupSubject(RID, 'cocktail', COCKTAIL)).rejects.toThrow(NotFoundException);
    await expect(s(recipe([])).rollupSubject(RID, 'cocktail', COCKTAIL)).rejects.toThrow(/no lines/);
  });
  it('says so when there is no recipe, and when recipes cannot be read at all', async () => {
    const none = recipe(sour); none.recipe_current = [];
    await expect(new TasteService(fakeDb(none).db).rollupSubject(RID, 'cocktail', COCKTAIL)).rejects.toMatchObject({ response: { code: 'recipe_not_written' } });
    await expect(new TasteService(fakeDb(recipe(sour), ['recipe_current']).db).rollupSubject(RID, 'cocktail', COCKTAIL)).rejects.toThrow(ServiceUnavailableException);
  });
  it('does not turn a failed lines read into an empty profile', async () => {
    const f = fakeDb(recipe(sour), ['recipe_lines']);
    await expect(new TasteService(f.db).rollupSubject(RID, 'cocktail', COCKTAIL)).rejects.toThrow(ServiceUnavailableException);
    expect(f.inserts).toHaveLength(0);
  });
});

describe('parsePreview and preview', () => {
  const ok = { kind: 'cocktail', method: 'stir', components: [{ name: 'd', lines: [{ name: 'Gin', qty: 50, unit: 'ml' }] }] };
  it('takes a typed recipe and never takes chemistry from the body', () => {
    const p = parsePreview({ ...ok, components: [{ name: 'd', lines: [{ name: 'Gin', qty: 50, unit: 'ml', chem: { abv: 99 }, chemProv: 'measured' }] }] });
    expect(p.components[0].lines[0]).not.toHaveProperty('chem');
  });
  it.each([
    ['unknown kind', { ...ok, kind: 'wine' }],
    ['no parts', { ...ok, components: [] }],
    ['13 parts', { ...ok, components: Array(13).fill(ok.components[0]) }],
    ['61 lines', { ...ok, components: [{ name: 'd', lines: Array(61).fill(ok.components[0].lines[0]) }] }],
    ['bad unit', { ...ok, components: [{ name: 'd', lines: [{ name: 'Gin', qty: 5, unit: 'oz' }] }] }],
    ['huge qty', { ...ok, components: [{ name: 'd', lines: [{ name: 'Gin', qty: 1e7, unit: 'ml' }] }] }],
    ['NaN qty', { ...ok, components: [{ name: 'd', lines: [{ name: 'Gin', qty: NaN, unit: 'ml' }] }] }],
    ['blank name', { ...ok, components: [{ name: 'd', lines: [{ name: ' ', qty: 5, unit: 'ml' }] }] }],
  ])('refuses %s', (_n, body) => { expect(() => parsePreview(body)).toThrow(BadRequestException); });
  it('works a recipe out without a database', () => {
    const r = new TasteService({} as any).preview(ok);
    expect(r.axes.alcohol.v).toBeGreaterThan(3);
  });
});
