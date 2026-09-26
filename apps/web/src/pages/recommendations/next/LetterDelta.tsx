/**
 * The delta cutting — "since your last letter", above the docket.
 *
 * Sketch 120 item 1, placed as a cutting above the docket (1A over 1B, the
 * founder's 2026-09-19 lean) and measured PER READER: sketch 122 Q9, the
 * founder 2026-09-25, round 5, "Per reader (Recommended)" — *"'Since Monday's
 * letter' is true for each person; a shared clock misdescribes what a newer
 * subscriber saw."* The clock is this reader's own last SENT letter
 * (`GET /recommendations/digest/subscription` → `lastLetter`).
 *
 * A letter carries only entries at or above the house's urgency floor, so an
 * entry it did not carry is said as exactly that — never "new".
 */

import { EM, fmtDay } from './rec-format';
import { deltaSince } from './rec-masthead';
import type { DigestSubscriptionData } from './useDigestSubscription';
import type { EntryVM } from './useRecommendationsNextData';

export default function LetterDelta({
  sub,
  entries,
}: {
  sub: DigestSubscriptionData;
  entries: EntryVM[];
}) {
  if (sub.phase === 'loading') return null;
  if (sub.phase === 'unreachable' || !sub.status)
    return (
      <p className="rc-said rc-delta" role="status" data-testid="rc-delta-unread">
        What changed since your last letter could not be read (
        {sub.failure?.message ?? 'no reason given'}), so no change is claimed.
      </p>
    );
  const letter = sub.status.lastLetter ?? null;
  if (!letter)
    return (
      <p className="rc-said rc-delta" data-testid="rc-delta-none">
        No letter has gone to you yet, so there is nothing to measure a change from {EM} ask
        for your copy under The post.
      </p>
    );
  if (!letter.ruleKeys)
    return (
      <p className="rc-said rc-delta" data-testid="rc-delta-unknown">
        Your letter of {fmtDay(letter.periodKey)} did not record what it carried, so no change is
        claimed from it.
      </p>
    );
  const d = deltaSince(entries, letter.ruleKeys);
  return (
    <div className="rc-delta rc-delta-cutting" data-testid="rc-delta">
      <span className="rc-micro">Since your letter of {fmtDay(letter.periodKey)}</span>
      <p className="rc-plain">
        <span className="rc-num">{d.notCarried.length}</span>{' '}
        {d.notCarried.length === 1 ? 'entry stands' : 'entries stand'} that it did not carry
        {' · '}
        <span className="rc-num">{d.gone}</span> it carried{' '}
        {d.gone === 1 ? 'no longer stands' : 'no longer stand'}.
      </p>
      {d.notCarried.length > 0 && (
        <ul className="rc-delta-list">
          {d.notCarried.slice(0, 3).map((e) => (
            <li key={e.ruleKey}>{e.recommendation || e.observation || e.ruleKey}</li>
          ))}
          {d.notCarried.length > 3 && <li>and {d.notCarried.length - 3} more below.</li>}
        </ul>
      )}
    </div>
  );
}
