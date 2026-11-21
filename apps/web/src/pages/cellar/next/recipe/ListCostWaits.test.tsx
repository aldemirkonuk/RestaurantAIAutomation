/** What a list's cost waits for, and the rows with no recipe yet (r40 recipes build). */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { NoRecipeYet, costWaits } from './ListCostWaits';

const cost = (o: Record<string, unknown>) => ({ perServe: null, perServeExact: null, priced: 0, of: 0, complete: false, partial: 0, ...o });

describe('costWaits', () => {
  it('counts the shelf ingredients priced', () => {
    expect(costWaits(cost({ priced: 1, of: 3 }))).toBe('1 of 3 ingredients priced');
    expect(costWaits(cost({ priced: 0, of: 1 }))).toBe('0 of 1 ingredients priced');
  });

  it('a recipe with no shelf ingredient says so', () => {
    expect(costWaits(cost({ of: 0 }))).toBe('no ingredient from the shelf yet');
  });

  it('a known cost, or none read, waits for nothing', () => {
    expect(costWaits(cost({ priced: 2, of: 2, complete: true, perServe: 3 }))).toBeNull();
    expect(costWaits(null)).toBeNull();
    expect(costWaits(undefined)).toBeNull();
  });
});

describe('NoRecipeYet', () => {
  it('counts the rows with no recipe, and the box shows only those', () => {
    const onOnly = vi.fn();
    render(<NoRecipeYet bare={12} of={80} noun="dishes" only={false} onOnly={onOnly} />);
    expect(screen.getByTestId('no-recipe-yet')).toHaveTextContent('12 of 80 dishes have no recipe yet, so what they cost is not known. Show only those');
    fireEvent.click(screen.getByLabelText(/Show only those/));
    expect(onOnly).toHaveBeenCalledWith(true);
  });

  it('speaks of one drink as one', () => {
    render(<NoRecipeYet bare={1} of={1} noun="drinks" only={false} onOnly={() => {}} />);
    expect(screen.getByTestId('no-recipe-yet')).toHaveTextContent('1 of 1 drink has no recipe yet, so what it costs is not known. Show only that one');
  });

  it('says nothing when every row has a recipe', () => {
    render(<NoRecipeYet bare={0} of={5} noun="dishes" only={false} onOnly={() => {}} />);
    expect(screen.queryByTestId('no-recipe-yet')).toBeNull();
  });
});
