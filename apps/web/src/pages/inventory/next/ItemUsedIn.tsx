/**
 * "Used in" — where one item goes (proposal §2 S2 item 4, §3 I15).
 *
 * Three groups from GET /inventory/:rid/item/:id/used-in, by how sure the link
 * is: menu lines linked to the item, the house's cocktails that name it, and
 * menu lines that only carry its name. The last group is never counted in
 * usage. A group whose read failed says so; it is never drawn as empty (ADR
 * 0067). No menu page links a line to an item yet, so the unlinked group says
 * what it is and offers no "Link this".
 */
import type { ItemMenuLine, ItemUsedIn as UsedIn, ItemUsedInGroup } from '../../../services/api/inventory';
import { cellMoney, type HouseCurrency } from './useInventoryNextData';

export type UsedInLoad = { status: 'reading' } | { status: 'failed'; reason: string } | { status: 'ready'; data: UsedIn };

const RECIPES_NOTE = 'Recipes are not recorded yet, so no dish recipe is shown here.';

function Group<T>({
  title,
  group,
  note,
  line,
  testid,
}: {
  title: string;
  group: ItemUsedInGroup<T>;
  note?: string;
  line: (l: T) => { key: string; text: string; side?: string };
  testid: string;
}) {
  if (!group.readable || group.lines === null) {
    return (
      <section className="ivd-used-g" data-testid={testid}>
        <h4 className="ivd-used-h">{title}</h4>
        <p className="iv-note">This could not be read, so nothing is shown here.</p>
      </section>
    );
  }
  if (group.lines.length === 0) return null;
  return (
    <section className="ivd-used-g" data-testid={testid}>
      <h4 className="ivd-used-h">{title}</h4>
      {note ? <p className="iv-note">{note}</p> : null}
      <ul className="ivd-used-list">
        {group.lines.map((l) => {
          const v = line(l);
          return (
            <li key={v.key}>
              <span>{v.text}</span>
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
    const { soldAs, inCocktails, namedNotLinked } = load.data;
    const all = [soldAs, inCocktails, namedNotLinked];
    const nothing = all.every((g) => g.readable && g.lines !== null && g.lines.length === 0);
    body = nothing ? (
      <p className="iv-said" data-testid="ivd-used-none">
        Not on the menu or in a recipe yet.
      </p>
    ) : (
      <>
        <Group title="Sold as" testid="ivd-used-sold" group={soldAs} line={menu} />
        <Group
          title="In these cocktails"
          testid="ivd-used-cocktails"
          group={inCocktails}
          line={(c) => ({
            key: `${c.cocktailId}-${c.quantity ?? ''}-${c.unit ?? ''}`,
            text: c.name,
            side: c.quantity !== null ? `${c.quantity}${c.unit ? ` ${c.unit}` : ''}` : undefined,
          })}
        />
        <Group
          title="Named on the menu, not linked"
          testid="ivd-used-named"
          group={namedNotLinked}
          note="These lines carry this item’s name but no link to it, so they are not counted in usage."
          line={menu}
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
      <p className="iv-note">{RECIPES_NOTE}</p>
    </section>
  );
}
