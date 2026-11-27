/**
 * The house's mail setup (founder /goal 2026-11-07: "which email do we
 * select, how do we prepare that, the portal that leads to there"): one read,
 * GET /communications/mail-setup, and three acts an owner or a manager may
 * take. Every act answers with the whole setup, so the page shows what the
 * server now holds, never a guess.
 *
 * No mail is sent by anything here: the test letter is a `mailto:` the owner
 * sends from their own mailbox (apps/api-gateway/.../mail-setup/test-letter.ts).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../services/api/client';
import { mailKeys, useHouse } from './useMailData';

export interface MailSenderChoice {
  connectionId: string;
  address: string | null;
  personName: string | null;
  mine: boolean;
  chosen: boolean;
  sending: boolean;
}

export interface MailTestLetter {
  code: string;
  subject: string;
  address: string;
  mailto: string;
  startedAt: string;
  arrivedAt: string | null;
  arrivedFrom: string | null;
}

/** apps/api-gateway/src/communications/mail-setup/mail-setup.service.ts MailSetupView. */
export interface MailSetupView {
  canChange: boolean;
  senders: { failed: string | null; choices: MailSenderChoice[]; chosenConnectionId: string | null };
  arrival: { domainReady: boolean; address: string | null; failed: string | null };
  testLetter: { failed: string | null; latest: MailTestLetter | null };
}

/** A test letter is waited on, and the page re-reads, for this long after it was started. */
export const TEST_WAIT_MS = 30 * 60_000;
export const TEST_POLL_MS = 10_000;

/** True while the newest test letter has not arrived and was started inside TEST_WAIT_MS. */
export function waitingForTestLetter(view: MailSetupView | undefined, now: number): boolean {
  const t = view?.testLetter.latest;
  if (!t || t.arrivedAt) return false;
  const started = Date.parse(t.startedAt);
  return Number.isFinite(started) && now - started < TEST_WAIT_MS;
}

export const mailSetupKey = (house: string) => ['mail-setup', house] as const;

const BASE = '/communications/mail-setup';

export function useMailSetup() {
  const house = useHouse();
  return useQuery<MailSetupView>({
    queryKey: mailSetupKey(house),
    queryFn: async () => (await apiClient.get<MailSetupView>(BASE)).data,
    enabled: Boolean(house),
    staleTime: 5_000,
    // Re-read only while a test letter is on its way; otherwise the page is still.
    refetchInterval: (q) => (waitingForTestLetter(q.state.data, Date.now()) ? TEST_POLL_MS : false),
  });
}

/**
 * One act. Its answer replaces the setup in the cache, and the reads that
 * show the same facts elsewhere (the sender, the summary's address) are read
 * again.
 */
function useSetupAct<V>(send: (v: V) => Promise<MailSetupView>) {
  const house = useHouse();
  const qc = useQueryClient();
  return useMutation<MailSetupView, unknown, V>({
    mutationFn: send,
    onSuccess: (view) => {
      qc.setQueryData(mailSetupKey(house), view);
      void qc.invalidateQueries({ queryKey: ['house-letter-sender', house] });
      void qc.invalidateQueries({ queryKey: mailKeys.summary(house) });
    },
  });
}

/** PUT sender: a connection id, or null to drop the house's choice. */
export function useChooseSender() {
  return useSetupAct<string | null>(
    async (connectionId) => (await apiClient.put<MailSetupView>(`${BASE}/sender`, { connectionId })).data,
  );
}

export function useMakeAddress() {
  return useSetupAct<void>(async () => (await apiClient.post<MailSetupView>(`${BASE}/address`)).data);
}

export function useStartTestLetter() {
  return useSetupAct<void>(async () => (await apiClient.post<MailSetupView>(`${BASE}/test-letter`)).data);
}
