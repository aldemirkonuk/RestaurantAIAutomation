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
 */
import { useId, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, Plus } from 'lucide-react';
import RecipeSheet from '../cellar/next/recipe/RecipeSheet';
import { pourCostShare } from '../cellar/next/recipe/DrinkCards';
import { PRICE_UNREAD, priceText, readPrice } from '../cellar/next/recipe/price-text';
import { useHousePercent, type SayPercent } from '../cellar/next/recipe/useHousePercent';
import { reason, useCanEditRecipe, useCreateDish, useDishes, useHouseMoney, useMenuPrices, useRemoveDish, useUpdateDish } from '../cellar/next/recipe/useRecipe';
import { MENU_PRICES_UNREAD, MenuPriceCell } from '../cellar/next/recipe/MenuPriceCell';
import type { DishListRow } from '../../services/api/recipes';
import { EM, SANS } from '../cellar/next/cellar-format';
import '../cellar/next/cellar-next.css';
import './dishes-page.css';

type Say = (n: number | null | undefined) => string;

/** Said under a cost some of whose lines are priced from part of the stock only. */
const PARTLY_INVOICED = 'partly invoiced';

function cells(d: DishListRow, say: Say, sayPct: SayPercent) {
  const dim = <span className="cl-dim">{EM}</span>;
  if (!d.hasRecipe) return { price: d.price != null ? say(d.price) : 'No price', cost: dim, share: dim };
  const share = pourCostShare(d.cost, d.price);
  const per = d.cost?.complete ? d.cost.perServe : null;
  // `partial` counts priced lines whose invoice cost covers only part of the
  // stock (bought another way, invoiced at 0, or not yet verified).
  const part = d.cost?.partial ?? 0;
  return {
    price: d.price != null ? say(d.price) : 'No price',
    cost:
      per == null ? (
        'Not known'
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

function AddDish({ onAdded }: { onAdded: (id: string) => void }) {
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
        <input id={`${id}-name`} className="cl-field cl-focus" aria-required="true" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
      </label>
      <label htmlFor={`${id}-section`}>
        Section
        <input id={`${id}-section`} className="cl-field cl-focus" value={section} maxLength={100} onChange={(e) => setSection(e.target.value)} />
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
          onChange={(e) => setPrice(e.target.value)}
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
function DishDetails({ dish, onRemoved }: { dish: DishListRow; onRemoved: () => void }) {
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
        <input id={`${id}-name`} className="cl-field cl-focus" aria-required="true" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
      </label>
      <label htmlFor={`${id}-section`}>
        Section
        <input id={`${id}-section`} className="cl-field cl-focus" value={section} maxLength={100} onChange={(e) => setSection(e.target.value)} />
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
          onChange={(e) => setPrice(e.target.value)}
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
  const canEdit = useCanEditRecipe();
  const sayMoney = useHouseMoney();
  const sayPct = useHousePercent();
  const say = canEdit ? sayMoney : null;
  const menu = useMenuPrices('dish', canEdit);
  const showMenu = Boolean(say && menu.byId && (menu.currentMenus ?? 0) > 0);
  const [params, setParams] = useSearchParams();
  const asked = params.get('open');
  const rows = dishes.data ?? [];
  const openId = rows.some((d) => d.id === asked) ? asked : null;

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
  const cols = (say ? 5 : 2) + (showMenu ? 1 : 0);

  return (
    <div className="mudavym min-h-full" style={{ background: 'var(--paper-0)', color: 'var(--ink-1)', fontFamily: SANS }}>
      <div style={{ margin: '0 auto', maxWidth: 1200, padding: '22px 16px 40px' }} data-testid="dishes-page">
        <h1 className="cl-h1">Dishes.</h1>
        <p className="cl-said" style={{ marginTop: 8 }}>
          Each dish has a recipe, costed from your shelf the way a drink is.
        </p>

        {canEdit ? <AddDish onAdded={open} /> : null}

        {say && menu.error ? (
          <p className="cl-said" role="status" style={{ marginTop: 12 }} data-testid="dishes-menu-unread">
            {MENU_PRICES_UNREAD}
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
        ) : rows.length === 0 ? (
          <p className="cl-said" style={{ marginTop: 12 }} data-testid="dishes-empty">No dishes yet.</p>
        ) : (
          <div
            className="dishes-scroll"
            data-testid="dishes-scroll"
            style={{ marginTop: 12, overflowX: 'auto', border: '1px solid var(--paper-2)', borderRadius: 10 }}
          >
            <table className="cl-table">
              <thead>
                <tr>
                  <th scope="col">Dish</th>
                  <th scope="col">Section</th>
                  {say ? <th scope="col" style={{ textAlign: 'right' }}>Price</th> : null}
                  {showMenu ? <th scope="col" style={{ textAlign: 'right' }}>Menu</th> : null}
                  {say ? <th scope="col" style={{ textAlign: 'right' }}>Cost per plate</th> : null}
                  {say ? <th scope="col" style={{ textAlign: 'right' }}>Food cost</th> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => {
                  const c = say ? cells(d, say, sayPct) : null;
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
                        {d.hasRecipe ? null : <span className="cl-dim" style={{ fontSize: 11 }}>No recipe yet</span>}
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
                    </tr>,
                    d.id === openId ? (
                      <tr key={`${d.id}-leaf`} data-testid={`dish-leaf-${d.id}`}>
                        <td colSpan={cols}>
                          {canEdit ? <DishDetails key={d.id} dish={d} onRemoved={() => open(null)} /> : null}
                          <RecipeSheet dishId={d.id} />
                        </td>
                      </tr>
                    ) : null,
                  ];
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
