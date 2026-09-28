/**
 * The pure half of "Log sales": what a typed figure, a typed row and a CSV
 * become. The written body must be the legacy panel's body, field for field;
 * what the legacy panel silently turned into 0 is refused here with a reason.
 */
import { describe, expect, it } from 'vitest';
import type { TeamMember } from '../../../services/api/team';
import { checkRow, duplicateKeys, readFigure, readSalesCsv, type SalesDraft } from './sales-entry';

const TODAY = '2026-09-26';
const ANA = { id: 'm-ana', display_name: 'Ana Lima', status: 'active' } as unknown as TeamMember;
const BO = { id: 'm-bo', display_name: 'Bo', status: 'active' } as unknown as TeamMember;
const BO2 = { id: 'm-bo2', display_name: 'bo', status: 'active' } as unknown as TeamMember;
const IDS = new Set(['m-ana', 'm-bo']);

const draft = (over: Partial<SalesDraft> = {}): SalesDraft => ({
  key: 'k',
  memberId: 'm-ana',
  serviceDate: '2026-09-25',
  covers: '',
  checks: '',
  netSales: '',
  wineSales: '',
  source: 'manual',
  ...over,
});

describe('readFigure', () => {
  it('reads blank as 0, as the legacy panel wrote it', () => {
    expect(readFigure('', true)).toEqual({ ok: true, value: 0 });
    expect(readFigure('  ', false)).toEqual({ ok: true, value: 0 });
  });
  it('reads plain numbers, whole and to two decimals', () => {
    expect(readFigure('42', true)).toEqual({ ok: true, value: 42 });
    expect(readFigure('1810.50', false)).toEqual({ ok: true, value: 1810.5 });
  });
  it('refuses what the legacy panel turned into a silent 0', () => {
    for (const s of ['1,200', 'abc', '-3', '$40', '1e3']) {
      expect(readFigure(s, false).ok).toBe(false);
    }
    expect(readFigure('4.5', true)).toEqual({ ok: false, why: '“4.5” is not a whole number' });
    expect(readFigure('10.125', false).ok).toBe(false);
  });
});

describe('checkRow', () => {
  it('builds exactly the IngestSalesDto body', () => {
    expect(
      checkRow(draft({ covers: '30', checks: '12', netSales: '900.5', wineSales: '310' }), TODAY, IDS),
    ).toEqual({
      ok: true,
      entry: {
        memberId: 'm-ana',
        serviceDate: '2026-09-25',
        covers: 30,
        checks: 12,
        netSales: 900.5,
        wineSales: 310,
        source: 'manual',
      },
    });
  });
  it('refuses a day in the future, nobody, and someone not on this roster', () => {
    expect(checkRow(draft({ serviceDate: '2026-09-27' }), TODAY, IDS)).toMatchObject({ ok: false, why: expect.stringMatching(/future/) });
    expect(checkRow(draft({ memberId: '' }), TODAY, IDS)).toMatchObject({ ok: false, why: 'no person is named' });
    expect(checkRow(draft({ memberId: 'm-zed' }), TODAY, IDS)).toMatchObject({ ok: false, why: expect.stringMatching(/roster/) });
    expect(checkRow(draft({ serviceDate: '25/09/2026' }), TODAY, IDS)).toMatchObject({ ok: false });
  });
  it('names the figure that refused the row', () => {
    expect(checkRow(draft({ netSales: '1,200' }), TODAY, IDS)).toEqual({
      ok: false,
      why: 'net sales: “1,200” is not a plain number',
    });
  });
});

describe('duplicateKeys', () => {
  it('flags both rows naming one person on one day', () => {
    const rows = [draft({ key: 'a' }), draft({ key: 'b' }), draft({ key: 'c', memberId: 'm-bo' })];
    expect([...duplicateKeys(rows)].sort()).toEqual(['a', 'b']);
  });
});

describe('readSalesCsv', () => {
  it('accepts the legacy headers and marks every row csv', () => {
    const r = readSalesCsv(
      'service_date,covers,net_sales,wine_sales,checks,member_id\n2026-09-24,30,900,310,12,m-bo\n',
      [ANA, BO],
      '',
    );
    expect(r).toEqual({
      ok: true,
      unnamed: 0,
      refused: [],
      rows: [
        {
          key: 'csv-2',
          memberId: 'm-bo',
          serviceDate: '2026-09-24',
          covers: '30',
          checks: '12',
          netSales: '900',
          wineSales: '310',
          source: 'csv',
        },
      ],
    });
  });
  it('matches a name column to the roster, and refuses an unknown or shared name', () => {
    const r = readSalesCsv('date,name,sales\n2026-09-24,ana lima,500\n2026-09-24,Zed,10\n2026-09-24,Bo,20\n', [ANA, BO, BO2], '');
    if (!r.ok) throw new Error(r.why);
    expect(r.rows.map((x) => x.memberId)).toEqual(['m-ana']);
    expect(r.refused).toEqual([
      { line: 3, why: 'nobody on the roster is called “Zed”' },
      { line: 4, why: 'more than one person is called “Bo”' },
    ]);
  });
  it('puts rows with no person column on the chosen person, and counts them', () => {
    const r = readSalesCsv('date,covers\n2026-09-23,5\n2026-09-24,6\n', [ANA], 'm-ana');
    if (!r.ok) throw new Error(r.why);
    expect(r.unnamed).toBe(2);
    expect(r.rows.every((x) => x.memberId === 'm-ana')).toBe(true);
  });
  it('refuses a file with no day column or no rows', () => {
    expect(readSalesCsv('covers,member_id\n4,m-ana\n', [ANA], '')).toMatchObject({ ok: false });
    expect(readSalesCsv('service_date\n', [ANA], '')).toMatchObject({ ok: false });
  });
});
