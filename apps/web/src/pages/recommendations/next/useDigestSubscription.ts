/**
 * "Your copy" — a person's own recommendations digest subscription.
 *
 * This is deliberately a SEPARATE hook from `useRecommendationsNextData`, and
 * a separate store from the house's `digest` preference read there. The two
 * are different facts: the house's post (`PUT /analytics/recommendations/:rid/digest`,
 * `recommendation-actions.service.ts` — read and written by the main hook) is
 * one stored row that says whether a scheduled send is armed for this house
 * at all; a person's subscription (`recommendation_digest_subscriptions`) is
 * whether THIS member gets a copy of it, on what cadence. A manager can turn
 * the house's post on for everyone and still not be subscribed themselves.
 *
 * The sender that actually mails anyone — `apps/api-gateway/src/analytics/digest/`
 * — is built on a separate branch, `feat/finish-digest` (worktree `wt-fin-digest`,
 * staged and unmerged as of 2026-09-17; sketch 120's "new field" #1/#2/#3 are
 * not part of it and are not built here either — see recommendations.md's
 * "Sketch 120 (round 4)" note for the full built/not-built breakdown).
 * This hook is written against its REAL, already-implemented contract
 * (`recommendation-digest.controller.ts`, `.service.ts`, `.dto.ts`, read from
 * that worktree, not reproduced here) — it does not reimplement the sender,
 * it only reads and writes the one resource it already exposes:
 * `GET/PUT/DELETE /recommendations/digest/subscription`. Until that branch
 * merges, every call below 404s on this branch's own gateway, and the hook's
 * job is to say that honestly rather than hide it — see `describeFailure`.
 */

import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/services/api/client';
import { failureOf, type FailureVM } from './rec-format';

export type DigestFrequency = 'daily' | 'weekly';
export type DigestUrgency = 'now' | 'this_week' | 'this_month';

export interface QuietHours {
  enabled: boolean;
  start: string;
  end: string;
}

/**
 * `DigestSubscriptionStatus`, mirrored field-for-field from
 * `recommendation-digest.service.ts:1335-1374` on `train/finish-2` — this
 * lane's actual dependency (this hook itself calls
 * `/recommendations/digest/subscription` below, which exists only there).
 * `feat/finish-digest` still carries the same interface at `:1344-1384`, but
 * with a `preferences.category` field the train has already dropped (PR #391
 * audit B2(b), 2026-09-19: the subscription alone is the gate now — see
 * recommendations.md's "Sketch 120 (round 4)" note). Kept as a hand-written
 * type rather than an import — neither branch shares a build with this one —
 * so a drift there is a compile error here, not a silent mismatch, the day
 * either branch merges and this can become a real import.
 */
export interface DigestSubscriptionStatus {
  armed: boolean;
  armedFlag: string;
  served: boolean;
  servedReason: string | null;
  unsubscribeLinkReady: boolean;
  house:
    | { set: true; enabled: boolean; hour: number; urgencyFloor: DigestUrgency }
    | { set: false; enabled: false; hour: null; urgencyFloor: null };
  timeZone: { zone: string; isFallback: boolean } | null;
  isMember: boolean;
  subscription: {
    frequency: DigestFrequency;
    weekday: number | null;
    subscribedAt: string;
    updatedAt: string;
    unsubscribedAt: string | null;
    unsubscribedVia: 'link' | 'settings' | null;
  } | null;
  preferences: {
    email: boolean;
    quietHours: QuietHours;
    usingDefaults: boolean;
  };
  willReceive: boolean;
  /** Every reason this person will not receive a digest, in words. Empty = will. */
  blockers: string[];
  nextDueAt: string | null;
  lastSend: {
    periodKey: string;
    frequency: DigestFrequency;
    dueAt: string;
    claimedAt: string;
    finishedAt: string | null;
    sentAt: string | null;
    outcome: 'sent' | 'failed' | 'skipped_empty' | 'expired' | null;
    reason: string | null;
    entriesCount: number | null;
  } | null;
  /**
   * This reader's own last SENT letter and the rule keys it carried — the
   * clock of the page's delta cutting (sketch 122 Q9, per reader). Optional:
   * a gateway from before 2026-09-25 does not send it, and the page then
   * claims no change.
   */
  lastLetter?: {
    periodKey: string;
    sentAt: string;
    ruleKeys: string[] | null;
  } | null;
  /**
   * The house's latest post date and how many letters went out on it — a
   * count, never who (sketch 122 Q8). Optional for the same reason.
   */
  houseLastPost?: {
    periodKey: string;
    sent: number;
    atCap: boolean;
  } | null;
}

export type SubscriptionPhase = 'loading' | 'ready' | 'unreachable';

export interface DigestSubscriptionData {
  phase: SubscriptionPhase;
  status: DigestSubscriptionStatus | null;
  /** Set only in the 'unreachable' phase — the real cause, never guessed at. */
  failure: FailureVM | null;
  /**
   * True when the failure is a plain 404 — the most likely reading on THIS
   * branch today is "the sender has not merged yet", not "something broke".
   * The hook does not assert that reading as fact (a 404 could be anything
   * routed wrong), it only offers the distinction so the sheet can print the
   * likelier sentence without claiming certainty it does not have.
   */
  looksUnmerged: boolean;
  refresh: () => void;
  subscribe: (frequency: DigestFrequency, weekday: number | null) => Promise<boolean>;
  unsubscribe: () => Promise<boolean>;
}

export function useDigestSubscription(active: boolean): DigestSubscriptionData {
  const [phase, setPhase] = useState<SubscriptionPhase>('loading');
  const [status, setStatus] = useState<DigestSubscriptionStatus | null>(null);
  const [failure, setFailure] = useState<FailureVM | null>(null);
  const [seq, setSeq] = useState(0);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setPhase('loading');
    apiClient
      .get<DigestSubscriptionStatus>('/recommendations/digest/subscription')
      .then(({ data }) => {
        if (cancelled) return;
        setStatus(data ?? null);
        setFailure(null);
        setPhase('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus(null);
        setFailure(failureOf(err));
        setPhase('unreachable');
      });
    return () => {
      cancelled = true;
    };
  }, [active, seq]);

  const refresh = useCallback(() => setSeq((n) => n + 1), []);

  const subscribe = useCallback(
    async (frequency: DigestFrequency, weekday: number | null): Promise<boolean> => {
      try {
        const { data } = await apiClient.put<DigestSubscriptionStatus>(
          '/recommendations/digest/subscription',
          frequency === 'weekly' ? { frequency, weekday } : { frequency },
        );
        setStatus(data ?? null);
        setFailure(null);
        setPhase('ready');
        return true;
      } catch (err) {
        setFailure(failureOf(err));
        return false;
      }
    },
    [],
  );

  const unsubscribe = useCallback(async (): Promise<boolean> => {
    try {
      await apiClient.delete('/recommendations/digest/subscription');
      refresh();
      return true;
    } catch (err) {
      setFailure(failureOf(err));
      return false;
    }
  }, [refresh]);

  return {
    phase,
    status,
    failure,
    looksUnmerged: failure?.status === 404,
    refresh,
    subscribe,
    unsubscribe,
  };
}
