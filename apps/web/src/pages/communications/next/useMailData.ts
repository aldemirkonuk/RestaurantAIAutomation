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

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../contexts/AuthContext';
import { apiClient } from '../../../services/api/client';
import type { SenderIdentity } from './Compose/useComposeData';
import type {
  MailboxReader,
  MailPeoplePage,
  MailSummary,
  MailThreadPage,
  MailThreadsPage,
} from './mail-format';

export const MAIL_POLL_MS = 30_000;

function useHouse(): string {
  const { user, activeRestaurantId } = useAuth();
  return activeRestaurantId ?? user?.restaurantId ?? '';
}

export const mailKeys = {
  summary: (house: string) => ['mail-summary', house] as const,
  people: (house: string, waitingOnly: boolean) => ['mail-people', house, waitingOnly] as const,
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

/** GET /mail/people, cursor-paged; "Show older people" appends the next page. */
export function useMailPeople(waitingOnly: boolean) {
  const house = useHouse();
  return useInfiniteQuery<MailPeoplePage>({
    queryKey: mailKeys.people(house, waitingOnly),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const params: Record<string, string> = {};
      if (waitingOnly) params.waiting = '1';
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

export function useMailSender() {
  const house = useHouse();
  return useQuery<SenderWithReader>({
    queryKey: ['house-letter-sender', house],
    queryFn: async () => (await apiClient.get<SenderWithReader>('/communications/letters/sender')).data,
    enabled: Boolean(house),
    staleTime: 60_000,
  });
}
