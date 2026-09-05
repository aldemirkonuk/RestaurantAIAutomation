/**
 * The one row every attachment on `/connections` is drawn by.
 *
 * FOUR COLUMNS AND NO FIFTH (founder, 2026-09-03)
 * ----------------------------------------------
 *   whose it is · what it may do · what it last did · how to stop it
 *
 * A row that cannot be stopped from here NAMES WHO CAN — that is what
 * `stopNote` is for, and it is why `controls` may be empty but `stopNote` must
 * not be. The prop is required for exactly that reason: a row with no control
 * and no sentence would be a dead end the reader has to guess about, and
 * TypeScript is a cheaper reviewer than a person.
 *
 * The row draws a live POS feed and an unconnected Excel grant identically.
 * What separates them is the chip, whether the control is live, and the
 * sentence under it — so the page cannot flatter an empty attachment by
 * drawing it richer than its evidence.
 *
 * `may` entries carry `can: false` for a thing the attachment may NOT do.
 * Listing what is refused is half the value of the column: "sends closed
 * checks" is not an answer to "could this place an order".
 */

import type { ReactNode } from 'react';
import { HoldToApprove } from '../../../components/mudavym/HoldToApprove';
import { DASH } from './cx-format';

export type ChipTone = 'on' | 'off' | 'warn' | 'plain';

export interface RowChip {
  label: string;
  tone: ChipTone;
}

export interface RowPermission {
  text: string;
  /** false renders it as something the attachment may NOT do. */
  can: boolean;
}

/**
 * A plain control. There is NO `seal` flag on it any more, and its absence is
 * the point (audit, 2026-09-04).
 *
 * `is-seal` used to be a colour a caller could ask for, and callers did: the
 * calendar feed's "Regenerate" wore the seal's ring while being an ordinary
 * click. So the seal marked two different things — an act that had been proven
 * and an act that merely felt weighty — and the reader could not tell which
 * from looking. Now the seal's appearance is produced by `HoldToApprove` and by
 * nothing else, through `hold` below, so seeing it means a gesture is required.
 */
export interface RowControl {
  label: string;
  onClick?: () => void;
  /** Disabled controls MUST carry a reason — see `AttachmentRow`'s header. */
  disabled?: boolean;
  busy?: boolean;
  /**
   * Render this control as a hold-to-approve gesture instead of a button.
   *
   * `onChallenge` is called when the hold BEGINS and must resolve the one-time
   * seal the write will carry; `onApprove` receives it. A control that reaches
   * a server-side seal MUST be one of these — a button that sends "I was
   * sealed" is the assertion-in-its-own-request flaw, and the type is what
   * stops the next person writing one.
   */
  hold?: {
    onChallenge: () => Promise<string | null>;
    onApprove: (challenge?: string | null) => void;
  };
  /** Lets a long label wrap instead of being clipped. See `.cx-hold-wide`. */
  wrap?: boolean;
}

export interface AttachmentRowProps {
  icon: ReactNode;
  title: string;
  chips?: RowChip[];
  /** "the house's" · "a person's" · "the deployment's" · "public to anyone". */
  owner: string;
  /** The address, the identifier, the thing you would paste into a ticket. */
  subtitle?: string | null;
  /** What this is and why it matters, in the house's voice. */
  why: ReactNode;
  permissionsLabel?: string;
  permissions?: RowPermission[];
  lastLabel?: string;
  /** The headline fact. `null` renders the em dash, never "never" or "0". */
  last: string | null;
  lastDetail?: ReactNode;
  controls?: RowControl[];
  /** Required. A row with no control says who can stop it. */
  stopNote: string;
  nested?: boolean;
}

function chipClass(tone: ChipTone): string {
  if (tone === 'on') return 'cx-chip is-on';
  if (tone === 'off') return 'cx-chip is-off';
  if (tone === 'warn') return 'cx-chip is-warn';
  return 'cx-chip';
}

export function AttachmentRow({
  icon,
  title,
  chips = [],
  owner,
  subtitle,
  why,
  permissionsLabel = 'May do',
  permissions = [],
  lastLabel = 'Last action',
  last,
  lastDetail,
  controls = [],
  stopNote,
  nested = false,
}: AttachmentRowProps) {
  return (
    <div className={nested ? 'cx-row is-nested' : 'cx-row'}>
      <span className="cx-row-ic" aria-hidden>
        {icon}
      </span>

      <div>
        <div className="cx-row-ttl">
          {title}
          {chips.map((c) => (
            <span key={c.label} className={chipClass(c.tone)}>
              {c.label}
            </span>
          ))}
          <span className="cx-owner">{owner}</span>
        </div>
        {subtitle ? <div className="cx-row-sub">{subtitle}</div> : null}
        <div className="cx-row-why">{why}</div>
      </div>

      <div className="cx-scope">
        <span className="cx-col-h">{permissionsLabel}</span>
        {permissions.length ? (
          <ul>
            {permissions.map((p) => (
              <li key={p.text} className={p.can ? undefined : 'is-not'}>
                {p.text}
              </li>
            ))}
          </ul>
        ) : (
          <span className="cx-last-em">{DASH}</span>
        )}
      </div>

      <div className="cx-last">
        <span className="cx-col-h">{lastLabel}</span>
        {/* An unknown is the dash in the SANS face, so it reads as prose
            rather than as a value that happens to be a line. */}
        <span className={last ? 'cx-last-w' : 'cx-last-w cx-last-em'}>
          {last ?? DASH}
        </span>
        {lastDetail ? <span className="cx-last-d">{lastDetail}</span> : null}
      </div>

      <div className="cx-ctl">
        {controls.map((c) =>
          c.hold ? (
            <HoldToApprove
              key={c.label}
              className={c.wrap ? 'cx-hold cx-hold-wide' : 'cx-hold'}
              label={c.busy ? `${c.label}…` : c.label}
              approvedLabel="Sealed"
              disabled={c.disabled || c.busy}
              onChallenge={c.hold.onChallenge}
              onApprove={c.hold.onApprove}
            />
          ) : (
            <button
              key={c.label}
              type="button"
              className="cx-btn"
              disabled={c.disabled || c.busy}
              onClick={c.onClick}
            >
              {c.busy ? `${c.label}…` : c.label}
            </button>
          ),
        )}
        <span className="cx-ctl-note">{stopNote}</span>
      </div>
    </div>
  );
}

/**
 * A register that could not be read.
 *
 * Named, and carrying the gateway's own sentence. The alternative — an empty
 * list — reads as "nothing is attached", which is the most reassuring thing
 * this page could say and the one thing it must never say by accident
 * (ADR 0020).
 */
export function UnreadRegister({
  name,
  detail,
  refused,
}: {
  name: string;
  detail: string;
  refused: boolean;
}) {
  return (
    <div className="cx-unread" role="status">
      <b>{name} could not be read.</b>{' '}
      {refused
        ? 'The gateway refused this read for your role, so nothing about it is shown — including whether anything is there.'
        : 'What is below is therefore not a list of what is attached; it is silence, and silence is not the same as nothing.'}
      <span className="cx-gateway-words">{detail}</span>
    </div>
  );
}

/** A register still being read. Never rendered as an empty one. */
export function LoadingRegister({ name }: { name: string }) {
  return (
    <div className="cx-loading" role="status">
      Reading {name}…
    </div>
  );
}
