/**
 * Everything the house composer needs to write one letter, and nothing it can
 * make up.
 *
 * FOUR READS, EACH WITH ITS OWN THREE STATES (ADR 0051 clause 3)
 *   sender    — which mailbox this house sends from, or why none does
 *   book      — every address the house may write to
 *   templates — the house's own letter templates
 *   insights  — the engine's sentences, WHOLE, with their provenance
 *
 * Every one of them is tenant-keyed by `activeRestaurantId`: a restaurant
 * switch must never leave the previous tenant's vendor addresses in a composer.
 *
 * THE MERGE UNIT IS THE SENTENCE, NOT THE FIGURE
 * ----------------------------------------------
 * `insights` returns rows the engine already computed, each with its
 * `candidate_key`, its window and its `computed_at`. The picker inserts the
 * whole `sentence`; nothing here parses a number back out of one. The reason is
 * the one `pages/recommendations/next/rec-forward.ts` gives for the same rule on
 * the recommendation side — a figure re-derived on the client is a second
 * arithmetic, and a letter a vendor keeps is the worst place for the two to
 * disagree. A sentence the engine withheld is simply not in this list, so there
 * is nothing to insert and nothing to invent.
 */

import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../../contexts/AuthContext';
import { apiClient } from '../../../../services/api/client';

export interface SenderIdentity {
  kind: 'house_mailbox' | 'mudavym_subdomain' | 'none' | 'unknown';
  address: string | null;
  sendable: boolean;
  ceremony: 'seal' | 'undo' | 'none';
  undoMs: number | null;
  words: string;
  missing: string[];
  deployment: { address: string; refusedBecause: string };
  subdomain: { provisioned: boolean; tier: 'paid'; words: string };
  categories: string[];
  dispatcher: {
    at: string;
    considered: number;
    sent: number;
    failed: number;
    skipped: number;
    error: string | null;
  } | null;
}

export interface BookEntry {
  providerId: string;
  providerName: string;
  contactName: string | null;
  email: string;
  source: 'provider' | 'contact';
}

export interface LetterTemplate {
  id: string;
  name: string;
  subject: string | null;
  body: string;
  category: string | null;
  mergeFields: { key: string }[] | null;
  lastEditedBy: string | null;
  lastEditedAt: string | null;
  lastUsedAt: string | null;
}

export interface InsightSentence {
  candidateKey: string;
  category: string | null;
  sentence: string;
  periodStart: string | null;
  periodEnd: string | null;
  computedAt: string | null;
}

export interface QueuedLetter {
  id: string;
  providerId: string;
  subject: string | null;
  to: string | null;
  dispatchAt: string | null;
}

export interface GuardrailHit {
  rule: string;
  says: string;
  blocking: boolean;
}

/**
 * The server's own sentence, terminated.
 *
 * Every surface here RELAYS this and then adds its own consequence clause, so
 * the two must not run together. A gateway message is already a sentence; an
 * axios fallback ("Unauthorized", "Network Error") is a bare word, and
 * "Unauthorized This is a failed read" is what that reads like on screen —
 * measured in the first browser capture of the letter library. The full stop is
 * added here, once, rather than in four pieces of copy.
 */
function errText(e: unknown): string {
  const raw = pickMessage(e);
  return /[.!?]$/.test(raw) ? raw : `${raw}.`;
}

function pickMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'response' in e) {
    const body = (e as { response?: { data?: { message?: unknown } } }).response?.data;
    const message = body?.message;
    if (typeof message === 'string' && message.trim()) return message.trim();
    if (Array.isArray(message) && message.length > 0) return message.join(' ');
  }
  if (e instanceof Error && e.message.trim()) return e.message.trim();
  return 'unknown error';
}

/** The guardrail sentences a 422 carried, when it carried any. */
export function guardrailsFrom(e: unknown): GuardrailHit[] {
  if (!e || typeof e !== 'object' || !('response' in e)) return [];
  const body = (e as { response?: { data?: { guardrails?: unknown } } }).response?.data;
  const hits = body?.guardrails;
  return Array.isArray(hits) ? (hits as GuardrailHit[]) : [];
}

export function useComposeData() {
  const { user, activeRestaurantId } = useAuth();
  const restaurantId = activeRestaurantId ?? user?.restaurantId ?? '';
  const queryClient = useQueryClient();

  const senderQ = useQuery<SenderIdentity>({
    queryKey: ['house-letter-sender', restaurantId],
    queryFn: async () => {
      const { data } = await apiClient.get<SenderIdentity>('/communications/letters/sender');
      return data;
    },
    staleTime: 60_000,
  });

  const bookQ = useQuery<BookEntry[]>({
    queryKey: ['house-letter-book', restaurantId],
    queryFn: async () => {
      const { data } = await apiClient.get<{ entries: BookEntry[] }>(
        '/communications/letters/book',
      );
      return data.entries;
    },
    staleTime: 60_000,
  });

  const templatesQ = useQuery<LetterTemplate[]>({
    queryKey: ['house-letter-templates', restaurantId],
    queryFn: async () => {
      const { data } = await apiClient.get<{ templates: LetterTemplate[] }>(
        '/communications/letters/templates',
      );
      return data.templates;
    },
    staleTime: 60_000,
  });

  const queuedQ = useQuery<QueuedLetter[]>({
    queryKey: ['house-letter-queued', restaurantId],
    queryFn: async () => {
      const { data } = await apiClient.get<{ queued: QueuedLetter[] }>(
        '/communications/letters/queued',
      );
      return data.queued;
    },
    staleTime: 15_000,
  });

  const insightsQ = useQuery<InsightSentence[]>({
    queryKey: ['house-letter-insights', restaurantId],
    enabled: Boolean(restaurantId),
    queryFn: async () => {
      const { data } = await apiClient.get<
        | { insights?: Record<string, unknown>[] }
        | Record<string, unknown>[]
      >(`/analytics/insights/${restaurantId}?limit=30`);
      const rows = Array.isArray(data)
        ? data
        : ((data.insights ?? []) as Record<string, unknown>[]);
      // The endpoint answers in two shapes — stored rows (snake_case columns)
      // and a fresh compute (the generator's camelCase records) — because it
      // falls through to `generate()` on a cold cache
      // (analytics.controller.ts:318-326). Both are read, and a row missing a
      // candidate key is DROPPED rather than inserted without provenance.
      return rows
        .map((r) => ({
          candidateKey: String(r.candidate_key ?? r.candidateKey ?? ''),
          category: (r.category as string | null) ?? null,
          sentence: String(r.sentence ?? ''),
          periodStart: (r.period_start ?? r.periodStart ?? null) as string | null,
          periodEnd: (r.period_end ?? r.periodEnd ?? null) as string | null,
          computedAt: (r.computed_at ?? r.computedAt ?? null) as string | null,
        }))
        .filter((r) => r.candidateKey !== '' && r.sentence !== '');
    },
    staleTime: 5 * 60_000,
  });

  const refetchQueued = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['house-letter-queued', restaurantId] });
    void queryClient.invalidateQueries({ queryKey: ['house-letter-templates', restaurantId] });
  }, [queryClient, restaurantId]);

  const byProvider = useMemo(() => {
    const map = new Map<string, BookEntry[]>();
    for (const entry of bookQ.data ?? []) {
      const list = map.get(entry.providerId);
      if (list) list.push(entry);
      else map.set(entry.providerId, [entry]);
    }
    return map;
  }, [bookQ.data]);

  return {
    restaurantId,
    sender: senderQ.data ?? null,
    senderFailed: senderQ.isError,
    senderError: senderQ.isError ? errText(senderQ.error) : null,
    book: bookQ.data ?? null,
    bookFailed: bookQ.isError,
    bookError: bookQ.isError ? errText(bookQ.error) : null,
    byProvider,
    templates: templatesQ.data ?? null,
    templatesFailed: templatesQ.isError,
    templatesError: templatesQ.isError ? errText(templatesQ.error) : null,
    insights: insightsQ.data ?? null,
    insightsFailed: insightsQ.isError,
    insightsError: insightsQ.isError ? errText(insightsQ.error) : null,
    queued: queuedQ.data ?? null,
    queuedFailed: queuedQ.isError,
    refetchQueued,
  };
}

export { errText };
