/**
 * The goals desk's writes — the one cutting on this sheet that is not read-only.
 *
 *   "the Goals section that owners/managers decide, and it can be edited (will
 *    be using AI to create the analytics and their wanted feature if not
 *    already created), and then they will have access to edit change as they
 *    like. Will be available to visible."
 *                                        — the founder, /reports, 2026-09-03
 *
 * READS go through the same machinery as every other cutting
 * (`useReportsNextData` → the catalogue's `goals` entry → `GET
 * /analytics/goals/:rid/progress`). This file is only the WRITES and the one
 * question, so the register's four honest states are not duplicated here.
 *
 * Two things it is careful about:
 *
 *  1. **Who may write.** `activeRole` is the role at the ACTIVE branch, from
 *     `user_restaurant_access` — not the role on the user row, which is the
 *     role somewhere else. Owners and managers write; everyone else sees the
 *     desk read-only with one line saying why, rather than a button that 403s.
 *     The gateway is the real gate (§9): the analytics routes are guarded by
 *     `JwtAuthGuard` at class level but not by role, so this is a courtesy, and
 *     the page note says so rather than implying an enforcement that is not there.
 *  2. **The assistant proposes; it never applies.** `ask()` returns a spec that
 *     the gateway has already validated against a closed catalogue
 *     (`report-cuttings.ts`). Nothing is placed on the sheet until the reader
 *     presses the button — and even then, the page checks the id AGAIN against
 *     its own catalogue before drawing anything, because the gateway's copy of
 *     the vocabulary and this one cannot be imported from a single file across
 *     the app boundary.
 */

import { useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { apiClient } from '@/services/api/client';
import { isGraphType, type AnalysisId, type GraphType } from './rp-sheet';
import { isAnalysisId } from './rp-sheet';
import { num } from './rp-format';

/** The window the till cutting offers. A proposal outside it is refused. */
const OFFERED_WINDOWS = [7, 30, 90];

export interface NewGoal {
  name: string;
  metricKey: string;
  targetValue: number;
  deadline: string | null;
  direction: 'at_least' | 'at_most';
  period: string;
}

export interface GoalPatch {
  name?: string;
  targetValue?: number;
  deadline?: string | null;
  direction?: 'at_least' | 'at_most';
  period?: string;
}

/** What the book proposed, once this page has re-checked it. */
export interface Proposal {
  goalId: string;
  goalName: string;
  /** Null when the assistant is unavailable or its answer was refused. */
  cutting: { id: AnalysisId; graph: GraphType; days: number | null } | null;
  /** The assistant's own sentence — labelled as a proposal, never a caption. */
  why: string | null;
  /** Why there is nothing to place, in words the reader can act on. */
  refusal: string | null;
}

export interface GoalsDesk {
  canWrite: boolean;
  readOnlyReason: string | null;
  /** The id being written, `'new'` while creating, or null. */
  busy: string | null;
  error: string | null;
  clearError: () => void;
  create: (input: NewGoal) => void;
  update: (goalId: string, patch: GoalPatch) => void;
  archive: (goalId: string) => void;
  /** Ask the book which catalogued analysis shows this goal. */
  ask: (goalId: string, goalName: string) => void;
  asking: string | null;
  proposal: Proposal | null;
  dismiss: () => void;
  /** Put a proposed cutting on the sheet. Supplied by the page. */
  place: (cutting: { id: AnalysisId; graph: GraphType; days: number | null }) => void;
}

export interface GoalsDeskOptions {
  place: (cutting: { id: AnalysisId; graph: GraphType; days: number | null }) => void;
  /** The query root, so a write refreshes the register that reads it. */
  queryRoot: string;
}

export function useGoalsDesk({ place, queryRoot }: GoalsDeskOptions): GoalsDesk {
  const { activeRestaurantId, activeRole } = useAuth();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);

  const canWrite = activeRole === 'owner' || activeRole === 'manager';
  const readOnlyReason = canWrite
    ? null
    : activeRole === null
      ? 'Your role at this restaurant is not known yet, so the desk is read-only until it is.'
      : 'Goals are set by owners and managers. You can read every figure here; the controls are theirs.';

  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: [queryRoot, 'goals'] });
    void qc.invalidateQueries({ queryKey: [queryRoot, 'bench'] });
  }, [qc, queryRoot]);

  /** One shape for every write: name what failed, never swallow it. */
  const run = useCallback(
    async (key: string, what: string, fn: () => Promise<unknown>) => {
      if (!activeRestaurantId) return;
      setBusy(key);
      setError(null);
      try {
        await fn();
        refresh();
      } catch (err: unknown) {
        const detail =
          (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          (err as { message?: string })?.message ??
          'the request failed';
        setError(`${what} did not go through: ${detail}`);
      } finally {
        setBusy(null);
      }
    },
    [activeRestaurantId, refresh],
  );

  const create = useCallback(
    (input: NewGoal) => {
      void run('new', 'Setting the goal', () =>
        apiClient.post(`/analytics/goals/${activeRestaurantId}`, {
          name: input.name,
          metricKey: input.metricKey,
          targetValue: input.targetValue,
          deadline: input.deadline,
          direction: input.direction,
          period: input.period,
        }),
      );
    },
    [activeRestaurantId, run],
  );

  const update = useCallback(
    (goalId: string, patch: GoalPatch) => {
      void run(goalId, 'The edit', () =>
        apiClient.patch(`/analytics/goals/${activeRestaurantId}/${goalId}`, patch),
      );
    },
    [activeRestaurantId, run],
  );

  const archive = useCallback(
    (goalId: string) => {
      void run(goalId, 'Archiving the goal', () =>
        apiClient.put(`/analytics/goals/${activeRestaurantId}/${goalId}/status`, {
          status: 'archived',
        }),
      );
    },
    [activeRestaurantId, run],
  );

  /**
   * Ask the book. The gateway validated the model's answer against its own
   * copy of the catalogue; this re-checks it against THIS page's catalogue,
   * because the two copies cannot be imported from one file across the app
   * boundary and a drift must surface as a sentence, never as a blank square.
   */
  const ask = useCallback(
    (goalId: string, goalName: string) => {
      if (!activeRestaurantId) return;
      setAsking(goalId);
      setError(null);
      setProposal(null);
      void (async () => {
        try {
          const { data } = await apiClient.post<{
            available?: boolean;
            reason?: string | null;
            spec?: { analysisId?: unknown; graph?: unknown; days?: unknown; why?: unknown } | null;
            rejected?: { reason?: string; detail?: string } | null;
          }>(`/analytics/goals/${activeRestaurantId}/${goalId}/cutting-spec`, {});

          if (data?.available === false) {
            setProposal({
              goalId,
              goalName,
              cutting: null,
              why: null,
              refusal:
                data.reason ??
                'No assistant is configured on this gateway, so nothing was proposed.',
            });
            return;
          }
          if (data?.rejected) {
            setProposal({
              goalId,
              goalName,
              cutting: null,
              why: null,
              refusal: `The book proposed something this sheet does not carry, so nothing was placed (${data.rejected.detail ?? data.rejected.reason}).`,
            });
            return;
          }
          if (!data?.spec) {
            setProposal({
              goalId,
              goalName,
              cutting: null,
              why: null,
              refusal: data?.reason ?? 'The book returned nothing.',
            });
            return;
          }

          const id = data.spec.analysisId;
          const graph = data.spec.graph;
          const days = num(data.spec.days);
          if (!isAnalysisId(id) || !isGraphType(graph)) {
            setProposal({
              goalId,
              goalName,
              cutting: null,
              why: null,
              refusal:
                'The book named an analysis or a drawing this sheet does not carry. Nothing was placed — the two catalogues have drifted, which is a defect worth reporting.',
            });
            return;
          }
          if (days !== null && !OFFERED_WINDOWS.includes(days)) {
            setProposal({
              goalId,
              goalName,
              cutting: null,
              why: null,
              refusal: `The book asked for a ${days}-day window, which this page does not offer.`,
            });
            return;
          }

          setProposal({
            goalId,
            goalName,
            cutting: { id, graph, days },
            why: typeof data.spec.why === 'string' ? data.spec.why : null,
            refusal: null,
          });
        } catch (err: unknown) {
          const detail =
            (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
            (err as { message?: string })?.message ??
            'the request failed';
          setError(`Asking the book did not go through: ${detail}`);
        } finally {
          setAsking(null);
        }
      })();
    },
    [activeRestaurantId],
  );

  const dismiss = useCallback(() => setProposal(null), []);
  const clearError = useCallback(() => setError(null), []);

  return useMemo(
    () => ({
      canWrite,
      readOnlyReason,
      busy,
      error,
      clearError,
      create,
      update,
      archive,
      ask,
      asking,
      proposal,
      dismiss,
      place,
    }),
    [
      archive,
      ask,
      asking,
      busy,
      canWrite,
      clearError,
      create,
      dismiss,
      error,
      place,
      proposal,
      readOnlyReason,
      update,
    ],
  );
}
