/**
 * The one definition of "who the house's letters come from" (GET
 * /communications/letters/sender). Mail's tab, the composer and the composer's
 * send standing all read it under one shared cache key; each had its own copy of
 * the key and options, so changing one silently changed what the other two read.
 * The key and the read live here now, and each caller says only what differs:
 * whether to poll, and when to wait.
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../services/api/client';
import type { SenderIdentity } from './Compose/useComposeData';

export const letterSenderKey = (house: string) => ['house-letter-sender', house] as const;

export function useLetterSenderRead<T extends SenderIdentity = SenderIdentity>(
  house: string,
  opts: { refetchMs?: number | false; enabled?: boolean } = {},
) {
  return useQuery<T>({
    queryKey: letterSenderKey(house),
    queryFn: async () => (await apiClient.get<T>('/communications/letters/sender')).data,
    staleTime: 60_000,
    // The app's default is to refetch on every mount; each new reader of this
    // read (Mail, then the composer) would ask again inside the minute the
    // read is kept (r50 w3: Mail then Compose made two requests).
    refetchOnMount: true,
    ...(opts.enabled === undefined ? {} : { enabled: opts.enabled }),
    refetchInterval: opts.refetchMs ?? false,
  });
}
