/**
 * Register 05 — Vendor terms.
 *
 * The founder's note for this pass: *"The more Vendor terms, thresholds, audit
 * trail -> this looks super detailed and I like it a lot, the more insights
 * functionality the better."* Sketch 091's `vendor-terms.html` is what he was
 * looking at; this is that register built.
 *
 * THE ONE STRUCTURAL IDEA: **a term is a claim, and every claim shows its
 * source.** Five fields per vendor, and each cell carries one of four sources —
 * stated by a person here (with their name and the date), read off the vendor
 * record (with the column named), inferred from this tenant's own orders (with
 * the receipt count and a confidence), or unknown (with the reason). The cell
 * cannot be rendered without one: `Cell` takes the whole `TermCell` and
 * branches on `source`, so there is no code path that prints a value with no
 * provenance under it.
 *
 * WHAT THAT SHAPE CAUGHT. `providers.lead_time_days` is `DEFAULT 7` and
 * `providers.payment_terms` is `DEFAULT 'Net 30'`, so every provider row in the
 * database has always asserted a seven-day lead time on Net 30 whether anyone
 * was ever asked or not. The gateway reports a value indistinguishable from its
 * column default as UNKNOWN rather than as a term
 * (`vendor-terms/vendor-terms.service.ts`), and the register prints the reason.
 * That is [[absence-reported-as-health]] living in a column default, and it was
 * only visible because every cell had to declare where it came from.
 *
 * THE OTHER HALF: an inference is never a value. The cutoff is a BRACKET —
 * "after 13:40, before 15:10" — because a house's own placement times can only
 * bound a vendor's cutoff, never state it; and the minimum is stated as "they
 * have accepted as little as X", because every row in the ledger is an order
 * the vendor took and a refusal leaves no row at all.
 */

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  Action,
  Micro,
  Note,
  Register,
  SaveFailure,
  fieldStyle,
} from './SectionKit';
import {
  EM,
  MONO,
  SANS,
  SERIF,
  SOURCE_LABEL,
  WEEKDAY_INITIALS,
  fmtCutoff,
  fmtMoney,
  fmtWeekdays,
  fmtWhen,
  word,
  type TermSource,
} from './st-format';
import type {
  SetVendorTermsBody,
  SettingsNextData,
  TermCell,
  VendorTermsRegister,
  VendorTermsRow,
} from './useSettingsNextData';

/* ── One cell ────────────────────────────────────────────────────────────── */

const SOURCE_TONE: Record<TermSource, string> = {
  stated: 'var(--seal-deep)',
  vendor_record: 'var(--seal-deep)',
  inferred: 'var(--ink-3)',
  unknown: 'var(--ink-3)',
};

function Cell<T>({ cell, render }: { cell: TermCell<T>; render: (v: T) => React.ReactNode }) {
  const known = cell.value !== null && cell.value !== undefined;
  return (
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          fontFamily: known ? MONO : SANS,
          fontSize: 12.5,
          color: known ? 'var(--ink-1)' : 'var(--ink-3)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {known ? render(cell.value as T) : EM}
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
        title={
          cell.reason ??
          cell.basis ??
          cell.column ??
          (cell.statedAt ? `stated ${fmtWhen(cell.statedAt)}` : undefined)
        }
      >
        {cell.source === 'inferred'
          ? `inferred · ${cell.n ?? 0} · ${cell.confidence ?? 'low'}`
          : SOURCE_LABEL[cell.source]}
      </span>
      {cell.contradiction && (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            fontFamily: SANS,
            fontSize: 10.5,
            lineHeight: 1.4,
            color: 'var(--ink-2)',
            marginTop: 3,
          }}
        >
          <AlertTriangle size={11} aria-hidden style={{ color: 'var(--seal-deep)', flexShrink: 0 }} />
          {cell.contradiction}
        </span>
      )}
    </div>
  );
}

/** The seven-box weekday strip. Off days are ink-3 on paper, never hidden. */
function DayStrip({ days }: { days: number[] }) {
  return (
    <span style={{ display: 'flex', gap: 2 }} aria-label={fmtWeekdays(days)}>
      {WEEKDAY_INITIALS.map((initial, i) => {
        const on = days.includes(i);
        return (
          <span
            key={i}
            aria-hidden
            style={{
              fontFamily: MONO,
              fontSize: 9.5,
              width: 18,
              height: 18,
              lineHeight: '18px',
              textAlign: 'center',
              borderRadius: 5,
              background: on ? 'var(--seal-tint)' : 'var(--paper-2)',
              color: on ? 'var(--seal-deep)' : 'var(--ink-3)',
              fontWeight: on ? 600 : 400,
              boxShadow: on ? 'inset 0 0 0 1px var(--seal-ring)' : undefined,
            }}
          >
            {initial}
          </span>
        );
      })}
    </span>
  );
}

/* ── The editor for one vendor ───────────────────────────────────────────── */

interface DraftState {
  weekdays: number[];
  cutoffTime: string;
  cutoffOffset: string;
  minimum: string;
  leadTime: string;
  paymentTerms: string;
}

function draftFrom(row: VendorTermsRow): DraftState {
  // Only STATED values seed the form. Seeding it from an inference would turn a
  // guess into the house's word the moment somebody pressed Record — which is
  // the whole failure this register exists to prevent.
  const stated = <T,>(cell: TermCell<T>): T | null =>
    cell.source === 'stated' ? (cell.value as T | null) : null;
  const cutoff = stated(row.orderCutoff);
  return {
    weekdays: stated(row.deliveryWeekdays) ?? [],
    cutoffTime: cutoff?.time ?? '',
    cutoffOffset: cutoff?.offsetDays === null || cutoff?.offsetDays === undefined
      ? ''
      : String(cutoff.offsetDays),
    minimum: stated(row.minimumOrder) === null ? '' : String(stated(row.minimumOrder)),
    leadTime: stated(row.leadTimeDays) === null ? '' : String(stated(row.leadTimeDays)),
    paymentTerms: stated(row.paymentTerms) ?? '',
  };
}

function toBody(draft: DraftState, before: DraftState): SetVendorTermsBody {
  const body: SetVendorTermsBody = {};
  // Only what the person actually touched is sent. An untouched field must stay
  // absent from the payload, because the gateway reads an explicit null as
  // "withdraw the statement" and a missing key as "leave it alone".
  if (JSON.stringify(draft.weekdays) !== JSON.stringify(before.weekdays)) {
    body.deliveryWeekdays = draft.weekdays;
  }
  if (draft.cutoffTime !== before.cutoffTime) {
    body.orderCutoffTime = draft.cutoffTime.trim() === '' ? null : draft.cutoffTime;
  }
  if (draft.cutoffOffset !== before.cutoffOffset) {
    body.orderCutoffOffsetDays =
      draft.cutoffOffset.trim() === '' ? null : Number(draft.cutoffOffset);
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
          color: 'var(--ink-3)',
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
  /** `null` when the house has not been asked what money it reports in. */
  currency: string | null;
  busy: boolean;
  onSave: (body: SetVendorTermsBody) => void;
  onClose: () => void;
}) {
  const initial = draftFrom(row);
  const [draft, setDraft] = useState<DraftState>(initial);
  const body = toBody(draft, initial);
  const nothingChanged = Object.keys(body).length === 0;

  return (
    <div
      style={{
        gridColumn: '1 / -1',
        borderTop: '1px solid var(--paper-2)',
        padding: '12px 0 4px',
      }}
    >
      <p style={{ fontFamily: SANS, fontSize: 12, lineHeight: 1.55, color: 'var(--ink-2)', margin: '0 0 10px' }}>
        Write down what {row.providerName} told you. A field left blank is
        withdrawn — the house stops claiming it, and the inference below takes
        over again. Nothing here is filled in from a guess.
      </p>

      <div
        style={{
          display: 'grid',
          gap: 12,
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          alignItems: 'end',
        }}
      >
        <Field label="Delivery days">
          <span style={{ display: 'flex', gap: 3 }}>
            {WEEKDAY_INITIALS.map((initialLetter, i) => {
              const on = draft.weekdays.includes(i);
              return (
                <button
                  key={i}
                  type="button"
                  aria-pressed={on}
                  aria-label={fmtWeekdays([i])}
                  className="st-ink st-focus"
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
                    border: `1px solid ${on ? 'var(--seal)' : 'var(--paper-2)'}`,
                    background: on ? 'var(--seal-tint)' : 'transparent',
                    color: on ? 'var(--seal-deep)' : 'var(--ink-3)',
                    fontWeight: on ? 600 : 400,
                  }}
                >
                  {initialLetter}
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
            <option value="">{EM} not said</option>
            <option value="0">same day</option>
            <option value="1">the day before</option>
            <option value="2">two days before</option>
            <option value="3">three days before</option>
          </select>
        </Field>

        <Field
          label={
            currency
              ? `Minimum order (${currency})`
              : 'Minimum order (currency not recorded)'
          }
        >
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

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
        <Action onClick={() => onSave(body)} disabled={busy || nothingChanged}>
          {busy ? 'Recording…' : 'Record what they said'}
        </Action>
        <Action tone="quiet" onClick={onClose}>
          Close
        </Action>
        <span style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--ink-3)' }}>
          {nothingChanged
            ? 'Nothing has changed, so there is nothing to record.'
            : `Your name and the time are kept with ${word(Object.keys(body).length)} of these.`}
        </span>
      </div>
    </div>
  );
}

/* ── The register ────────────────────────────────────────────────────────── */

const HEAD: Array<{ key: string; label: string }> = [
  { key: 'vendor', label: 'Vendor' },
  { key: 'closes', label: 'Closes' },
  { key: 'delivers', label: 'Delivers' },
  { key: 'minimum', label: 'Will not go below' },
  { key: 'lead', label: 'Lead time' },
  { key: 'pays', label: 'Payment' },
];

export function VendorTermsSection({ data }: { data: SettingsNextData }) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <Register<VendorTermsRegister> remote={data.vendorTerms} name="the vendor terms">
      {(reg) => (
        <div>
          <Note>
            Five terms per vendor, each saying where it came from. A term the
            house has been told is kept with the name of whoever wrote it down;
            a term nobody has stated is worked out from this restaurant&rsquo;s
            own orders over the last {reg.windowDays} days, with the number of
            receipts behind it; and where neither can answer, the answer is an
            em dash with its reason, never a zero.
          </Note>

          {!reg.sources.statedTerms.readable && (
            <p
              role="alert"
              style={{
                fontFamily: SANS, fontSize: 12, lineHeight: 1.55, color: 'var(--ink-1)',
                background: 'var(--paper-2)', borderRadius: 8, padding: '8px 11px', margin: '0 0 12px',
              }}
            >
              The book of stated terms could not be read — {reg.sources.statedTerms.reason}.
              Everything below is inference or the vendor record only; this is not
              a house that has stated nothing.
            </p>
          )}
          {!reg.sources.orders.readable && (
            <p
              role="alert"
              style={{
                fontFamily: SANS, fontSize: 12, lineHeight: 1.55, color: 'var(--ink-1)',
                background: 'var(--paper-2)', borderRadius: 8, padding: '8px 11px', margin: '0 0 12px',
              }}
            >
              The order ledger could not be read — {reg.sources.orders.reason}. Nothing
              is inferred below, which is not the same as nothing being inferable.
            </p>
          )}

          {reg.zone.isColumnDefault && (
            <p style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.55, color: 'var(--ink-3)', margin: '0 0 6px' }}>
              Weekdays and closing times below are read in <strong>{reg.zone.zone}</strong>,
              which is this restaurant&rsquo;s stored timezone and also that
              column&rsquo;s default value — so it may simply never have been set.
              A delivery signed for late at night can land on the wrong weekday
              if it is wrong.
            </p>
          )}
          {/* Two different states, said differently. Before 2026-09-05 they were
              one: `restaurants.currency` defaulted to USD, so "nobody answered"
              and "this house is American" were the same row (ADR 0117 Q25). */}
          {reg.currency.code === null ? (
            <p style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.55, color: 'var(--ink-3)', margin: '0 0 12px' }}>
              This house has not recorded the money it reports in, so amounts
              below are shown as bare numbers. Set it on the sign-up form or ask
              us to record it — nothing here is in dollars by default any more.
            </p>
          ) : reg.currency.isColumnDefault ? (
            <p style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.55, color: 'var(--ink-3)', margin: '0 0 12px' }}>
              Money is shown in <strong>{reg.currency.code}</strong>, which was
              also that column&rsquo;s default until 2026-09-05, so on a house
              created before then it may never have been chosen.
            </p>
          ) : null}

          {reg.vendors.length === 0 ? (
            <Note role="status">
              No vendor is on this restaurant&rsquo;s books, so there are no terms
              to hold. The vendor list itself was read successfully
              {reg.sources.providers.rows !== null ? ` and returned ${reg.sources.providers.rows} rows` : ''} —
              this is an empty register, not a failed one.
            </Note>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 780 }}>
                <thead>
                  <tr>
                    {HEAD.map((h) => (
                      <th
                        key={h.key}
                        scope="col"
                        style={{
                          textAlign: 'left', fontFamily: MONO, fontSize: 9.5, fontWeight: 600,
                          letterSpacing: '0.11em', textTransform: 'uppercase', color: 'var(--ink-3)',
                          padding: '0 10px 8px 0', borderBottom: '1px solid var(--ink-1)', verticalAlign: 'bottom',
                        }}
                      >
                        {h.label}
                      </th>
                    ))}
                    <th scope="col" style={{ borderBottom: '1px solid var(--ink-1)' }}>
                      <span className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
                        Record terms
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {reg.vendors.map((v) => (
                    <tr key={v.providerId} style={{ verticalAlign: 'top' }}>
                      <td style={cellStyle}>
                        <div style={{ fontFamily: SANS, fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>
                          {v.providerName}
                        </div>
                        <div style={{ fontFamily: SANS, fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>
                          {v.ordersInWindow === 0
                            ? 'no orders in the window'
                            : `${v.ordersInWindow} order${v.ordersInWindow === 1 ? '' : 's'} · last ${
                                v.lastOrderedAt ? fmtWhen(v.lastOrderedAt) : EM
                              }`}
                        </div>
                      </td>
                      <td style={cellStyle}>
                        <Cell
                          cell={v.orderCutoff}
                          render={(c) =>
                            c.time
                              ? fmtCutoff(c.time, c.offsetDays)
                              : `after ${c.notBefore}${c.notAfter ? `, before ${c.notAfter}` : ' — nothing has missed yet'}`
                          }
                        />
                      </td>
                      <td style={cellStyle}>
                        <Cell cell={v.deliveryWeekdays} render={(d) => <DayStrip days={d} />} />
                      </td>
                      <td style={cellStyle}>
                        <Cell
                          cell={v.minimumOrder}
                          render={(m) =>
                            v.minimumOrder.source === 'inferred'
                              ? `≤ ${fmtMoney(m, reg.currency.code)}`
                              : fmtMoney(m, reg.currency.code)
                          }
                        />
                      </td>
                      <td style={cellStyle}>
                        <Cell cell={v.leadTimeDays} render={(d) => (d === 0 ? 'same day' : `${d} day${d === 1 ? '' : 's'}`)} />
                      </td>
                      <td style={cellStyle}>
                        <Cell cell={v.paymentTerms} render={(t) => t} />
                      </td>
                      <td style={{ ...cellStyle, textAlign: 'right' }}>
                        <Action
                          tone="quiet"
                          onClick={() => setOpen((o) => (o === v.providerId ? null : v.providerId))}
                        >
                          {open === v.providerId ? 'Close' : 'Record'}
                        </Action>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {open && (() => {
            const row = reg.vendors.find((v) => v.providerId === open);
            if (!row) return null;
            return (
              <Editor
                key={row.providerId}
                row={row}
                currency={reg.currency.code}
                busy={data.writer.busy === `terms:${row.providerId}`}
                onClose={() => setOpen(null)}
                onSave={(body) => {
                  void data.saveVendorTerms(row.providerId, body).then((ok) => {
                    if (ok) setOpen(null);
                  });
                }}
              />
            );
          })()}

          <SaveFailure
            failed={data.writer.failed?.key.startsWith('terms:') ? data.writer.failed : null}
            what="Nothing was recorded; what the table already held is unchanged."
          />

          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginTop: 14 }}>
            <LegendItem tone="var(--seal-deep)" label="stated by the house">
              a person wrote it down here, or it sits on the vendor record. Their
              name and the date are kept.
            </LegendItem>
            <LegendItem tone="var(--ink-3)" label="inferred">
              computed from this restaurant&rsquo;s own orders at read time, with
              the receipt count. Never written down as a fact.
            </LegendItem>
            <LegendItem tone="var(--ink-3)" label={`${EM} unknown`}>
              nobody has said and the ledger cannot tell. That is an answer, not
              a blank.
            </LegendItem>
          </div>

          <p style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 12.5, lineHeight: 1.6, color: 'var(--ink-2)', margin: '16px 0 0', maxWidth: 720 }}>
            A closing time is bracketed, never stated: this house&rsquo;s own
            orders can only say the latest one that still made the vendor&rsquo;s
            fastest turnaround and the earliest one that did not. A minimum is
            read the same way — every order in the books is one the vendor
            accepted, so the smallest of them proves the floor is at most that,
            and a refusal leaves no row to read.
          </p>
        </div>
      )}
    </Register>
  );
}

const cellStyle: React.CSSProperties = {
  padding: '11px 10px 11px 0',
  borderBottom: '1px solid var(--paper-2)',
};

function LegendItem({ tone, label, children }: { tone: string; label: string; children: React.ReactNode }) {
  return (
    <span style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-3)', maxWidth: 260 }}>
      <Micro tone={tone === 'var(--seal-deep)' ? 'seal' : undefined}>{label}</Micro>{' '}
      — {children}
    </span>
  );
}

export default VendorTermsSection;
