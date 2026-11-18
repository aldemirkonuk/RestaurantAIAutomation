/**
 * /dishes (ADR 0366): the house's dishes, each with a recipe on the drinks'
 * recipe engine. One row per dish; opening one mounts the same RecipeSheet the
 * cocktails use. Owner and manager see money and may add a dish; staff read
 * the list and the recipes with no money (the gateway sends them none).
 *
 * A failed read says why and never "No dishes yet." (ADR 0020).
 * `?open=<id>` opens that dish (the inventory drawer links here); the query
 * follows the open row with `replace`, so Back leaves the page.
 *
 * An editor changes an open dish's name, section and price, or takes it off
 * the list (its recipe versions are kept), in the open row above its sheet.
 * A price is typed as text: "12,50" and "12.50" both read as 12.5, and a
 * price that cannot be read is said, never dropped (a number field read
 * "12,50" as empty and saved the dish with no price).
 *
 * A cost a plate priced partly from stock without a verified invoice says so
 * under the figure ("partly invoiced"), as the dish's own cost card does; the
 * food cost share is written in the house's form ("%33,3" in a lira house),
 * as the inventory drawer writes it (r28 recipes audit, gaps 13 and 15).
 *
 * A "Menu" column beside the price shows what the house's current menu gives
 * a line of the dish's name, and "differs" when the two disagree (gap 2).
 * Only while a menu is current; an unread menu is said once above the list.
 *
 * Above the add form, an owner or manager is offered the current menu's
 * dishes that are not on the list yet, all in one step (MenuDishesOffer;
 * r28 onboarding audit, gap 1, slice 3).
 *
 * Every role sees an Allergens column, and can check one allergen: the rows
 * that state it free are hidden, every other row stays (ListAllergens; r36
 * recipes audit, gap 8).
 *
 * An opened dish whose sheet would land off the screen (a link, or a dish just
 * added, far down the list) is scrolled into view, as on /cocktails.
 *
 * The names and the figures are two reads (r41 recipes audit, gaps 2 and 3),
 * as on /cocktails: the list shows as soon as the names are read, its cost
 * cells say "…" while the figures are read, and a failed figures read blanks
 * only the figures and says so once above the list, never the names.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, Plus } from 'lucide-react';
import RecipeSheet from '../cellar/next/recipe/RecipeSheet';
import { pourCostShare } from '../cellar/next/recipe/DrinkCards';
import { PRICE_UNREAD, priceText, readPrice } from '../cellar/next/recipe/price-text';
import { useHousePercent, type SayPercent } from '../cellar/next/recipe/useHousePercent';
import { reason, useCanEditRecipe, useCreateDish, useDishFigures, useDishes, useHouseMoney, useMenuPrices, useRemoveDish, useUpdateDish } from '../cellar/next/recipe/useRecipe';
import { MENU_PRICES_UNREAD, MenuPriceCell } from '../cellar/next/recipe/MenuPriceCell';
import { bringIntoView } from '../cellar/next/recipe/bringIntoView';
import MenuDishesOffer from './MenuDishesOffer';
import { dishMatches, sectionsOf } from './fold';
import { AllergenCell, AllergenCheck, keptFor } from '../cellar/next/recipe/ListAllergens';
import { CostWaits, NoRecipeYet } from '../cellar/next/recipe/ListCostWaits';
import type { DishFigureRow, DishListRow } from '../../services/api/recipes';
import { EM, SANS } from '../cellar/next/cellar-format';
import '../cellar/next/cellar-next.css';

type Say = (n: number | null | undefined) => string;

/** Said under a cost some of whose lines are priced from part of the stock only. */
const PARTLY_INVOICED = 'partly invoiced';

/** Said once above the list when its costs could not be read; the names stay. */
export const DISH_COSTS_UNREAD = 'The dishes’ costs could not be read just now, so none is shown.';

/** Said once above the list, to every role, when the figures that carry the allergens could not be read. */
export const DISH_ALLERGENS_UNREAD = 'The dishes’ allergens could not be read just now, so none is shown.';

/** Where the figures stand: being read, read, or not readable just now. */
export type FiguresState = 'reading' | 'read' | 'unread';

function cells(d: DishListRow, f: DishFigureRow | undefined, state: FiguresState, say: Say, sayPct: SayPercent) {
  const dim = <span className="cl-dim">{EM}</span>;
  const price = d.price != null ? say(d.price) : 'No price';
  // While the figures are read the cell says so; "—" is a dish with no recipe.
  if (state === 'reading') {
    const reading = (cell: 'cost' | 'share') => (
      <span className="cl-dim" title="Reading the costs" data-testid={`dish-${cell}-reading-${d.id}`}>
        …
      </span>
    );
    return { price, cost: reading('cost'), share: reading('share') };
  }
  if (state === 'unread' || !f || !f.hasRecipe) return { price, cost: dim, share: dim };
  const share = pourCostShare(f.cost, d.price);
  const per = f.cost?.complete ? f.cost.perServe : null;
  // `partial` counts priced lines whose invoice cost covers only part of the
  // stock (bought another way, invoiced at 0, or not yet verified).
  const part = f.cost?.partial ?? 0;
  return {
    price,
    cost:
      per == null ? (
        <>
          Not known
          <CostWaits id={d.id} cost={f.cost} />
        </>
      ) : part > 0 ? (
        <>
          {say(per)}
          <span className="cl-dim" style={{ display: 'block', fontSize: 11 }} data-testid={`dish-partly-${d.id}`}>
            {PARTLY_INVOICED}
          </span>
        </>
      ) : (
        say(per)
      ),
    share: 'pct' in share ? sayPct(share.pct) : 'Not known',
  };
}

function SectionList({ id, sections }: { id: string; sections: string[] }) {
  return (
    <datalist id={id}>
      {sections.map((s) => (
        <option key={s} value={s} />
      ))}
    </datalist>
  );
}

function AddDish({ onAdded, sections }: { onAdded: (id: string) => void; sections: string[] }) {
  const create = useCreateDish();
  const [name, setName] = useState('');
  const [section, setSection] = useState('');
  const [price, setPrice] = useState('');
  const [said, setSaid] = useState<string | null>(null);
  // Each field names itself by `for`/`id`, not only by sitting inside its label:
  // some readers and voice-control tools name a wrapped input as a bare "textbox".
  const id = useId();
  const read = readPrice(price);
  const priceNum = read.price ?? undefined;
  const priceBad = read.bad;
  const blocked = name.trim() === '' || priceBad || create.isPending;

  const submit = async () => {
    if (blocked) return;
    setSaid(null);
    try {
      const made = await create.mutateAsync({
        name: name.trim(),
        ...(section.trim() ? { section: section.trim() } : {}),
        ...(priceNum !== undefined ? { price: priceNum } : {}),
      });
      setName('');
      setSection('');
      setPrice('');
      onAdded(made.id);
    } catch (e) {
      setSaid(`Nothing was written: ${reason(e)}`);
    }
  };

  return (
    <form
      className="cl-panel"
      data-testid="dish-add"
      aria-label="Add a dish"
      style={{ marginTop: 12, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label htmlFor={`${id}-name`}>
        Dish name
        <input id={`${id}-name`} className="cl-field cl-focus" aria-required="true" value={name} maxLength={200} onChange={(e) => { setName(e.target.value); setSaid(null); }} />
      </label>
      <label htmlFor={`${id}-section`}>
        Section
        <input id={`${id}-section`} className="cl-field cl-focus" list={sections.length ? `${id}-sections` : undefined} value={section} maxLength={100} onChange={(e) => { setSection(e.target.value); setSaid(null); }} />
        {sections.length ? <SectionList id={`${id}-sections`} sections={sections} /> : null}
      </label>
      <label htmlFor={`${id}-price`}>
        Price
        <input
          id={`${id}-price`}
          className="cl-field cl-focus cl-num"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={price}
          aria-invalid={priceBad}
          aria-describedby={priceBad ? `${id}-price-said` : undefined}
          onChange={(e) => { setPrice(e.target.value); setSaid(null); }}
        />
      </label>
      {priceBad ? (
        <p id={`${id}-price-said`} className="cl-note" style={{ gridColumn: '1 / -1' }}>
          {PRICE_UNREAD}
        </p>
      ) : null}
      <button type="submit" className="cl-btn cl-focus" disabled={blocked} style={{ alignSelf: 'end' }}>
        <Plus size={13} aria-hidden />
        Add dish
      </button>
      {said ? (
        <p className="cl-note" role="alert" style={{ gridColumn: '1 / -1' }}>
          {said}
        </p>
      ) : null}
    </form>
  );
}

/**
 * The open dish's own name, section and price, and taking it off the list.
 * Mounted with `key={dish.id}`, so one dish's draft never saves into another.
 */
function DishDetails({ dish, onRemoved, sections }: { dish: DishListRow; onRemoved: () => void; sections: string[] }) {
  const update = useUpdateDish(dish.id);
  const remove = useRemoveDish(dish.id);
  const [name, setName] = useState(dish.name);
  const [section, setSection] = useState(dish.section ?? '');
  const [price, setPrice] = useState(priceText(dish.price));
  const [said, setSaid] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const id = useId();

  const read = readPrice(price);
  const change: { name?: string; section?: string | null; price?: number | null } = {};
  const nameT = name.trim().replace(/\s+/g, ' ');
  if (nameT !== dish.name) change.name = nameT;
  const sectionT = section.trim() || null;
  if (sectionT !== (dish.section ?? null)) change.section = sectionT;
  if (!read.bad && read.price !== dish.price) change.price = read.price;
  const changed = Object.keys(change).length > 0;
  const blocked = nameT === '' || read.bad || !changed || update.isPending;

  const save = async () => {
    if (blocked) return;
    setSaid(null);
    try {
      await update.mutateAsync(change);
      setSaid('Saved.');
    } catch (e) {
      setSaid(`Nothing was changed: ${reason(e)}`);
    }
  };
  const takeOff = async () => {
    setSaid(null);
    try {
      await remove.mutateAsync();
      onRemoved();
    } catch (e) {
      setAsking(false);
      setSaid(`It is still on your list: ${reason(e)}`);
    }
  };

  return (
    <form
      className="cl-panel"
      data-testid={`dish-details-${dish.id}`}
      aria-label={`Change ${dish.name}`}
      style={{ marginBottom: 12, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label htmlFor={`${id}-name`}>
        Dish name
        <input id={`${id}-name`} className="cl-field cl-focus" aria-required="true" value={name} maxLength={200} onChange={(e) => { setName(e.target.value); setSaid(null); }} />
      </label>
      <label htmlFor={`${id}-section`}>
        Section
        <input id={`${id}-section`} className="cl-field cl-focus" list={sections.length ? `${id}-sections` : undefined} value={section} maxLength={100} onChange={(e) => { setSection(e.target.value); setSaid(null); }} />
        {sections.length ? <SectionList id={`${id}-sections`} sections={sections} /> : null}
      </label>
      <label htmlFor={`${id}-price`}>
        Price
        <input
          id={`${id}-price`}
          className="cl-field cl-focus cl-num"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={price}
          aria-invalid={read.bad}
          onChange={(e) => { setPrice(e.target.value); setSaid(null); }}
        />
      </label>
      <button type="submit" className="cl-btn cl-focus" disabled={blocked} style={{ alignSelf: 'end' }}>
        Save changes
      </button>
      {read.bad ? (
        <p className="cl-note" style={{ gridColumn: '1 / -1' }}>{PRICE_UNREAD}</p>
      ) : price.trim() === '' && dish.price != null ? (
        <p className="cl-note" style={{ gridColumn: '1 / -1' }}>A blank price saves the dish with no price.</p>
      ) : null}
      <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {asking ? (
          <>
            <span className="cl-said">Take {dish.name} off your list? Its recipe history is kept.</span>
            <button type="button" className="cl-btn cl-focus" disabled={remove.isPending} onClick={() => void takeOff()}>
              Yes, take it off
            </button>
            <button type="button" className="cl-btn cl-focus" onClick={() => setAsking(false)}>
              Keep it
            </button>
          </>
        ) : (
          <button type="button" className="cl-btn cl-focus" onClick={() => setAsking(true)}>
            Take off the list
          </button>
        )}
      </div>
      {said ? (
        <p className="cl-note" role={said === 'Saved.' ? 'status' : 'alert'} style={{ gridColumn: '1 / -1' }}>
          {said}
        </p>
      ) : null}
    </form>
  );
}

export default function DishesPage() {
  const dishes = useDishes();
  const figures = useDishFigures();
  const canEdit = useCanEditRecipe();
  const sayMoney = useHouseMoney();
  const sayPct = useHousePercent();
  const say = canEdit ? sayMoney : null;
  const menu = useMenuPrices('dish', canEdit);
  const showMenu = Boolean(say && menu.byId && (menu.currentMenus ?? 0) > 0);
  const [params, setParams] = useSearchParams();
  const asked = params.get('open');
  const [allergen, setAllergen] = useState('');
  const [query, setQuery] = useState('');
  const all = dishes.data ?? [];
  const sections = sectionsOf(all);
  const [onlyBare, setOnlyBare] = useState(false);
  const fig = (id: string) => figures.byId?.get(id);
  const figState: FiguresState = figures.loading ? 'reading' : !figures.byId || figures.costsUnread ? 'unread' : 'read';
  const searched = all.filter((d) => dishMatches(d, query));
  const byAllergen = searched.filter((d) => keptFor(fig(d.id)?.allergens, allergen));
  // Which dishes have no recipe is known only once the figures are read.
  const bareIds = figures.byId ? all.filter((d) => !fig(d.id)?.hasRecipe).map((d) => d.id) : [];
  const rows = canEdit && onlyBare ? byAllergen.filter((d) => bareIds.includes(d.id)) : byAllergen;
  const openId = rows.some((d) => d.id === asked) ? asked : null;
  // A link (the inventory drawer's "used in" lines) to a dish that opens nothing
  // says why, as /cocktails does: it is not on the list, or the search or a check hides it.
  const linkNote =
    asked && dishes.data
      ? !all.some((d) => d.id === asked)
        ? 'missing'
        : openId === null
          ? 'hidden'
          : null
      : null;

  const open = (id: string | null) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (id) next.set('open', id);
        else next.delete('open');
        return next;
      },
      { replace: true },
    );
  const toggle = (id: string) => open(id === openId ? null : id);
  // An opened dish (by a click, a link, or just added) can sit far down the
  // list; its sheet is brought into view when its heading would land off the
  // screen, once per dish opened, as /cocktails does (r41 recipes audit, gap 7).
  const leafRef = useRef<HTMLTableRowElement | null>(null);
  useEffect(() => {
    if (openId) bringIntoView(leafRef.current);
  }, [openId]);
  const cols = (say ? 6 : 3) + (showMenu ? 1 : 0);

  return (
    <div className="mudavym min-h-full" style={{ background: 'var(--paper-0)', color: 'var(--ink-1)', fontFamily: SANS }}>
      <div style={{ margin: '0 auto', maxWidth: 1200, padding: '22px 16px 40px' }} data-testid="dishes-page">
        <h1 className="cl-h1">Dishes.</h1>
        <p className="cl-said" style={{ marginTop: 8 }}>
          Each dish has a recipe, costed from your shelf the way a drink is.
        </p>

        {canEdit ? <MenuDishesOffer /> : null}
        {canEdit ? <AddDish onAdded={open} sections={sections} /> : null}

        {say && menu.error ? (
          <p className="cl-said" role="status" style={{ marginTop: 12 }} data-testid="dishes-menu-unread">
            {MENU_PRICES_UNREAD}
          </p>
        ) : null}

        {linkNote === 'missing' ? (
          <p className="cl-said" role="status" style={{ marginTop: 12 }} data-testid="dishes-link-missing">
            The dish that link names is not on this house’s list. It may have been taken off it.
          </p>
        ) : null}
        {linkNote === 'hidden' ? (
          <p className="cl-said" role="status" style={{ marginTop: 12 }} data-testid="dishes-link-hidden">
            The dish that link names is on your list, but the search or a check above hides it.
          </p>
        ) : null}

        {dishes.loading ? (
          <p className="cl-said" role="status" style={{ marginTop: 12 }}>Reading the dishes…</p>
        ) : !dishes.data ? (
          <div style={{ marginTop: 12 }} data-testid="dishes-unread">
            <p className="cl-said" role="alert">
              <AlertTriangle size={13} aria-hidden style={{ verticalAlign: '-2px', marginRight: 5 }} />
              The dishes could not be read ({dishes.error ?? 'no reason given'}). They are unread, not absent.
            </p>
            <button type="button" className="cl-btn cl-focus" onClick={() => void dishes.refetch()}>
              Read again
            </button>
          </div>
        ) : all.length === 0 ? (
          <p className="cl-said" style={{ marginTop: 12 }} data-testid="dishes-empty">No dishes yet.</p>
        ) : (
          <>
          {say && (figures.error || figures.costsUnread) ? (
            <p className="cl-said" role="status" style={{ marginTop: 12 }} data-testid="dishes-costs-unread">
              {DISH_COSTS_UNREAD}
            </p>
          ) : null}
          {figures.error ? (
            <p className="cl-said" role="status" style={{ marginTop: 12 }} data-testid="dishes-allergens-unread">
              {DISH_ALLERGENS_UNREAD}
            </p>
          ) : null}
          {canEdit ? <NoRecipeYet bare={bareIds.length} of={all.length} noun="dishes" only={onlyBare} onOnly={setOnlyBare} /> : null}
          <div className="cl-row-controls" style={{ marginTop: 12 }}>
            <label htmlFor="dishes-search" className="cl-sr">Search this house’s dishes</label>
            <input
              id="dishes-search"
              className="cl-field cl-focus"
              type="search"
              placeholder="Search dish or section…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ minWidth: 220, flex: '1 1 220px' }}
            />
          </div>
          {query.trim() && searched.length === 0 ? (
            <p className="cl-said" role="status" style={{ marginTop: 12 }} data-testid="dishes-search-none">
              No dish matches “{query.trim()}”. {all.length} {all.length === 1 ? 'dish is' : 'dishes are'} on your list.
            </p>
          ) : null}
          <AllergenCheck value={allergen} onChange={setAllergen} hidden={searched.length - byAllergen.length} noun="dishes" />
          <div style={{ marginTop: 12, overflowX: 'auto', border: '1px solid var(--paper-2)', borderRadius: 10 }}>
            <table className="cl-table">
              <thead>
                <tr>
                  <th scope="col">Dish</th>
                  <th scope="col">Section</th>
                  {say ? <th scope="col" style={{ textAlign: 'right' }}>Price</th> : null}
                  {showMenu ? <th scope="col" style={{ textAlign: 'right' }}>Menu</th> : null}
                  {say ? <th scope="col" style={{ textAlign: 'right' }}>Cost per plate</th> : null}
                  {say ? <th scope="col" style={{ textAlign: 'right' }}>Food cost</th> : null}
                  <th scope="col">Allergens</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => {
                  const f = fig(d.id);
                  const c = say ? cells(d, f, figState, say, sayPct) : null;
                  return [
                    <tr
                      key={d.id}
                      data-testid={`dish-row-${d.id}`}
                      data-selected={d.id === openId}
                      aria-expanded={d.id === openId}
                      tabIndex={0}
                      onClick={() => toggle(d.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggle(d.id);
                        }
                      }}
                    >
                      <td>
                        <span className="cl-serif" style={{ display: 'block', fontWeight: 600, fontSize: 13.5 }}>{d.name}</span>
                        {figures.byId && !f?.hasRecipe ? <span className="cl-dim" style={{ fontSize: 11 }}>No recipe yet</span> : null}
                      </td>
                      <td>{d.section ?? <span className="cl-dim">{EM}</span>}</td>
                      {c ? <td className="cl-num" style={{ textAlign: 'right' }}>{c.price}</td> : null}
                      {showMenu && say ? (
                        <td className="cl-num" style={{ textAlign: 'right' }} data-testid={`dish-menu-${d.id}`}>
                          <MenuPriceCell id={d.id} menu={menu.byId?.get(d.id)} say={say} />
                        </td>
                      ) : null}
                      {c ? <td className="cl-num" style={{ textAlign: 'right' }}>{c.cost}</td> : null}
                      {c ? <td className="cl-num" style={{ textAlign: 'right' }}>{c.share}</td> : null}
                      <AllergenCell id={d.id} a={f?.allergens} />
                    </tr>,
                    d.id === openId ? (
                      <tr key={`${d.id}-leaf`} data-testid={`dish-leaf-${d.id}`} ref={leafRef}>
                        <td colSpan={cols}>
                          {canEdit ? <DishDetails key={d.id} dish={d} onRemoved={() => open(null)} sections={sections} /> : null}
                          <RecipeSheet dishId={d.id} />
                        </td>
                      </tr>
                    ) : null,
                  ];
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>
    </div>
  );
}
