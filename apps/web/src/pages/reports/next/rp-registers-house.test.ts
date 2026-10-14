import { describe, expect, it } from 'vitest';
import { quadrants } from './rp-registers-house';
import type { ViewCtx } from './rp-spec';

/**
 * F-470: the gateway sends `velocityPerDay: null` and counts the wine under
 * `counts.unmeasured` when some of its sales carry no bottle figure (ADR 0297).
 * The page read that null as 0, plotted the wine at 0 bottles a day, printed
 * "0" in the table, and left it out of "No quadrant".
 */
const payload = {
  basis: { velocity: 'bottles/day over 90d', margin: 'menu price − cost', unpriced: 'named in leftOut' },
  medians: { velocityPerDay: 0.05, marginPerBottle: 30 },
  counts: { star: 1, unclassified: 0, unmeasured: 1, unpriced: 1 },
  items: [
    { id: 'w1', name: 'Barolo', velocityPerDay: 0.1, marginPerBottle: 40, marginPct: 0.5, quadrant: 'star' },
    { id: 'w2', name: 'Kalecik Karası', velocityPerDay: null, marginPerBottle: 25, marginPct: 0.4, quadrant: null },
  ],
  leftOut: [{ id: 'w3', name: 'Narince', reason: 'glass_pour_unconfirmed' }],
};

const draw = () => quadrants.view(quadrants.select(payload), { days: 90 } as ViewCtx);

describe('Margin against movement: a wine whose movement is not measured', () => {
  it('is not drawn at 0 bottles a day', () => {
    const v = draw();
    expect(v.points?.data.map((p) => p.name)).toEqual(['Barolo']);
  });

  it('reads "not measured" in the table, never 0', () => {
    const row = draw().table?.rows.find((r) => r.key === 'w2');
    expect(row?.cells[1]).toBe('not measured');
  });

  it('is counted under No quadrant, with its own reason', () => {
    const v = draw();
    expect(v.figures?.find((f) => f.label === 'No quadrant')?.value).toBe('1');
    expect(v.notes?.join(' ')).toMatch(/how fast it moves is not measured — not 0 bottles a day/);
    expect(v.table?.more).toMatch(/how fast it sells is not measured/);
  });

  it('names the wines the engine could not price at all (F-472)', () => {
    expect(draw().notes?.join(' ')).toMatch(/Not on this list at all.*Narince/);
  });
});

describe('Margin against movement: a tax basis that could not be read (F-1626)', () => {
  const failed = {
    ...payload,
    taxBasisUnread: true,
    counts: { star: 0, unclassified: 0, unmeasured: 0, unpriced: 0, taxRefused: 2 },
    items: payload.items.map((i) => ({
      ...i,
      marginPerBottle: null,
      marginPct: null,
      quadrant: null,
      marginRefusal: "No margin: whether this house's prices include tax could not be read, so no margin is worked out (connection reset).",
    })),
    leftOut: [],
  };

  it('says the basis was not read, and never that the prices include tax', () => {
    const v = quadrants.view(quadrants.select(failed), { days: 90 } as ViewCtx);
    const said = JSON.stringify(v);
    expect(said).toContain('could not be read just now');
    expect(said).not.toContain('worked out on the price without tax');
    expect(said).not.toContain('No pre-tax margin');
  });
});
