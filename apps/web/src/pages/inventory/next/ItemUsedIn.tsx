/**
 * "Used in" — where one item goes (proposal §2 S2 item 4, §3 I15).
 *
 * Three groups from GET /inventory/:rid/item/:id/used-in, by how sure the link
 * is: menu lines linked to the item, the house's cocktails that name it, and
 * menu lines that only carry its name. The last group is never counted in
 * usage. A group whose read failed says so; it is never drawn as empty (ADR
 * 0067). An owner or manager links an unlinked line from here (r109 g2,
 * POST …/used-in/link): "Link to this good", then a sentence naming the line,
 * its menu and what the link changes, then "Link it". The line then moves into
 * "Sold as", and the groups hold their height for one frame so nothing under
 * them jumps.
 *
 * "At the till" (r109 g3) lists the till buttons mapped to the good, which
 * are what move its stock on a sale: "Gin & Tonic · by the glass · Square".
 * No money is in it, so staff see it too; a manager can open Map POS buttons.
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
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useInRouterContext } from 'react-router-dom';
import HeldReading from './HeldReading';
import type { ItemMenuLine, ItemTillButton, ItemUsedIn as UsedIn, ItemUsedInGroup } from '../../../services/api/inventory';
import {
  dishHref,
  type ItemDish,
  type ItemDishCost,
  type ItemDishes,
  type ItemDrink,
  type ItemDrinks,
  type ItemGoodShare,
  type ItemServes,
  type ItemThroughComponent,
  type ItemThroughOwner,
  type ServesWhy,
} from '../../../services/api/itemDishes';
import { cellMoney, type HouseCurrency } from './useInventoryNextData';
// A share in the house's form, as its money is: "%13,1" beside "₺12,00" (r23 walk).
import { formatHouseNumber, formatHousePercent } from '../../../lib/house-number';
import { pourCostShare } from '../../cellar/next/recipe/DrinkCards';
import { UNSET_TAX, shareBasis, type ListTax } from '../../cellar/next/recipe/listTax';

export type UsedInLoad = { status: 'reading' } | { status: 'failed'; reason: string } | { status: 'ready'; data: UsedIn };

export type DishesLoad = { status: 'reading' } | { status: 'failed'; reason: string } | { status: 'ready'; data: ItemDishes };

export type DrinksLoad = { status: 'reading' } | { status: 'failed'; reason: string } | { status: 'ready'; data: ItemDrinks };

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
export function fmtRecipeQty(n: number, code: string | null = null): string {
  return formatHouseNumber(n, code, { max: 2 });
}

/**
 * A recipe's card mounts from a read that has landed, so it has nothing to
 * wait for: it holds no height (data-settled releases the 94 px floor the
 * drawer's own cards keep while they read), and the room under a short card is
 * not left blank (r106 walk, a ~40 px band at 375; r107 g3).
 */
function DishCard({ id, title, value, sub, warn }: { id: string; title: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className="ivd-card" data-testid={id} data-settled="true">
      <span className="ivd-card-k">{title}</span>
      <span className="ivd-card-v" data-warn={warn ? 'true' : undefined}>{value}</span>
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

/** Why the serves the stock makes are not known, in the house's words; never 0. */
export const SERVES_WHY: Record<ServesWhy, string> = {
  size_not_known: 'the bottle size is not recorded',
  pack_size_not_known: 'what one pack holds is not recorded',
  unit_mismatch: 'the recipe measures it another way than the shelf counts it',
  no_yield: 'the recipe does not say how many it makes',
  stock_unread: 'the stock on hand could not be read',
  never_counted: 'the stock has not been counted or received yet',
};

/**
 * "From stock": how many serves (plates) the stock on hand makes, the
 * theoretical use run in reverse (r108 g11). A quantity, not money, so every
 * role sees it. Unknown is "Not known" with why, never 0; 0 is said only when
 * the shelf holds less than one.
 */
export function servesFromStockWords(
  s: ItemServes,
  kind: 'dish' | 'drink',
  code: string | null,
): { value: string; sub?: string } {
  const one = kind === 'dish' ? 'plate' : 'serve';
  const n = s.servesFromStock;
  if (n === null || n === undefined) return { value: 'Not known', sub: s.servesWhy ? SERVES_WHY[s.servesWhy] : undefined };
  if (n === 0) return { value: `Not enough for one ${one}` };
  return { value: `Enough for ${formatHouseNumber(n, code, { digits: 0 })} ${n === 1 ? one : `${one}s`}` };
}

/**
 * "This good": its share of the serve's cost (r108 g17), so the drawer says
 * which recipes this good drives. A share of the priced part says so; an
 * unpriced line of this good is "Not priced", never 0 %.
 */
export function goodShareWords(s: ItemGoodShare, code: string | null): { value: string; sub?: string } {
  if (s.unpriced) return { value: 'Not priced', sub: 'this good has no price yet' };
  if (s.pct === null) return { value: 'Not known' };
  const value = formatHousePercent(s.pct, code, { digits: 0 });
  return { value, sub: s.ofPricedPart ? `of the priced part (${s.priced} of ${s.of} lines)` : 'of the cost' };
}

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
  tax,
  serves,
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
  tax: ListTax;
  serves: ItemServes & { goodShare?: ItemGoodShare | null };
}) {
  const w = RECIPE_WORDS[kind];
  const fromStock = serves.servesFromStock === undefined ? null : servesFromStockWords(serves, kind, currency.code);
  const goodShare = canManage && serves.goodShare ? goodShareWords(serves.goodShare, currency.code) : null;
  const t = `ivd-${kind}-${id}`;
  const known = y !== null && y > 0;
  const perServe = known ? uses.map((u) => `${fmtRecipeQty(u.qtyEntered / y, currency.code)} ${u.unitCode}`).join(' + ') : '';
  const share = pourCostShare(cost, price, tax);
  const basis = shareBasis(tax);
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
        {fromStock ? <DishCard id={`${t}-from-stock`} title="From stock" value={fromStock.value} sub={fromStock.sub} /> : null}
        {canManage && cost !== null ? (
          <DishCard
            id={`${t}-cost`}
            title={w.cost}
            value={cost.complete ? cellMoney(cost.perServe, currency) : 'Not known'}
            sub={cost.complete ? undefined : `${cost.priced} of ${cost.of} lines priced`}
          />
        ) : null}
        {goodShare ? <DishCard id={`${t}-good-share`} title="This good" value={goodShare.value} sub={goodShare.sub} /> : null}
        {canManage ? (
          <DishCard id={`${t}-price`} title="Price" value={price !== null ? cellMoney(price, currency) : w.noPrice} />
        ) : null}
        {canManage ? (
          <DishCard
            id={`${t}-${w.shareId}`}
            title={w.share}
            value={'pct' in share ? formatHousePercent(share.pct, currency.code) : 'Not known'}
            warn={'pct' in share && basis.warn}
            sub={'pct' in share ? basis.text : share.missing.join(' and ')}
          />
        ) : null}
      </div>
    </div>
  );
}

export const THROUGH_UNREAD = 'Which recipes draw this good through something the house makes could not be read.';

/** The good in one serve, in the unit a person reads: 28571 mg is 28.6 g, 400 ml10 is 40 ml. */
export function throughQty(q: number, unit: ItemThroughOwner['baseUnit'], code: string | null): string {
  const n = (x: number) => formatHouseNumber(x, code, { max: 1 });
  if (unit === 'mg') return q >= 1000 ? `${n(q / 1000)} g` : `${n(q)} mg`;
  if (unit === 'ml10') return q >= 10_000 ? `${n(q / 10_000)} l` : `${n(q / 10)} ml`;
  return `${n(q / 1000)} each`;
}

/** Why a serve's amount is not said, naming the component (or, deeper, what it is made from). */
export function throughWhyWords(o: ItemThroughOwner, c: ItemThroughComponent): string {
  const of = c.level > 1 ? `${c.componentName} or what it is made from` : c.componentName;
  switch (o.why) {
    case 'no_yield':
      return `how much is not known: ${of} has no yield set`;
    case 'unit_mismatch':
      return `how much is not known: it is measured in another unit than ${of} is made in`;
    case 'no_serves':
      return `how much is not known: ${o.name} does not say how many serves it makes`;
    case 'cycle':
      return `how much is not known: ${c.componentName} and what it is made from draw each other`;
    default:
      return 'how much is not known';
  }
}

/**
 * "Drawn by: Daiquiri 28.6 g a serve · Mojito 14.3 g a serve" under a
 * component's dish row (r110 g1), then the same for any component made from
 * it, one level down each, never twice. Quantities only: every role.
 */
function DrawnBy({ c, through, code, seen }: { c: ItemThroughComponent; through: ItemThroughComponent[]; code: string | null; seen: Set<string> }) {
  const deeper = c.owners
    .filter((o) => o.kind === 'dish')
    .map((o) => through.find((x) => x.componentId === o.id && x.level > c.level))
    .filter((x): x is ItemThroughComponent => !!x && !seen.has(x.componentId));
  for (const x of deeper) seen.add(x.componentId);
  return (
    <>
      <p className="iv-note ivd-drawn" data-testid={`ivd-drawn-${c.componentId}`}>
        {c.level > 1 ? `${c.componentName} is drawn by: ` : 'Drawn by: '}
        {c.owners.map((o, i) => (
          <span key={`${o.kind}-${o.id}`}>
            {i > 0 ? ' · ' : null}
            <LineLink to={o.kind === 'dish' ? dishHref(o.id) : drinkHref(o.id)}>{o.name}</LineLink>{' '}
            {o.perServeQtyBase !== null ? `${throughQty(o.perServeQtyBase, o.baseUnit, code)} a serve` : throughWhyWords(o, c)}
          </span>
        ))}
      </p>
      {deeper.map((x) => (
        <DrawnBy key={x.componentId} c={x} through={through} code={code} seen={seen} />
      ))}
    </>
  );
}

function DishBlock({ dish, canManage, currency, tax }: { dish: ItemDish; canManage: boolean; currency: HouseCurrency; tax: ListTax }) {
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
      tax={tax}
      serves={dish}
    />
  );
}

function DrinkBlock({ drink, canManage, currency, tax }: { drink: ItemDrink; canManage: boolean; currency: HouseCurrency; tax: ListTax }) {
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
      tax={tax}
      serves={drink}
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
  act,
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
  /** What a person may do with one line, drawn under it (the unlinked group's Link). */
  act?: (l: T) => ReactNode;
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
              {act ? act(l) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Link one unlinked line (r109 g2): the button, then the sentence that says
 * what linking changes, then the act. A refusal (another name, already linked
 * by another good, no longer current) is said under it and links nothing.
 */
function LinkLine({ line, good, onLink }: { line: ItemMenuLine; good: string; onLink: (menuItemId: string) => Promise<void> }) {
  const [phase, setPhase] = useState<'idle' | 'confirm' | 'busy'>('idle');
  const [refused, setRefused] = useState<string | null>(null);
  if (phase === 'idle') {
    return (
      <button type="button" className="iv-btn iv-focus ivd-link-btn" onClick={() => setPhase('confirm')}>
        Link to this good
      </button>
    );
  }
  const menu = line.menuName ? `the menu “${line.menuName}”` : 'the current menu';
  return (
    <div className="ivd-link-confirm" role="group" aria-label={`Link ${line.name} to ${good}`}>
      <p className="iv-said" data-testid="ivd-link-sentence">
        Link “{line.name}” on {menu} to {good}? It then counts as {good} on the current menu, and a later price or name
        correction on that line sets {good}’s menu price or name. A menu made current later does not carry this link.
      </p>
      {refused ? (
        <p className="iv-note" role="alert">
          {refused}
        </p>
      ) : null}
      <button
        type="button"
        className="iv-btn iv-focus ivd-link-btn"
        data-seal="true"
        disabled={phase === 'busy'}
        onClick={() => {
          setPhase('busy');
          setRefused(null);
          onLink(line.menuItemId).catch((e: unknown) => {
            setRefused(e instanceof Error && e.message ? e.message : 'The line could not be linked. Nothing was linked.');
            setPhase('confirm');
          });
        }}
      >
        {phase === 'busy' ? 'Linking…' : 'Link it'}
      </button>{' '}
      <button type="button" className="iv-btn iv-focus ivd-link-btn" disabled={phase === 'busy'} onClick={() => setPhase('idle')}>
        Not now
      </button>
    </div>
  );
}

const TILL_WORDS: Record<string, string> = { '*': 'every till', square: 'Square', toast: 'Toast', clover: 'Clover', lightspeed: 'Lightspeed' };
const SALE_UNIT_WORDS: Record<string, string> = { glass: 'by the glass', bottle: 'by the bottle' };

/** "Gin & Tonic · by the glass · Square": the button, how it sells, which till. */
export function tillButtonWords(b: ItemTillButton): string {
  const till = TILL_WORDS[b.source.toLowerCase()] ?? b.source.charAt(0).toUpperCase() + b.source.slice(1);
  return [b.itemName || 'A button with no name', b.saleUnit ? SALE_UNIT_WORDS[b.saleUnit] ?? b.saleUnit : null, till]
    .filter(Boolean)
    .join(' · ');
}

export const TILL_NONE = 'No till button draws this good, so a till sale does not move it.';
export const TILL_FOOD = 'A dish sale does not draw its foods yet.';
export const TILL_RECIPE = 'A button pointed at a recipe is not listed here; recipes are not drawn at the till yet.';
export const TILL_UNREAD = 'Which till buttons draw this good could not be read here.';

/** The till buttons that draw this good down on a sale (r109 g3). An older gateway's absent group is unread. */
function AtTheTill({ group, kind, onMapTill }: { group: ItemUsedInGroup<ItemTillButton> | undefined; kind: string | null; onMapTill?: () => void }) {
  const read = !!group && group.readable && group.lines !== null;
  const lines = read ? (group.lines ?? []) : [];
  return (
    <section className="ivd-used-g" data-testid="ivd-used-till">
      <h4 className="ivd-used-h">At the till</h4>
      {!read ? (
        <p className="iv-note">{TILL_UNREAD}</p>
      ) : lines.length === 0 ? (
        <p className="iv-said" data-testid="ivd-used-till-none">
          {TILL_NONE}
        </p>
      ) : (
        <ul className="ivd-used-list">
          {lines.map((b) => (
            <li key={b.id}>
              <span>{tillButtonWords(b)}</span>
            </li>
          ))}
        </ul>
      )}
      {read ? (
        <p className="iv-note">
          {kind === 'food' ? `${TILL_FOOD} ` : ''}
          {TILL_RECIPE}
        </p>
      ) : null}
      {onMapTill ? (
        <p className="iv-note">
          <button type="button" className="iv-linkish iv-focus ivd-till-map" onClick={onMapTill}>
            Change on Map POS buttons
          </button>
        </p>
      ) : null}
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

/** Said on a drink only the old recipe box holds: it shows, and cannot be edited here (the box no longer saves). */
export const OLD_RECIPE_BOX = 'old recipe box, read only';

export const DRINK_RECIPES_SOURCE = 'Drinks whose current recipe has a line linked to this item.';

export default function ItemUsedIn({
  load,
  dishes,
  drinks,
  canManage,
  currency,
  tax = UNSET_TAX,
  onRetry,
  onRetryDishes,
  onRetryDrinks,
  onLink,
  onMapTill,
}: {
  load: UsedInLoad;
  dishes: DishesLoad;
  /** The drinks with their figures; absent, the drinks are the used-in read's lines alone. */
  drinks?: DrinksLoad;
  canManage: boolean;
  currency: HouseCurrency;
  /** What the house says about tax in its list prices (the drawer reads it); unset when not given. */
  tax?: ListTax;
  onRetry: () => void;
  onRetryDishes: () => void;
  onRetryDrinks?: () => void;
  /** Link an unlinked line to this good (owner/manager); resolves once the fresh Used in is in place, rejects with words. */
  onLink?: (menuItemId: string) => Promise<void>;
  /** Open the house's Map POS buttons (managers only; the drawer closes first). */
  onMapTill?: () => void;
}) {
  // A link moves a line from the unlinked group into Sold as. The groups hold
  // the height they had for the one frame the move is drawn in, so the dish
  // recipes under them are not pulled up under the reader, then let go (#2284).
  const holdRef = useRef<HTMLDivElement | null>(null);
  const data = load.status === 'ready' ? load.data : null;
  useEffect(() => {
    const el = holdRef.current;
    if (!el || el.style.minHeight === '') return;
    const f = window.requestAnimationFrame(() => {
      el.style.minHeight = '';
    });
    return () => window.cancelAnimationFrame(f);
  }, [data]);
  const link =
    canManage && onLink
      ? async (menuItemId: string) => {
          const el = holdRef.current;
          if (el) el.style.minHeight = `${el.offsetHeight}px`;
          try {
            await onLink(menuItemId);
          } catch (e) {
            if (el) el.style.minHeight = '';
            throw e;
          }
        }
      : null;

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
    body = <HeldReading say="Reading where it is used…" hold="used" />;
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
      <div className="ivd-arrive">
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
            side: `${c.quantity !== null ? `${fmtRecipeQty(c.quantity, currency.code)}${c.unit ? ` ${c.unit}` : ''} · ` : ''}${OLD_RECIPE_BOX}`,
          })}
        />
        ) : null}
        {figuredRecipes !== null && figuredRecipes.length > 0 ? (
          <section className="ivd-used-g" data-testid="ivd-used-drink-recipes">
            <h4 className="ivd-used-h">In drink recipes</h4>
            <p className="iv-note">{DRINKS_DO_NOT_DRAW}</p>
            {figuredRecipes.map((d) => (
              <DrinkBlock key={d.cocktailId} drink={d} canManage={canManage} currency={currency} tax={tax} />
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
            text: `${d.name} — ${fmtRecipeQty(d.qtyEntered, currency.code)} ${d.unitCode} (${d.label})`,
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
          act={link ? (l) => <LinkLine line={l} good={load.data.item.displayName ?? 'this good'} onLink={link} /> : undefined}
        />
        <AtTheTill group={load.data.atTill} kind={load.data.item.kind} onMapTill={canManage ? onMapTill : undefined} />
      </div>
    );
  }

  return (
    <section
      id="ivd-used"
      className="ivd-used"
      aria-labelledby="ivd-used-title"
      data-testid="ivd-used"
      // Until its three reads have answered the block changes height; scroll anchoring must not pick one of its
      // groups as the anchor and move the page by the distance that group travels (r107 F9 tail, r108 g16).
      data-settling={load.status === 'reading' || dishes.status === 'reading' || drinks?.status === 'reading' ? 'true' : undefined}
    >
      <h3 id="ivd-used-title" className="iv-sec">
        Used in
      </h3>
      <div ref={holdRef} data-testid="ivd-used-hold">
        {body}
      </div>
      <section className="ivd-used-g" data-testid="ivd-used-recipes">
        <h4 className="ivd-used-h">In dish recipes</h4>
        {dishes.status === 'reading' ? (
          <HeldReading say="Reading which dishes use it…" hold="dishes" />
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
          <div className="ivd-arrive">
            {dishes.data.dishes.map((d) => {
              const through = dishes.data.through;
              const c = through?.find((x) => x.componentId === d.dishId && x.level === 1);
              return (
                <Fragment key={d.dishId}>
                  <DishBlock dish={d} canManage={canManage} currency={currency} tax={tax} />
                  {c && through ? <DrawnBy c={c} through={through} code={currency.code} seen={new Set([c.componentId])} /> : null}
                </Fragment>
              );
            })}
            {dishes.data.through === null ? (
              <p className="iv-note" role="status" data-testid="ivd-drawn-unread">
                {THROUGH_UNREAD}
              </p>
            ) : null}
          </div>
        )}
      </section>
    </section>
  );
}
