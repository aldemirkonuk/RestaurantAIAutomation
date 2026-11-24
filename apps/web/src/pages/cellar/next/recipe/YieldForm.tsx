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
import { RECIPE_UNITS, UNIT_LABEL, qtyText, readQty, type RecipeUnit } from './units';

/** The unit a stored batch is read back in. */
const SHOWN: Record<string, { unit: RecipeUnit; per: number }> = { ml10: { unit: 'ml', per: 10 }, mg: { unit: 'g', per: 1000 }, each_milli: { unit: 'each', per: 1000 } };

export function yieldWords(y: DishYield | null | undefined): string | null {
  const s = y ? SHOWN[y.baseUnit] : null;
  return y && s ? `${qtyText(y.qtyBase / s.per)} ${s.unit}` : null;
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
  const amount = readQty(text, unit);

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
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <label>
        Unit
        <select className="cl-field cl-focus" value={unit} onChange={(e) => setUnit(e.target.value as RecipeUnit)}>
          {RECIPE_UNITS.map((u) => (
            <option key={u} value={u}>{UNIT_LABEL[u]}</option>
          ))}
        </select>
      </label>
      <button type="button" className="cl-btn cl-focus" disabled={amount === null || busy} onClick={() => void save()}>
        {busy ? 'Saving…' : 'Save what a batch makes'}
      </button>
      {said ? (
        <p className={said.ok ? 'cl-note' : 'cl-rcp-note cl-rcp-note-warn'} role={said.ok ? 'status' : 'alert'} data-testid="yield-said">
          {said.text}
        </p>
      ) : null}
    </div>
  );
}
