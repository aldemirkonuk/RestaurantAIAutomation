/**
 * The flag on a "Waiting on you" row — ADR 0256 (founder, 2026-10-01:
 * "oldest first, flag priority ones"; the flags "focus on this, money issue,
 * order approval, large amount of order, item running out").
 *
 * The gateway decides the flags and the order; this only says them. It prints
 * the reasons as WORDS and never a figure, so the same line holds for a role
 * that does not see money (DASH-W22). A reason the gateway could not check is
 * said as such — it is not a quiet "no" (ADR 0020).
 *
 * Spans only: it renders inside the row's button.
 */

import { Flag } from 'lucide-react';
import type { PendingFlagReason, PendingOrderPriority } from '@/services/api/types';

/** What each reason says when it held. */
const FLAG_WORDS: Record<PendingFlagReason, string> = {
  price_jump: 'price jumped',
  needs_signature: 'needs a signature',
  manager_ceiling: 'large order',
  running_out: 'running out',
};

/** What each reason is about, when it could not be checked. */
const UNCHECKED_WORDS: Record<PendingFlagReason, string> = {
  price_jump: 'the price',
  needs_signature: 'who must sign',
  manager_ceiling: 'the amount',
  running_out: 'the stock',
};

function list(words: string[]): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} or ${words[words.length - 1]}`;
}

export function WaitingFlag({ priority }: { priority?: PendingOrderPriority }) {
  if (!priority) return null;
  const reasons = priority.flagged ? priority.reasons : [];
  const unknown = priority.unknown ?? [];
  if (reasons.length === 0 && unknown.length === 0) return null;

  return (
    <>
      {reasons.length > 0 && (
        <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="inline-flex items-center gap-1 rounded border border-seal-ring bg-seal-tint px-1.5 font-semibold text-seal">
            <Flag size={10} strokeWidth={1.75} aria-hidden />
            Focus on this
          </span>
          <span className="text-inkm-2">{reasons.map((r) => FLAG_WORDS[r]).join(' · ')}</span>
        </span>
      )}
      {unknown.length > 0 && (
        <span className="mt-0.5 block text-[11px] italic text-inkm-4">
          Couldn’t check {list(unknown.map((r) => UNCHECKED_WORDS[r]))} just now.
        </span>
      )}
    </>
  );
}
