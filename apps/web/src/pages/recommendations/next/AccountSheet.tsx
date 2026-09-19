/**
 * A subject's account — sketch 120 item 4: "a side sheet from an entry whose
 * rule carries a subject ... drawn only where the gateway can key it: today
 * that is two rules" (`sales_below_weekday_baseline`, `weekly_demand_slide` —
 * `recommendations.service.ts:163,182`).
 *
 * What it shows, and only what the currently-loaded data actually supports —
 * no second fetch pretends to answer more than it can:
 *
 *   STANDING AGAINST IT — sibling active entries sharing this subject, read
 *   from the book already in memory (no extra request).
 *   WRITTEN RECENTLY — the stored insight feed for this subject
 *   (`GET /analytics/insights/:rid`), fetched once, on open.
 *   CAN BE TOLD — a link into the catalogue (`/recommendations/catalog`),
 *   pre-searched for this subject's own words.
 *
 * What it deliberately does NOT claim: whether this subject has ever been
 * silenced. That answer lives on the Dismissed/History leaves, which are not
 * loaded here, and guessing from a leaf this sheet has not read would be
 * exactly the kind of silent invention ADR 0020 forbids. The sheet says so.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { apiClient } from '@/services/api/client';
import { Sheet } from '@/components/mudavym';
import { failureOf, fmtDay, type FailureVM } from './rec-format';
import type { EntryVM } from './useRecommendationsNextData';

interface StoredInsight {
  candidateKey: string;
  category: string;
  sentence: string;
  subject: string | null;
  periodKey: string | null;
}

type Phase = 'loading' | 'ready' | 'failed';

/** "wednesday" → "Wednesday" — display only; the key used for matching stays as stored. */
function titleCase(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

export default function AccountSheet({
  entry,
  siblings,
  onClose,
}: {
  entry: EntryVM;
  /** The whole loaded book, so sibling entries on the same subject can be counted. */
  siblings: EntryVM[];
  onClose: () => void;
}) {
  const { activeRestaurantId } = useAuth();
  const rid = activeRestaurantId ?? null;
  const subject = entry.subject ?? '';

  const [phase, setPhase] = useState<Phase>('loading');
  const [insights, setInsights] = useState<StoredInsight[]>([]);
  const [failure, setFailure] = useState<FailureVM | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!rid) {
      setPhase('failed');
      setFailure({ status: null, message: 'no restaurant is selected', expired: false, forbidden: false });
      return;
    }
    setPhase('loading');
    apiClient
      .get<{ insights?: StoredInsight[] }>(`/analytics/insights/${rid}`)
      .then(({ data }) => {
        if (cancelled) return;
        setInsights((data?.insights ?? []).filter((i) => i.subject === entry.subject));
        setPhase('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        setFailure(failureOf(err));
        setPhase('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [rid, entry.subject]);

  const standing = siblings.filter(
    (s) => s.subject === entry.subject && s.ruleKey !== entry.ruleKey && s.status === 'active',
  );
  const done = siblings.filter(
    (s) => s.subject === entry.subject && s.ruleKey !== entry.ruleKey && s.status === 'done',
  );

  return (
    <Sheet
      open
      onClose={onClose}
      label={`${titleCase(subject)}'s account`}
      eyebrow="Recommendations · the subject"
      title={titleCase(subject)}
    >
      <div className="rc-sheet-block">
        <p className="rc-why">
          Everything this house's book currently holds about{' '}
          <span className="rc-num">{titleCase(subject)}</span> — not a new read, a
          gathering of what the entries and the stored feed already say.
        </p>
      </div>

      <div className="rc-sheet-block">
        <span className="rc-micro">Standing against it</span>
        {standing.length === 0 ? (
          <p className="rc-plain">Only this entry, today.</p>
        ) : (
          <ul className="rc-excl">
            {standing.map((s) => (
              <li key={s.ruleKey}>
                <span className="rc-said">{s.observation || s.ruleKey}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rc-sheet-block">
        <span className="rc-micro">Done</span>
        {done.length === 0 ? (
          <p className="rc-plain">Nothing on this subject has been ruled off.</p>
        ) : (
          <ul className="rc-excl">
            {done.map((s) => (
              <li key={s.ruleKey}>
                <span className="rc-said">{s.observation || s.ruleKey}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rc-sheet-block">
        <span className="rc-micro">Silenced for it</span>
        <p className="rc-why">
          Not read here — that answer lives on the Dismissed and History leaves, which this
          sheet does not load. Use <span className="rc-num">Silence</span> on this entry to act
          on it, or check those leaves directly.
        </p>
      </div>

      <div className="rc-sheet-block">
        <span className="rc-micro">Written recently</span>
        {phase === 'loading' && <p className="rc-why">Reading the stored feed…</p>}
        {phase === 'failed' && (
          <p className="rc-said" role="status">
            The stored feed could not be read ({failure?.message ?? 'unknown error'}). Nothing
            below is claimed.
          </p>
        )}
        {phase === 'ready' &&
          (insights.length === 0 ? (
            <p className="rc-plain">Nothing else stored mentions {titleCase(subject)}.</p>
          ) : (
            <ul className="rc-excl">
              {insights.map((i, idx) => (
                <li key={`${i.candidateKey}-${idx}`}>
                  <span className="rc-said">{i.sentence}</span>
                  {i.periodKey && <span className="rc-why"> {fmtDay(i.periodKey.replace(/^[a-z]+:/, ''))}</span>}
                </li>
              ))}
            </ul>
          ))}
      </div>

      <div className="rc-sheet-block">
        <span className="rc-micro">Can be told</span>
        <p className="rc-plain">
          <Link to={`/recommendations/catalog?q=${encodeURIComponent(subject)}`}>
            Browse the catalogue for {titleCase(subject)} →
          </Link>
        </p>
        <p className="rc-why">
          What Mudavym could tell you about this subject if the data existed to compute it —
          read-only, and the same "data present" honesty as the catalogue itself.
        </p>
      </div>

      <div className="rc-row">
        <button type="button" className="rc-quiet" onClick={onClose}>
          Close
        </button>
      </div>
    </Sheet>
  );
}
