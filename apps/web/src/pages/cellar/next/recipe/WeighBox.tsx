/**
 * The box a line opens when it is measured one way and its good is kept
 * another, and only a weight the house states joins them (r28 gap 7): "2 eggs"
 * against eggs kept by the kg needs what one egg weighs; "2 tbsp flour"
 * against flour kept by the kg needs what one ml of flour weighs.
 *
 * The weight belongs to the good, not to this recipe: every recipe that uses
 * the good is priced and counted from it once it is kept. Nothing is guessed
 * for the person: the box starts empty, and a figure past the gateway's bounds
 * is said before it is sent.
 */
import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { StatedWeights, WeightNeeded } from '../../../../services/api/recipes';
import { useAuth } from '../../../../contexts/AuthContext';
import { settingsApi } from '../../../../services/api/settings';
import { formatHouseNumber } from '../../../../lib/house-number';
import { qtyText, readQty } from './units';
import { reason, useStateWeights } from './useRecipe';

/** Writes a weight in grams as a number in the house's form. */
export type SayGrams = (grams: number) => string;

/** Until the house's form is read, a weight is written plainly ("0.53"). */
export const plainGrams: SayGrams = (g) => qtyText(g);

/**
 * A stated weight written the way the house writes its numbers ("0,53" in a
 * lira house, "0.53" in a pound house), from the same currency query the
 * sheet's share reads, so the two never disagree about the house. Up to four
 * places: one ml's weight is kept to four (ml_grams numeric(8,4)).
 */
export function useSayGrams(): SayGrams {
  const { activeRestaurantId } = useAuth();
  const q = useQuery({
    queryKey: ['settings', 'currency', activeRestaurantId ?? null],
    enabled: Boolean(activeRestaurantId),
    queryFn: () => settingsApi.houseCurrency(),
    staleTime: 5 * 60_000,
  });
  const code = q.data?.readable ? q.data.code : null;
  return code ? (g) => formatHouseNumber(g, code, { max: 4 }) : plainGrams;
}

/** The gateway's bounds (recipes.service.ts MAX_PIECE_GRAMS, MAX_ML_GRAMS). */
export const MOST_GRAMS: Record<WeightNeeded, number> = { piece_grams: 50_000, ml_grams: 5 };

export function weighLabel(needs: WeightNeeded, item: string): string {
  // The good's name first: shelf names are often plural ("Eggs", "Lemons").
  return needs === 'piece_grams' ? `${item}: one piece weighs` : `${item}: one ml weighs`;
}

/** The figure typed, or the sentence that says why it is not sent. */
export function readWeight(text: string, needs: WeightNeeded): { grams: number } | { why: string } {
  if (!text.trim()) return { why: 'Type a weight in grams.' };
  const n = readQty(text, 'g');
  if (n === null) return { why: 'Type the weight as a number of grams, such as 60 or 0,53, without a thousands mark.' };
  if (n > MOST_GRAMS[needs]) {
    return {
      why:
        needs === 'piece_grams'
          ? 'One piece can weigh at most 50000 g. Check the figure.'
          : 'One ml can weigh at most 5 g (honey is about 1,4). Check the figure.',
    };
  }
  return { grams: n };
}

export default function WeighBox({
  itemId,
  item,
  needs,
  onWeighed,
  now,
  onCancel,
}: {
  itemId: string;
  item: string;
  needs: WeightNeeded;
  onWeighed?: (itemId: string, weights: StatedWeights) => void | Promise<void>;
  /** The weight already stated, written for the reader, when the box changes one. */
  now?: string;
  /** Closes a box opened to change a weight; a box a line waits on has none. */
  onCancel?: () => void;
}) {
  const id = useId();
  const [text, setText] = useState('');
  const [said, setSaid] = useState<string | null>(null);
  const keep = useStateWeights();
  const read = readWeight(text, needs);

  const submit = async () => {
    if ('why' in read) {
      setSaid(read.why);
      return;
    }
    setSaid(null);
    try {
      const body = needs === 'piece_grams' ? { pieceGrams: read.grams } : { mlGrams: read.grams };
      const out = await keep.mutateAsync({ itemId, body });
      await onWeighed?.(itemId, out);
    } catch (e) {
      setSaid(`The weight was not kept: ${reason(e)}`);
    }
  };

  return (
    <form
      className="cl-rcp-weigh"
      data-testid="recipe-line-weigh"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label htmlFor={`${id}-g`}>{weighLabel(needs, item)}</label>
      <input
        id={`${id}-g`}
        className="cl-field cl-focus cl-num"
        inputMode="decimal"
        value={text}
        aria-invalid={said !== null}
        aria-describedby={said ? `${id}-said` : undefined}
        onChange={(e) => {
          setText(e.target.value);
          setSaid(null);
        }}
        style={{ width: '6em' }}
      />
      <span aria-hidden> g</span>
      <button type="submit" className="cl-btn cl-focus" disabled={keep.isPending}>
        {keep.isPending ? 'Keeping…' : 'Keep'}
      </button>
      {onCancel ? (
        <button type="button" className="cl-btn cl-focus" onClick={onCancel} disabled={keep.isPending}>
          Cancel
        </button>
      ) : null}
      {now ? (
        <span className="cl-dim" data-testid="recipe-line-weigh-now">
          {' '}
          Now {now} g.
        </span>
      ) : null}
      {said ? (
        <p id={`${id}-said`} className="cl-rcp-note cl-rcp-note-warn" role="alert">
          {said}
        </p>
      ) : null}
    </form>
  );
}
