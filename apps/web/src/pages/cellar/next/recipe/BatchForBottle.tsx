/**
 * Batch for a bottle on the recipe card (r109 drinks-g2): the owner picks the
 * water and the bottle, leaves out what is added at service, and reads how
 * many serves fit and what goes in. The figures are `recipeBatch.ts`; this
 * file only holds the choices. Any role reads it; a cost is said only under
 * the card's Include cost box (owner or manager).
 *
 * Motion: none. The figures snap as the person types, and the disclosure
 * opens at once (it is the person's own act, so no layout shift is counted).
 */
import { useId } from 'react';
import type { RecipeVersion } from '../../../../services/api/recipes';
import {
  BOTTLES, BOTTLE_SAID, WATER_PRESETS, WATER_SAID, batchAtService, batchHead, batchParts, bottleWords, planBatch,
  readBottle, readWater, type BatchAnswer,
} from './recipeBatch';
import { scaledCost } from './recipeScale';

export interface BatchState {
  open: boolean;
  waterText: string;
  bottleText: string;
  leftOut: string[];
}
export const BATCH_START: BatchState = { open: false, waterText: '0', bottleText: '1000', leftOut: [] };

/** The answer for the card's saved version, or null while closed or while a box cannot be read. */
export function batchAnswer(v: RecipeVersion, s: BatchState): BatchAnswer | null {
  const water = readWater(s.waterText);
  const bottle = readBottle(s.bottleText);
  if (!s.open || water == null || bottle == null) return null;
  const lines = v.lines.map((l) => ({
    id: l.id, name: l.itemName ?? l.label, qtyEntered: l.qtyEntered, unitCode: l.unitCode, qtyBase: Number(l.qtyBase), baseUnit: l.baseUnit,
  }));
  return planBatch(lines, v.yieldServes, new Set(s.leftOut), water, bottle);
}

/** What the card says of the batch's cost; null when no cost is shown. */
export function batchCost(a: BatchAnswer | null, exact: number | null, sayMoney: ((n: number) => string) | null): string | null {
  if (!sayMoney || !a || a.kind !== 'plan') return null;
  const n = a.plan.serves;
  return exact == null
    ? `What ${n} serves cost is not known.`
    : `${n} serves cost ${sayMoney(scaledCost(exact, n))} at today's prices, with what is added at service.`;
}

export default function BatchForBottle({
  v,
  state,
  setState,
  cost,
}: {
  v: RecipeVersion;
  state: BatchState;
  setState: (s: BatchState) => void;
  /** The cost sentence, already gated by role and the Include cost box. */
  cost: string | null;
}) {
  const id = useId();
  const set = (p: Partial<BatchState>) => setState({ ...state, ...p });
  const water = readWater(state.waterText);
  const bottle = readBottle(state.bottleText);
  const a = batchAnswer(v, state);
  const volumeLines = v.lines.filter((l) => l.baseUnit === 'ml10');

  return (
    <div className="cl-rcp-batch-wrap">
      <button
        type="button"
        className="cl-btn cl-focus"
        aria-expanded={state.open}
        aria-controls={`${id}-batch`}
        onClick={() => set({ open: !state.open })}
      >
        Batch for a bottle
      </button>
      {state.open ? (
        <div id={`${id}-batch`} className="cl-rcp-batch" data-testid="recipe-batch">
          <div className="cl-rcp-batch-row" role="group" aria-label="Water">
            {WATER_PRESETS.map((p) => (
              <button key={p.pct} type="button" className="cl-btn cl-focus" aria-pressed={water === p.pct} onClick={() => set({ waterText: String(p.pct) })}>
                {p.label}
              </button>
            ))}
            <label htmlFor={`${id}-water`} className="cl-note">Water %</label>
            <input
              id={`${id}-water`}
              className="cl-field cl-focus cl-num cl-rcp-batch-in"
              inputMode="decimal"
              value={state.waterText}
              aria-invalid={water == null}
              onChange={(e) => set({ waterText: e.target.value })}
            />
          </div>
          <div className="cl-rcp-batch-row" role="group" aria-label="Bottle">
            {BOTTLES.map((ml) => (
              <button key={ml} type="button" className="cl-btn cl-focus" aria-pressed={bottle === ml} onClick={() => set({ bottleText: String(ml) })}>
                {bottleWords(ml)}
              </button>
            ))}
            <label htmlFor={`${id}-bottle`} className="cl-note">Bottle ml</label>
            <input
              id={`${id}-bottle`}
              className="cl-field cl-focus cl-num cl-rcp-batch-in"
              inputMode="numeric"
              value={state.bottleText}
              aria-invalid={bottle == null}
              onChange={(e) => set({ bottleText: e.target.value })}
            />
          </div>
          {volumeLines.length ? (
            <fieldset className="cl-rcp-batch-row">
              <legend className="cl-note">In the bottle (untick what is added at service)</legend>
              {volumeLines.map((l) => (
                <label key={l.id} className="cl-note cl-rcp-batch-tick">
                  <input
                    type="checkbox"
                    checked={!state.leftOut.includes(l.id)}
                    onChange={(e) =>
                      set({ leftOut: e.target.checked ? state.leftOut.filter((x) => x !== l.id) : [...state.leftOut, l.id] })
                    }
                  />
                  {l.itemName ?? l.label}
                </label>
              ))}
            </fieldset>
          ) : null}
          <div aria-live="polite" data-testid="recipe-batch-said">
            {water == null ? <p className="cl-note">{WATER_SAID}</p> : null}
            {bottle == null ? <p className="cl-note">{BOTTLE_SAID}</p> : null}
            {a?.kind === 'nothing' ? <p className="cl-note">Nothing in the bottle is measured by volume, so there is nothing to batch.</p> : null}
            {a?.kind === 'too-big' ? (
              <p className="cl-note">{`One pour (${Math.round(a.pourMl)} ml) is more than the bottle holds.`}</p>
            ) : null}
            {a?.kind === 'plan' ? (
              <>
                <p className="cl-rcp-batch-head"><b>{batchHead(a.plan)}</b> {batchParts(a.plan)}</p>
                {batchAtService(a.plan) ? <p className="cl-note">{batchAtService(a.plan)}</p> : null}
                {cost ? <p className="cl-note" data-testid="recipe-batch-cost">{cost}</p> : null}
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
