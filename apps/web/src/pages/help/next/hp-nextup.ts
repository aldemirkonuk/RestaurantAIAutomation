/**
 * hp-nextup — "What to do next," the rail ADR 0160 §111's Decision grafts
 * into this page regardless of which base was picked (direction B's own
 * drawing, `direction-b.html:782` `rail()`, `:792` its start line; ADR 0160
 * `0160-the-founders-sketch-review-*.md` §111 Decision, verbatim: *"B's
 * What-to-do-next rail and write-to-support modal are grafted in regardless
 * of which base is picked."*).
 *
 * Pure, like every other `hp-*.ts` module here: given the same
 * `ReadinessItem`s Section I already renders (`hp-readiness.ts`) and the
 * deployment's own state (`hp-service.ts`), it picks out the ones that need a
 * person to act, in the order a stuck person should look at them — the
 * deployment first (nothing below it can be trusted while it is down, the
 * same reason direction B's ladder puts it on rung 1), then the house's
 * connections and what last failed, then what is waiting on the house.
 *
 * ATTENTION IS THE ONLY TONE THAT SURFACES HERE, ON PURPOSE. `HelpNext.tsx`'s
 * `TONE_COLOR`/`StateRow` already draw `unknown` and `refused` identically
 * muted in Section I: both mean "this page cannot tell you more," not "do
 * this" — `attention` is the one tone that gets the ink-1 dot and the ring.
 * Reusing that existing distinction, rather than inventing a second "not
 * clear" for the rail (ADR 0144 §2 forbids invented apparatus), is also why a
 * still-loading read never flashes a false next step while the page opens:
 * every `hp-readiness.ts` builder reports a read in flight as `unknown`
 * ("Reading."), never `attention` — nothing here has to special-case loading
 * a second time to get that right.
 */

import type { ReadinessItem } from './hp-readiness';
import type { ServiceState } from './hp-service';
import { serviceNextStep, serviceSentence } from './hp-service';

export interface NextUpEntry {
  id: string;
  title: string;
  body: string;
  actionUrl?: string;
  actionLabel?: string;
}

/**
 * True exactly when the deployment line itself is the thing to act on:
 * unreachable, or answered but not ready. `checking` is a read in flight, not
 * a fault — the same distinction `hp-readiness.ts` draws with tone `unknown`.
 */
export function serviceNeedsAttention(s: ServiceState): boolean {
  return s.kind === 'unreachable' || (s.kind === 'answered' && !s.ready);
}

/**
 * The rail's list, most important first. Empty means every read this page
 * can make came back clear — the caller renders that as a sentence, never as
 * a blank section (ADR 0020: an absence is shown as one).
 */
export function nextUpEntries(input: {
  service: ServiceState;
  connections: ReadinessItem[];
  failed: ReadinessItem[];
  waiting: ReadinessItem[];
}): NextUpEntry[] {
  const entries: NextUpEntry[] = [];

  if (serviceNeedsAttention(input.service)) {
    entries.push({
      id: 'service',
      title: serviceSentence(input.service),
      body: serviceNextStep(input.service),
    });
  }

  // Named groups, not a bare array: `hp-readiness.ts`'s two builders both use
  // the literal id "mail" — connectionItems' mailItem for a live grant whose
  // last read failed, and failedItems' own mail check for the SAME fact —
  // because Section I renders them in two separate cards, where an id only
  // has to be unique within its own list. This rail flattens all three
  // groups into one list, so without a prefix that real, reachable overlap
  // would hand two entries the same id — a duplicate React key, not a
  // theoretical one (see hp-nextup.test.ts's dedicated case).
  const groups: [string, ReadinessItem[]][] = [
    ['connections', input.connections],
    ['failed', input.failed],
    ['waiting', input.waiting],
  ];
  for (const [group, items] of groups) {
    for (const item of items) {
      if (item.tone !== 'attention') continue;
      const entry: NextUpEntry = { id: `${group}:${item.id}`, title: item.label, body: item.detail };
      // Assigned only when present, not copied as `undefined` — an entry
      // with no link should not claim an actionUrl key any more than a
      // ReadinessItem with none does (same absence-is-shown-as-one rule,
      // ADR 0020, applied to this object as it is to the sentence).
      if (item.actionUrl) entry.actionUrl = item.actionUrl;
      if (item.actionLabel) entry.actionLabel = item.actionLabel;
      entries.push(entry);
    }
  }

  return entries;
}
