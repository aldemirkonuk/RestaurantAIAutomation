/**
 * SettingsNext — the shared parts every register is built from.
 *
 * `Row` is the page's structural idea made into a component: a setting is a
 * label, the consequence of changing it, and a PROVENANCE line saying where the
 * value is kept and when it was last written. The provenance line is not
 * decoration — it is the honest answer to "did flipping this change anything,
 * and for whom", which is the question the legacy page could not answer.
 *
 * `Dead` is its twin: a setting the product stores but nothing reads. It shows
 * the stored value as TEXT and carries no control, because a control whose
 * effect does not exist is the thing ADR 0020 forbids. The `readBy` line names
 * the file that was grepped, so the claim is checkable.
 */

import { CSSProperties, ReactNode, useId, useState } from 'react';
import { EM, KEPT_LABEL, KEPT_NOTE, MONO, SANS, SERIF, fmtExact, fmtWhen, type Kept } from './st-format';
import type { Remote } from './useSettingsNextData';

/* ── Type ────────────────────────────────────────────────────────────────── */

export const microStyle: CSSProperties = {
  fontFamily: MONO,
  fontSize: 9.5,
  fontWeight: 600,
  letterSpacing: '0.13em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
};

export function Micro({ children, tone }: { children: ReactNode; tone?: 'seal' }) {
  return <span style={{ ...microStyle, color: tone === 'seal' ? 'var(--seal-deep)' : 'var(--ink-3)' }}>{children}</span>;
}

export function Note({ children, role }: { children: ReactNode; role?: 'status' | 'alert' }) {
  return (
    <p role={role} style={{ fontFamily: SANS, fontSize: 12, lineHeight: 1.55, color: 'var(--ink-2)', margin: '0 0 10px' }}>
      {children}
    </p>
  );
}

/** The one style every text input, time input and select on the page uses. */
export const fieldStyle: CSSProperties = {
  fontFamily: SANS,
  fontSize: 12,
  padding: '5px 8px',
  borderRadius: 8,
  border: '1px solid var(--paper-2)',
  background: 'var(--paper-0)',
  color: 'var(--ink-1)',
};

/**
 * A write that did not go through, said where the reader is looking.
 *
 * Every register needs this and each one used to hand-roll the same paragraph;
 * more importantly, a failed write must never be swallowed into a toast that
 * scrolls away, and a shared component is what stops one register quietly
 * forgetting to render `writer.failed`.
 */
export function SaveFailure({ failed, what }: { failed: { message: string } | null; what: string }) {
  if (!failed) return null;
  return (
    <p
      role="alert"
      style={{
        fontFamily: SANS, fontSize: 12, lineHeight: 1.5, color: 'var(--ink-1)',
        background: 'var(--paper-2)', borderRadius: 8, padding: '8px 11px', margin: '10px 0 0',
      }}
    >
      That did not go through — {failed.message}. {what}
    </p>
  );
}

export function Rule({ double }: { double?: boolean }) {
  return double ? (
    <div aria-hidden style={{ borderTop: '1px solid var(--ink-1)', borderBottom: '1px solid var(--ink-1)', height: 3, opacity: 0.55, margin: '14px 0' }} />
  ) : (
    <div aria-hidden style={{ borderTop: '1px solid var(--paper-2)', margin: '2px 0' }} />
  );
}

/* ── Controls ────────────────────────────────────────────────────────────── */

export function Toggle({
  checked, onChange, label, disabled, busy,
}: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean; busy?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled || busy}
      onClick={() => onChange(!checked)}
      className="st-ink st-focus"
      style={{
        position: 'relative', width: 40, height: 22, flexShrink: 0, borderRadius: 999,
        border: `1px solid ${checked ? 'var(--seal)' : 'var(--paper-2)'}`,
        background: checked ? 'var(--seal)' : 'var(--paper-2)',
        cursor: disabled || busy ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1, padding: 0,
      }}
    >
      <span
        className="st-thumb"
        style={{
          position: 'absolute', top: 2, left: 2, width: 16, height: 16, borderRadius: 999,
          background: 'var(--paper-0)', boxShadow: '0 1px 2px rgba(23,19,15,.25)',
          transform: checked ? 'translateX(18px)' : 'none',
        }}
      />
    </button>
  );
}

export function Choice<T extends string>({
  value, options, onChange, label, disabled,
}: { value: T | null; options: Array<{ value: T; label: string }>; onChange: (v: T) => void; label: string; disabled?: boolean }) {
  return (
    <div role="group" aria-label={label} style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className="st-ink st-focus"
            style={{
              fontFamily: SANS, fontSize: 12, fontWeight: on ? 600 : 500, padding: '5px 12px', borderRadius: 8,
              border: `1px solid ${on ? 'var(--seal)' : 'var(--paper-2)'}`,
              background: on ? 'var(--seal-tint)' : 'transparent',
              color: on ? 'var(--seal-deep)' : 'var(--ink-2)',
              // Disabled, not hidden — the choice stays legible so a person can
              // read the rule they are not allowed to change (ADR 0116).
              cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1,
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Action({
  children, onClick, tone, disabled, type = 'button',
}: { children: ReactNode; onClick?: () => void; tone?: 'quiet' | 'grave'; disabled?: boolean; type?: 'button' | 'submit' }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="st-ink st-focus"
      style={{
        fontFamily: SANS, fontSize: 12, fontWeight: 600, padding: '6px 13px', borderRadius: 8,
        border: `1px solid ${tone === 'grave' ? 'var(--ink-3)' : 'var(--seal-ring)'}`,
        background: 'transparent',
        color: tone === 'grave' ? 'var(--ink-2)' : tone === 'quiet' ? 'var(--ink-2)' : 'var(--seal-deep)',
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1,
      }}
    >
      {children}
    </button>
  );
}

/* ── Rows ────────────────────────────────────────────────────────────────── */

export interface Provenance {
  kept: Kept;
  /** ISO date of the last write, or null when nothing records one. */
  when?: string | null;
  /** Why there is no date. Required when `when` is null — never left blank. */
  whenUnknown?: string;
  /**
   * What the date is a date OF. Defaults to "changed".
   *
   * It exists because two registers hold a date that is real but is not a
   * last-changed date: an invite records when it was *issued* and a member's
   * access row records when it was *granted*. Printing either under the word
   * "changed" would be a small, confident lie about a true number — the
   * shape [[absence-reported-as-health]] warns about, wearing its opposite face.
   */
  verb?: string;
}

function ProvenanceLine({ kept, when, whenUnknown, verb = 'changed' }: Provenance) {
  const known = Boolean(when);
  return (
    <p style={{ ...microStyle, margin: '5px 0 0', letterSpacing: '0.1em', fontWeight: 500 }} title={fmtExact(when)}>
      kept · {KEPT_LABEL[kept]}
      <span aria-hidden style={{ opacity: 0.45 }}> — </span>
      {verb} · {known ? fmtWhen(when) : <span title={whenUnknown}>{EM} {whenUnknown ?? 'no date is recorded'}</span>}
    </p>
  );
}

export function Row({
  label, consequence, provenance, control, children, tone,
}: {
  label: string;
  consequence: ReactNode;
  provenance?: Provenance;
  control?: ReactNode;
  children?: ReactNode;
  tone?: 'grave';
}) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 16, padding: '13px 0',
        borderTop: '1px solid var(--paper-2)',
        background: tone === 'grave' ? 'var(--seal-tint)' : undefined,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontFamily: SANS, fontSize: 13.5, fontWeight: 600, color: 'var(--ink-1)', margin: 0 }}>{label}</p>
        <p style={{ fontFamily: SANS, fontSize: 12, lineHeight: 1.55, color: 'var(--ink-2)', margin: '3px 0 0' }}>
          {consequence}
        </p>
        {provenance && <ProvenanceLine {...provenance} />}
        {children}
      </div>
      {control && <div style={{ flexShrink: 0, paddingTop: 2 }}>{control}</div>}
    </div>
  );
}

/**
 * A setting the product STORES but nothing READS. No control — the stored
 * value is shown as text, and `readBy` says where that was checked.
 */
export function Dead({
  label, consequence, stored, evidence,
}: { label: string; consequence: ReactNode; stored: ReactNode; evidence: string }) {
  return (
    <Row
      label={label}
      consequence={consequence}
      control={
        <span
          style={{
            fontFamily: MONO, fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase',
            color: 'var(--ink-3)', border: '1px dashed var(--paper-2)', borderRadius: 999, padding: '3px 9px', whiteSpace: 'nowrap',
          }}
        >
          {stored}
        </span>
      }
    >
      <p style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-3)', margin: '5px 0 0' }}>
        No switch: nothing in the product reads this. {evidence}
      </p>
    </Row>
  );
}

/* ── Register shell — the four honest states ─────────────────────────────── */

export function Register<T>({
  remote, name, children, deniedNote,
}: {
  remote: Remote<T>;
  /** How this register is named in a sentence, e.g. "the team roster". */
  name: string;
  children: (data: T) => ReactNode;
  deniedNote?: string;
}) {
  if (remote.status === 'idle' || remote.status === 'loading') {
    return <Note role="status">Opening {name}…</Note>;
  }
  if (remote.status === 'denied') {
    return (
      <Note role="status">
        {deniedNote ?? `Your role may not read ${name}. Nothing is shown, because we were refused — not because it is empty.`}
      </Note>
    );
  }
  if (remote.status === 'error' || remote.data === null) {
    return (
      <div role="alert" style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--ink-2)', margin: '0 0 12px' }}>
        <p style={{ margin: '0 0 8px', lineHeight: 1.55 }}>
          {name.charAt(0).toUpperCase() + name.slice(1)} could not be read — {remote.error ?? 'unknown error'}. Nothing
          below is claimed for it; this is not an empty register.
        </p>
        <Action onClick={remote.reload}>Try again</Action>
      </div>
    );
  }
  return <>{children(remote.data)}</>;
}

/* ── A settle disclosure ─────────────────────────────────────────────────── */

export function Disclosure({ summary, open, onToggle, children }: {
  summary: string; open: boolean; onToggle: () => void; children: ReactNode;
}) {
  const id = useId();
  return (
    <div style={{ borderTop: '1px solid var(--paper-2)', paddingTop: 10, marginTop: 4 }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={id}
        className="st-ink st-focus"
        style={{
          ...microStyle, display: 'flex', alignItems: 'center', gap: 6, background: 'transparent',
          border: 0, padding: '2px 0', cursor: 'pointer',
        }}
      >
        <span aria-hidden className="st-chev" style={{ transform: open ? 'rotate(90deg)' : 'none', display: 'inline-block' }}>›</span>
        {summary}
      </button>
      <div id={id} className="st-disc" data-open={open ? 'true' : 'false'}>
        <div style={{ overflow: 'hidden' }}>{open && <div style={{ paddingTop: 8 }}>{children}</div>}</div>
      </div>
    </div>
  );
}

export { SANS, SERIF, MONO, EM, KEPT_NOTE };

/**
 * A destructive action that arms before it fires — the dry-pressed die.
 *
 * `window.confirm` is what the legacy page uses; it is a browser chrome dialog
 * that says nothing about consequence and cannot be styled or read by a test.
 * This states the consequence in the page's own voice and needs two deliberate
 * clicks. The seal is NOT used here: the wax is rationed to granting autonomy.
 */
export function ConfirmAction({
  label, confirmLabel, consequence, onConfirm, busy,
}: {
  label: string;
  confirmLabel: string;
  consequence: string;
  onConfirm: () => void;
  busy?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return <Action tone="grave" disabled={busy} onClick={() => setArmed(true)}>{busy ? 'Working…' : label}</Action>;
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      <span style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--ink-2)', maxWidth: 260, textAlign: 'right' }}>
        {consequence}
      </span>
      <Action tone="grave" disabled={busy} onClick={() => { setArmed(false); onConfirm(); }}>{confirmLabel}</Action>
      <Action tone="quiet" onClick={() => setArmed(false)}>Keep as is</Action>
    </span>
  );
}
