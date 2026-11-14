/**
 * /dishes (ADR 0366): the house's dishes, each with a recipe on the drinks'
 * recipe engine. One row per dish; opening one mounts the same RecipeSheet the
 * cocktails use. Owner and manager see money and may add a dish; staff read
 * the list and the recipes with no money (the gateway sends them none).
 *
 * A failed read says why and never "No dishes yet." (ADR 0020).
 * `?open=<id>` opens that dish (the inventory drawer links here); the query
 * follows the open row with `replace`, so Back leaves the page.
 */
import { useId, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, Plus } from 'lucide-react';
import RecipeSheet from '../cellar/next/recipe/RecipeSheet';
import { pourCostShare } from '../cellar/next/recipe/DrinkCards';
import { reason, useCanEditRecipe, useCreateDish, useDishes, useHouseMoney } from '../cellar/next/recipe/useRecipe';
import type { DishListRow } from '../../services/api/recipes';
import { EM, SANS } from '../cellar/next/cellar-format';
import '../cellar/next/cellar-next.css';

type Say = (n: number | null | undefined) => string;

function cells(d: DishListRow, say: Say) {
  const dim = <span className="cl-dim">{EM}</span>;
  if (!d.hasRecipe) return { price: d.price != null ? say(d.price) : 'No price', cost: dim, share: dim };
  const share = pourCostShare(d.cost, d.price);
  return {
    price: d.price != null ? say(d.price) : 'No price',
    cost: d.cost?.complete && d.cost.perServe != null ? say(d.cost.perServe) : 'Not known',
    share: 'pct' in share ? `${share.pct.toFixed(1)}%` : 'Not known',
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
  const priceNum = price.trim() === '' ? undefined : Number(price);
  const priceBad = priceNum !== undefined && !(Number.isFinite(priceNum) && priceNum >= 0);
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
          type="number"
          min={0}
          step="any"
          inputMode="decimal"
          value={price}
          aria-invalid={priceBad}
          onChange={(e) => setPrice(e.target.value)}
        />
      </label>
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

export default function DishesPage() {
  const dishes = useDishes();
  const canEdit = useCanEditRecipe();
  const sayMoney = useHouseMoney();
  const say = canEdit ? sayMoney : null;
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
  const cols = say ? 5 : 2;

  return (
    <div className="mudavym min-h-full" style={{ background: 'var(--paper-0)', color: 'var(--ink-1)', fontFamily: SANS }}>
      <div style={{ margin: '0 auto', maxWidth: 1200, padding: '22px 16px 40px' }} data-testid="dishes-page">
        <h1 className="cl-h1">Dishes.</h1>
        <p className="cl-said" style={{ marginTop: 8 }}>
          Each dish has a recipe, costed from your shelf the way a drink is.
        </p>

        {canEdit ? <AddDish onAdded={open} /> : null}

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
          <div style={{ marginTop: 12, overflowX: 'auto', border: '1px solid var(--paper-2)', borderRadius: 10 }}>
            <table className="cl-table">
              <thead>
                <tr>
                  <th scope="col">Dish</th>
                  <th scope="col">Section</th>
                  {say ? <th scope="col" style={{ textAlign: 'right' }}>Price</th> : null}
                  {say ? <th scope="col" style={{ textAlign: 'right' }}>Cost a plate</th> : null}
                  {say ? <th scope="col" style={{ textAlign: 'right' }}>Food cost</th> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => {
                  const c = say ? cells(d, say) : null;
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
                      {c ? <td className="cl-num" style={{ textAlign: 'right' }}>{c.cost}</td> : null}
                      {c ? <td className="cl-num" style={{ textAlign: 'right' }}>{c.share}</td> : null}
                    </tr>,
                    d.id === openId ? (
                      <tr key={`${d.id}-leaf`} data-testid={`dish-leaf-${d.id}`}>
                        <td colSpan={cols}>
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
