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
 * The names and the figures are two reads (r41 recipes audit, gaps 2 and 3),
 * as on /cocktails: the list shows as soon as the names are read, its cost
 * cells say "…" while the figures are read, and a failed figures read blanks
 * only the figures and says so once above the list, never the names.
 * The opened dish offers to take the menu's price, after a confirm.
 *
 * Above the list, the dishes whose price the menu states differently are
 * counted, shown, and taken all at once after one confirm (TakeMenuPrices);
 * so are the dishes the current menu prints no line of, which can be taken
 * off the list together (TakeOffMenu).
 */
import { useId, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, Plus } from 'lucide-react';
import RecipeSheet from '../cellar/next/recipe/RecipeSheet';
import { pourCostShare } from '../cellar/next/recipe/DrinkCards';
import { PRICE_UNREAD, priceText, readPrice } from '../cellar/next/recipe/price-text';
import { useHousePercent, type SayPercent } from '../cellar/next/recipe/useHousePercent';
import type { TakeOffMenuAnswer } from '../../services/api/recipes';
import { reason, useCanEditRecipe, useCreateDish, useDishFigures, useDishes, useHouseMoney, useMenuPrices, useRemoveDish, useTakeMenuPrices, useTakeOffMenu, useUpdateDish } from '../cellar/next/recipe/useRecipe';
import { MENU_PRICES_UNREAD, MenuPriceCell } from '../cellar/next/recipe/MenuPriceCell';
import MenuDishesOffer from './MenuDishesOffer';
import { dishMatches, sectionsOf } from './fold';
import { AllergenCell, AllergenCheck, keptFor } from '../cellar/next/recipe/ListAllergens';
import { CostWaits, NoRecipeYet } from '../cellar/next/recipe/ListCostWaits';
import UseMenuPrice, { menuPriceOffer } from '../cellar/next/recipe/UseMenuPrice';
import TakeMenuPrices, { type Takeable } from './TakeMenuPrices';
import type { DishFigureRow, DishListRow, MenuPrice } from '../../services/api/recipes';
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
function DishDetails({
  dish,
  onRemoved,
  sections,
  menu,
  say,
}: {
  dish: DishListRow;
  onRemoved: () => void;
  sections: string[];
  /** What the current menu says for this dish, while a menu is current and read. */
  menu?: MenuPrice;
  say?: ((n: number | null | undefined) => string) | null;
}) {
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
      {menu && say ? (
        <div style={{ gridColumn: '1 / -1' }}>
          <UseMenuPrice
            name={dish.name}
            own={dish.price}
            menu={menu}
            say={say}
            share="food cost"
            onUse={async (p) => {
              await update.mutateAsync({ price: p });
              // The box shows the price now kept, so Save has nothing left to send.
              setPrice(priceText(p));
            }}
          />
        </div>
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

/**
 * The dishes the current menu no longer prints are counted, shown, and
 * taken off the list together after one confirm (g2 menu gap). A re-uploaded
 * menu left every dish it dropped live on the list with nothing saying so.
 *
 * One line says how many; the sheet lists each by name, and one button takes
 * them all off. Nothing is written before that button; the gateway reads the
 * menu again and names every dish it leaves, which is said here in words. A
 * failed take-off says nothing came off. A dish taken off keeps its recipe's
 * saved versions.
 */
export interface OffMenu {
  id: string;
  name: string;
  section: string | null;
}

const dishCount = (n: number) => `${n} ${n === 1 ? 'dish' : 'dishes'}`;

function TakeOffMenu({
  items,
  showing,
  onShowing,
  onTakeOff,
}: {
  items: OffMenu[];
  showing: boolean;
  onShowing: (v: boolean) => void;
  onTakeOff: (ids: string[]) => Promise<TakeOffMenuAnswer>;
}) {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string; left: string[] } | null>(null);

  const takeOff = async () => {
    if (busy) return;
    setBusy(true);
    setSaid(null);
    try {
      const out = await onTakeOff(items.map((i) => i.id));
      onShowing(false);
      setSaid({
        ok: true,
        text: out.removed.length > 0 ? `${dishCount(out.removed.length)} ${out.removed.length === 1 ? 'is' : 'are'} off your list.` : 'No dish was taken off.',
        left: out.skipped.map((s) => `${s.name} was left on the list: ${s.why}`),
      });
    } catch (e) {
      setSaid({ ok: false, text: `Nothing was taken off: ${reason(e)}`, left: [] });
    } finally {
      setBusy(false);
    }
  };

  const result = said ? (
    <div data-testid="take-off-menu-said" role={said.ok ? 'status' : 'alert'} style={{ marginTop: 8 }}>
      <p className="cl-said">{said.text}</p>
      {said.left.map((l) => (
        <p key={l} className="cl-note">{l}</p>
      ))}
    </div>
  ) : null;

  if (items.length === 0) return result ? <div style={{ marginTop: 12 }}>{result}</div> : null;

  return (
    <div className="cl-panel" style={{ marginTop: 12, display: 'grid', gap: 8 }} data-testid="take-off-menu">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="cl-said">
          {dishCount(items.length)} {items.length === 1 ? 'is' : 'are'} not on the current menu.
        </span>
        <button type="button" className="cl-btn cl-focus" aria-pressed={showing} onClick={() => onShowing(!showing)}>
          {showing ? 'Show all dishes' : 'Show them'}
        </button>
      </div>
      {showing ? (
        <div role="group" aria-label="Dishes the current menu does not print" data-testid="take-off-menu-sheet" style={{ display: 'grid', gap: 8 }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="cl-table">
              <thead>
                <tr>
                  <th scope="col">Dish</th>
                  <th scope="col">Section</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id} data-testid={`take-off-menu-row-${i.id}`}>
                    <td>{i.name}</td>
                    <td>{i.section ?? 'No section'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="cl-note">
            The current menu has no line of these names. Nothing comes off until you take them off. A dish taken off keeps its recipe’s saved versions. If a dish is on the menu under another name, keep it and rename it.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="cl-btn cl-focus" disabled={busy} onClick={() => void takeOff()}>
              {busy ? 'Taking off…' : `Take ${items.length === 1 ? 'it' : 'them'} off the list`}
            </button>
            <button type="button" className="cl-btn cl-focus" disabled={busy} onClick={() => onShowing(false)}>
              Keep them
            </button>
          </div>
        </div>
      ) : null}
      {result}
    </div>
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
  // The dish a link named when the page opened (the inventory drawer's "used in"
  // lines): its sheet holds room while its recipe is read. A dish opened by a
  // click holds none, the person's own act is not a layout shift.
  const [fromLink] = useState(asked);
  const [allergen, setAllergen] = useState('');
  const [query, setQuery] = useState('');
  const all = dishes.data ?? [];
  const sections = sectionsOf(all);
  const [onlyBare, setOnlyBare] = useState(false);
  const [onlyDiffering, setOnlyDiffering] = useState(false);
  const take = useTakeMenuPrices();
  const takeOff = useTakeOffMenu();
  const [onlyOff, setOnlyOff] = useState(false);
  const fig = (id: string) => figures.byId?.get(id);
  const figState: FiguresState = figures.loading ? 'reading' : !figures.byId || figures.costsUnread ? 'unread' : 'read';
  const searched = all.filter((d) => dishMatches(d, query));
  const byAllergen = searched.filter((d) => keptFor(fig(d.id)?.allergens, allergen));
  // Which dishes have no recipe is known only once the figures are read.
  const bareIds = figures.byId ? all.filter((d) => !fig(d.id)?.hasRecipe).map((d) => d.id) : [];
  // The dishes the menu prices apart from the list: one line, one price, and it differs.
  const takeable: Takeable[] = [];
  if (showMenu && say) {
    for (const d of all) {
      const offer = menuPriceOffer(menu.byId?.get(d.id), d.price);
      if (offer.length !== 1) continue;
      const cost = fig(d.id)?.cost ?? null;
      const shareText = (price: number | null) => {
        const sh = pourCostShare(cost, price);
        return 'pct' in sh ? sayPct(sh.pct) : figState === 'reading' ? 'being read' : 'not known';
      };
      takeable.push({ id: d.id, name: d.name, from: d.price, to: offer[0], shareNow: shareText(d.price), shareMenu: shareText(offer[0]) });
    }
  }
  // The dishes the current menu prints no line of (g2 menu gap): only when the menu was read and one is current.
  const offMenu: OffMenu[] = showMenu ? all.filter((d) => menu.byId?.get(d.id)?.found === 'none').map((d) => ({ id: d.id, name: d.name, section: d.section })) : [];
  const offIds = new Set(offMenu.map((o) => o.id));
  const takeIds = new Set(takeable.map((t) => t.id));
  const filtered = canEdit && onlyBare ? byAllergen.filter((d) => bareIds.includes(d.id)) : byAllergen;
  const byDiffering = onlyDiffering && takeable.length > 0 ? filtered.filter((d) => takeIds.has(d.id)) : filtered;
  const rows = onlyOff && offMenu.length > 0 ? byDiffering.filter((d) => offIds.has(d.id)) : byDiffering;
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

        {say && showMenu ? (
          <TakeMenuPrices
            items={takeable}
            say={say}
            showing={onlyDiffering && takeable.length > 0}
            onShowing={setOnlyDiffering}
            onUse={(ids) => take.mutateAsync(ids)}
          />
        ) : null}

        {say && showMenu ? (
          <TakeOffMenu
            items={offMenu}
            showing={onlyOff && offMenu.length > 0}
            onShowing={setOnlyOff}
            onTakeOff={(ids) => takeOff.mutateAsync(ids)}
          />
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
          {canEdit && figState === 'read' && bareIds.length > 0 ? (
            <NoRecipeYet bare={bareIds.length} of={all.length} noun="dishes" only={onlyBare} onOnly={setOnlyBare} />
          ) : canEdit ? (
            // Which dishes have no recipe is known only when the figures land; the line
            // that says so sits above the table, so its room (one line, same class) is
            // held while they are read and KEPT once they land: NoRecipeYet takes it, or
            // "every dish has a recipe" when none is bare, or it stays empty when the
            // figures could not be read. Dropping it pulled the table up 31 px at ~210 ms.
            <p
              className="cl-said"
              style={{ marginTop: 12, minHeight: '1lh' }}
              aria-hidden={figState === 'read' ? undefined : 'true'}
              data-testid={figState === 'read' ? 'every-dish-has-recipe' : 'no-recipe-yet-room'}
            >
              {figState === 'read' ? 'Every dish has a recipe.' : null}
            </p>
          ) : null}
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
                        {/* The line's room is held on every row, said or not: the figures land
                            after the names, and a row that grew by this line then moved every
                            row under it (r97 register CLS). */}
                        <span className="cl-dim" data-testid="dish-sub" style={{ display: 'block', fontSize: 11, minHeight: '1lh' }}>
                          {figures.byId && !f?.hasRecipe ? 'No recipe yet' : null}
                        </span>
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
                      <tr key={`${d.id}-leaf`} data-testid={`dish-leaf-${d.id}`}>
                        <td colSpan={cols}>
                          {canEdit ? (
                            <DishDetails
                              key={d.id}
                              dish={d}
                              onRemoved={() => open(null)}
                              sections={sections}
                              menu={showMenu ? menu.byId?.get(d.id) : undefined}
                              say={say}
                            />
                          ) : null}
                          <RecipeSheet dishId={d.id} holdRoom={d.id === fromLink} />
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
