/**
 * The Mail tab's reads (founder /goal 2026-11-07; proposal Phase C). Every
 * read goes through the shared `apiClient` and is house-scoped server-side
 * (GET /mail/* takes the house from the token, never a parameter).
 *
 * Freshness (proposal F13): the people list and the summary poll every 30 s
 * only while the Mail tab is shown — the tab mounts these hooks only then,
 * and the tab label's count reads the summary once, without polling, while
 * Letters is shown. React Query already stops an interval in a hidden browser
 * tab (`refetchIntervalInBackground` is false).
 *
 * Paging never caps (proposal G5): people and threads follow the server's
 * `next` cursor; a thread pages backwards by `before`.
 */

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../contexts/AuthContext';
import { apiClient } from '../../../services/api/client';
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

export const MAIL_POLL_MS = 30_000;

export function useHouse(): string {
  const { user, activeRestaurantId } = useAuth();
  return activeRestaurantId ?? user?.restaurantId ?? '';
}

export const mailKeys = {
  summary: (house: string) => ['mail-summary', house] as const,
  people: (house: string, waitingOnly: boolean, search = '') => ['mail-people', house, waitingOnly, search] as const,
  threads: (house: string, withKey: string) => ['mail-threads', house, withKey] as const,
  thread: (house: string, key: string) => ['mail-thread', house, key] as const,
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
    refetchInterval: MAIL_POLL_MS,
  });
}

/** GET /mail/threads?with=<kind>:<id>, newest first. */
export function useMailThreads(withKey: string | null) {
  const house = useHouse();
  return useInfiniteQuery<MailThreadsPage>({
    queryKey: mailKeys.threads(house, withKey ?? ''),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const params: Record<string, string> = { with: withKey ?? '' };
      if (pageParam) params.after = String(pageParam);
      return (await apiClient.get<MailThreadsPage>('/mail/threads', { params })).data;
    },
    getNextPageParam: (last) => last.next ?? undefined,
    enabled: Boolean(house && withKey),
    staleTime: 15_000,
    refetchInterval: MAIL_POLL_MS,
  });
}

/**
 * GET /mail/thread?key=<thread_key>. The first page is the newest 50 letters;
 * "Show earlier letters" asks for the page `before` the oldest one held.
 * Pages are stored newest-first, so a reader joins them oldest-first.
 */
export function useMailThread(key: string | null) {
  const house = useHouse();
  return useInfiniteQuery<MailThreadPage>({
    queryKey: mailKeys.thread(house, key ?? ''),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const params: Record<string, string> = { key: key ?? '' };
      if (pageParam) params.before = String(pageParam);
      return (await apiClient.get<MailThreadPage>('/mail/thread', { params })).data;
    },
    getNextPageParam: (last) => last.before ?? undefined,
    enabled: Boolean(house && key),
    staleTime: 15_000,
    refetchInterval: MAIL_POLL_MS,
  });
}

/**
 * The house's sender and mailbox reader, from GET /communications/letters/sender.
 * The SAME cache entry the composer and the requests panel read
 * (`house-letter-sender`), so the tab adds no request. The route also answers
 * `conversation` and `reader`, which the composer's type does not name.
 */
export interface SenderWithReader extends SenderIdentity {
  conversation?: { where: string; words: string };
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
      (await apiClient.post('/mail/thread/seen', null, { params: { key: mark.key, with: mark.with, through: mark.through } }))
        .data,
    onSuccess: () => {
      for (const root of ['mail-people', 'mail-threads']) {
        void qc.invalidateQueries({ queryKey: [root, house] });
      }
    },
  });
}
