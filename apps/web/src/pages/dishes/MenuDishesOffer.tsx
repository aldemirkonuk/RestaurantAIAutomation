/**
 * /dishes: the current menu's dishes, offered onto the list in one step
 * (r28 onboarding audit, gap 1, slice 3).
 *
 * A food house reads its menu at /get-started, and /house/menu keeps its
 * dishes "apart from the drinks". On /dishes it then had to type every dish
 * again, one form each, with the price it had just read. This says how many
 * of the menu's dishes are not on the list yet, names the first few, and
 * puts them all on it with one button: each with the menu's name, section
 * and price, and no recipe (a recipe is added on the dish itself).
 *
 * Owner and manager only (the page mounts it only for them; the routes
 * refuse anyone else). Sends the names it showed, so a menu changed in
 * between never adds a dish the person did not see. An unread offer is said
 * in one line, never shown as "nothing to add". A write that may or may not
 * have landed (no answer from the server) is said as unknown, and the list
 * is read again.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../contexts/AuthContext';
import { getErrorStatus } from '../../services/api/client';
import { dishesApi, type MenuDishesAdded } from '../../services/api/recipes';
import { dishesKey, reason } from '../cellar/next/recipe/useRecipe';

/** Under the list's own key, so a dish added or taken off reads the offer again. */
export const menuDishesKey = (rid: string | null | undefined) => [...dishesKey(rid), 'from-menu'] as const;

/** Said when the offer could not be read. */
export const MENU_DISHES_UNREAD = 'Your menu’s dishes could not be read just now, so none is offered here.';

/** How many names are shown before "and N more". */
const SHOWN = 3;

const dishes = (n: number) => `${n} ${n === 1 ? 'dish' : 'dishes'}`;

/** "A", "A and B", "A, B and C", "A, B, C and 4 more". */
export function someNames(names: string[]): string {
  const shown = names.slice(0, SHOWN);
  const more = names.length - shown.length;
  if (more > 0) return `${shown.join(', ')} and ${more} more`;
  if (shown.length <= 1) return shown.join('');
  return `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
}

/** What the run did, in sentences. */
export function addedWords(out: MenuDishesAdded): string {
  const parts: string[] = [];
  if (out.added.length > 0) parts.push(`${dishes(out.added.length)} put on your list from the menu.`);
  if (out.already.length > 0) parts.push(`${someNames(out.already)} ${out.already.length === 1 ? 'was' : 'were'} already on it.`);
  if (out.notOffered.length > 0) {
    parts.push(`${someNames(out.notOffered)}: no longer offered (listed meanwhile, or gone from the menu), so not added.`);
  }
  if (out.notAdded.length > 0) {
    parts.push(`${someNames(out.notAdded)} could not be saved just now and ${out.notAdded.length === 1 ? 'is' : 'are'} not on your list. Add ${out.notAdded.length === 1 ? 'it' : 'them'} again below.`);
  }
  return parts.length > 0 ? parts.join(' ') : 'Nothing was added.';
}

export default function MenuDishesOffer() {
  const { activeRestaurantId } = useAuth();
  const rid = activeRestaurantId;
  const qc = useQueryClient();
  const [said, setSaid] = useState<{ text: string; alert: boolean } | null>(null);
  const offer = useQuery({
    queryKey: menuDishesKey(rid),
    enabled: Boolean(rid),
    queryFn: () => dishesApi.menuDishes(rid as string),
  });
  const add = useMutation({
    mutationFn: (names: string[]) => dishesApi.addMenuDishes(rid as string, names),
    // Read the list (and with it this offer and the Menu column) again
    // whatever happened: a write with no answer may still have landed.
    onSettled: () => qc.invalidateQueries({ queryKey: dishesKey(rid) }),
  });

  if (offer.isPending && !said) return null;

  const items = offer.isError ? [] : (offer.data?.dishes ?? []);
  const names = items.map((d) => d.name);
  const unpriced = items.filter((d) => d.pricesDiffer).map((d) => d.name);

  const run = async () => {
    setSaid(null);
    try {
      const out = await add.mutateAsync(names);
      setSaid({ text: addedWords(out), alert: out.notAdded.length > 0 });
    } catch (e) {
      setSaid(
        getErrorStatus(e) == null
          ? { text: 'We could not tell whether the menu’s dishes were added: no answer came back. Your list is read again below.', alert: true }
          : { text: `Nothing was added: ${reason(e)}`, alert: true },
      );
    }
  };

  return (
    <div data-testid="menu-dishes-offer">
      {offer.isError ? (
        <p className="cl-said" role="status" style={{ marginTop: 12 }} data-testid="menu-dishes-unread">
          {MENU_DISHES_UNREAD}
        </p>
      ) : items.length > 0 ? (
        <div className="cl-panel" style={{ marginTop: 12, display: 'grid', gap: 8 }} aria-label="Dishes from your menu" role="group">
          <p className="cl-said">
            Your menu has {dishes(items.length)} not on this list yet: {someNames(names)}.
          </p>
          <p className="cl-note">
            Each comes with the menu’s section and price. Its recipe is added on the dish itself.
            {unpriced.length > 0
              ? ` ${someNames(unpriced)} ${unpriced.length === 1 ? 'comes' : 'come'} with no price, because the menu gives ${unpriced.length === 1 ? 'it' : 'them'} two.`
              : ''}
          </p>
          <div>
            <button type="button" className="cl-btn cl-focus" disabled={add.isPending} onClick={() => void run()}>
              {add.isPending ? 'Adding…' : items.length === 1 ? 'Add this dish from the menu' : `Add the menu’s ${dishes(items.length)}`}
            </button>
          </div>
        </div>
      ) : null}
      {said ? (
        <p className="cl-note" role={said.alert ? 'alert' : 'status'} style={{ marginTop: 8 }} data-testid="menu-dishes-said">
          {said.text}
        </p>
      ) : null}
    </div>
  );
}
