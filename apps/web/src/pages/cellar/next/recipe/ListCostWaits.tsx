/**
 * What a list's cost waits for (r40 recipes build). After the menu's dishes
 * and drinks come onto the lists in one step, an owner faces a long list of
 * "No recipe yet" and "Not known" with nothing saying what to do next. The
 * cost cell now says how many of a recipe's shelf ingredients are priced, and
 * a line above the list counts the rows with no recipe yet and can show only
 * those. Owner and manager only: writing a recipe, and its cost, are theirs.
 */
import { useId } from 'react';
import type { ListCost } from '../../../../services/api/recipes';

/**
 * The one definition of "a cost that is not known": a read cost with a line
 * unpriced. `costWaits` (the words under the cell) and the "only without a
 * cost" switch both ask this, so the two can never disagree about a row.
 */
export const costNotKnown = (cost: ListCost | undefined): cost is NonNullable<ListCost> => Boolean(cost) && !(cost as NonNullable<ListCost>).complete;

/** Under a "Not known" cost: what it waits for; null when the cost is known or absent. */
export function costWaits(cost: ListCost | undefined): string | null {
  if (!costNotKnown(cost)) return null;
  if (cost.of === 0) return 'no ingredient from the shelf yet';
  return `${cost.priced} of ${cost.of} ingredients priced`;
}

export function CostWaits({ id, cost }: { id: string; cost: ListCost | undefined }) {
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
  read = true,
}: {
  bare: number;
  of: number;
  noun: 'dishes' | 'drinks';
  only: boolean;
  onOnly: (v: boolean) => void;
  /** False when what each row has could not be read: with the box ticked it says so, never "every one has". */
  read?: boolean;
}) {
  const id = useId();
  // Ticked, the box stays even when nothing is left to show: unmounting it left the list filtered to nothing with no way back (r107f).
  if (bare === 0 && !only) return null;
  const one = noun === 'dishes' ? 'dish' : 'drink';
  if (bare === 0) {
    return (
      <p className="cl-said" style={{ marginTop: 12 }} data-testid="no-recipe-yet">
        {read ? `Every ${one} now has a recipe.` : `Whether each ${one} has a recipe could not be read just now, so the list is not narrowed.`}{' '}
        <label htmlFor={`${id}-only`} style={{ whiteSpace: 'nowrap' }}>
          <input id={`${id}-only`} type="checkbox" className="cl-focus" checked={only} onChange={(e) => onOnly(e.target.checked)} /> Show only those
        </label>
      </p>
    );
  }
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

/** "3 of 20 drinks have a cost that is not known…", with a box that shows only those; nothing when none. */
export function NoCostYet({
  unknown,
  of,
  noun,
  only,
  onOnly,
  read = true,
}: {
  unknown: number;
  of: number;
  noun: 'dishes' | 'drinks';
  only: boolean;
  onOnly: (v: boolean) => void;
  /** False when the costs could not be read: with the box ticked it says so, never "every one has a cost". */
  read?: boolean;
}) {
  const id = useId();
  // Ticked, the box stays even when no drink is left without a cost: pricing the last one unmounted it and left the list empty with no way back (r107f).
  if (unknown === 0 && !only) return null;
  const one = noun === 'dishes' ? 'dish' : 'drink';
  if (unknown === 0) {
    return (
      <p className="cl-said" style={{ marginTop: 12 }} data-testid="no-cost-yet">
        {read ? `Every ${one} with a recipe now has a cost.` : `What the ${noun} cost could not be read just now, so the list is not narrowed.`}{' '}
        <label htmlFor={`${id}-only`} style={{ whiteSpace: 'nowrap' }}>
          <input id={`${id}-only`} type="checkbox" className="cl-focus" checked={only} onChange={(e) => onOnly(e.target.checked)} /> Only without a cost
        </label>
      </p>
    );
  }
  return (
    <p className="cl-said" style={{ marginTop: 12 }} data-testid="no-cost-yet">
      {unknown} of {of} {of === 1 ? one : noun} {unknown === 1 ? 'has' : 'have'} a recipe with a line that has no price, so what{' '}
      {unknown === 1 ? 'it costs' : 'they cost'} is not known.{' '}
      <label htmlFor={`${id}-only`} style={{ whiteSpace: 'nowrap' }}>
        <input id={`${id}-only`} type="checkbox" className="cl-focus" checked={only} onChange={(e) => onOnly(e.target.checked)} /> Only without a cost
      </label>
    </p>
  );
}
