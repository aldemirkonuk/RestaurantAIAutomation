import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CocktailRecipe, RecipeLine } from '../../../../services/api/recipes';
import DrinkCards from './DrinkCards';

const say = (n: number) => `$${n.toFixed(2)}`;
const line = (over: Partial<RecipeLine>): RecipeLine => ({
  id: `l-${over.label}`, position: 0, role: 'stocked', inventoryId: 'item', label: 'Gin', itemName: null, itemKind: null,
  qtyEntered: 50, unitCode: 'ml', qtyBase: 500, baseUnit: 'ml10', status: 'linked', costPerServe: 2, costBasis: 'x', ...over,
});
const drink = (lines: RecipeLine[], cost: Partial<CocktailRecipe['cost']> = {}): CocktailRecipe => ({
  cocktail: { id: 'c', name: 'Gin Tonic', price: 12, glass: null, garnish: null, method: null, description: null },
  current: { versionId: 'v', version: 1, yieldServes: 1, method: null, glass: null, garnish: null, createdAt: '', lines },
  cost: { perServe: 2.11, perServeExact: 2.105, priced: lines.length, of: lines.length, complete: true, partial: 0, ...cost } as CocktailRecipe['cost'],
  versionCount: 1, legacyLines: [],
});
const shares = () => screen.queryByTestId('line-shares');

describe('line share of cost on the cost card', () => {
  it('says each line, whole percent, totalling 100', () => {
    render(<DrinkCards data={drink([line({ label: 'Gin', itemName: 'Gin', costPerServe: 2 }), line({ label: 'Tonic', itemName: 'Tonic', costPerServe: 0.105 })])} sayMoney={say} unsaved={false} />);
    expect(Array.from(shares()!.querySelectorAll('li')).map((li) => li.textContent)).toEqual(['Gin 95%', 'Tonic 5%']);
  });

  it('an unpriced line says not priced and the rest are of the priced part', () => {
    render(
      <DrinkCards
        data={drink([line({ label: 'Gin', itemName: 'Gin', costPerServe: 3 }), line({ label: 'Campari', itemName: 'Campari', costPerServe: null })], { complete: false, perServe: null, priced: 1, of: 2 })}
        sayMoney={say}
        unsaved={false}
      />,
    );
    const t = shares()!.textContent!;
    expect(t).toContain('Gin 100%');
    expect(t).toContain('Campari not priced');
    expect(screen.getByTestId('line-shares-block').textContent).toContain('Shares are of the priced part of the serve.');
  });

  it('a made line (a house-made component) has its share: Sour Test is Gin 95%, Sour mix 5%, not Gin 100%', () => {
    render(
      <DrinkCards
        data={drink([
          line({ label: 'Gin', itemName: 'Gin', costPerServe: 2 }),
          line({ label: 'Sour mix', role: 'made', inventoryId: null, componentId: 'dish-sour', costPerServe: 0.105 }),
        ])}
        sayMoney={say}
        unsaved={false}
      />,
    );
    expect(Array.from(shares()!.querySelectorAll('li')).map((li) => li.textContent)).toEqual(['Gin 95%', 'Sour mix 5%']);
    expect(screen.getByTestId('line-shares-block').textContent).not.toContain('priced part');
  });

  it('an unpriced made line is not priced, keeps the priced-part sentence, and the cost says N of M priced, never a sum or 0', () => {
    render(
      <DrinkCards
        data={drink(
          [
            line({ label: 'Gin', itemName: 'Gin', costPerServe: 2 }),
            line({ label: 'Sour mix', role: 'made', inventoryId: null, componentId: 'dish-sour', costPerServe: null }),
          ],
          { complete: false, perServe: null, perServeExact: null, priced: 1, of: 2 },
        )}
        sayMoney={say}
        unsaved={false}
      />,
    );
    const t = shares()!.textContent!;
    expect(t).toContain('Gin 100%');
    expect(t).toContain('Sour mix not priced');
    expect(screen.getByTestId('line-shares-block').textContent).toContain('Shares are of the priced part of the serve.');
    const body = document.body.textContent!;
    expect(body).toContain('1 of 2 ingredients priced; no price yet for Sour mix.');
    expect(body).toContain('Not known');
    expect(body).not.toContain('$2.00');
    expect(body).not.toContain('$0.00');
  });

  it('staff, who see no cost card, see no shares', () => {
    render(<DrinkCards data={drink([line({})])} sayMoney={null} unsaved={false} />);
    expect(screen.queryByTestId('line-shares')).toBeNull();
  });
});
