/**
 * What a list's cost waits for (r40 recipes build). After the menu's dishes
 * and drinks come onto the lists in one step, an owner faces a long list of
 * "No recipe yet" and "Not known" with nothing saying what to do next. The
 * cost cell now says how many of a recipe's shelf ingredients are priced, and
 * a line above the list counts the rows with no recipe yet and can show only
 * those. Owner and manager only: writing a recipe, and its cost, are theirs.
 */
import { useId } from 'react';
import type { DishListRow } from '../../../../services/api/recipes';

/** Under a "Not known" cost: what it waits for; null when the cost is known or absent. */
export function costWaits(cost: DishListRow['cost'] | undefined): string | null {
  if (!cost || cost.complete) return null;
  if (cost.of === 0) return 'no ingredient from the shelf yet';
  return `${cost.priced} of ${cost.of} ingredients priced`;
}

export function CostWaits({ id, cost }: { id: string; cost: DishListRow['cost'] | undefined }) {
  const said = costWaits(cost);
  return said ? (
    <span className="cl-dim" style={{ display: 'block', fontSize: 11 }} data-testid={`cost-waits-${id}`}>
      {said}
    </span>
  ) : null;
}

/** "12 of 80 dishes have no recipe yet…", with a box that shows only those; nothing when every row has one. */
export function NoRecipeYet({
  bare,
  of,
  noun,
  only,
  onOnly,
}: {
  bare: number;
  of: number;
  noun: 'dishes' | 'drinks';
  only: boolean;
  onOnly: (v: boolean) => void;
}) {
  const id = useId();
  if (bare === 0) return null;
  const one = noun === 'dishes' ? 'dish' : 'drink';
  return (
    <p className="cl-said" style={{ marginTop: 12 }} data-testid="no-recipe-yet">
      {bare} of {of} {of === 1 ? one : noun} {bare === 1 ? 'has' : 'have'} no recipe yet, so what{' '}
      {bare === 1 ? 'it costs' : 'they cost'} is not known.{' '}
      <label htmlFor={`${id}-only`} style={{ whiteSpace: 'nowrap' }}>
        <input id={`${id}-only`} type="checkbox" className="cl-focus" checked={only} onChange={(e) => onOnly(e.target.checked)} /> Show
        only {bare === 1 ? 'that one' : 'those'}
      </label>
    </p>
  );
}
