/** The kind table (recipeWords.ts): a dish reads as food, a drink reads as it always did. */
import { describe, expect, it } from 'vitest';
import { parseSpec } from './parseSpec';
import { recipeWords } from './recipeWords';
import { rowNote, type DraftRow } from './LineRow';
import { whyBlocked } from './RecipeSheet';

const row = (over: Partial<DraftRow> = {}): DraftRow => ({
  key: 'k',
  role: 'stocked',
  inventoryId: 'i1',
  itemName: 'Olive Oil',
  itemKind: 'food',
  itemUom: null,
  label: 'Olive Oil',
  qtyText: '100',
  unit: 'ml',
  saved: { status: 'priced', costPerServe: 1.25, costPerServeExact: 1.25, costBasis: 'invoice_lot_wac_partial' },
  ...over,
}) as DraftRow;
const unpriced = (costBasis: string) => ({ status: 'unpriced', costPerServe: null, costBasis }) as unknown as DraftRow['saved'];
const say = (n: number) => `$${n.toFixed(2)}`;

describe('recipeWords', () => {
  it('the dish paste example has no drink in it, and every line reads with a unit and no flag', () => {
    const w = recipeWords('dish');
    expect(w.pastePlaceholder).not.toMatch(/gin|angostura|oz|dash|egg white|twist/i);
    const lines = parseSpec(w.pastePlaceholder);
    expect(lines).toHaveLength(4);
    for (const l of lines) {
      expect(l.flag).toBeNull();
      expect(l.unit).not.toBeNull();
    }
    expect(lines.map((l) => l.role)).toEqual(['stocked', 'stocked', 'stocked', 'untracked']);
  });

  it('a dish has no alcohol figure; a drink keeps it, and anything unknown reads as a drink', () => {
    expect(recipeWords('dish').alcohol).toBe(false);
    expect(recipeWords('cocktail').alcohol).toBe(true);
    expect(recipeWords(undefined)).toBe(recipeWords('cocktail'));
  });

  it("a dish line's notes say plate, dish and deliveries; a drink's are unchanged", () => {
    const dish = recipeWords('dish');
    expect(rowNote(row(), say, dish)?.text).toBe('$1.25 a plate, from the deliveries that have an invoice; some on hand have none yet.');
    const whole = { status: 'priced', costPerServe: 1.25, costPerServeExact: 1.25, costBasis: 'invoice_lot_wac' } as unknown as DraftRow['saved'];
    expect(rowNote(row({ saved: whole }), say, dish)?.text).toBe('$1.25 a plate');
    expect(rowNote(row({ saved: whole }), say)?.text).toBe('$1.25 a serve');
    expect(rowNote(row({ inventoryId: null }), say, dish)?.text).toBe(
      "This dish won't take stock until 'Olive Oil' is linked to something on your shelf.",
    );
    expect(rowNote(row({ saved: unpriced('size_not_known') }), say, dish)?.text).toBe(
      "No price yet: your shelf doesn't say how much one pack of Olive Oil holds.",
    );
    expect(rowNote(row({ itemUom: 'case', saved: unpriced('pack_size_not_known') }), say, dish)?.text).toMatch(
      /Link the line to the single bottle, tin or pack it comes from\.$/,
    );
    // The drink default is word for word what the sheet said before the table.
    expect(rowNote(row(), say)?.text).toBe('$1.25 a serve, from the bottles that have an invoice; some on hand have none yet.');
    expect(rowNote(row({ inventoryId: null }), say)?.text).toBe(
      "This drink won't take stock until 'Olive Oil' is linked to something on your shelf.",
    );
    expect(rowNote(row({ saved: unpriced('size_not_known') }), say)?.text).toBe(
      "No price yet: your shelf doesn't say how much one bottle of Olive Oil holds.",
    );
    expect(rowNote(row({ itemUom: 'case', saved: unpriced('pack_size_not_known') }), say)?.text).toMatch(
      /Link the line to the single bottle you pour from\.$/,
    );
  });

  it('Save names plates for a dish and serves for a drink', () => {
    expect(whyBlocked([row()], 0, recipeWords('dish'))).toMatch(/^Say how many plates it makes/);
    expect(whyBlocked([row()], 0)).toMatch(/^Say how many serves it makes/);
  });

  it('a dish offers kitchen units; a drink keeps the bar list', () => {
    expect(recipeWords('dish').units).toEqual(['g', 'kg', 'ml', 'l', 'tsp', 'tbsp', 'each']);
    expect(recipeWords('cocktail').units).toContain('barspoon');
    expect(recipeWords(null).units).toHaveLength(11);
  });

  it('a fresh dish line starts in grams; a fresh drink line in ml', () => {
    expect(recipeWords('dish').newLineUnit).toBe('g');
    expect(recipeWords('cocktail').newLineUnit).toBe('ml');
  });
});
