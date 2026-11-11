/**
 * "Used in" — where one item goes (proposal §2 S2 item 4, §3 I15).
 *
 * Three groups from GET /inventory/:rid/item/:id/used-in, by how sure the link
 * is: menu lines linked to the item, the house's cocktails that name it, and
 * menu lines that only carry its name. The last group is never counted in
 * usage. A group whose read failed says so; it is never drawn as empty (ADR
 * 0067). No menu page links a line to an item yet, so the unlinked group says
 * what it is and offers no "Link this".
 *
 * An empty group is said as "None" under the server's own sentence for it,
 * which names the state (no current menu, not a catalogue drink); the drawer
 * never sums the groups into "not used anywhere". Dish recipes are not read
 * by this page at all (recipe lines live on the recipe-engine stack), so that
 * line says whether a recipe uses the item is not known here, never "no".
 */
import { Link, useInRouterContext } from 'react-router-dom';
import type { ItemMenuLine, ItemUsedIn as UsedIn, ItemUsedInGroup } from '../../../services/api/inventory';
import { cellMoney, type HouseCurrency } from './useInventoryNextData';

export type UsedInLoad = { status: 'reading' } | { status: 'failed'; reason: string } | { status: 'ready'; data: UsedIn };

export const RECIPES_UNKNOWN =
  'No dish carries a recipe yet, so which dishes use this good is not known here. It is never read as none.';

/** Where a drink opens: its own card on /cocktails, with its recipe. */
export const drinkHref = (cocktailId: string) => `/cocktails?open=${encodeURIComponent(cocktailId)}`;

/** A line that leads somewhere: a router link inside the app, a plain link outside it (tests, a bare mount). */
function LineLink({ to, children }: { to: string; children: string }) {
  const routed = useInRouterContext();
  return routed ? (
    <Link to={to} className="iv-linkish iv-focus">
      {children}
    </Link>
  ) : (
    <a href={to} className="iv-linkish iv-focus">
      {children}
    </a>
  );
}

export const DRINK_RECIPES_UNREAD = 'Which drink recipes use this item could not be read here.';

/** ADR 0360: a recipe links a good, but a sale does not take it from stock yet (sale depletion is the next wave). */
export const DRINKS_DO_NOT_DRAW =
  'A sale of these drinks does not take this item from stock yet; counts and write-offs move it.';

/** A recipe quantity as a person writes it: 0.30000000000000004 reads 0.3, 29.5735295625 reads 29.57. */
export function fmtRecipeQty(n: number): string {
  return n.toLocaleString('en-GB', { maximumFractionDigits: 2 });
}

function Group<T>({
  title,
  group,
  note,
  line,
  testid,
  hideWhenEmpty,
  unread,
}: {
  title: string;
  group: ItemUsedInGroup<T>;
  note?: string;
  line: (l: T, i: number) => { key: string; text: string; side?: string; to?: string };
  testid: string;
  /** Only the "named, not linked" group: nothing to link is nothing to say. */
  hideWhenEmpty?: boolean;
  /** Replaces the generic unread sentence with one that names the group. */
  unread?: string;
}) {
  if (!group.readable || group.lines === null) {
    return (
      <section className="ivd-used-g" data-testid={testid}>
        <h4 className="ivd-used-h">{title}</h4>
        <p className="iv-note">{unread ?? 'This could not be read, so nothing is shown here.'}</p>
      </section>
    );
  }
  if (group.lines.length === 0) {
    if (hideWhenEmpty) return null;
    return (
      <section className="ivd-used-g" data-testid={testid}>
        <h4 className="ivd-used-h">{title}</h4>
        <p className="iv-said" data-testid={`${testid}-none`}>
          None.
        </p>
        <p className="iv-note">{group.source}</p>
      </section>
    );
  }
  return (
    <section className="ivd-used-g" data-testid={testid}>
      <h4 className="ivd-used-h">{title}</h4>
      {note ? <p className="iv-note">{note}</p> : null}
      <ul className="ivd-used-list">
        {group.lines.map((l, i) => {
          const v = line(l, i);
          return (
            <li key={v.key}>
              {v.to ? <LineLink to={v.to}>{v.text}</LineLink> : <span>{v.text}</span>}
              {v.side ? <span className="ivd-dim">{v.side}</span> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default function ItemUsedIn({
  load,
  canManage,
  currency,
  onRetry,
}: {
  load: UsedInLoad;
  canManage: boolean;
  currency: HouseCurrency;
  onRetry: () => void;
}) {
  // Menu prices are money: owners and managers only, as on every card above.
  const menu = (l: ItemMenuLine) => ({
    key: l.menuItemId,
    text: l.name,
    side: canManage
      ? [
          l.bottlePrice !== null ? `bottle ${cellMoney(l.bottlePrice, currency)}` : null,
          l.byGlassPrice !== null ? `glass ${cellMoney(l.byGlassPrice, currency)}` : null,
        ]
          .filter(Boolean)
          .join(' · ') || undefined
      : undefined,
  });

  let body;
  if (load.status === 'reading') {
    body = <p className="iv-note">Reading where it is used…</p>;
  } else if (load.status === 'failed') {
    body = (
      <p className="iv-note" role="alert">
        Where this item is used could not be read — {load.reason}.{' '}
        <button type="button" className="iv-linkish iv-focus" onClick={onRetry}>
          Read again
        </button>
      </p>
    );
  } else {
    const { soldAs, inCocktails, inDrinkRecipes, namedNotLinked } = load.data;
    body = (
      <>
        <Group title="Sold as" testid="ivd-used-sold" group={soldAs} line={menu} />
        <Group
          title="In these cocktails"
          testid="ivd-used-cocktails"
          group={inCocktails}
          note={DRINKS_DO_NOT_DRAW}
          // One cocktail may name the item twice (two lines): the key is the line, not the cocktail.
          line={(c, i) => ({
            key: `${c.cocktailId}-${i}`,
            text: c.name,
            to: drinkHref(c.cocktailId),
            side: c.quantity !== null ? `${fmtRecipeQty(c.quantity)}${c.unit ? ` ${c.unit}` : ''}` : undefined,
          })}
        />
        <Group
          title="In drink recipes"
          testid="ivd-used-drink-recipes"
          // An older gateway does not send the field: that is unread, never None.
          group={inDrinkRecipes ?? { readable: false, lines: null, source: DRINK_RECIPES_UNREAD }}
          unread={DRINK_RECIPES_UNREAD}
          note={DRINKS_DO_NOT_DRAW}
          line={(d, i) => ({
            key: `${d.cocktailId}-${i}`,
            text: `${d.name} — ${fmtRecipeQty(d.qtyEntered)} ${d.unitCode} (${d.label})`,
            to: drinkHref(d.cocktailId),
          })}
        />
        <Group
          title="Named on the menu, not linked"
          testid="ivd-used-named"
          group={namedNotLinked}
          note="These lines carry this item’s name but no link to it, so they are not counted in usage."
          line={menu}
          hideWhenEmpty
        />
      </>
    );
  }

  return (
    <section className="ivd-used" aria-labelledby="ivd-used-title" data-testid="ivd-used">
      <h3 id="ivd-used-title" className="iv-sec">
        Used in
      </h3>
      {body}
      <section className="ivd-used-g" data-testid="ivd-used-recipes">
        <h4 className="ivd-used-h">In dish recipes</h4>
        <p className="iv-note">{RECIPES_UNKNOWN}</p>
      </section>
    </section>
  );
}
