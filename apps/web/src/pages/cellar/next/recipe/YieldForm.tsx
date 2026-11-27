/**
 * What one batch of a house-made component makes (ADR 0397, r106 drinks-3).
 * A drink or a dish draws the component by the ml or the gram; its price is
 * the batch's cost over this figure. Owner and manager only (the sheet shows
 * it to them alone). The gateway's own refusal is said as it sent it, and a
 * refused save leaves what was typed.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../../contexts/AuthContext';
import { dishesApi, type DishYield } from '../../../../services/api/recipes';
import { dishesKey, recipeKey } from './useRecipe';
import { RECIPE_UNITS, UNIT_LABEL, qtyText, readQty, readsAsThousandAmbiguous, type RecipeUnit } from './units';

/** The unit a stored batch is read back in. */
const SHOWN: Record<string, { unit: RecipeUnit; per: number }> = { ml10: { unit: 'ml', per: 10 }, mg: { unit: 'g', per: 1000 }, each_milli: { unit: 'each', per: 1000 } };

export function yieldWords(y: DishYield | null | undefined): string | null {
  const s = y ? SHOWN[y.baseUnit] : null;
  return y && s ? `${qtyText(y.qtyBase / s.per)} ${s.unit}` : null;
}

/** The gateway's own sentence for a batch that makes nothing (dishes.service YIELD_NEEDS_AMOUNT). */
export const YIELD_NEEDS_AMOUNT = 'A batch makes an amount above zero.';

/** Said when what was typed is not a number at all. */
export const YIELD_NOT_A_NUMBER = 'Type the amount as a number, like 700.';

/**
 * Why a typed batch size cannot be read, each reason in its own sentence (r107f):
 * 1.500 is above zero, so "above zero" was false for it; the real reason is that
 * the separator could be a thousand or a decimal, said in the sheet's own words.
 * Null when the text reads.
 */
export function yieldProblem(text: string, unit: RecipeUnit): string | null {
  if (readQty(text, unit) !== null) return null;
  const t = text.trim();
  if (readsAsThousandAmbiguous(t, unit)) {
    return `${t} could be ${t.replace(/[.,]/, '')} or ${t.replace(',', '.').replace(/0+$/, '').replace(/\.$/, '')}. Type it without the separator.`;
  }
  if (t === '') return YIELD_NEEDS_AMOUNT;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) && n <= 0 ? YIELD_NEEDS_AMOUNT : YIELD_NOT_A_NUMBER;
}

function refusal(e: unknown): string {
  const m = (e as { response?: { data?: { message?: unknown } } } | null)?.response?.data?.message;
  return typeof m === 'string' && m.trim() ? m.trim() : 'Could not be saved just now. Nothing was changed.';
}

export default function YieldForm({ dishId, current }: { dishId: string; current: DishYield | null | undefined }) {
  const { activeRestaurantId } = useAuth();
  const qc = useQueryClient();
  const shown = current ? SHOWN[current.baseUnit] : null;
  const [text, setText] = useState(current && shown ? qtyText(current.qtyBase / shown.per) : '');
  const [unit, setUnit] = useState<RecipeUnit>(shown?.unit ?? 'ml');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  // Said only once the field has been edited, so an untouched form is not scolded.
  const [edited, setEdited] = useState(false);
  const amount = readQty(text, unit);
  const problem = edited ? yieldProblem(text, unit) : null;

  const save = async () => {
    if (amount === null || busy || !activeRestaurantId) return;
    setBusy(true);
    setSaid(null);
    try {
      const out = await dishesApi.setYield(activeRestaurantId, dishId, { amount, unit });
      setSaid({ ok: true, text: `One batch makes ${qtyText(out.yield.amount)} ${out.yield.unit}. Every recipe that draws it is priced again.` });
      void qc.invalidateQueries({ queryKey: recipeKey(activeRestaurantId, { kind: 'dish', id: dishId }) });
      void qc.invalidateQueries({ queryKey: dishesKey(activeRestaurantId) });
    } catch (e) {
      setSaid({ ok: false, text: refusal(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cl-rcp-meta" data-testid="yield-form">
      <label>
        One batch makes
        <input
          className="cl-field cl-focus cl-num"
          inputMode="decimal"
          value={text}
          placeholder="700"
          aria-invalid={text !== '' && amount === null}
          onChange={(e) => {
            // what was said above belonged to the figure before this edit
            setSaid(null);
            setEdited(true);
            setText(e.target.value);
          }}
        />
      </label>
      <label>
        Unit
        <select className="cl-field cl-focus" value={unit} onChange={(e) => {
            setSaid(null);
            setUnit(e.target.value as RecipeUnit);
          }}>
          {RECIPE_UNITS.map((u) => (
            <option key={u} value={u}>{UNIT_LABEL[u]}</option>
          ))}
        </select>
      </label>
      <button type="button" className="cl-btn cl-focus" disabled={amount === null || busy} onClick={() => void save()}>
        {busy ? 'Saving…' : 'Save what a batch makes'}
      </button>
      {problem ? (
        <p className="cl-rcp-note cl-rcp-note-warn" role="status" data-testid="yield-needs-amount">
          {problem}
        </p>
      ) : null}
      {said ? (
        <p className={said.ok ? 'cl-note' : 'cl-rcp-note cl-rcp-note-warn'} role={said.ok ? 'status' : 'alert'} data-testid="yield-said">
          {said.text}
        </p>
      ) : null}
    </div>
  );
}
