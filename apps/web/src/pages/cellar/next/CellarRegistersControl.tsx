/**
 * CellarRegistersControl — the seven registers, with a switch each.
 *
 * EXPORTED FOR SETTINGS. The founder's decision of 2026-09-03 puts the change
 * path in Settings; `apps/web/src/pages/settings/**` is another agent's
 * directory, so this component lives here and is mounted there. The mount point
 * is filed in the page note §13. Nothing about it depends on this page: it
 * takes a readout and a save, and renders.
 *
 * ONE AUTHORITATIVE SOURCE (premortem M4). The switch writes
 * `PUT /cellar/:rid/registers`, whose one row per (restaurant, register) in
 * `restaurant_cellar_registers` is the only place this fact lives. There is no
 * copy on `restaurants`, none in a client store, and none in a constant — the
 * page's own `REGISTER_ORDER` is a vocabulary and an order, never an answer.
 *
 * THE CHANGE-OVER-TIME CASE. Switching a register ON that the books know
 * nothing about is a legitimate act, not an error: the house started carrying
 * it and the books have not caught up. So the switch works, the write is
 * `source: 'manual'`, and the ask (NeedsItemsNotice) appears beneath the row —
 * inline and dismissible, never a modal.
 */

import { useMemo, useState } from 'react';
import { AlertTriangle, Check, Loader2 } from 'lucide-react';
import RegisterNotice from './NeedsItemsNotice';
import RegisterEvidenceLine from './RegisterEvidenceLine';
import { REGISTER_ORDER, REGISTER_TITLE, decidedLine, type RegisterId } from './cellar-format';
import { REGISTER_SOURCE } from './registerShapes';
import type { CellarRegistersVM } from './useCellarNextData';

export interface CellarRegistersControlProps {
  readout: CellarRegistersVM | null;
  loading: boolean;
  /** Why the readout could not be read. Rendered in words, never as "none". */
  error: string | null;
  /** Writes one register. Returns when the server has answered. */
  onChange: (
    registers: { id: RegisterId; carried: boolean }[],
    source: 'confirmed' | 'manual',
  ) => Promise<unknown>;
  saving?: boolean;
  saveError?: string | null;
  /** Passed through to the ask, so the founder can switch its weight. */
  noticeVariant?: 'inline' | 'interrupt';
}

export default function CellarRegistersControl({
  readout,
  loading,
  error,
  onChange,
  saving = false,
  saveError = null,
  noticeVariant = 'inline',
}: CellarRegistersControlProps) {
  const [pending, setPending] = useState<RegisterId | null>(null);
  const byId = useMemo(
    () => new Map((readout?.registers ?? []).map((r) => [r.id, r])),
    [readout],
  );

  if (loading) {
    return (
      <p className="cl-said" role="status" data-testid="registers-control-loading">
        Reading which registers this house carries…
      </p>
    );
  }

  if (error || !readout) {
    return (
      <div role="alert" className="cl-panel" data-testid="registers-control-error">
        <p className="cl-said" style={{ color: 'var(--ink-1)' }}>
          <AlertTriangle size={14} aria-hidden style={{ verticalAlign: '-2px', marginRight: 6 }} />
          Which registers this house carries could not be read
          {error ? ` (${error})` : ''}. Nothing below is switched off — it is
          unread. No register was changed.
        </p>
      </div>
    );
  }

  const toggle = async (id: RegisterId, next: boolean) => {
    setPending(id);
    try {
      // Written as `manual` because a human moved this switch outside
      // onboarding. The gateway stamps confirmed_at and snapshots what the
      // inference said at this instant, so the override stays auditable.
      await onChange([{ id, carried: next }], 'manual');
    } finally {
      setPending(null);
    }
  };

  return (
    <div data-testid="registers-control">
      <p className="cl-said">{decidedLine(readout.decidedBy)}</p>
      {readout.sources.answers.readable ? null : (
        <p className="cl-note" role="status">
          The house’s own answers could not be read ({readout.sources.answers.reason}), so
          every line below is what the books suggest — not what anyone has said.
          A switch will not save until that is fixed.
        </p>
      )}

      <ul style={{ listStyle: 'none', margin: '14px 0 0', padding: 0, display: 'grid', gap: 10 }}>
        {REGISTER_ORDER.map((id) => {
          const r = byId.get(id);
          const on = r?.carried === true;
          const source = REGISTER_SOURCE[id];
          return (
            <li
              key={id}
              className="cl-panel"
              data-register={id}
              data-on={on ? 'true' : 'false'}
              style={{ padding: '12px 14px' }}
            >
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <p
                    className="cl-serif"
                    style={{ margin: 0, fontSize: 17, fontWeight: 600, letterSpacing: '-0.01em' }}
                  >
                    {REGISTER_TITLE[id]}
                  </p>
                  <p className="cl-said" style={{ marginTop: 3 }}>
                    {r ? r.basis : 'This register has not been read.'}
                  </p>
                  {r ? (
                    <RegisterEvidenceLine evidence={r.evidence} confidence={r.confidence} />
                  ) : null}
                  {source.wired ? null : (
                    <p className="cl-note">{source.missing}</p>
                  )}
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={`${REGISTER_TITLE[id]} register`}
                  className="cl-btn cl-ink cl-focus"
                  data-on={on ? 'true' : 'false'}
                  disabled={saving || pending === id}
                  onClick={() => void toggle(id, !on)}
                  style={{ flex: '0 0 auto', minWidth: 92, justifyContent: 'center' }}
                >
                  {pending === id ? (
                    <Loader2 size={13} aria-hidden />
                  ) : on ? (
                    <>
                      <Check size={13} aria-hidden /> carried
                    </>
                  ) : (
                    'not carried'
                  )}
                </button>
              </div>
              {/* Per-row here rather than aggregated: the switch that caused
                  it is on this row, and the settings list is where a house
                  turns registers on one at a time. The parent surface
                  aggregates, because that is where several arrive at once. */}
              {r?.needsEvidence ? (
                <RegisterNotice registers={[id]} variant={noticeVariant} />
              ) : null}
              {r?.carried === false && (r?.strandedItems ?? 0) > 0 ? (
                <RegisterNotice
                  kind="stranded"
                  registers={[id]}
                  counts={{ [id]: r.strandedItems }}
                  variant={noticeVariant}
                />
              ) : null}
            </li>
          );
        })}
      </ul>

      {saveError ? (
        <p role="alert" className="cl-note" style={{ color: 'var(--ink-1)' }}>
          The change was not saved: {saveError}. The switch above shows what the
          server holds, not what was clicked.
        </p>
      ) : null}
    </div>
  );
}
