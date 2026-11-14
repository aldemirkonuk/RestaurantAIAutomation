/**
 * "Use the menu's price" on an opened dish or drink (r28 recipes audit, gap 2,
 * slice 2). The Menu column says "differs" when the house's current menu
 * prices a line of the row's name apart from the row's own price; the food
 * and pour cost shares divide by the row's price, so the owner should be able
 * to take the menu's price in one step, without typing it again.
 *
 * - Offered only for one menu line (`found: "one"`) with a price, when the row
 *   differs from it or has no price of its own. Several lines that disagree,
 *   or none, are left to the person.
 * - A line with a bottle and a glass price offers each, never one chosen.
 * - Nothing is written before a confirm that names the price and the share
 *   it changes. The write is the row's own PATCH (owner and manager only).
 */
import { useState } from 'react';
import type { MenuPrice } from '../../../../services/api/recipes';
import { reason } from './useRecipe';

/** The menu's prices a row can take: none unless they would change it. */
export function menuPriceOffer(menu: MenuPrice | undefined, own: number | null | undefined): number[] {
  if (!menu || menu.found !== 'one' || menu.prices.length === 0) return [];
  const ownPrice = own ?? null;
  if (ownPrice !== null && menu.agrees !== false) return [];
  return menu.prices.filter((p) => p !== ownPrice);
}

export default function UseMenuPrice({
  name,
  own,
  menu,
  say,
  share,
  onUse,
}: {
  /** The dish's or drink's name as the list shows it. */
  name: string;
  own: number | null | undefined;
  menu: MenuPrice | undefined;
  say: (n: number | null | undefined) => string;
  /** "food cost" for a dish, "pour cost" for a drink. */
  share: 'food cost' | 'pour cost';
  /** Writes the price; throws with the gateway's refusal. */
  onUse: (price: number) => Promise<void>;
}) {
  const [asking, setAsking] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const offer = menuPriceOffer(menu, own);

  // Once taken, the price is said and nothing more is offered: the list is
  // read again, and until it is the old figures must not offer it twice.
  if (offer.length === 0 || said?.ok) {
    return said ? (
      <p className="cl-note" role={said.ok ? 'status' : 'alert'} data-testid="use-menu-price-said">
        {said.text}
      </p>
    ) : null;
  }

  const ownWords = own == null ? 'it has no price here' : `this list says ${say(own)}`;
  const menuWords = offer.length === 1 ? say(offer[0]) : offer.map((p) => say(p)).join(' or ');

  const use = async (price: number) => {
    setBusy(true);
    setSaid(null);
    try {
      await onUse(price);
      setAsking(null);
      setSaid({ ok: true, text: `${name} is now ${say(price)}, as on your menu.` });
    } catch (e) {
      setSaid({ ok: false, text: `Nothing was changed: ${reason(e)}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cl-said" data-testid="use-menu-price" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      {asking === null ? (
        <>
          <span>
            Your current menu prices {name} at {menuWords}; {ownWords}.
          </span>
          {offer.map((p) => (
            <button key={p} type="button" className="cl-btn cl-focus" onClick={() => setAsking(p)}>
              Use {say(p)}
            </button>
          ))}
        </>
      ) : (
        <>
          <span>
            Set {name}’s price to {say(asking)}? Its {share} is then taken over {say(asking)}.
          </span>
          <button type="button" className="cl-btn cl-focus" disabled={busy} onClick={() => void use(asking)}>
            {busy ? 'Setting…' : `Yes, use ${say(asking)}`}
          </button>
          <button type="button" className="cl-btn cl-focus" disabled={busy} onClick={() => setAsking(null)}>
            {own == null ? 'Leave it unpriced' : `Keep ${say(own)}`}
          </button>
        </>
      )}
      {said ? (
        <p className="cl-note" role={said.ok ? 'status' : 'alert'} data-testid="use-menu-price-said" style={{ flexBasis: '100%' }}>
          {said.text}
        </p>
      ) : null}
    </div>
  );
}
