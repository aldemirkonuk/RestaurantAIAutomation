/**
 * "Send at…" (r110 mail-gap g1): three times on the house's clock, chosen by
 * key. The server reads the key in the house's zone; this list never sends a
 * clock of its own, and its labels say "house time" because the browser's
 * zone is not the house's.
 *
 * Motion (MOTIONS.md, ADR 0112): the list enters with opacity 0->1 and
 * translateY 4px->0 over 160 ms, cubic-bezier(0.16,1,0.3,1); it leaves at once
 * (no exit animation); under reduced motion it is drawn at its end state.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { Clock } from 'lucide-react';

export type SendAtChoice = 'in_1h' | 'tomorrow_0800' | 'monday_0800';

/** What the server recorded on the letter (`email_headers.send_at_chosen`). */
export interface SendAtChosen {
  choice: SendAtChoice;
  local: string;
  zone: string;
}

export const SEND_AT_LABELS: ReadonlyArray<{ choice: SendAtChoice; label: string }> = [
  { choice: 'in_1h', label: 'In an hour' },
  { choice: 'tomorrow_0800', label: 'Tomorrow, 08:00 house time' },
  { choice: 'monday_0800', label: 'Monday, 08:00 house time' },
];

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Mon 08:00", from the house's own wall time; null when it cannot be read. */
export function leavesAt(chosen: SendAtChosen | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})$/.exec(chosen?.local ?? '');
  if (!m) return null;
  const day = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
  return `${DAYS[day]} ${m[4]}`;
}

export const SEND_AT_CSS = `
  @keyframes cmp-sendat-in { from { opacity: 0; transform: translateY(4px) } to { opacity: 1; transform: none } }
  .cmp-sendat-pop { animation: cmp-sendat-in 160ms cubic-bezier(0.16,1,0.3,1) both }
  @media (prefers-reduced-motion: reduce) { .cmp-sendat-pop { animation: none } }
`;

export function SendAtMenu({ disabled, onChoose }: { disabled: boolean; onChoose: (choice: SendAtChoice) => void }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const trigger = useRef<HTMLButtonElement | null>(null);
  const first = useRef<HTMLButtonElement | null>(null);
  const root = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    first.current?.focus();
    const away = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  return (
    <div ref={root} style={{ position: 'relative' }}>
      <style>{SEND_AT_CSS}</style>
      <button
        ref={trigger}
        type="button"
        data-testid="letter-send-at"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5"
        style={{
          fontSize: 12.5,
          fontWeight: 600,
          padding: '7px 12px',
          borderRadius: 9,
          border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
          background: 'transparent',
          color: disabled ? 'var(--ink-4, #665D50)' : 'var(--seal-deep, #14515C)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.7 : 1,
        }}
      >
        <Clock size={13} strokeWidth={1.8} aria-hidden="true" />
        Send at…
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Send at a time on the house's clock"
          data-testid="letter-send-at-menu"
          className="cmp-sendat-pop"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              // The menu closes, not the sheet behind it.
              e.stopPropagation();
              close();
            }
          }}
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 6px)',
            left: 0,
            zIndex: 2,
            minWidth: 220,
            padding: 4,
            borderRadius: 10,
            border: '1px solid var(--paper-2, #EAE4D8)',
            background: 'var(--paper-0, #FAF7F1)',
            boxShadow: '0 6px 20px rgba(28,24,18,.12)',
          }}
        >
          {SEND_AT_LABELS.map((o, i) => (
            <button
              key={o.choice}
              ref={i === 0 ? first : undefined}
              type="button"
              role="menuitem"
              className="cmp-pick"
              onClick={() => {
                setOpen(false);
                onChoose(o.choice);
              }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                minHeight: 36,
                padding: '8px 10px',
                fontSize: 12.5,
                borderRadius: 8,
                border: '1px solid transparent',
                background: 'transparent',
                color: 'var(--ink-1, #2A251E)',
                cursor: 'pointer',
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
