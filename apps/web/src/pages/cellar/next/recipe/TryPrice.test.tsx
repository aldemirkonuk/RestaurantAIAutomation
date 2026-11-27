import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CocktailRecipe, RecipeCost } from '../../../../services/api/recipes';
import { formatHousePercent } from '../../../../lib/house-number';
import DrinkCards, { type DraftCost } from './DrinkCards';
import { tryPriceSaid } from './TryPrice';

/** A lira house: "₺12,50" and "%21,1". */
const lira = (n: number) => `₺${n.toFixed(2).replace('.', ',')}`;
const pct = (p: number) => formatHousePercent(p, 'TRY');

const cost = (over: Partial<RecipeCost> = {}): RecipeCost => ({
  perServe: 2.11,
  perServeExact: 2.11,
  priced: 1,
  of: 1,
  complete: true,
  partial: 0,
  ...over,
});

function negroni(over: Partial<CocktailRecipe> = {}): CocktailRecipe {
  return {
    cocktail: { id: 'n', name: 'Negroni', price: 14, glass: null, garnish: null, method: null, description: null },
    current: {
      versionId: 'v1',
      version: 1,
      yieldServes: 1,
      method: null,
      glass: null,
      garnish: null,
      createdAt: '',
      lines: [
        {
          id: 'l1',
          position: 0,
          role: 'stocked',
          inventoryId: 'gin',
          label: 'Gin',
          itemName: 'Gin 700 ml',
          itemKind: null,
          qtyEntered: 30,
          unitCode: 'ml',
          qtyBase: 300,
          baseUnit: 'ml10',
          status: 'linked',
          costPerServe: 2.11,
          costBasis: 'invoice_lot_wac',
        },
      ],
    },
    cost: cost(),
    versionCount: 1,
    legacyLines: [],
    ...over,
  };
}

const type = (text: string) => fireEvent.change(screen.getByTestId('try-price-input'), { target: { value: text } });
const said = () => screen.getByTestId('try-price-said');

afterEach(() => vi.restoreAllMocks());

describe('Try a price (r108 drinks-g8)', () => {
  it('10 at a cost of 2,11 a serve is a 21,1 % pour cost and 7,89 margin', () => {
    render(<DrinkCards data={negroni()} sayMoney={lira} sayPct={pct} unsaved={false} />);
    type('10');
    expect(said()).toHaveTextContent('At ₺10,00: pour cost %21,1, margin ₺7,89 a serve.');
    expect(said()).toHaveAttribute('data-known', 'true');
  });

  it('a house whose prices include 20% tax is read against 8,33, not 10', () => {
    render(
      <DrinkCards data={negroni()} sayMoney={lira} sayPct={pct} unsaved={false} tax={{ basis: 'prices_include_tax', ratePct: 20 }} />,
    );
    type('10');
    // 2,11 / 8,333… = 25,3 %; 8,333… - 2,11 = 6,22
    expect(said()).toHaveTextContent('At ₺10,00: pour cost %25,3, margin ₺6,22 a serve.');
  });

  it('reads the house form "12,50" and the point form alike', () => {
    render(<DrinkCards data={negroni()} sayMoney={lira} sayPct={pct} unsaved={false} />);
    type('12,50');
    expect(said()).toHaveTextContent('At ₺12,50: pour cost %16,9, margin ₺10,39 a serve.');
    type('12.5');
    expect(said()).toHaveTextContent('At ₺12,50:');
  });

  it('bad text says how to write a price, in the house form', () => {
    render(<DrinkCards data={negroni()} sayMoney={lira} sayPct={pct} unsaved={false} />);
    type('12,5,0');
    expect(said()).toHaveTextContent('Write a price like 12,50.');
    expect(said()).toHaveAttribute('data-known', 'false');
    expect(tryPriceSaid('1x', cost(), (n) => `$${n.toFixed(2)}`, pct, { basis: 'unset' }, { unit: 'serve', share: 'pour cost' })?.said).toBe(
      'Write a price like 12.50.',
    );
  });

  it('an incomplete cost gives the cards’ own missing sentence, never a partial figure', () => {
    const partial = cost({ perServe: null, perServeExact: null, priced: 1, of: 2, complete: false });
    render(<DrinkCards data={negroni({ cost: partial })} sayMoney={lira} sayPct={pct} unsaved={false} />);
    type('10');
    expect(said()).toHaveTextContent(/^The cost is not complete\.$/);
    expect(said().textContent).not.toMatch(/%|margin/);
    // The pour cost card says the same words.
    expect(screen.getByTestId('drink-card-pour-cost')).toHaveTextContent('The cost is not complete.');
  });

  it('a tax-inclusive house with no rate says so instead of a figure', () => {
    render(
      <DrinkCards data={negroni()} sayMoney={lira} sayPct={pct} unsaved={false} tax={{ basis: 'prices_include_tax', ratePct: null }} />,
    );
    type('10');
    expect(said()).toHaveTextContent('Your list prices include tax and no tax rate for them is recorded.');
  });

  it('a price under the cost reads as a minus margin and is marked', () => {
    render(<DrinkCards data={negroni()} sayMoney={lira} sayPct={pct} unsaved={false} />);
    type('2');
    expect(said()).toHaveTextContent('At ₺2,00: pour cost %105,5, margin −₺0,11 a serve.');
    expect(said()).toHaveAttribute('data-warn', 'true');
    type('0');
    expect(said()).toHaveTextContent('Write a price above 0.');
  });

  it('unsaved lines are tried against the draft cost the cost card shows', () => {
    const draft: DraftCost = {
      cost: { perServe: 3, perServeExact: 3, priced: 1, of: 1, complete: true, partial: 0, lines: [{ status: 'linked', costPerServe: 3, costBasis: null }] },
      labels: ['Gin'],
    };
    render(<DrinkCards data={negroni()} sayMoney={lira} sayPct={pct} unsaved draftCost={draft} />);
    type('10');
    expect(said()).toHaveTextContent('At ₺10,00: pour cost %30,0, margin ₺7,00 a serve.');
  });

  it('staff, who see no money, get no box at all (ADR 0348)', () => {
    render(<DrinkCards data={negroni()} sayMoney={null} sayPct={pct} unsaved={false} />);
    expect(screen.queryByTestId('try-price')).toBeNull();
    expect(screen.queryByTestId('try-price-input')).toBeNull();
  });

  it('a dish says food cost and a plate', () => {
    render(<DrinkCards data={negroni({ kind: 'dish' })} sayMoney={lira} sayPct={pct} unsaved={false} />);
    type('10');
    expect(said()).toHaveTextContent('At ₺10,00: food cost %21,1, margin ₺7,89 a plate.');
  });

  it('holds its line from the first paint, writes nothing, keeps nothing and never tweens', () => {
    const set = vi.spyOn(Storage.prototype, 'setItem');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.reject(new Error('no fetch')));
    render(<DrinkCards data={negroni()} sayMoney={lira} sayPct={pct} unsaved={false} />);
    // Empty box: the sentence's room is there, empty, before any typing.
    expect(said()).toHaveClass('cl-try-room');
    expect(said()).toHaveTextContent(/^$/);
    type('10');
    type('11');
    expect(said()).toHaveClass('cl-try-room');
    expect(said().getAttribute('style') ?? '').not.toMatch(/transition|animation/);
    expect(set).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    const css = readFileSync(`${__dirname}/../cellar-next.css`, 'utf8');
    expect(css).toMatch(/\.cl-try-room \{ min-height: 1lh; \}/);
    expect(css).toMatch(/@media \(max-width: 640px\) \{\s*\.cl-offer-room, \.cl-try-room \{ min-height: 2lh; \}/);
    expect(css).not.toMatch(/\.cl-try-room[^{]*\{[^}]*(transition|animation)/);
  });
});
