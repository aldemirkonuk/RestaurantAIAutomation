/**
 * GroundAskWatch — notices a person's first completed task (N-08 / P0-1).
 *
 * Renders nothing. Mounted beside `GroundChoiceSync` inside the
 * `QueryClientProvider`; it is a separate component only because the sync's
 * own tests run without a query client. The rule lives in `groundAsk.ts`.
 */

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../../stores';
import { watchFirstTask } from './groundAsk';

export function GroundAskWatch(): null {
  const userId = useAuthStore((s) => s.user?.userId) ?? null;
  const client = useQueryClient();
  useEffect(() => {
    if (!userId) return;
    return watchFirstTask(client);
  }, [userId, client]);
  return null;
}
