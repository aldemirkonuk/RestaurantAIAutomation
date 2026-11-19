/**
 * /dishes: the dishes whose price the current menu states differently, taken
 * in one step (g1 menu gap). A re-uploaded menu moved no dish's price, and
 * each dish needed its own confirm, with nothing saying which differed.
 *
 * One line says how many differ and shows them; the sheet then lists each
 * with its price now, the menu's price and the food cost share each gives, and
 * one button writes them all. Nothing is written before that button; the
 * gateway reads the menu again and names every dish it leaves, which is said
 * here in words. A failed write says nothing was changed.
 */
import { useState } from 'react';
import type { TakeMenuPricesAnswer } from '../../services/api/recipes';
import { reason } from '../cellar/next/recipe/useRecipe';

export interface Takeable {
  id: string;
  name: string;
  from: number | null;
  to: number;
  /** The food cost share at the dish's price now, said; or why it is not known. */
  shareNow: string;
  /** The food cost share at the menu's price, said; or why it is not known. */
  shareMenu: string;
}

const dishes = (n: number) => `${n} ${n === 1 ? 'dish' : 'dishes'}`;

export default function TakeMenuPrices({
  items,
  say,
  showing,
  onShowing,
  onUse,
}: {
  items: Takeable[];
  say: (n: number | null | undefined) => string;
  showing: boolean;
  onShowing: (v: boolean) => void;
  onUse: (ids: string[]) => Promise<TakeMenuPricesAnswer>;
}) {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string; left: string[] } | null>(null);

  const use = async () => {
    setBusy(true);
    setSaid(null);
    try {
      const out = await onUse(items.map((i) => i.id));
      onShowing(false);
      setSaid({
        ok: true,
        text:
          out.changed.length > 0
            ? `${dishes(out.changed.length)} now ${out.changed.length === 1 ? 'uses' : 'use'} the menu’s price.`
            : 'No price was changed.',
        left: out.skipped.map((s) => `${s.name} was left as it was: ${s.why}`),
      });
    } catch (e) {
      setSaid({ ok: false, text: `Nothing was changed: ${reason(e)}`, left: [] });
    } finally {
      setBusy(false);
    }
  };

  const result = said ? (
    <div data-testid="take-menu-prices-said" role={said.ok ? 'status' : 'alert'} style={{ marginTop: 8 }}>
      <p className="cl-said">{said.text}</p>
      {said.left.map((l) => (
        <p key={l} className="cl-note">{l}</p>
      ))}
    </div>
  ) : null;

  if (items.length === 0) return result ? <div style={{ marginTop: 12 }}>{result}</div> : null;

  return (
    <div className="cl-panel" style={{ marginTop: 12, display: 'grid', gap: 8 }} data-testid="take-menu-prices">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="cl-said">
          {dishes(items.length)} {items.length === 1 ? 'is' : 'are'} priced differently on the current menu.
        </span>
        <button type="button" className="cl-btn cl-focus" aria-pressed={showing} onClick={() => onShowing(!showing)}>
          {showing ? 'Show all dishes' : 'Show them'}
        </button>
      </div>
      {showing ? (
        <div role="group" aria-label="Prices to take from the menu" data-testid="take-menu-prices-sheet" style={{ display: 'grid', gap: 8 }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="cl-table">
              <thead>
                <tr>
                  <th scope="col">Dish</th>
                  <th scope="col" style={{ textAlign: 'right' }}>Price now</th>
                  <th scope="col" style={{ textAlign: 'right' }}>Menu price</th>
                  <th scope="col" style={{ textAlign: 'right' }}>Food cost</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id} data-testid={`take-menu-prices-row-${i.id}`}>
                    <td>{i.name}</td>
                    <td className="cl-num" style={{ textAlign: 'right' }}>{i.from == null ? 'No price' : say(i.from)}</td>
                    <td className="cl-num" style={{ textAlign: 'right' }}>{say(i.to)}</td>
                    <td className="cl-num" style={{ textAlign: 'right' }}>{i.shareNow} to {i.shareMenu}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="cl-note">
            Nothing changes until you use the menu’s prices. A dish the menu names with several prices is left to you, and said.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="cl-btn cl-focus" disabled={busy} onClick={() => void use()}>
              {busy ? 'Setting…' : 'Use the menu’s prices'}
            </button>
            <button type="button" className="cl-btn cl-focus" disabled={busy} onClick={() => onShowing(false)}>
              Keep my prices
            </button>
          </div>
        </div>
      ) : null}
      {result}
    </div>
  );
}
