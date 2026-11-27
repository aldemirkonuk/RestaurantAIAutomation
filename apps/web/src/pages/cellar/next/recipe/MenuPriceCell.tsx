/**
 * The "Menu" cell of /dishes and /cocktails (r28 recipes audit, gap 2): the
 * price the house's current menu gives a line of the row's name, beside the
 * row's own price, and "differs" when the two disagree. A house types its
 * dishes and drinks again after uploading its menu, and the food and pour
 * cost shares divide by the price typed here, so a disagreement is said
 * where the price is read. Nothing is linked: this only shows.
 */
import type { MenuPrice } from '../../../../services/api/recipes';
import { EM } from '../cellar-format';

/** Said under a menu price the row's own price does not match. */
export const MENU_DIFFERS = 'differs';
/** Said above the list when the menu's prices could not be read. */
export const MENU_PRICES_UNREAD = 'Your menu’s prices could not be read just now, so none is shown beside your list.';

export function MenuPriceCell({
  id,
  menu,
  say,
}: {
  id: string;
  menu: MenuPrice | undefined;
  say: (n: number | null | undefined) => string;
}) {
  const dim = (t: string) => <span className="cl-dim">{t}</span>;
  if (!menu) return dim(EM);
  if (menu.found === 'none') return dim('Not on the menu');
  if (menu.found === 'several') return dim(`${menu.lines} lines differ`);
  if (menu.prices.length === 0) return dim('No price on the menu');
  return (
    <>
      {menu.prices.map((p) => say(p)).join(' / ')}
      {menu.agrees === false ? (
        <span
          className="cl-dim"
          style={{ display: 'block', fontSize: 11, color: 'var(--warn)' }}
          data-testid={`menu-differs-${id}`}
        >
          {MENU_DIFFERS}
        </span>
      ) : null}
    </>
  );
}
