/**
 * ProfileNext primitives — the page's one row shape, one chip, one field.
 *
 * The structural idea the whole page rests on: **everything attached to this
 * account renders through the same `ConnectionRow`, so a connection that works
 * and one whose backend does not exist differ only in their state chip and in
 * whether the control is live or `disabled` with a stated reason.** A section
 * cannot quietly promote itself by being drawn richer than its evidence, and a
 * control whose backend is missing is a `disabled` element carrying its reason
 * in words — never a Connect button that appears to work.
 */

import { CSSProperties, ReactNode, useId } from 'react';
import { ink, settle } from '../../../lib/mudavym/motion';
import { EM, MONO, SANS, SERIF } from './pf-format';
import type { ConnectionState } from './useProfileNextData';

/** Page-scoped CSS: hover/focus ink, the settle expand, reduced-motion guard. */
export const PF_CSS = `
.pf-row { transition: border-color ${ink.ms}ms ${ink.easing}, background ${ink.ms}ms ${ink.easing} }
.pf-row:hover { border-color: var(--seal-ring) }
.pf-btn { transition: border-color ${ink.ms}ms ${ink.easing}, background ${ink.ms}ms ${ink.easing}, color ${ink.ms}ms ${ink.easing} }
.pf-btn:hover:not(:disabled) { border-color: var(--seal-ring); background: var(--seal-tint) }
.pf-btn:disabled { opacity: .55; cursor: not-allowed }
.pf-expand { display: grid; grid-template-rows: 0fr; transition: grid-template-rows ${settle.ms}ms ${settle.easing} }
.pf-expand[data-open="true"] { grid-template-rows: 1fr }
.pf-expand > div { overflow: hidden; min-height: 0 }
.pf-focus:focus-visible { outline: 2px solid var(--seal); outline-offset: 2px; border-radius: 8px }
@media (prefers-reduced-motion: reduce) {
  .pf-row, .pf-btn, .pf-expand { transition: none !important }
}
`;

/* ── type ─────────────────────────────────────────────────────────────── */

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        fontFamily: MONO,
        fontSize: 8.5,
        fontWeight: 600,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: 'var(--seal-deep)',
      }}
    >
      {children}
    </span>
  );
}

export function Note({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <p id={id} style={{ margin: 0, fontFamily: SANS, fontSize: 12, color: 'var(--ink-3)' }}>
      {children}
    </p>
  );
}

/** A settled error or a settled confirmation. Always words, never an empty. */
export function StatusLine({ tone, children }: { tone: 'error' | 'done'; children: ReactNode }) {
  return (
    <p
      role="status"
      style={{
        margin: '8px 0 0',
        fontFamily: SANS,
        fontSize: 12,
        lineHeight: 1.5,
        color: tone === 'error' ? 'var(--ink-1)' : 'var(--seal-deep)',
        borderLeft: `2px solid ${tone === 'error' ? 'var(--ink-3)' : 'var(--seal-ring)'}`,
        paddingLeft: 8,
      }}
    >
      {children}
    </p>
  );
}

/* ── the register ─────────────────────────────────────────────────────── */

/**
 * A titled block. `ruledOff` draws the ledger's double rule — 057's mark, and
 * the accountant's sign that this account is being closed. It appears exactly
 * once on the page, above the exit.
 */
export function Register({
  eyebrow,
  title,
  lead,
  icon,
  ruledOff = false,
  children,
}: {
  eyebrow: string;
  title: string;
  lead?: ReactNode;
  /**
   * A lucide glyph beside the eyebrow. Ink, never the seal: an icon is a
   * finding aid down a long ledger, not a status, and a coloured one would
   * start competing with the state chips for meaning.
   */
  icon?: ReactNode;
  ruledOff?: boolean;
  children: ReactNode;
}) {
  return (
    <section style={{ marginTop: 28 }}>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          color: 'var(--seal-deep)',
        }}
      >
        {icon}
        <Eyebrow>{eyebrow}</Eyebrow>
      </span>
      <h2
        style={{
          margin: '2px 0 0',
          fontFamily: SERIF,
          fontSize: 22,
          fontWeight: 600,
          letterSpacing: '-0.015em',
          lineHeight: 1.15,
          color: 'var(--ink-1)',
        }}
      >
        {title}
      </h2>
      <div aria-hidden style={{ marginTop: 8, borderTop: '1px solid var(--paper-2)' }} />
      {ruledOff && (
        <div aria-hidden style={{ marginTop: 2, borderTop: '1px solid var(--paper-2)' }} />
      )}
      {lead && <div style={{ marginTop: 10 }}>{lead}</div>}
      <div style={{ marginTop: 12 }}>{children}</div>
    </section>
  );
}

/**
 * A named group of rows inside a register — the ledger's sub-heading.
 *
 * Lives here rather than in one register because four of the six use it now, and
 * a rail that looked different depending on which register drew it would undo
 * the page's whole argument: what separates two rows is their evidence, never
 * their styling.
 */
export function Rail({
  title,
  lead,
  icon,
  children,
}: {
  title: string;
  lead: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div style={{ marginTop: 18 }}>
      <h3
        style={{
          margin: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontFamily: SANS,
          fontSize: 12.5,
          fontWeight: 700,
          letterSpacing: '0.01em',
          color: 'var(--ink-1)',
        }}
      >
        <span aria-hidden style={{ display: 'inline-flex', color: 'var(--ink-3)' }}>
          {icon}
        </span>
        {title}
      </h3>
      <p style={{ margin: '2px 0 10px', fontFamily: SANS, fontSize: 12, color: 'var(--ink-3)' }}>
        {lead}
      </p>
      {children}
    </div>
  );
}

/**
 * A titled block inside a register. Same ground and border as a
 * `ConnectionRow`, because a form about the account and a row about a
 * connection are the same kind of object.
 */
export function Card({
  id,
  title,
  lead,
  children,
}: {
  id?: string;
  title: string;
  lead?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      id={id}
      style={{
        border: '1px solid var(--paper-2)',
        background: 'var(--paper-1)',
        borderRadius: 12,
        padding: '14px 16px',
        marginBottom: 10,
        scrollMarginTop: 24,
      }}
    >
      <h3 style={{ margin: 0, fontFamily: SANS, fontSize: 13, fontWeight: 700, color: 'var(--ink-1)' }}>
        {title}
      </h3>
      {lead && (
        <p style={{ margin: '2px 0 0', fontFamily: SANS, fontSize: 12, color: 'var(--ink-3)' }}>{lead}</p>
      )}
      <div style={{ marginTop: 12 }}>{children}</div>
    </div>
  );
}

/** The retry that belongs inside a settled error line. */
export function RetryLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="pf-focus"
      onClick={onClick}
      style={{
        background: 'none',
        border: 'none',
        padding: 0,
        font: 'inherit',
        color: 'var(--seal-deep)',
        textDecoration: 'underline',
        cursor: 'pointer',
      }}
    >
      Try again
    </button>
  );
}

const BTN_BASE: CSSProperties = {
  fontFamily: SANS,
  fontSize: 12,
  fontWeight: 600,
  padding: '6px 12px',
  borderRadius: 8,
  border: '1px solid var(--paper-2)',
  background: 'transparent',
  color: 'var(--ink-1)',
  cursor: 'pointer',
};

/* ── the row and its chip ─────────────────────────────────────────────── */

const CHIP_LABEL: Record<ConnectionState, string> = {
  connected: 'Connected',
  available: 'Not connected',
  unavailable: 'Unavailable',
  unbuilt: 'Not built',
  unknown: EM,
};

/**
 * Chip labels are ink, never a semantic colour — the seal is the only
 * chromatic mark on the page (ADR 0042), and it appears here only as the
 * hairline ring of a live connection.
 */
export function StateChip({ state }: { state: ConnectionState }) {
  const live = state === 'connected';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 9px',
        borderRadius: 999,
        border: `1px solid ${live ? 'var(--seal-ring)' : 'var(--paper-2)'}`,
        background: live ? 'var(--seal-tint)' : 'transparent',
        fontFamily: MONO,
        fontSize: 9.5,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: 'var(--ink-2)',
        whiteSpace: 'nowrap',
      }}
    >
      {CHIP_LABEL[state]}
    </span>
  );
}

/** The one row shape. Every rail of the Connections register uses it. */
export function ConnectionRow({
  title,
  subtitle,
  state,
  reason,
  controls,
  detail,
  detailOpen,
  onToggleDetail,
  detailLabel = 'Show the working',
}: {
  title: string;
  subtitle: ReactNode;
  state: ConnectionState;
  /** Why the control is disabled. Non-null exactly when something is. */
  reason?: string | null;
  controls?: ReactNode;
  detail?: ReactNode;
  detailOpen?: boolean;
  onToggleDetail?: () => void;
  detailLabel?: string;
}) {
  const detailId = useId();
  return (
    <div
      className="pf-row"
      style={{
        border: '1px solid var(--paper-2)',
        background: 'var(--paper-1)',
        borderRadius: 12,
        padding: '12px 14px',
        marginBottom: 8,
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'baseline' }}>
        <span
          style={{
            fontFamily: SANS,
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--ink-1)',
            flex: '1 1 auto',
          }}
        >
          {title}
        </span>
        <StateChip state={state} />
      </div>
      <div style={{ marginTop: 4, fontFamily: SANS, fontSize: 12, color: 'var(--ink-3)' }}>
        {subtitle}
      </div>
      {reason && (
        <p
          style={{
            margin: '6px 0 0',
            fontFamily: SANS,
            fontSize: 12,
            lineHeight: 1.5,
            color: 'var(--ink-2)',
          }}
        >
          {reason}
        </p>
      )}
      {(controls || detail) && (
        <div
          style={{
            marginTop: 10,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            alignItems: 'center',
          }}
        >
          {controls}
          {detail && (
            <button
              type="button"
              className="pf-btn pf-focus"
              onClick={onToggleDetail}
              aria-expanded={!!detailOpen}
              aria-controls={detailId}
              style={{ ...BTN_BASE, borderColor: 'transparent', color: 'var(--ink-3)' }}
            >
              {detailOpen ? 'Hide' : detailLabel}
            </button>
          )}
        </div>
      )}
      {detail && (
        <div className="pf-expand" data-open={detailOpen ? 'true' : 'false'} id={detailId}>
          <div>
            <div style={{ paddingTop: 10 }}>{detail}</div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── controls ─────────────────────────────────────────────────────────── */

export function Btn({
  children,
  onClick,
  disabled,
  emphasis = 'quiet',
  title,
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  emphasis?: 'quiet' | 'seal';
  /** Native tooltip — always mirrored by visible words elsewhere in the row. */
  title?: string;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      className="pf-btn pf-focus"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        ...BTN_BASE,
        ...(emphasis === 'seal'
          ? { borderColor: 'var(--seal-ring)', color: 'var(--seal-deep)' }
          : null),
      }}
    >
      {children}
    </button>
  );
}

/* ── fields ───────────────────────────────────────────────────────────── */

export function Field({
  id,
  label,
  value,
  onChange,
  type = 'text',
  disabled,
  readOnly,
  placeholder,
  autoComplete,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange?: (v: string) => void;
  type?: string;
  disabled?: boolean;
  readOnly?: boolean;
  placeholder?: string;
  autoComplete?: string;
  hint?: ReactNode;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label
        htmlFor={id}
        style={{
          display: 'block',
          marginBottom: 4,
          fontFamily: SANS,
          fontSize: 11.5,
          fontWeight: 600,
          color: 'var(--ink-2)',
        }}
      >
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        disabled={disabled}
        readOnly={readOnly}
        placeholder={placeholder}
        autoComplete={autoComplete}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        className="pf-focus"
        style={{
          width: '100%',
          maxWidth: 420,
          padding: '8px 10px',
          borderRadius: 8,
          border: '1px solid var(--paper-2)',
          background: readOnly || disabled ? 'var(--paper-2)' : 'var(--paper-1)',
          color: readOnly || disabled ? 'var(--ink-3)' : 'var(--ink-1)',
          fontFamily: SANS,
          fontSize: 13,
        }}
      />
      {hint && <div style={{ marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

/** A labelled `<select>`. Same shell as `Field`, so a form reads as one thing. */
export function Choice({
  id,
  label,
  value,
  onChange,
  options,
  disabled,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
  hint?: ReactNode;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label
        htmlFor={id}
        style={{
          display: 'block',
          marginBottom: 4,
          fontFamily: SANS,
          fontSize: 11.5,
          fontWeight: 600,
          color: 'var(--ink-2)',
        }}
      >
        {label}
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="pf-focus"
        style={{
          width: '100%',
          maxWidth: 420,
          padding: '8px 10px',
          borderRadius: 8,
          border: '1px solid var(--paper-2)',
          background: disabled ? 'var(--paper-2)' : 'var(--paper-1)',
          color: disabled ? 'var(--ink-3)' : 'var(--ink-1)',
          fontFamily: SANS,
          fontSize: 13,
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint && <div style={{ marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

/** A figure of record: tabular mono, em dash when unknown. */
export function Figure({ children }: { children: ReactNode }) {
  return (
    <span style={{ fontFamily: MONO, fontVariantNumeric: 'tabular-nums', fontSize: 12.5 }}>
      {children}
    </span>
  );
}
