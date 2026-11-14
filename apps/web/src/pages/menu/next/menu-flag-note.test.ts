/**
 * r28 G19: the gateway stores the kept price in a line's flag note as a plain
 * number ("bottle price 1250.00"), and /menu printed it as stored.
 */
import { describe, expect, it } from 'vitest';
import { flagNoteInHouseMoney } from './menu-price-note';

const lira = (n: number) => `₺${n.toLocaleString('de-DE', { minimumFractionDigits: 2 })}`;

describe('flagNoteInHouseMoney (r28 G19)', () => {
  it("writes each kept price in the house's money, bottle and glass", () => {
    expect(
      flagNoteInHouseMoney(
        'The menu line shows no bottle or glass price, so the house kept the bottle price 1250.00 and glass price 45.50 it already had. A manager can change it on Inventory, under Your price.',
        lira,
      ),
    ).toBe(
      'The menu line shows no bottle or glass price, so the house kept the bottle price ₺1.250,00 and glass price ₺45,50 it already had. A manager can change it on Inventory, under Your price.',
    );
  });

  it('leaves a note with no kept price as it is', () => {
    const note = 'The menu line shows no price, and the house had no price for this wine either, so it stands on the menu unpriced.';
    expect(flagNoteInHouseMoney(note, lira)).toBe(note);
  });
});
