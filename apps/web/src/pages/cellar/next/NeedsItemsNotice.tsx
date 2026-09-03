/**
 * The two notices a register's answer can produce, and the reasons neither one
 * interrupts anybody.
 *
 *   ON with nothing behind it   → "add the rows", per register.
 *   OFF with rows still behind it → "they are still in the books".
 *
 * THE FOUNDER'S CASE. A house starts carrying whiskey in March. It switches the
 * register on. There is no menu line and no inventory row to sense that with,
 * so the software's job is not to doubt the human — it is to ask for the rows
 * that would let the books catch up. And in September a seasonal spritz list
 * goes off again with a case of prosecco still behind it; that is a correct,
 * deliberate act, and the items must not silently vanish with the register.
 *
 * WHY NEITHER IS A MODAL. The menu research's premortem M1 traced the most
 * likely failure of this whole mechanism: built as an interrupting modal on
 * data entry, it becomes noise inside a month and gets clicked through unread —
 * the same fate as the legacy "Reorder" alert on this very page. The founder's
 * own backtest across four scenarios then found **no scenario in which
 * `interrupt` was the right default**, and found it actively worse at full
 * onboarding, where it would fire most. `variant` survives as a one-prop escape
 * hatch, nothing more.
 *
 * "Persistent" is structural: both notices render from state the gateway
 * recomputes from the books on every read, so neither can go stale, and
 * dismissing one does not change the condition it describes.
 *
 * THREE AMENDMENTS FROM THAT BACKTEST, all here:
 *  1. the ask is **register-aware** (`addRowsPrompt`) — telling a house to add
 *     a keg to `/inventory`, which cannot hold one, teaches it to stop reading;
 *  2. several registers at once collapse into **one** notice, never a stack —
 *     every from-scratch onboarding produces that case;
 *  3. the **symmetric** off-with-items state exists at all, which it did not.
 *
 * DISMISSAL IS PER-BROWSER, and the notice says so. It is `localStorage`, not a
 * column: a server-side dismissal would be a second piece of state about a
 * register whose one authoritative row is `restaurant_cellar_registers`
 * (premortem M4 — never two homes for one fact). Filed in the page note §13.
 */

import { useCallback, useEffect, useState } from 'react';
import { Archive, PackagePlus, X } from 'lucide-react';
import {
  REGISTER_TITLE,
  addRowsPrompt,
  strandedPrompt,
  type RegisterId,
} from './cellar-format';

type Kind = 'needs-items' | 'stranded';

export interface RegisterNoticeProps {
  /** The registers this notice is about. Several collapse into one line. */
  registers: RegisterId[];
  kind?: Kind;
  /** Row counts per register. Used by the `stranded` copy. */
  counts?: Partial<Record<RegisterId, number | null>>;
  /** `inline` (default and, per the backtest, always right) or `interrupt`. */
  variant?: 'inline' | 'interrupt';
  /** Omit to make the notice undismissable (the onboarding step does). */
  dismissible?: boolean;
}

/** One key per (kind, register set) — dismissing beer does not hide whiskey. */
const KEY = (kind: Kind, ids: RegisterId[]) =>
  `mudavym.cellar.notice.${kind}.${[...ids].sort().join('+')}`;

function readDismissed(kind: Kind, ids: RegisterId[]): boolean {
  try {
    return localStorage.getItem(KEY(kind, ids)) === '1';
  } catch {
    // A browser with storage denied gets the notice, every time. Showing an ask
    // that was already dismissed is the safe failure; hiding one that was never
    // dismissed is not.
    return false;
  }
}

function listNames(ids: RegisterId[]): string {
  const names = ids.map((id) => REGISTER_TITLE[id]);
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export default function RegisterNotice({
  registers,
  kind = 'needs-items',
  counts = {},
  variant = 'inline',
  dismissible = true,
}: RegisterNoticeProps) {
  const id = registers.join('+');
  const [dismissed, setDismissed] = useState(() =>
    dismissible ? readDismissed(kind, registers) : false,
  );

  useEffect(() => {
    setDismissed(dismissible ? readDismissed(kind, registers) : false);
    // `id` is the stable identity of the set; `registers` is a fresh array each
    // render and would re-run this on every paint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, kind, dismissible]);

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(KEY(kind, registers), '1');
    } catch {
      /* the notice still closes for this session; nothing else depends on it */
    }
    setDismissed(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, kind]);

  if (registers.length === 0 || dismissed) return null;

  const many = registers.length > 1;
  const Icon = kind === 'stranded' ? Archive : PackagePlus;

  const headline =
    kind === 'stranded'
      ? many
        ? `${listNames(registers)} are off, and their items are still in the books.`
        : `${REGISTER_TITLE[registers[0]]} is off, and its items are still in the books.`
      : many
        ? `${listNames(registers)} are on, and the books have nothing of those kinds yet.`
        : `${REGISTER_TITLE[registers[0]]} is on, and the books have nothing of the kind yet.`;

  return (
    <div
      role="status"
      className="cl-panel"
      data-needs-items={variant}
      data-notice-kind={kind}
      data-testid={
        many ? `${kind}-many` : `${kind}-${registers[0]}`
      }
      style={{
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
        marginTop: 12,
        borderStyle: variant === 'interrupt' ? 'solid' : 'dashed',
        borderColor: variant === 'interrupt' ? 'var(--seal-ring)' : 'var(--paper-2)',
      }}
    >
      <Icon size={16} aria-hidden style={{ color: 'var(--ink-3)', flex: '0 0 auto', marginTop: 1 }} />
      <div style={{ minWidth: 0 }}>
        <p className="cl-said" style={{ color: 'var(--ink-1)' }}>
          <strong style={{ fontWeight: 600 }}>{headline}</strong>
        </p>
        <ul style={{ margin: '6px 0 0', paddingLeft: 16, display: 'grid', gap: 4 }}>
          {registers.map((r) => (
            <li key={r} className="cl-said">
              {kind === 'stranded'
                ? strandedPrompt(r, counts[r] ?? 0)
                : many
                  ? `${REGISTER_TITLE[r]}: ${addRowsPrompt(r)}`
                  : addRowsPrompt(r)}
            </li>
          ))}
        </ul>
        <p className="cl-note" style={{ marginTop: 6 }}>
          {kind === 'stranded'
            ? 'Nothing was deleted and nothing is hidden: those items keep showing in the cellar under “not on the list”. Switch the register back on when the season comes round, or move the items.'
            : 'The register stays on either way — this is the house telling the software something the software cannot see.'}{' '}
          Dismissing hides this line on this browser only; the register keeps
          saying what the books do and do not hold.
        </p>
      </div>
      {dismissible ? (
        <button
          type="button"
          className="cl-btn cl-ink cl-focus"
          onClick={dismiss}
          aria-label={`Dismiss the ${many ? listNames(registers) : REGISTER_TITLE[registers[0]]} notice`}
          style={{ marginLeft: 'auto', flex: '0 0 auto', padding: '4px 6px' }}
        >
          <X size={13} aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
