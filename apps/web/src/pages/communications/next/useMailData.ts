/**
 * The Mail tab's reads (founder /goal 2026-11-07; proposal Phase C). Every
 * read goes through the shared `apiClient` and is house-scoped server-side
 * (GET /mail/* takes the house from the token, never a parameter).
 *
 * Freshness (proposal F13; r41 mail audit, gaps 4 and 5): only the summary
 * polls every 30 s, and only while the Mail tab is shown; the tab label's
 * count reads it once, without polling, while Letters is shown. The lists —
 * people, a person's threads, an open thread — are read again when the
 * summary says something moved ({@link useMailListsFollowSummary}), and
 * otherwise every {@link MAIL_LIST_FALLBACK_MS}. Each list re-read fetches
 * every page already loaded, one after another, and a search re-runs over
 * every letter, so a quiet house no longer pays for them every 30 s. React
 * Query already stops an interval in a hidden browser tab
 * (`refetchIntervalInBackground` is false).
 *
 * Paging never caps (proposal G5): people and threads follow the server's
 * `next` cursor; a thread pages backwards by `before`.
 */

import { useEffect, useRef } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../contexts/AuthContext';
import { apiClient } from '../../../services/api/client';
import { integrationsApi } from '../../../services/api/integrations';
import type { SenderIdentity } from './Compose/useComposeData';
import type {
  IntakeRead,
  MailIntakeResponse,
  MailboxReader,
  MailPeoplePage,
  MailSummary,
  MailThreadPage,
  MailThreadsPage,
  SeenMark,
} from './mail-format';
import { READ_ALL_ID } from './mail-format';

export const MAIL_POLL_MS = 30_000;

/**
 * How often a list is read again when the summary says nothing moved. It
 * bounds what the summary cannot see: a letter that was refused or pulled
 * back, or a letter a colleague sent from a house with no zone (its "out
 * today" is unknown, so it does not move).
 */
export const MAIL_LIST_FALLBACK_MS = 120_000;

export function useHouse(): string {
  const { user, activeRestaurantId } = useAuth();
  return activeRestaurantId ?? user?.restaurantId ?? '';
}

export const mailKeys = {
  summary: (house: string) => ['mail-summary', house] as const,
  people: (house: string, waitingOnly: boolean, search = '') => ['mail-people', house, waitingOnly, search] as const,
  threads: (house: string, withKey: string) => ['mail-threads', house, withKey] as const,
  thread: (house: string, key: string, withKey: string) => ['mail-thread', house, key, withKey] as const,
};

/** GET /mail/summary. `poll` is true only while the Mail tab is shown. */
export function useMailSummary(poll: boolean) {
  const house = useHouse();
  return useQuery<MailSummary>({
    queryKey: mailKeys.summary(house),
    queryFn: async () => (await apiClient.get<MailSummary>('/mail/summary')).data,
    enabled: Boolean(house),
    staleTime: 15_000,
    refetchInterval: poll ? MAIL_POLL_MS : false,
  });
}

/**
 * What, in the summary, moves when a Mail list can have changed: who is
 * waiting and since when, the day's and the month's letters in and out, and
 * the last letter stored at each door. Null before the summary is read.
 */
export function mailChangeMark(summary: MailSummary | null | undefined): string | null {
  if (!summary) return null;
  return JSON.stringify([
    summary.waitingPeople,
    summary.oldestWaitAt,
    summary.inToday,
    summary.outToday,
    summary.inLast30 ?? null,
    summary.doors.houseMailbox.lastStoredAt,
    summary.doors.whatsapp.lastStoredAt,
    summary.doors.mudavymMail.lastStoredAt,
  ]);
}

/**
 * The lists follow the summary (r41 mail audit, gaps 4 and 5): when its mark
 * moves, the people, every person's threads and every open thread of this
 * house are read again. The first summary read, and a summary that answers
 * the same again, read nothing. Mounted once, by the Mail tab.
 */
export function useMailListsFollowSummary(summary: MailSummary | null | undefined): void {
  const house = useHouse();
  const qc = useQueryClient();
  const mark = mailChangeMark(summary);
  const last = useRef<{ house: string; mark: string } | null>(null);
  useEffect(() => {
    if (mark === null) return;
    const before = last.current;
    last.current = { house, mark };
    if (!before || before.house !== house || before.mark === mark) return;
    for (const root of ['mail-people', 'mail-threads', 'mail-thread']) {
      void qc.invalidateQueries({ queryKey: [root, house] });
    }
  }, [house, mark, qc]);
}

/**
 * GET /mail/people, cursor-paged; "Show older people" appends the next page.
 * `search` (r28 mail gap 16) is the trimmed term, '' for none: the server
 * searches, so a person past the first page is found too. While a new term
 * is read, the last list stays on screen instead of "Reading the mail…".
 */
export function useMailPeople(waitingOnly: boolean, search = '') {
  const house = useHouse();
  return useInfiniteQuery<MailPeoplePage>({
    queryKey: mailKeys.people(house, waitingOnly, search),
    initialPageParam: null as string | null,
    placeholderData: (previous) => previous,
    queryFn: async ({ pageParam }) => {
      const params: Record<string, string> = {};
      if (waitingOnly) params.waiting = '1';
      if (search) params.q = search;
      if (pageParam) params.after = String(pageParam);
      return (await apiClient.get<MailPeoplePage>('/mail/people', { params })).data;
    },
    getNextPageParam: (last) => last.next ?? undefined,
    enabled: Boolean(house),
    staleTime: 15_000,
    refetchInterval: MAIL_LIST_FALLBACK_MS,
  });
}

async function readThreadsPage(withKey: string, pageParam: unknown): Promise<MailThreadsPage> {
  const params: Record<string, string> = { with: withKey };
  if (pageParam) params.after = String(pageParam);
  return (await apiClient.get<MailThreadsPage>('/mail/threads', { params })).data;
}

async function readThreadPage(key: string, pageParam: unknown, withKey: string | null = null): Promise<MailThreadPage> {
  const params: Record<string, string> = { key };
  // One key can be two threads (one Gmail thread to two vendors): naming
  // the person reads only theirs (gateway GET /mail/thread `with`).
  if (withKey) params.with = withKey;
  if (pageParam) params.before = String(pageParam);
  return (await apiClient.get<MailThreadPage>('/mail/thread', { params })).data;
}

/**
 * Start the read a click is about to ask for, when the pointer reaches a row,
 * focus lands on it or a finger touches it (r56 mail). Both reads only read: the
 * "seen" mark is a separate POST sent by the open thread, so looking ahead marks
 * nothing. It shares the open view's cache entry and its 15 s freshness, so a
 * row passed over twice is read once, and a failed read just leaves the click
 * to read it, and say so, as it always did.
 */
export function useMailLookAhead() {
  const house = useHouse();
  const client = useQueryClient();
  return {
    threads: (withKey: string) => {
      if (!house || !withKey) return;
      void client.prefetchInfiniteQuery<MailThreadsPage>({
        queryKey: mailKeys.threads(house, withKey),
        initialPageParam: null as string | null,
        queryFn: ({ pageParam }) => readThreadsPage(withKey, pageParam),
        staleTime: 15_000,
      });
    },
    thread: (key: string, withKey: string | null = null) => {
      if (!house || !key) return;
      void client.prefetchInfiniteQuery<MailThreadPage>({
        queryKey: mailKeys.thread(house, key, withKey ?? ''),
        initialPageParam: null as string | null,
        queryFn: ({ pageParam }) => readThreadPage(key, pageParam, withKey),
        staleTime: 15_000,
      });
    },
  };
}

/** GET /mail/threads?with=<kind>:<id>, newest first. */
export function useMailThreads(withKey: string | null) {
  const house = useHouse();
  return useInfiniteQuery<MailThreadsPage>({
    queryKey: mailKeys.threads(house, withKey ?? ''),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => readThreadsPage(withKey ?? '', pageParam),
    getNextPageParam: (last) => last.next ?? undefined,
    enabled: Boolean(house && withKey),
    staleTime: 15_000,
    refetchInterval: MAIL_LIST_FALLBACK_MS,
  });
}

/**
 * GET /mail/thread?key=<thread_key>[&with=vendor:<id>]. The first page is the newest 50 letters;
 * "Show earlier letters" asks for the page `before` the oldest one held.
 * Pages are stored newest-first, so a reader joins them oldest-first.
 */
export function useMailThread(key: string | null, withKey: string | null = null) {
  const house = useHouse();
  return useInfiniteQuery<MailThreadPage>({
    queryKey: mailKeys.thread(house, key ?? '', withKey ?? ''),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => readThreadPage(key ?? '', pageParam, withKey),
    getNextPageParam: (last) => last.before ?? undefined,
    enabled: Boolean(house && key),
    staleTime: 15_000,
    refetchInterval: MAIL_LIST_FALLBACK_MS,
  });
}

/**
 * The house's sender and mailbox reader, from GET /communications/letters/sender.
 * The SAME cache entry the composer and the requests panel read
 * (`house-letter-sender`), so the tab adds no request. The route also answers
 * `conversation` and `reader`, which the composer's type does not name.
 */
export interface SenderWithReader extends SenderIdentity {
  reader?: MailboxReader & { lastRun?: unknown };
}

/** `poll`: re-read every 30 s while the Mail tab is shown (QA round 16, finding 6). */
export function useMailSender(poll = false) {
  const house = useHouse();
  return useQuery<SenderWithReader>({
    queryKey: ['house-letter-sender', house],
    queryFn: async () => (await apiClient.get<SenderWithReader>('/communications/letters/sender')).data,
    enabled: Boolean(house),
    staleTime: 60_000,
    refetchInterval: poll ? MAIL_POLL_MS : false,
  });
}

/** What the house-grants read says about `gmail_read_all`, the grant that reads every conversation. */
interface HouseGrantRow {
  connectionId: string;
  integrationId: string;
  houseAccess?: { revoked?: boolean } | null;
}

const readAllKey = (house: string) => ['mail-read-all', house] as const;

/**
 * Whether this house reads every conversation, from GET
 * /integrations/oauth/house-grants (owner or manager only, so `enabled` is
 * false for staff). It does when some member holds a `gmail_read_all` grant
 * that the house has not stopped using. A failed read is `isError`, never "no".
 */
export function useReadAllGrants(enabled: boolean) {
  const house = useHouse();
  const q = useQuery<{ grants: HouseGrantRow[] }>({
    queryKey: readAllKey(house),
    queryFn: async () => {
      const { data } = await apiClient.get<{ grants?: HouseGrantRow[] }>('/integrations/oauth/house-grants');
      return { grants: data.grants ?? [] };
    },
    enabled: Boolean(house) && enabled,
    staleTime: 30_000,
  });
  const live = (q.data?.grants ?? []).filter((g) => g.integrationId === READ_ALL_ID && g.houseAccess?.revoked !== true);
  return { isPending: q.isPending && enabled, isError: q.isError, reads: live.length > 0, liveIds: live.map((g) => g.connectionId) };
}

/**
 * Whether this deployment offers the grant at all, from GET
 * /integrations/oauth/catalog (the same read, and cache entry, the setup page
 * uses). An unread or unknown catalogue offers nothing.
 */
export function useReadAllOffered(enabled: boolean): boolean {
  const q = useQuery({
    queryKey: ['integration-catalog'],
    queryFn: () => integrationsApi.getCatalog(),
    enabled,
    staleTime: 300_000,
  });
  const rows = Array.isArray(q.data) ? q.data : [];
  return enabled && rows.some((r) => r.id === READ_ALL_ID && r.available === true);
}

/**
 * The house stops using every live `gmail_read_all` grant: PUT
 * /integrations/oauth/house-grants/:connectionId/access `{ houseUses: false }`.
 * The member keeps the grant; the reader stops on its next run. Done when the
 * grants have been read again, so the tab never shows the old answer.
 */
export function useStopReadingAll() {
  const house = useHouse();
  const qc = useQueryClient();
  return useMutation<void, unknown, { connectionIds: string[] }>({
    mutationFn: async ({ connectionIds }) => {
      for (const id of connectionIds) {
        await apiClient.put(`/integrations/oauth/house-grants/${id}/access`, { houseUses: false });
      }
    },
    onSettled: () => {
      for (const root of ['mail-people', 'mail-summary']) void qc.invalidateQueries({ queryKey: [root, house] });
      return qc.invalidateQueries({ queryKey: readAllKey(house) });
    },
  });
}

const intakeKey = (house: string) => ['mail-intake', house] as const;

/**
 * GET /communications/letters/intake, read only while the intake sheet is open.
 * A 404 or 403 (route not deployed yet, or staff) is `absent`, which the sheet
 * words as it always did; any other error is `failed`, which it never words as
 * "none". While the read is pending the sheet shows `absent`'s words.
 */
export function useMailIntake(enabled: boolean): IntakeRead {
  const house = useHouse();
  const q = useQuery<MailIntakeResponse>({
    queryKey: intakeKey(house),
    queryFn: async () => (await apiClient.get<MailIntakeResponse>('/communications/letters/intake')).data,
    enabled: Boolean(house) && enabled,
    retry: false,
    staleTime: 15_000,
  });
  if (q.isError) {
    const status = (q.error as { response?: { status?: unknown } } | null)?.response?.status;
    return status === 404 || status === 403 ? { kind: 'absent' } : { kind: 'failed' };
  }
  return q.data ? { kind: 'known', data: q.data } : { kind: 'absent' };
}

/** POST /communications/letters/intake/read-again: offers kept letters to their homes once more. */
export function useIntakeReadAgain() {
  const house = useHouse();
  const qc = useQueryClient();
  return useMutation<{ queued: number }>({
    mutationFn: async () => (await apiClient.post<{ queued: number }>('/communications/letters/intake/read-again')).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: intakeKey(house) });
    },
  });
}

/**
 * POST / DELETE /mail/letters/:id/no-reply-needed (r28 mail gap 4). On
 * success every read that says who is waiting is read again: the thread, the
 * person's threads, the people list and the header with its tab badge.
 */
export function useNoReplyMark() {
  const house = useHouse();
  const qc = useQueryClient();
  return useMutation<{ id: string; marked: boolean }, unknown, { id: string; marked: boolean }>({
    mutationFn: async ({ id, marked }) => {
      const url = `/mail/letters/${encodeURIComponent(id)}/no-reply-needed`;
      return (marked ? await apiClient.post<{ id: string; marked: boolean }>(url) : await apiClient.delete<{ id: string; marked: boolean }>(url)).data;
    },
    // The act is not done until the thread on screen shows it (r35 mail,
    // M-F1): the mark answered at once, but the page read again 1-2 s later,
    // and in between the button read "No reply needed" again over a letter
    // still drawn as waiting. Returning the thread's refetch keeps the
    // mutation pending, so "Saving…" or "Taking it back…" holds until the
    // line appears. A failed refetch still settles (TanStack does not throw
    // from an invalidation), and the API client's 30 s timeout bounds a slow
    // one. The lists behind the thread are read again without waiting.
    onSuccess: () => {
      for (const root of ['mail-threads', 'mail-people', 'mail-summary']) {
        void qc.invalidateQueries({ queryKey: [root, house] });
      }
      return qc.invalidateQueries({ queryKey: ['mail-thread', house] });
    },
  });
}

/**
 * POST /mail/thread/seen (r36 mail gap 6): this person was shown this thread
 * through its newest vendor letter. On success the people list and the
 * person's threads are read again, so "New" leaves the rows behind it. A
 * failed mark changes nothing on screen: the row stays "New", which is the
 * side to err on.
 */
export function useMarkThreadSeen() {
  const house = useHouse();
  const qc = useQueryClient();
  return useMutation<unknown, unknown, SeenMark>({
    mutationFn: async (mark) =>
      (await apiClient.post('/mail/thread/seen', undefined, { params: { key: mark.key, with: mark.with, through: mark.through } }))
        .data,
    onSuccess: () => {
      for (const root of ['mail-people', 'mail-threads']) {
        void qc.invalidateQueries({ queryKey: [root, house] });
      }
    },
  });
}
