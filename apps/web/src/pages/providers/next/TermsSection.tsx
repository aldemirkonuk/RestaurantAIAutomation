/**
 * Terms — the same register, on the vendor's own row.
 *
 * The founder's decision of 2026-09-04: cutoffs, delivery days, minimums and
 * payment terms are reachable from /providers on the vendor's row, not only
 * from /settings. A person who has just phoned a vendor is looking at that
 * vendor, not at a house-wide table.
 *
 * ONE REGISTER, TWO DOORS. This is not a second store of terms. It reads and
 * writes the SAME rows through the SAME routes as
 * `pages/settings/next/VendorTermsSection.tsx`, and it takes the formatters
 * both doors speak from `lib/mudavym/format.ts` rather than restating them, so
 * a cutoff cannot read one way here and another way there. Until 2026-09-04
 * those formatters were imported from `settings/next/st-format.ts` — one page
 * reaching into another page's module; they were hoisted to the shared library
 * and `st-format.ts` re-exports them, so nothing about the output moved. The
 * link at the foot takes the reader to the whole-house view.
 *
 * THE RULE IT INHERITS: a term is a claim, and every claim shows its source.
 * `Cell` takes the whole `TermCell` and branches on `source`, so no code path
 * prints a value without provenance underneath it. A value the gateway cannot
 * distinguish from its column default arrives as `source: 'unknown'` with the
 * reason, and renders as an em dash with that reason — a default is not a term.
 *
 * WHO MAY WRITE: anyone signed in. That is the founder's call and the
 * controller's (vendor-terms.controller.ts:29-35) — a cutoff is operational
 * knowledge, and the control is that the author is filed by the gateway from
 * the JWT, never sent by this form. Recorded, not restricted.
 */

import { useState } from 'react';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import {
  EM as ST_EM,
  SOURCE_LABEL,
  WEEKDAY_INITIALS,
  fmtCutoff,
  fmtMoney,
  fmtWeekdays,
  fmtWhen,
  type TermSource,
} from '@/lib/mudavym/format';
import type {
  SetVendorTermsBody,
  TermCell,
  VendorTermsRow,
} from '../../settings/next/useSettingsNextData';
import { MONO, SANS } from './pv-format';
import { useProviderTerms } from './useProviderTerms';

const SOURCE_TONE: Record<TermSource, string> = {
  stated: 'var(--seal-deep, #14515C)',
  vendor_record: 'var(--seal-deep, #14515C)',
  inferred: 'var(--ink-3, #7C7365)',
  unknown: 'var(--ink-3, #7C7365)',
};

function Cell<T>({
  label,
  cell,
  render,
}: {
  label: string;
  cell: TermCell<T>;
  render: (v: T) => React.ReactNode;
}) {
  const known = cell.value !== null && cell.value !== undefined;
  const why =
    cell.reason ??
    cell.basis ??
    cell.column ??
    (cell.statedAt ? `stated ${fmtWhen(cell.statedAt)}` : undefined);
  return (
    <div style={{ minWidth: 0, padding: '7px 0', borderBottom: '1px solid var(--paper-2, #EAE4D8)' }}>
      <span
        style={{
          display: 'block',
          fontFamily: MONO,
          fontSize: 9,
          fontWeight: 600,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--ink-3, #7C7365)',
        }}
      >
        {label}
      </span>
      <div
        style={{
          fontFamily: known ? MONO : SANS,
          fontSize: 12.5,
          marginTop: 2,
          color: known ? 'var(--ink-1, #211C16)' : 'var(--ink-3, #7C7365)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {known ? render(cell.value as T) : ST_EM}
      </div>
      <span
        style={{
          display: 'block',
          fontFamily: MONO,
          fontSize: 8.5,
          fontWeight: 600,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          marginTop: 3,
          color: SOURCE_TONE[cell.source],
        }}
        title={why}
      >
        {cell.source === 'inferred'
          ? `inferred · ${cell.n ?? 0} · ${cell.confidence ?? 'low'}`
          : SOURCE_LABEL[cell.source]}
      </span>
      {/* An unknown says WHY in words on the row itself — a tooltip is not an
          answer for someone who cannot hover. */}
      {cell.source === 'unknown' && why && (
        <span style={{ display: 'block', fontFamily: SANS, fontSize: 11, lineHeight: 1.45, color: 'var(--ink-3, #7C7365)', marginTop: 2 }}>
          {why}
        </span>
      )}
      {cell.contradiction && (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            fontFamily: SANS,
            fontSize: 10.5,
            lineHeight: 1.4,
            color: 'var(--ink-2, #4F473C)',
            marginTop: 3,
          }}
        >
          <AlertTriangle size={11} aria-hidden style={{ color: 'var(--seal-deep, #14515C)', flexShrink: 0 }} />
          {cell.contradiction}
        </span>
      )}
    </div>
  );
}

/* ── The editor ──────────────────────────────────────────────────────────── */

interface DraftState {
  weekdays: number[];
  cutoffTime: string;
  cutoffOffset: string;
  minimum: string;
  leadTime: string;
  paymentTerms: string;
}

/** Only STATED values seed the form: seeding it from an inference would turn a
 *  guess into the house's word the moment somebody pressed Record. */
function draftFrom(row: VendorTermsRow): DraftState {
  const stated = <T,>(cell: TermCell<T>): T | null =>
    cell.source === 'stated' ? (cell.value as T | null) : null;
  const cutoff = stated(row.orderCutoff);
  const min = stated(row.minimumOrder);
  const lead = stated(row.leadTimeDays);
  return {
    weekdays: stated(row.deliveryWeekdays) ?? [],
    cutoffTime: cutoff?.time ?? '',
    cutoffOffset:
      cutoff?.offsetDays === null || cutoff?.offsetDays === undefined ? '' : String(cutoff.offsetDays),
    minimum: min === null ? '' : String(min),
    leadTime: lead === null ? '' : String(lead),
    paymentTerms: stated(row.paymentTerms) ?? '',
  };
}

/** Only what the person touched is sent: the gateway reads an explicit null as
 *  "withdraw the statement" and a missing key as "leave it alone". */
function toBody(draft: DraftState, before: DraftState): SetVendorTermsBody {
  const body: SetVendorTermsBody = {};
  if (JSON.stringify(draft.weekdays) !== JSON.stringify(before.weekdays)) {
    body.deliveryWeekdays = draft.weekdays;
  }
  if (draft.cutoffTime !== before.cutoffTime) {
    body.orderCutoffTime = draft.cutoffTime.trim() === '' ? null : draft.cutoffTime;
  }
  if (draft.cutoffOffset !== before.cutoffOffset) {
    body.orderCutoffOffsetDays = draft.cutoffOffset.trim() === '' ? null : Number(draft.cutoffOffset);
  }
  if (draft.minimum !== before.minimum) {
    body.minimumOrderAmount = draft.minimum.trim() === '' ? null : Number(draft.minimum);
  }
  if (draft.leadTime !== before.leadTime) {
    body.leadTimeDays = draft.leadTime.trim() === '' ? null : Number(draft.leadTime);
  }
  if (draft.paymentTerms !== before.paymentTerms) {
    body.paymentTerms = draft.paymentTerms.trim() === '' ? null : draft.paymentTerms.trim();
  }
  return body;
}

const fieldStyle: React.CSSProperties = {
  fontFamily: SANS,
  fontSize: 12.5,
  padding: '5px 8px',
  borderRadius: 7,
  border: '1px solid var(--paper-2, #EAE4D8)',
  background: 'var(--paper-0, #FAF7F1)',
  color: 'var(--ink-1, #211C16)',
};

function Btn({
  children,
  onClick,
  disabled,
  quiet,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  quiet?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="pv-terms-btn"
      style={{
        fontFamily: SANS,
        fontSize: 12,
        fontWeight: 600,
        padding: '5px 12px',
        borderRadius: 8,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        border: `1px solid ${quiet ? 'var(--paper-2, #EAE4D8)' : 'var(--seal-ring, rgba(26,94,107,.32))'}`,
        background: 'transparent',
        color: quiet ? 'var(--ink-2, #4F473C)' : 'var(--seal-deep, #14515C)',
      }}
    >
      {children}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', minWidth: 0 }}>
      <span
        style={{
          display: 'block',
          fontFamily: MONO,
          fontSize: 9,
          fontWeight: 600,
          letterSpacing: '0.11em',
          textTransform: 'uppercase',
          color: 'var(--ink-3, #7C7365)',
          marginBottom: 3,
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

function Editor({
  row,
  currency,
  busy,
  onSave,
  onClose,
}: {
  row: VendorTermsRow;
  currency: string;
  busy: boolean;
  onSave: (body: SetVendorTermsBody) => void;
  onClose: () => void;
}) {
  const initial = draftFrom(row);
  const [draft, setDraft] = useState<DraftState>(initial);
  const body = toBody(draft, initial);
  const nothingChanged = Object.keys(body).length === 0;

  return (
    <div style={{ marginTop: 10 }}>
      <p style={{ fontFamily: SANS, fontSize: 12, lineHeight: 1.55, color: 'var(--ink-2, #4F473C)', margin: '0 0 10px' }}>
        Write down what {row.providerName} told you. A field left blank is
        withdrawn — the house stops claiming it and the inference takes over
        again. Nothing here is filled in from a guess.
      </p>
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', alignItems: 'end' }}>
        <Field label="Delivery days">
          <span style={{ display: 'flex', gap: 3 }}>
            {WEEKDAY_INITIALS.map((letter, i) => {
              const on = draft.weekdays.includes(i);
              return (
                <button
                  key={i}
                  type="button"
                  aria-pressed={on}
                  aria-label={fmtWeekdays([i])}
                  onClick={() =>
                    setDraft((d) => ({
                      ...d,
                      weekdays: on
                        ? d.weekdays.filter((x) => x !== i)
                        : [...d.weekdays, i].sort((a, b) => a - b),
                    }))
                  }
                  style={{
                    fontFamily: MONO,
                    fontSize: 10,
                    width: 24,
                    height: 24,
                    borderRadius: 6,
                    cursor: 'pointer',
                    border: `1px solid ${on ? 'var(--seal, #1A5E6B)' : 'var(--paper-2, #EAE4D8)'}`,
                    background: on ? 'var(--seal-tint, rgba(26,94,107,.10))' : 'transparent',
                    color: on ? 'var(--seal-deep, #14515C)' : 'var(--ink-3, #7C7365)',
                    fontWeight: on ? 600 : 400,
                  }}
                >
                  {letter}
                </button>
              );
            })}
          </span>
        </Field>

        <Field label="Closes at">
          <input
            type="time"
            value={draft.cutoffTime}
            onChange={(e) => setDraft((d) => ({ ...d, cutoffTime: e.target.value }))}
            style={{ ...fieldStyle, width: '100%' }}
          />
        </Field>

        <Field label="How long before delivery">
          <select
            value={draft.cutoffOffset}
            onChange={(e) => setDraft((d) => ({ ...d, cutoffOffset: e.target.value }))}
            style={{ ...fieldStyle, width: '100%' }}
          >
            <option value="">{ST_EM} not said</option>
            <option value="0">same day</option>
            <option value="1">the day before</option>
            <option value="2">two days before</option>
            <option value="3">three days before</option>
          </select>
        </Field>

        <Field label={`Minimum order (${currency})`}>
          <input
            type="number"
            min={0}
            inputMode="decimal"
            value={draft.minimum}
            onChange={(e) => setDraft((d) => ({ ...d, minimum: e.target.value }))}
            style={{ ...fieldStyle, width: '100%' }}
          />
        </Field>

        <Field label="Lead time (days)">
          <input
            type="number"
            min={0}
            max={365}
            value={draft.leadTime}
            onChange={(e) => setDraft((d) => ({ ...d, leadTime: e.target.value }))}
            style={{ ...fieldStyle, width: '100%' }}
          />
        </Field>

        <Field label="Payment terms">
          <input
            type="text"
            placeholder="Net 30, prepaid, 2% 10 net 30…"
            value={draft.paymentTerms}
            onChange={(e) => setDraft((d) => ({ ...d, paymentTerms: e.target.value }))}
            style={{ ...fieldStyle, width: '100%' }}
          />
        </Field>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
        <Btn onClick={() => onSave(body)} disabled={busy || nothingChanged}>
          {busy ? 'Recording…' : 'Record what they said'}
        </Btn>
        <Btn quiet onClick={onClose}>
          Close
        </Btn>
        <span style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--ink-3, #7C7365)' }}>
          {nothingChanged
            ? 'Nothing has changed, so there is nothing to record.'
            : 'Your name and the time are filed with this, on the provider row.'}
        </span>
      </div>
    </div>
  );
}

/* ── The section ─────────────────────────────────────────────────────────── */

function Words({ children, alert }: { children: React.ReactNode; alert?: boolean }) {
  return (
    <p
      role={alert ? 'alert' : 'status'}
      style={{
        fontFamily: SANS,
        fontSize: 12,
        lineHeight: 1.55,
        color: 'var(--ink-2, #4F473C)',
        margin: '6px 0 0',
      }}
    >
      {children}
    </p>
  );
}

export function TermsSection({ providerId, providerName }: { providerId: string; providerName: string }) {
  const terms = useProviderTerms(providerId);
  const [editing, setEditing] = useState(false);
  const reg = terms.register;
  const row = terms.row;
  const currency = reg?.currency.code ?? 'USD';

  return (
    <section style={{ fontFamily: SANS }}>
      <h3
        style={{
          fontFamily: MONO,
          fontSize: 9.5,
          fontWeight: 600,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--ink-3, #7C7365)',
          margin: '14px 0 4px',
        }}
      >
        Terms
      </h3>

      {terms.loading && <Words>Reading the terms register…</Words>}

      {terms.denied && (
        <Words alert>
          This account may not read the terms register, so the terms for{' '}
          {providerName} are unknown here — not absent.
        </Words>
      )}

      {!terms.denied && terms.error && (
        <Words alert>
          The terms register could not be read — {terms.error}. Nothing is shown
          below, which is not the same as this vendor having no terms.{' '}
          <button
            type="button"
            onClick={terms.reload}
            style={{
              fontFamily: SANS,
              fontSize: 12,
              fontWeight: 600,
              background: 'transparent',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              color: 'var(--seal-deep, #14515C)',
              textDecoration: 'underline',
            }}
          >
            Try again
          </button>
        </Words>
      )}

      {reg && !row && (
        <Words>
          The register was read and holds no row for {providerName}. Its terms are
          unknown, not empty.
        </Words>
      )}

      {reg && row && (
        <>
          {!reg.sources.statedTerms.readable && (
            <Words alert>
              The book of stated terms could not be read — {reg.sources.statedTerms.reason}.
              What follows is inference or the vendor record only; this is not a
              house that has stated nothing.
            </Words>
          )}
          {!reg.sources.orders.readable && (
            <Words alert>
              The order ledger could not be read — {reg.sources.orders.reason}.
              Nothing below is inferred, which is not the same as nothing being
              inferable.
            </Words>
          )}

          <div style={{ marginTop: 4 }}>
            <Cell
              label="Closes"
              cell={row.orderCutoff}
              render={(c) =>
                c.time
                  ? fmtCutoff(c.time, c.offsetDays)
                  : `after ${c.notBefore}${c.notAfter ? `, before ${c.notAfter}` : ' — nothing has missed yet'}`
              }
            />
            <Cell label="Delivers" cell={row.deliveryWeekdays} render={(d) => fmtWeekdays(d)} />
            <Cell
              label="Will not go below"
              cell={row.minimumOrder}
              render={(m) =>
                row.minimumOrder.source === 'inferred'
                  ? `≤ ${fmtMoney(m, currency)}`
                  : fmtMoney(m, currency)
              }
            />
            <Cell
              label="Lead time"
              cell={row.leadTimeDays}
              render={(d) => (d === 0 ? 'same day' : `${d} day${d === 1 ? '' : 's'}`)}
            />
            <Cell label="Payment" cell={row.paymentTerms} render={(t) => t} />
          </div>

          <p style={{ fontFamily: SANS, fontSize: 11, lineHeight: 1.5, color: 'var(--ink-3, #7C7365)', margin: '8px 0 0' }}>
            {row.statedBy || row.statedAt
              ? `Last written down by ${row.statedBy?.name ?? 'someone whose name is not on the row'} ${fmtWhen(row.statedAt)}.`
              : 'Nobody has written these down for this house yet.'}{' '}
            Inference looks back {reg.windowDays} days over this restaurant’s own
            orders, and it is never written to the vendor record.
          </p>

          {terms.saveError && (
            <Words alert>{terms.saveError}</Words>
          )}
          {terms.audited === false && (
            <Words alert>
              The terms were recorded, but the audit trail did not take the entry
              — {terms.auditReason ?? 'no reason was given'}. The change is real
              and unlogged; say so before relying on the trail.
            </Words>
          )}

          {editing ? (
            <Editor
              key={row.providerId}
              row={row}
              currency={currency}
              busy={terms.saving}
              onClose={() => setEditing(false)}
              onSave={(body) => {
                void terms.save(body).then((ok) => {
                  if (ok) setEditing(false);
                });
              }}
            />
          ) : (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
              <Btn onClick={() => setEditing(true)}>Record what they said</Btn>
              <a
                href="/settings?tab=vendor-terms"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontFamily: SANS,
                  fontSize: 11.5,
                  color: 'var(--seal-deep, #14515C)',
                }}
              >
                Every vendor’s terms
                <ExternalLink size={11} aria-hidden />
              </a>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default TermsSection;
