/**
 * "Try a price" under a drink's pour cost and margin cards (r108 drinks-g8):
 * a typed price, read the way the price box reads one (`readPrice`), and the
 * pour cost and margin that price would give, from the same pure figures the
 * cards use (`pourCostShare`, `marginPerServe`) under the house's tax basis,
 * against the cost the cost card shows (the unsaved lines' once priced).
 *
 * Price to figures only, and nothing is written or kept: the menu's own price
 * write stays the only one (ADR 0193). The reverse, a price for a wanted %,
 * was taken out with DD-r104-33 and is not brought back here.
 *
 * The sentence holds its room from the first paint (one line, two at a
 * phone), so typing never moves what is under it. The figure changes as the
 * text does, with no tween (DD-r106-31); there is nothing to reduce.
 */
import { useId, useState } from 'react';
import type { RecipeCost } from '../../../../services/api/recipes';
import type { SayPercent } from './useHousePercent';
import type { ListTax } from './listTax';
import { marginPerServe, pourCostShare } from './DrinkCards';
import { readPrice } from './price-text';

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "12,50" in a house that writes a comma, "12.50" in one that writes a point: from the house's own money form. */
export const priceExample = (sayMoney: (n: number) => string) => sayMoney(12.5).replace(/[^\d.,]/g, '');

/**
 * What a tried price gives, as one sentence; null for an empty box. `warn`
 * when the price would not cover the cost a serve.
 */
export function tryPriceSaid(
  text: string,
  cost: RecipeCost | null,
  sayMoney: (n: number) => string,
  sayPct: SayPercent,
  tax: ListTax,
  words: { unit: string; share: string },
): { said: string; known: boolean; warn: boolean } | null {
  const read = readPrice(text);
  if (read.bad) return { said: `Write a price like ${priceExample(sayMoney)}.`, known: false, warn: false };
  if (read.price == null) return null;
  if (!(read.price > 0)) return { said: 'Write a price above 0.', known: false, warn: false };
  const share = pourCostShare(cost, read.price, tax);
  // The cards' own sentence for what is missing (an incomplete cost, a tax rate not recorded), never a partial figure.
  if (!('pct' in share)) return { said: `${capital(share.missing.join(' and '))}.`, known: false, warn: false };
  const m = marginPerServe(cost, read.price, tax) as { margin: number };
  const margin = m.margin < 0 ? `−${sayMoney(-m.margin)}` : sayMoney(m.margin);
  return {
    said: `At ${sayMoney(read.price)}: ${words.share} ${sayPct(share.pct)}, margin ${margin} a ${words.unit}.`,
    known: true,
    warn: m.margin < 0,
  };
}

export default function TryPrice({
  cost,
  sayMoney,
  sayPct,
  tax,
  isDish,
}: {
  /** The cost the cost card shows. */
  cost: RecipeCost | null;
  sayMoney: (n: number) => string;
  sayPct: SayPercent;
  tax: ListTax;
  isDish: boolean;
}) {
  const [text, setText] = useState('');
  const id = useId();
  const words = isDish ? { unit: 'plate', share: 'food cost' } : { unit: 'serve', share: 'pour cost' };
  const out = tryPriceSaid(text, cost, sayMoney, sayPct, tax, words);
  return (
    <div className="cl-rcp-try" data-testid="try-price" style={{ marginTop: 8 }}>
      <label htmlFor={`${id}-in`} className="cl-rcp-card-label" style={{ display: 'block' }}>
        Try a price
      </label>
      <input
        id={`${id}-in`}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        className="cl-field cl-focus"
        data-testid="try-price-input"
        aria-describedby={`${id}-out`}
        placeholder={priceExample(sayMoney)}
        value={text}
        onChange={(e) => setText(e.target.value)}
        style={{ width: 120 }}
      />
      <p
        id={`${id}-out`}
        className="cl-rcp-card-said cl-try-room"
        role="status"
        aria-live="polite"
        data-testid="try-price-said"
        data-known={out?.known ? 'true' : 'false'}
        data-warn={out?.warn ? 'true' : 'false'}
        style={{ margin: '4px 0 0', color: out?.warn ? 'var(--warn)' : undefined }}
      >
        {out?.said ?? ''}
      </p>
    </div>
  );
}
