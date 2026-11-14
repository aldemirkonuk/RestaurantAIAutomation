/**
 * /cocktails: the current menu's cocktails, offered onto the list in one step
 * (r36 recipes audit, gap 3). The twin of /dishes' MenuDishesOffer.
 *
 * A bar reads its menu and makes it current; its dishes could already come
 * onto /dishes, but every cocktail was typed again here, with the price the
 * menu had just given, before a pour cost could show. This says how many of
 * the menu's cocktails are not on the list yet, names the first few, and puts
 * them all on it with one button: each with the menu's name, section and
 * price, and no recipe (the recipe is added on the drink, and its pour cost
 * comes from that). With no current menu it says so and points at Menu.
 *
 * Owner and manager only (the register mounts it only for them; the routes
 * refuse anyone else). It sends the names it showed, so a menu changed in
 * between never adds a drink the person did not see. The gateway writes the
 * drinks in one go: a refusal is "nothing was added", and a write with no
 * answer is said as unknown and the list is read again.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../contexts/AuthContext';
import { getErrorStatus } from '../../../services/api/client';
import { dishesApi, type MenuDishesAdded } from '../../../services/api/recipes';
import { reason } from './recipe/useRecipe';
import { PER_RUN, someNames } from '../../dishes/MenuDishesOffer';

/** The cocktail list's own key prefix: the list, its figures and its Menu column sit under it. */
const cocktailsKey = (rid: string | null | undefined) => ['cellar', 'cocktails', rid ?? null] as const;

/** Under the list's key, so a drink added or retired reads the offer again. */
export const menuDrinksKey = (rid: string | null | undefined) => [...cocktailsKey(rid), 'from-menu'] as const;

export const MENU_DRINKS_UNREAD = 'Your menu’s cocktails could not be read just now, so none is offered here.';

export const NO_CURRENT_MENU_DRINKS = 'No menu is current yet, so none of its cocktails is offered here. Choose your menu on';

const cocktails = (n: number) => `${n} ${n === 1 ? 'cocktail' : 'cocktails'}`;

/** What the run did, in sentences. */
export function drinksAddedWords(out: MenuDishesAdded): string {
  const parts: string[] = [];
  if (out.added.length > 0) parts.push(`${cocktails(out.added.length)} put on your list from the menu. Open one to add its recipe and see its pour cost.`);
  if (out.already.length > 0) parts.push(`${someNames(out.already)} ${out.already.length === 1 ? 'was' : 'were'} already on it.`);
  if (out.notOffered.length > 0) {
    parts.push(`${someNames(out.notOffered)}: no longer offered (listed meanwhile, or gone from the menu), so not added.`);
  }
  if (out.notAdded.length > 0) {
    parts.push(`${someNames(out.notAdded)} could not be saved just now and ${out.notAdded.length === 1 ? 'is' : 'are'} not on your list.`);
  }
  return parts.length > 0 ? parts.join(' ') : 'Nothing was added.';
}

export default function MenuDrinksOffer() {
  const { activeRestaurantId } = useAuth();
  const rid = activeRestaurantId;
  const qc = useQueryClient();
  const [said, setSaid] = useState<{ text: string; alert: boolean } | null>(null);
  const offer = useQuery({
    queryKey: menuDrinksKey(rid),
    enabled: Boolean(rid),
    queryFn: () => dishesApi.menuDrinks(rid as string),
  });
  const add = useMutation({
    mutationFn: (names: string[]) => dishesApi.addMenuDrinks(rid as string, names),
    // The list, its figures, this offer and the Menu column (all under the
    // list's key) and the ledger are read again whatever happened: a write
    // with no answer may have landed.
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: cocktailsKey(rid) }),
        qc.invalidateQueries({ queryKey: ['cellar', 'register', rid] }),
      ]),
  });

  if (offer.isPending && !said) return null;

  const items = offer.isError ? [] : (offer.data?.drinks ?? []);
  const names = items.map((d) => d.name);
  const unpriced = items.filter((d) => d.pricesDiffer).map((d) => d.name);

  const run = async () => {
    setSaid(null);
    try {
      const out = await add.mutateAsync(names.slice(0, PER_RUN));
      setSaid({ text: drinksAddedWords(out), alert: out.notAdded.length > 0 });
    } catch (e) {
      setSaid(
        getErrorStatus(e) == null
          ? { text: 'We could not tell whether the menu’s cocktails were added: no answer came back. Your list is read again below.', alert: true }
          : { text: `Nothing was added: ${reason(e)}`, alert: true },
      );
    }
  };

  return (
    <div data-testid="menu-drinks-offer">
      {offer.isError ? (
        <p className="cl-said" role="status" style={{ marginTop: 12 }} data-testid="menu-drinks-unread">
          {MENU_DRINKS_UNREAD}
        </p>
      ) : offer.data?.currentMenus === 0 ? (
        <p className="cl-said" style={{ marginTop: 12 }} data-testid="menu-drinks-no-menu">
          {NO_CURRENT_MENU_DRINKS}{' '}
          <Link to="/menu" className="cl-focus" style={{ textDecoration: 'underline' }}>
            Menu
          </Link>
          .
        </p>
      ) : items.length > 0 ? (
        <div className="cl-panel" style={{ marginTop: 12, display: 'grid', gap: 8 }} aria-label="Cocktails from your menu" role="group">
          <p className="cl-said">
            Your menu has {cocktails(items.length)} not on this list yet: {someNames(names)}.
          </p>
          <p className="cl-note">
            Each comes with the menu’s section and price. Its recipe is added on the drink itself, and its pour cost comes from that.
            {unpriced.length > 0
              ? ` ${someNames(unpriced)} ${unpriced.length === 1 ? 'comes' : 'come'} with no price, because the menu gives ${unpriced.length === 1 ? 'it' : 'them'} two.`
              : ''}
          </p>
          <div>
            <button type="button" className="cl-btn cl-focus" disabled={add.isPending} onClick={() => void run()}>
              {add.isPending ? 'Adding…' : items.length === 1 ? 'Add this cocktail from the menu' : `Add the menu’s ${cocktails(items.length)}`}
            </button>
          </div>
        </div>
      ) : null}
      {said ? (
        <p className="cl-note" role={said.alert ? 'alert' : 'status'} style={{ marginTop: 8 }} data-testid="menu-drinks-said">
          {said.text}
        </p>
      ) : null}
    </div>
  );
}
