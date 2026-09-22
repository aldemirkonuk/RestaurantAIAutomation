/**
 * useHelpNextData — every read `/help` makes.
 *
 * NINE reads, each its own `useQuery`, on a page opened rarely — the same
 * trade-off ADR 0114 already chose over a two-answer aggregate for
 * `/connections` ("seven requests on a page a manager opens rarely is the
 * price"). Composing them client-side means a failed till read leaves the
 * other facts standing, costs zero gateway change, and needs no migration —
 * see the wave dossier `p4-scratch/wave/help.md` §4 (fork F5) for the
 * aggregate this rejected and why.
 *
 * SCOPE (dossier forks F1, F2 — recorded here as the assumption taken rather
 * than left to block the page, per CLAUDE.md §5 "do every part that does not
 * depend on it, then state the assumption")
 * -----------------------------------------------------------------------
 * F1 — "waiting on the house" is the narrow set the dossier recommended: a
 * person must act on each one today (one-tap actions, orders awaiting
 * approval, Ask AI proposals). The curation queues (identity candidates, POS
 * unresolved lines) are NOT read here — they already have an owning page.
 * F2 — an owner/manager reads `/integrations/oauth/house-grants` (every
 * member's grant against this house); anyone else reads their own
 * `/integrations/oauth/connections` instead, and the resulting item says
 * which scope it is (`hp-readiness.ts` `OauthGrants.scope`), so a staff
 * reader never mistakes "my own grants" for "this house's".
 *
 * `/one-tap-actions/pending`, `/notifications/producers/status` and
 * `/calendar/reminders/status` all scope from the signed token — no path or
 * query restaurant id is ever sent (the tenant-from-body/path faults the
 * dossier's endpoint table records are read-only findings about the
 * gateway, not something a caller here could introduce).
 *
 * `GET /health/ready` is the one PUBLIC, untenanted read — see hp-service.ts.
 * It is not `enabled` on a restaurant id because it answers the same for
 * every one.
 */

import { useMemo } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useAuth } from '../../../contexts/AuthContext';
import { apiClient } from '../../../services/api/client';
import { getPosStatus, type PosStatusResponse } from '../../../services/api/posHub';
import { listOpenProposals } from '../../../services/api/askAi';
import { apiMessage, isForbidden } from './hp-format';
import {
  readinessFromResponse,
  readinessUnreachable,
  type ServiceState,
} from './hp-service';
import type {
  Fetched,
  LetterSenderRaw,
  McpConnectionRaw,
  OauthGrants,
  OneTapActionRaw,
  PosStatusRaw,
  ProducersStatusRaw,
  ReminderStatusRaw,
} from './hp-readiness';

function toFetched<T>(q: UseQueryResult<T, unknown>): Fetched<T> {
  if (q.isPending) return { status: 'loading' };
  if (q.isError) {
    return isForbidden(q.error)
      ? { status: 'refused', message: apiMessage(q.error, 'not yours to see') }
      : { status: 'error', message: apiMessage(q.error) };
  }
  return { status: 'ok', data: q.data as T };
}

export interface HelpNextData {
  role: 'owner' | 'manager' | 'staff' | null;
  houseName: string | null;
  restaurantId: string | null;

  mcp: Fetched<McpConnectionRaw[]>;
  oauth: Fetched<OauthGrants>;
  pos: Fetched<PosStatusRaw>;
  mail: Fetched<LetterSenderRaw>;

  oneTap: Fetched<OneTapActionRaw[]>;
  ordersPending: Fetched<{ count: number }>;
  askAi: Fetched<unknown[]>;

  producers: Fetched<ProducersStatusRaw>;
  reminders: Fetched<ReminderStatusRaw>;

  /** The one untenanted read — see the module header. */
  service: ServiceState;

  refetchAll: () => void;
}

export function useHelpNextData(): HelpNextData {
  const { activeRole, activeRestaurantId, availableRestaurants } = useAuth();
  const rid = activeRestaurantId ?? '';
  const role = activeRole;
  const isManager = role === 'owner' || role === 'manager';
  const houseName = useMemo(
    () => availableRestaurants.find((b) => b.id === rid)?.name ?? null,
    [availableRestaurants, rid],
  );

  const mcpQ = useQuery({
    queryKey: ['help-next-mcp', rid],
    queryFn: async (): Promise<McpConnectionRaw[]> => {
      const { data } = await apiClient.get<McpConnectionRaw[]>('/mcp-connections');
      return Array.isArray(data) ? data : [];
    },
    enabled: !!rid,
    staleTime: 30_000,
  });

  const oauthQ = useQuery({
    queryKey: ['help-next-oauth', rid, isManager],
    queryFn: async (): Promise<OauthGrants> => {
      if (isManager) {
        const { data } = await apiClient.get<{
          success: boolean;
          grants: Array<{ integrationId: string; ownerName: string | null; connectedAt: string | null }>;
        }>('/integrations/oauth/house-grants');
        return {
          scope: 'house',
          rows: (data.grants ?? []).map((g) => ({
            integrationId: g.integrationId,
            connected: true,
            connectedAt: g.connectedAt,
            ownerName: g.ownerName,
          })),
        };
      }
      const { data } = await apiClient.get<{
        success: boolean;
        connections: Array<{ integrationId: string; connected: boolean; connectedAt: string | null }>;
      }>('/integrations/oauth/connections');
      return {
        scope: 'own',
        rows: (data.connections ?? []).map((c) => ({
          integrationId: c.integrationId,
          connected: c.connected,
          connectedAt: c.connectedAt,
        })),
      };
    },
    enabled: !!rid && role !== null,
    staleTime: 30_000,
  });

  const posQ = useQuery({
    queryKey: ['help-next-pos', rid],
    queryFn: (): Promise<PosStatusResponse> => getPosStatus(rid),
    enabled: !!rid,
    staleTime: 30_000,
  });

  const mailQ = useQuery({
    queryKey: ['help-next-mail', rid],
    queryFn: async (): Promise<LetterSenderRaw> => {
      const { data } = await apiClient.get<{ reader: LetterSenderRaw['reader'] }>(
        '/communications/letters/sender',
      );
      return { reader: data.reader };
    },
    enabled: !!rid,
    staleTime: 30_000,
  });

  const oneTapQ = useQuery({
    queryKey: ['help-next-one-tap', rid],
    queryFn: async (): Promise<OneTapActionRaw[]> => {
      const { data } = await apiClient.get<OneTapActionRaw[]>('/one-tap-actions/pending');
      return Array.isArray(data) ? data : [];
    },
    enabled: !!rid,
    staleTime: 15_000,
  });

  const ordersPendingQ = useQuery({
    queryKey: ['help-next-orders-pending', rid],
    queryFn: async (): Promise<{ count: number }> => {
      const { data } = await apiClient.get<{ count: number }>('/procurement/orders/pending/count');
      return { count: typeof data.count === 'number' ? data.count : 0 };
    },
    enabled: !!rid,
    staleTime: 15_000,
  });

  const askAiQ = useQuery({
    queryKey: ['help-next-ask-ai', rid],
    queryFn: () => listOpenProposals(),
    enabled: !!rid,
    staleTime: 15_000,
  });

  const producersQ = useQuery({
    queryKey: ['help-next-producers', rid],
    queryFn: async (): Promise<ProducersStatusRaw> => {
      const { data } = await apiClient.get<ProducersStatusRaw>('/notifications/producers/status');
      return data;
    },
    enabled: !!rid,
    staleTime: 30_000,
  });

  const remindersQ = useQuery({
    queryKey: ['help-next-reminders', rid],
    queryFn: async (): Promise<ReminderStatusRaw> => {
      const { data } = await apiClient.get<ReminderStatusRaw>('/calendar/reminders/status');
      return data;
    },
    enabled: !!rid,
    staleTime: 30_000,
  });

  /* ── the one public, untenanted read ─────────────────────────────────── */
  const serviceQ = useQuery({
    queryKey: ['help-next-service'],
    queryFn: async (): Promise<ServiceState> => {
      const startedAt = performance.now();
      try {
        const { data, status } = await apiClient.get('/health/ready', { validateStatus: () => true });
        return readinessFromResponse(status, data, performance.now() - startedAt);
      } catch (e) {
        return readinessUnreachable(apiMessage(e, 'no error message'), performance.now() - startedAt);
      }
    },
    staleTime: 5_000,
  });

  const refetchAll = () => {
    void mcpQ.refetch();
    void oauthQ.refetch();
    void posQ.refetch();
    void mailQ.refetch();
    void oneTapQ.refetch();
    void ordersPendingQ.refetch();
    void askAiQ.refetch();
    void producersQ.refetch();
    void remindersQ.refetch();
    void serviceQ.refetch();
  };

  return {
    role,
    houseName,
    restaurantId: activeRestaurantId ?? null,

    mcp: toFetched(mcpQ),
    oauth: toFetched(oauthQ),
    pos: toFetched(posQ) as Fetched<PosStatusRaw>,
    mail: toFetched(mailQ),

    oneTap: toFetched(oneTapQ),
    ordersPending: toFetched(ordersPendingQ),
    askAi: toFetched(askAiQ) as Fetched<unknown[]>,

    producers: toFetched(producersQ),
    reminders: toFetched(remindersQ),

    service: serviceQ.data ?? { kind: 'checking' },

    refetchAll,
  };
}
