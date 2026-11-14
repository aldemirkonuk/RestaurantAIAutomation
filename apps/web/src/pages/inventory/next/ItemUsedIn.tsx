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
 * never sums the groups into "not used anywhere". Dish recipes come from
 * GET /recipes/:rid/items/:id/dishes (ADR 0366): each dish whose current recipe
 * uses the good, with its cards. A failed read says so and is never "None".
 *
 * The two drink groups answer one question from two sources (a cocktail card
 * that names the catalogue drink, and a current recipe line linked to the
 * item), so they are drawn so that they never contradict (r5, R7): an empty
 * group is left out when the other one was read, a drink the recipes already
 * list is not listed again from its card, and when both are empty one "None."
 * is said, under the recipes. A group that could not be read always says so.
 *
 * A drink in a recipe gets the cards a dish gets (founder /goal 2026-11-07:
 * "the same for drinks and their recipes"): used per serve, cost per serve,
 * price and pour cost, from GET /recipes/:rid/items/:id/drinks. Until that
 * read answers, or when it fails, the drink is the used-in read's one line,
 * and a failed read says its cards could not be read, with Read again.
 */
import { Link, useInRouterContext } from 'react-router-dom';
import type { ItemMenuLine, ItemUsedIn as UsedIn, ItemUsedInGroup } from '../../../services/api/inventory';
import {
  dishHref,
  type ItemDish,
  type ItemDishCost,
  type ItemDishes,
  type ItemDrink,
  type ItemDrinks,
} from '../../../services/api/itemDishes';
import { cellMoney, type HouseCurrency } from './useInventoryNextData';
// A share in the house's form, as its money is: "%13,1" beside "₺12,00" (r23 walk).
import { formatHousePercent } from '../../../lib/house-number';

export type UsedInLoad = { status: 'reading' } | { status: 'failed'; reason: string } | { status: 'ready'; data: UsedIn };

export type DishesLoad = { status: 'reading' } | { status: 'failed'; reason: string } | { status: 'ready'; data: ItemDishes };

export type DrinksLoad = { status: 'reading' } | { status: 'failed'; reason: string } | { status: 'ready'; data: ItemDrinks };

export const FOOD_COST_TAX_NOTE = 'of the price as your list has it; whether that price includes tax is not recorded';

/** Food (or pour) cost as a share of the price: only from a complete cost and a price above zero. */
export function foodCostShare(
  cost: ItemDishCost | null,
  price: number | null,
  noun: 'dish' | 'drink' = 'dish',
): { pct: number } | { missing: string[] } {
  const missing: string[] = [];
  if (!(cost?.complete === true && cost.perServeExact !== null)) missing.push('the cost is not complete');
  if (!(price !== null && price > 0)) missing.push(`the ${noun} has no price`);
  if (missing.length > 0 || cost === null || cost.perServeExact === null || price === null) return { missing };
  return { pct: Math.round((cost.perServeExact / price) * 1000) / 10 };
}

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

function DishCard({ id, title, value, sub }: { id: string; title: string; value: string; sub?: string }) {
  return (
    <div className="ivd-card" data-testid={id}>
      <span className="ivd-card-k">{title}</span>
      <span className="ivd-card-v">{value}</span>
      {sub ? <span className="ivd-card-s">{sub}</span> : null}
    </div>
  );
}

/**
 * What a recipe's cards call themselves: a dish is a plate and a food cost, a
 * drink a serve and a pour cost.
 *
 * "per", never "a" (r21 walk D5): the labels are drawn in capitals, and
 * "COST A SERVE" / "THIS GOOD A SERVE" read as an instruction or a fragment.
 * "Used per serve" is how much of this good one serve takes; "Cost per serve"
 * is what one serve costs, the restaurant's own term.
 */
const RECIPE_WORDS = {
  dish: { per: 'Used per plate', perId: 'per-plate', cost: 'Cost per plate', share: 'Food cost', shareId: 'food-cost', noPrice: 'Not on the dish' },
  drink: { per: 'Used per serve', perId: 'per-serve', cost: 'Cost per serve', share: 'Pour cost', shareId: 'pour-cost', noPrice: 'Not on the drink' },
} as const;

/** One dish or drink that uses the good: its name as a link, then its cards. */
function RecipeBlock({
  kind,
  id,
  name,
  section,
  href,
  yieldServes: y,
  uses,
  cost,
  price,
  canManage,
  currency,
}: {
  kind: 'dish' | 'drink';
  id: string;
  name: string;
  section: string | null;
  href: string;
  yieldServes: number | null;
  uses: ItemDish['uses'];
  cost: ItemDishCost | null;
  price: number | null;
  canManage: boolean;
  currency: HouseCurrency;
}) {
  const w = RECIPE_WORDS[kind];
  const t = `ivd-${kind}-${id}`;
  const known = y !== null && y > 0;
  const perServe = known ? uses.map((u) => `${fmtRecipeQty(u.qtyEntered / y)} ${u.unitCode}`).join(' + ') : '';
  const share = foodCostShare(cost, price, kind);
  return (
    <div className={`ivd-dish ivd-${kind}`} data-testid={t}>
      <p className="ivd-dish-h">
        <LineLink to={href}>{name}</LineLink>
        {section ? <span className="ivd-dim"> · {section}</span> : null}
      </p>
      <div className="ivd-cards">
        <DishCard
          id={`${t}-${w.perId}`}
          title={w.per}
          value={known && perServe ? perServe : 'Not known'}
          sub={known && y > 1 ? `in a batch of ${y}` : undefined}
        />
        {canManage && cost !== null ? (
          <DishCard
            id={`${t}-cost`}
            title={w.cost}
            value={cost.complete ? cellMoney(cost.perServe, currency) : 'Not known'}
            sub={cost.complete ? undefined : `${cost.priced} of ${cost.of} lines priced`}
          />
        ) : null}
        {canManage ? (
          <DishCard id={`${t}-price`} title="Price" value={price !== null ? cellMoney(price, currency) : w.noPrice} />
        ) : null}
        {canManage ? (
          <DishCard
            id={`${t}-${w.shareId}`}
            title={w.share}
            value={'pct' in share ? formatHousePercent(share.pct, currency.code) : 'Not known'}
            sub={'pct' in share ? FOOD_COST_TAX_NOTE : share.missing.join(' and ')}
          />
        ) : null}
      </div>
    </div>
  );
}

function DishBlock({ dish, canManage, currency }: { dish: ItemDish; canManage: boolean; currency: HouseCurrency }) {
  return (
    <RecipeBlock
      kind="dish"
      id={dish.dishId}
      name={dish.name}
      section={dish.section}
      href={dishHref(dish.dishId)}
      yieldServes={dish.yieldServes}
      uses={dish.uses}
      cost={dish.cost}
      price={dish.price}
      canManage={canManage}
      currency={currency}
    />
  );
}

function DrinkBlock({ drink, canManage, currency }: { drink: ItemDrink; canManage: boolean; currency: HouseCurrency }) {
  return (
    <RecipeBlock
      kind="drink"
      id={drink.cocktailId}
      name={drink.name}
      section={drink.section}
      href={drinkHref(drink.cocktailId)}
      yieldServes={drink.yieldServes}
      uses={drink.uses}
      cost={drink.cost}
      price={drink.price}
      canManage={canManage}
      currency={currency}
    />
  );
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

type UsedGroup<T> = ItemUsedInGroup<T>;
const read = <T,>(g: UsedGroup<T> | undefined): g is UsedGroup<T> & { lines: T[] } => !!g && g.readable && g.lines !== null;

/**
 * The two drink groups, drawn so they never contradict each other (R7). Each
 * returned group is null when it is left out.
 */
export function drinkGroups<C extends { cocktailId: string }, D extends { cocktailId: string }>(
  cards: UsedGroup<C>,
  recipes: UsedGroup<D> | undefined,
): { cards: UsedGroup<C> | null; recipes: UsedGroup<D> | undefined | null } {
  if (!read(cards) || !read(recipes)) {
    // One side unread: the read side is drawn as it is, and None there is only its own.
    return { cards, recipes };
  }
  const inRecipes = new Set(recipes.lines.map((d) => d.cocktailId));
  const onlyOnCards = cards.lines.filter((c) => !inRecipes.has(c.cocktailId));
  if (recipes.lines.length > 0) {
    return { cards: onlyOnCards.length > 0 ? { ...cards, lines: onlyOnCards } : null, recipes };
  }
  // No recipe line: the cards answer alone, or one None is said under the recipes.
  return cards.lines.length > 0 ? { cards, recipes: null } : { cards: null, recipes };
}

export const DRINK_RECIPES_SOURCE = 'Drinks whose current recipe has a line linked to this item.';

export default function ItemUsedIn({
  load,
  dishes,
  drinks,
  canManage,
  currency,
  onRetry,
  onRetryDishes,
  onRetryDrinks,
}: {
  load: UsedInLoad;
  dishes: DishesLoad;
  /** The drinks with their figures; absent, the drinks are the used-in read's lines alone. */
  drinks?: DrinksLoad;
  canManage: boolean;
  currency: HouseCurrency;
  onRetry: () => void;
  onRetryDishes: () => void;
  onRetryDrinks?: () => void;
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
    const { soldAs, namedNotLinked } = load.data;
    // Once the drinks' figures are read they are the list; until then, or when
    // that read failed, the used-in read's lines are (one rule, two reads).
    const figured = drinks?.status === 'ready' ? drinks.data.drinks : null;
    const recipeSource =
      figured !== null ? { readable: true, lines: figured, source: DRINK_RECIPES_SOURCE } : load.data.inDrinkRecipes;
    // A figured drink stands in for a used-in line here only to be grouped; it is drawn by DrinkBlock.
    const groups = drinkGroups(load.data.inCocktails, recipeSource as UsedIn['inDrinkRecipes']);
    const inCocktails = groups.cards;
    const inDrinkRecipes = groups.recipes;
    const figuredRecipes = figured !== null && inDrinkRecipes !== null ? figured : null;
    const drinksFailed =
      drinks?.status === 'failed' ? (
        <p className="iv-note" role="alert" data-testid="ivd-used-drink-figures-unread">
          Their cost, price and pour cost could not be read — {drinks.reason}.{' '}
          {onRetryDrinks ? (
            <button type="button" className="iv-linkish iv-focus" onClick={onRetryDrinks}>
              Read again
            </button>
          ) : null}
        </p>
      ) : null;
    body = (
      <>
        <Group title="Sold as" testid="ivd-used-sold" group={soldAs} line={menu} />
        {inCocktails ? (
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
        ) : null}
        {figuredRecipes !== null && figuredRecipes.length > 0 ? (
          <section className="ivd-used-g" data-testid="ivd-used-drink-recipes">
            <h4 className="ivd-used-h">In drink recipes</h4>
            <p className="iv-note">{DRINKS_DO_NOT_DRAW}</p>
            {figuredRecipes.map((d) => (
              <DrinkBlock key={d.cocktailId} drink={d} canManage={canManage} currency={currency} />
            ))}
          </section>
        ) : inDrinkRecipes === null ? null : (
        <>
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
        {drinksFailed}
        </>
        )}
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
        {dishes.status === 'reading' ? (
          <p className="iv-note">Reading which dishes use it…</p>
        ) : dishes.status === 'failed' ? (
          <p className="iv-note" role="alert">
            Which dishes use this good could not be read — {dishes.reason}.{' '}
            <button type="button" className="iv-linkish iv-focus" onClick={onRetryDishes}>
              Read again
            </button>
          </p>
        ) : dishes.data.dishes.length === 0 ? (
          <>
            <p className="iv-said" data-testid="ivd-used-recipes-none">
              None.
            </p>
            <p className="iv-note">No dish&apos;s current recipe uses this good.</p>
          </>
        ) : (
          dishes.data.dishes.map((d) => <DishBlock key={d.dishId} dish={d} canManage={canManage} currency={currency} />)
        )}
      </section>
    </section>
  );
}
