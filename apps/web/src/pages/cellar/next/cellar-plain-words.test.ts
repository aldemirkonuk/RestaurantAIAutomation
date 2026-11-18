/**
 * What /cellar says to an owner carries no table, column, event or decision
 * names (r58 N-04): the strings a person can read are checked here at the
 * source, so a developer sentence cannot slip back in.
 */
import { describe, expect, it } from 'vitest';
import { REGISTER_ORDER, addRowsPrompt } from './cellar-format';
import { REGISTER_SOURCE } from './registerShapes';
import { allColumnsFor } from './cellar-columns';

const DEV = /restaurant_inventory|master_wine_id|OD-\d+|stock:updated|cocktail_ingredients|identity axis|extraction pass|keyed on|\/inventory cannot/i;

describe('/cellar owner-facing strings', () => {
  it.each(REGISTER_ORDER)('the add-rows prompt for %s has no developer words', (id) => {
    expect(addRowsPrompt(id)).not.toMatch(DEV);
  });

  it.each(REGISTER_ORDER)('the register source sentences for %s have no developer words', (id) => {
    const s = REGISTER_SOURCE[id];
    for (const t of [s.oneLine, s.scopeNote, s.missing]) expect(t).not.toMatch(DEV);
  });

  it('the stock column explains itself in plain words', () => {
    const stock = REGISTER_ORDER.flatMap((id) => allColumnsFor(id)).find((c) => c.source === 'restaurant_inventory.stock_live');
    expect(stock?.meaning).toBe('Bottles in the building. Wines only: a keg has no stock count yet.');
  });

  it('the beer prompt says what the stock room counts', () => {
    expect(addRowsPrompt('beer')).toMatch(/counts wines only today/);
  });
});
