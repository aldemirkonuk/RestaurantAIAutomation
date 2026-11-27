import { describe, expect, it } from 'vitest';
import { formatMoney } from '../../../lib/currency';
import { menuReadChecks, normaliseName, type CheckLine } from './menu-read-checks';

const L = (id: string, name: string, bottle: number | null, glass: number | null = null, section = 'red'): CheckLine => ({
  id,
  name,
  section,
  bottle,
  glass,
});
const priced = (...ps: Array<number | null>) => ps.map((p, i) => L(`p${i}`, `Wine ${i}`, p));

describe('menuReadChecks', () => {
  it('flags 4500 among 40, 45, 50 and says it may be 45.00, without changing anything', () => {
    const lines = priced(40, 45, 50, 4500);
    const before = JSON.stringify(lines);
    const f = menuReadChecks(lines, 'USD');
    expect(f).toHaveLength(1);
    expect(f[0].lineId).toBe('p3');
    expect(f[0].words).toContain('may be $45.00');
    expect(f[0].words).toContain('times the other red prices');
    expect(JSON.stringify(lines)).toBe(before);
  });

  it('names the thousand shift too', () => {
    const f = menuReadChecks(priced(40, 45, 50, 45000), 'USD');
    expect(f[0].words).toContain('may be $45.00');
  });

  it('flags nothing with three priced lines, however far one sits', () => {
    expect(menuReadChecks(priced(40, 45, 50), 'USD')).toEqual([]);
    expect(menuReadChecks(priced(40, 45, 4500), 'USD')).toEqual([]);
  });

  it('flags a price far below the section, without a decimal guess', () => {
    const f = menuReadChecks(priced(400, 450, 500, 5), 'USD');
    expect(f).toHaveLength(1);
    expect(f[0].lineId).toBe('p3');
    expect(f[0].words).not.toContain('may be');
  });

  it('judges a section against its own prices only', () => {
    const lines = [...priced(40, 45, 50, 55), ...[4, 5, 6, 7].map((p, i) => L(`b${i}`, `Beer ${i}`, p, null, 'beer'))];
    expect(menuReadChecks(lines, 'USD')).toEqual([]);
  });

  it('calls Rakı, RAKI and raki one name in one section, and not across sections', () => {
    const f = menuReadChecks([L('a', 'Rakı', 90, null, 'spirit'), L('b', 'RAKI', 95, null, 'spirit')], 'TRY');
    expect(f).toHaveLength(1);
    expect(f[0].kind).toBe('duplicate');
    expect(f[0].lineId).toBe('b');
    expect(menuReadChecks([L('a', 'Rakı', 90, null, 'spirit'), L('b', 'Raki', 95, null, 'wine')], 'TRY')).toEqual([]);
    expect(normaliseName('İstanbul  ')).toBe(normaliseName('istanbul'));
  });

  it('flags a glass at or above its bottle, each kind on its own', () => {
    const f = menuReadChecks([L('a', 'Barolo', 90, 120)], 'USD');
    expect(f.map((x) => x.kind)).toEqual(['glass_not_under_bottle']);
    expect(menuReadChecks([L('a', 'Barolo', 120, 90)], 'USD')).toEqual([]);
  });

  it('never flags a missing price', () => {
    expect(menuReadChecks([L('a', 'Barolo', null, 120)], 'USD')).toEqual([]);
    expect(menuReadChecks([...priced(40, 45, 50, 4500).slice(0, 3), L('z', 'Blank', null)], 'USD')).toEqual([]);
  });

  it('says the money in the house currency', () => {
    const f = menuReadChecks(priced(400, 450, 500, 45000), 'TRY');
    expect(f[0].words).toContain(formatMoney(45000, 'TRY'));
    expect(f[0].words).toContain(formatMoney(450, 'TRY'));
  });
});
