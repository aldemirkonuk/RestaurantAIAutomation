/**
 * CellarRegistersStep — the onboarding half of the founder's decision:
 * **infer, then confirm**.
 *
 * EXPORTED FOR THE ONBOARDING SURFACE. `/get-started` belongs to another
 * directory; this component is written here and mounted there. The mount point
 * is filed in the page note §13. It takes a readout and a save and nothing
 * else, so it can sit in a wizard step, a card, or a dialog without change.
 *
 * WHAT IT SHOWS. The machine's proposal, with the evidence behind every line —
 * because a proposal a house cannot check is a proposal it will click through.
 * Every line is editable before it is confirmed, and confirming writes ALL
 * seven registers at once with `source: 'confirmed'`, so the house's answer
 * covers the registers it said no to as firmly as the ones it said yes to.
 * A register nobody answers is not the same as one answered "no", and after
 * this step there are no unanswered registers left.
 *
 * WHAT IT REFUSES TO DO. It does not confirm on the house's behalf when there
 * is nothing to infer from. A brand-new restaurant with no menu and no cellar
 * gets `carried: null` on every register, and this step says so and asks
 * plainly rather than proposing seven `no`s that would then read as the
 * house's own word.
 */

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Loader2 } from 'lucide-react';
import { Seal } from '@/components/mudavym';
import RegisterNotice from './NeedsItemsNotice';
import RegisterEvidenceLine from './RegisterEvidenceLine';
import { REGISTER_ORDER, REGISTER_TITLE, type RegisterId } from './cellar-format';
import type { CellarRegistersVM } from './useCellarNextData';

export interface CellarRegistersStepProps {
  readout: CellarRegistersVM | null;
  loading: boolean;
  error: string | null;
  onConfirm: (registers: { id: RegisterId; carried: boolean }[]) => Promise<unknown>;
  saving?: boolean;
  saveError?: string | null;
  noticeVariant?: 'inline' | 'interrupt';
}

export default function CellarRegistersStep({
  readout,
  loading,
  error,
  onConfirm,
  saving = false,
  saveError = null,
  noticeVariant = 'inline',
}: CellarRegistersStepProps) {
  const proposal = useMemo(() => {
    const m = new Map<RegisterId, boolean>();
    for (const id of REGISTER_ORDER) {
      const r = readout?.registers.find((x) => x.id === id);
      // A null proposal (nothing to infer from) starts OFF and the copy says
      // the machine had nothing to go on — it is not presented as a finding.
      m.set(id, r?.carried === true);
    }
    return m;
  }, [readout]);

  const [chosen, setChosen] = useState<Map<RegisterId, boolean>>(proposal);
  useEffect(() => setChosen(proposal), [proposal]);

  if (loading) {
    return (
      <p className="cl-said" role="status" data-testid="registers-step-loading">
        Reading this house’s cellar and menu…
      </p>
    );
  }

  if (error || !readout) {
    return (
      <div role="alert" className="cl-panel" data-testid="registers-step-error">
        <p className="cl-said" style={{ color: 'var(--ink-1)' }}>
          <AlertTriangle size={14} aria-hidden style={{ verticalAlign: '-2px', marginRight: 6 }} />
          This house’s books could not be read{error ? ` (${error})` : ''}, so there
          is nothing to propose. Nothing was assumed and nothing was saved — the
          registers can be set by hand instead.
        </p>
      </div>
    );
  }

  const nothingToInferFrom = readout.decidedBy === 'unknown';
  const byId = new Map(readout.registers.map((r) => [r.id, r]));

  return (
    <section data-testid="registers-step">
      <h2 className="cl-h2">What does this house pour?</h2>
      <p className="cl-standing">
        {nothingToInferFrom
          ? 'Nothing has been counted into the cellar and no menu has been read yet, so there is nothing to read this off. Say which registers the house carries and the books will be checked against it later.'
          : 'Read from this house’s own cellar and menu. Change anything that is wrong — nothing here is saved until it is confirmed.'}
      </p>

      <ul style={{ listStyle: 'none', margin: '16px 0 0', padding: 0, display: 'grid', gap: 10 }}>
        {REGISTER_ORDER.map((id) => {
          const r = byId.get(id);
          const on = chosen.get(id) === true;
          const proposed = proposal.get(id) === true;
          const changed = on !== proposed;
          return (
            <li key={id} className="cl-panel" data-register={id} style={{ padding: '12px 14px' }}>
              <label
                style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}
              >
                <input
                  type="checkbox"
                  className="cl-focus"
                  checked={on}
                  aria-label={`${REGISTER_TITLE[id]} register`}
                  onChange={(e) =>
                    setChosen((prev) => new Map(prev).set(id, e.target.checked))
                  }
                  style={{ marginTop: 3, accentColor: 'var(--seal)' }}
                />
                <span style={{ minWidth: 0 }}>
                  <span
                    className="cl-serif"
                    style={{ display: 'block', fontSize: 17, fontWeight: 600, letterSpacing: '-0.01em' }}
                  >
                    {REGISTER_TITLE[id]}
                    {changed ? (
                      <span className="cl-chip" style={{ marginLeft: 8 }}>
                        changed from what was read
                      </span>
                    ) : null}
                  </span>
                  <span className="cl-said" style={{ display: 'block', marginTop: 3 }}>
                    {r ? r.basis : 'This register has not been read.'}
                  </span>
                  {r ? (
                    <RegisterEvidenceLine evidence={r.evidence} confidence={r.confidence} />
                  ) : null}
                </span>
              </label>
              {/* Switched on here with nothing behind it: the same ask, and
                  never dismissible during onboarding — there is nothing yet to
                  dismiss it against. */}
              {on && (r?.evidence.inventoryRows ?? 0) === 0 && (r?.evidence.menuRows ?? 0) === 0 ? (
                <RegisterNotice registers={[id]} variant={noticeVariant} dismissible={false} />
              ) : null}
              {/* Unticking a register the books DO hold items in, during
                  onboarding: the same symmetric state, said plainly, and never
                  a guard on the tick. */}
              {!on && ((r?.evidence.inventoryRows ?? 0) + (r?.evidence.menuRows ?? 0)) > 0 ? (
                <RegisterNotice
                  kind="stranded"
                  registers={[id]}
                  counts={{
                    [id]: (r?.evidence.inventoryRows ?? 0) + (r?.evidence.menuRows ?? 0),
                  }}
                  variant={noticeVariant}
                  dismissible={false}
                />
              ) : null}
            </li>
          );
        })}
      </ul>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 16, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="cl-btn cl-ink cl-focus"
          disabled={saving}
          data-testid="registers-step-confirm"
          onClick={() =>
            void onConfirm(
              REGISTER_ORDER.map((id) => ({ id, carried: chosen.get(id) === true })),
            )
          }
        >
          {saving ? <Loader2 size={13} aria-hidden /> : <Check size={13} aria-hidden />}
          {saving ? 'Recording…' : 'This is what we pour'}
        </button>
        <Seal size={16} aria-hidden />
        <span className="cl-note" style={{ margin: 0 }}>
          All seven are recorded, including the ones set to “no” — so the cellar
          knows the difference between a register the house declined and one
          nobody has been asked about.
        </span>
      </div>

      {saveError ? (
        <p role="alert" className="cl-note" style={{ color: 'var(--ink-1)' }}>
          Nothing was recorded: {saveError}. The choices above are unsaved.
        </p>
      ) : null}
    </section>
  );
}
