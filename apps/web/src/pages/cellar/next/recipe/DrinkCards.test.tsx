import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CocktailRecipe, CostPreview, RecipeLine, WhatIsIn } from '../../../../services/api/recipes';
import DrinkCards, { type DraftCost } from './DrinkCards';

const fig = (value: number | null, missing: string[] = [], atLeast = false) => ({ value, atLeast, missing });
const say = (n: number) => `$${n.toFixed(2)}`;

const line = (over: Partial<RecipeLine>): RecipeLine => ({
  id: `l-${over.label}`,
  position: 0,
  role: 'stocked',
  inventoryId: 'item',
  label: 'gin',
  itemName: null,
  itemKind: null,
  qtyEntered: 50,
  unitCode: 'ml',
  qtyBase: 500,
  baseUnit: 'ml10',
  status: 'linked',
  costPerServe: 1.57,
  costBasis: 'invoice_lot_wac',
  ...over,
});

/** The browser walk's House G&T: gin 50 ml @ 22/700 ml, tonic 200 ml @ 0.90, Angostura not counted. */
function gAndT(over: Partial<CocktailRecipe> = {}, whatIsIn?: WhatIsIn): CocktailRecipe {
  return {
    cocktail: { id: 'c', name: 'House G&T', price: 12, glass: null, garnish: null, method: null, description: null },
    current: {
      versionId: 'v2',
      version: 2,
      yieldServes: 1,
      method: null,
      glass: null,
      garnish: null,
      createdAt: '',
      lines: [
        line({ label: 'House London Dry Gin', itemName: 'Gin 700 ml' }),
        line({ label: 'Tonic Water', itemName: 'Tonic 200 ml', costPerServe: 0.9 }),
        line({ label: 'Angostura', role: 'untracked', inventoryId: null, status: 'untracked', costPerServe: null, costBasis: null }),
      ],
    },
    cost: { perServe: 2.47, perServeExact: 2.471429, priced: 2, of: 2, complete: true, partial: 0 },
    whatIsIn,
    versionCount: 2,
    legacyLines: [],
    ...over,
  };
}

const readable = (alcohol: ReturnType<typeof fig> | undefined): WhatIsIn => ({
  readable: true,
  figures: {
    energyKcal: fig(178.45, ['Angostura'], true),
    fatG: fig(null, ['Angostura']),
    saturatesG: fig(null, ['Angostura']),
    carbohydrateG: fig(17, ['Angostura'], true),
    sugarsG: fig(17, ['Angostura'], true),
    proteinG: fig(null, ['Angostura']),
    saltG: fig(0.06, ['Angostura'], true),
    ...(alcohol ? { alcoholMl: alcohol } : {}),
  },
  notCounted: [{ label: 'Angostura', why: 'it is not counted from the shelf' }],
  allergens: {},
  allergensUnstatedBy: ['Angostura'],
});

describe('DrinkCards', () => {
  it('reads the House G&T as the walk measured it: 2.47 a serve, 12 on the list, 178.5 kcal, 20 ml of alcohol', () => {
    render(<DrinkCards data={gAndT({}, readable(fig(20, ['Angostura'], true)))} sayMoney={say} unsaved={false} />);
    expect(screen.getByTestId('drink-card-cost').textContent).toBe("Cost a serve$2.47At today's prices, all 2 ingredients priced.");
    expect(screen.getByTestId('drink-card-price').textContent).toBe('Price$12.00A serve, as your list has it.');
    expect(screen.getByTestId('drink-card-ingredients').textContent).toBe('Ingredients32 from your shelf, 1 not counted.');
    expect(screen.getByTestId('drink-card-energy').textContent).toBe('Energy a serveat least 178.5 kcalUnknown for Angostura.');
    expect(screen.getByTestId('drink-card-alcohol').textContent).toBe(
      "Pure alcohol a serveat least 20 ml15.8 g of pure alcohol, from each ingredient's stated strength; unknown for Angostura.",
    );
  });

  it('never shows a partial sum as the cost: an unpriced or unlinked line makes it not known, named', () => {
    const d = gAndT();
    const lines = [d.current!.lines[0], line({ label: 'lime', inventoryId: null, status: 'not_linked', costPerServe: null, costBasis: null })];
    render(
      <DrinkCards
        data={gAndT({ current: { ...d.current!, lines }, cost: { perServe: null, priced: 1, of: 2, complete: false } })}
        sayMoney={say}
        unsaved={false}
      />,
    );
    const cost = screen.getByTestId('drink-card-cost');
    expect(cost).toHaveAttribute('data-known', 'false');
    expect(cost.textContent).toBe('Cost a serveNot known1 of 2 ingredients priced; no price yet for lime.');
    expect(cost.textContent).not.toContain('1.57');
    expect(screen.getByTestId('drink-card-ingredients')).toHaveAttribute('data-warn', 'true');
    expect(screen.getByTestId('drink-card-ingredients').textContent).toContain('1 not linked to it yet');
  });

  it('says a drink with nothing from the shelf has no cost here, and no price as no price, never 0', () => {
    const d = gAndT();
    render(
      <DrinkCards
        data={gAndT({
          cocktail: { ...d.cocktail, price: null },
          current: { ...d.current!, lines: [d.current!.lines[2]] },
          cost: { perServe: null, priced: 0, of: 0, complete: false },
        })}
        sayMoney={say}
        unsaved={false}
      />,
    );
    expect(screen.getByTestId('drink-card-cost').textContent).toContain('Not known');
    expect(screen.getByTestId('drink-card-price').textContent).toBe('PriceNo priceYour list has no price for it.');
    expect(document.body.textContent).not.toContain('$0');
  });

  it('a role without money gets no cost or price card; an older gateway with no alcohol figure reads not read', () => {
    render(<DrinkCards data={gAndT({ cost: null }, readable(undefined))} sayMoney={null} unsaved />);
    expect(screen.queryByTestId('drink-card-cost')).toBeNull();
    expect(screen.queryByTestId('drink-card-price')).toBeNull();
    expect(screen.getByTestId('drink-card-alcohol').textContent).toContain('Not read');
    expect(screen.getByTestId('drink-cards').textContent).toContain('Save to count your changes.');
  });

  it('per serve on a batch: says how many serves the figures divide by', () => {
    const d = gAndT();
    render(<DrinkCards data={gAndT({ current: { ...d.current!, yieldServes: 10 } })} sayMoney={say} unsaved={false} />);
    expect(screen.getByTestId('drink-card-ingredients').textContent).toContain('Makes 10 serves; every card is per serve.');
  });

  it('shows nothing before a recipe is saved', () => {
    const { container } = render(<DrinkCards data={gAndT({ current: null, cost: null })} sayMoney={say} unsaved={false} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('DrinkCards: the cost of unsaved lines', () => {
  const draft = (cost: Partial<CostPreview>, labels = ['House London Dry Gin', 'Tonic Water']): DraftCost => ({
    labels,
    cost: {
      perServe: 3.1,
      perServeExact: 3.1,
      priced: 2,
      of: 2,
      complete: true,
      partial: 0,
      lines: [
        { status: 'linked', costPerServe: 2.2, costBasis: 'invoice_lot_wac' },
        { status: 'linked', costPerServe: 0.9, costBasis: 'invoice_lot_wac' },
      ],
      ...cost,
    },
  });

  it('shows the draft cost with its own said-line, and says which figures are still the saved ones', () => {
    render(<DrinkCards data={gAndT({}, readable(fig(20)))} sayMoney={say} unsaved draftCost={draft({})} />);
    expect(screen.getByTestId('drink-card-cost').textContent).toBe("Cost a serve$3.10Your unsaved lines, at today's prices.");
    expect(screen.getByTestId('drink-card-price').textContent).toBe('Price$12.00A serve, as your list has it.');
    expect(screen.getByTestId('drink-cards').textContent).toContain(
      'The cost is your unsaved lines. The other figures are the saved recipe\u2019s; save to count them.',
    );
    expect(screen.getByTestId('drink-cards').textContent).not.toContain('Save to count your changes.');
  });

  it('keeps the saved cost and the old note while the draft is not priced (absent draftCost)', () => {
    render(<DrinkCards data={gAndT({}, readable(fig(20)))} sayMoney={say} unsaved draftCost={null} />);
    expect(screen.getByTestId('drink-card-cost').textContent).toBe("Cost a serve$2.47At today's prices, all 2 ingredients priced.");
    expect(screen.getByTestId('drink-cards').textContent).toContain('These are the saved recipe\u2019s figures. Save to count your changes.');
  });

  it('ignores a draft cost once the sheet is not unsaved', () => {
    render(<DrinkCards data={gAndT({}, readable(fig(20)))} sayMoney={say} unsaved={false} draftCost={draft({})} />);
    expect(screen.getByTestId('drink-card-cost').textContent).toContain('$2.47');
  });

  it('says an unknown draft cost as not known and names the line, never 0', () => {
    render(
      <DrinkCards
        data={gAndT({}, readable(fig(20)))}
        sayMoney={say}
        unsaved
        draftCost={draft({
          perServe: null,
          perServeExact: null,
          priced: 1,
          complete: false,
          lines: [
            { status: 'linked', costPerServe: 2.2, costBasis: 'invoice_lot_wac' },
            { status: 'linked', costPerServe: null, costBasis: 'unknown' },
          ],
        })}
      />,
    );
    const cost = screen.getByTestId('drink-card-cost');
    expect(cost).toHaveAttribute('data-known', 'false');
    expect(cost.textContent).toBe('Cost a serveNot known1 of 2 ingredients priced; no price yet for Tonic Water.');
    expect(cost.textContent).not.toMatch(/\$0/);
  });

  it('says a partial draft cost the way the saved one does', () => {
    render(<DrinkCards data={gAndT({}, readable(fig(20)))} sayMoney={say} unsaved draftCost={draft({ partial: 1 })} />);
    expect(screen.getByTestId('drink-card-cost').textContent).toBe(
      "Cost a serve$3.10Your unsaved lines, at today's prices; 1 ingredient is priced from the bottles with an invoice only.",
    );
  });
});
