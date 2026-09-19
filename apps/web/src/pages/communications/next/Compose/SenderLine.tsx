/**
 * The first line of the composer, and the one the founder's decision turns on:
 * WHICH ADDRESS this letter leaves from.
 *
 * The decision, 2026-09-03/04 (ADR 0118):
 *   · the house's OWN connected mailbox, or
 *   · a Mudavym subdomain address we provision — a PAID-tier option, and a
 *     house on the free plan sends from its own mailbox instead
 *   · never the mailbox shared with every other house on this deployment
 *
 * The price of the paid option is OD-23 and is deliberately absent: this row
 * says which tier the option belongs to and never what it costs.
 *
 * Four states, each real and each different:
 *   house_mailbox      — sends, plain button, an undo window
 *   mudavym_subdomain  — sends, held under the seal
 *   none               — sends nothing; the control is disabled with the reason
 *   unknown            — the read FAILED; that is not "no mailbox", and saying
 *                        so is the whole of ADR 0051 clause 3
 */

import { Ban, KeyRound, Mail, ShieldQuestion } from 'lucide-react';
import type { SenderIdentity } from './useComposeData';
import { EM, MONO, SANS, fmtWindowLength } from './compose-format';

const ICON = { size: 13, strokeWidth: 1.75 } as const;

export function SenderLine({
  sender,
  failed,
  error,
}: {
  sender: SenderIdentity | null;
  failed: boolean;
  error: string | null;
}) {
  // A failed fetch and an unanswered one are not the same thing, and neither is
  // "no sender". The banner names which one this is before anything else.
  const kind = failed ? 'unknown' : (sender?.kind ?? null);

  const Icon =
    kind === 'house_mailbox'
      ? Mail
      : kind === 'mudavym_subdomain'
        ? KeyRound
        : kind === 'unknown'
          ? ShieldQuestion
          : Ban;

  const address = failed ? null : (sender?.address ?? null);
  const words = failed
    ? `Which mailbox this house sends from could not be read (${error ?? 'unknown error'}). No letter may be queued until it can be. This is a failed read, not an empty answer.`
    : kind === null
      ? 'Reading which mailbox this house sends from…'
      : sender!.words;

  const tone =
    kind === 'house_mailbox' || kind === 'mudavym_subdomain'
      ? 'var(--seal-deep, #14515C)'
      : kind === 'unknown'
        ? 'var(--alarm-deep, #8C3322)'
        : 'var(--ink-2, #4F473C)';

  return (
    <div
      role="status"
      className="rounded-xl px-3 py-2.5"
      style={{
        fontFamily: SANS,
        border: '1px solid var(--paper-2, #EAE4D8)',
        background: 'var(--paper-1, #F3EFE6)',
      }}
    >
      <div className="flex items-baseline gap-2">
        <span style={{ color: tone, transform: 'translateY(2px)' }}>
          <Icon {...ICON} aria-hidden />
        </span>
        <span
          style={{
            fontFamily: MONO,
            fontSize: 9,
            fontWeight: 600,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--ink-3, #7C7365)',
          }}
        >
          Leaves from
        </span>
        <span
          data-testid="sender-address"
          style={{
            fontFamily: MONO,
            fontSize: 12,
            fontWeight: 600,
            color: address ? 'var(--ink-1, #211C16)' : 'var(--ink-3, #7C7365)',
          }}
        >
          {address ?? EM}
        </span>
      </div>
      <p style={{ margin: '5px 0 0', fontSize: 11.5, lineHeight: 1.45, color: tone }}>{words}</p>

      {/* What is NOT used, said out loud. The shared deployment mailbox is the
          address every letter uses today, and the reader deserves to know the
          composer is refusing it rather than failing to find it. */}
      {sender && !failed && (
        <p style={{ margin: '5px 0 0', fontSize: 11, lineHeight: 1.45, color: 'var(--ink-3, #7C7365)' }}>
          Not {sender.deployment.address}: {sender.deployment.refusedBecause}
        </p>
      )}

      {sender && !failed && !sender.subdomain.provisioned && (
        <p style={{ margin: '5px 0 0', fontSize: 11, lineHeight: 1.45, color: 'var(--ink-3, #7C7365)' }}>
          {sender.subdomain.words}
        </p>
      )}

      {sender && sender.ceremony === 'undo' && (
        <p style={{ margin: '5px 0 0', fontSize: 11, color: 'var(--ink-3, #7C7365)' }}>
          Send holds the letter for {fmtWindowLength(sender.undoMs)} before it leaves. Until then
          it can be pulled back, and the book shows it as queued, never as sent.
        </p>
      )}

      {sender && sender.missing.length > 0 && (
        <ul style={{ margin: '6px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 4 }}>
          {sender.missing.map((line) => (
            <li key={line} style={{ fontSize: 10.5, lineHeight: 1.45, color: 'var(--ink-3, #7C7365)' }}>
              {line}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default SenderLine;
