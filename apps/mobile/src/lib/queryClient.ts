import { QueryClient } from "@tanstack/react-query";
import { storage } from "./mmkv";

/**
 * Query client with a hand-rolled MMKV persister: every settled query is
 * written to disk, and boot rehydrates them synchronously so screens render
 * instantly from the last known data (offline or cold start). Freshness
 * labels read dataUpdatedAt from the same records.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 24 * 60 * 60 * 1000,
      retry: 1,
      refetchOnReconnect: true,
    },
  },
});

const PREFIX = "q:";
const PERSIST_VERSION = "v1";

interface PersistedQuery {
  v: string;
  data: unknown;
  dataUpdatedAt: number;
}

export function hydrateQueryCache(): void {
  for (const key of storage.getAllKeys()) {
    if (!key.startsWith(PREFIX)) continue;
    try {
      const raw = storage.getString(key);
      if (!raw) continue;
      const record = JSON.parse(raw) as PersistedQuery;
      if (record.v !== PERSIST_VERSION) {
        storage.delete(key);
        continue;
      }
      const queryKey = JSON.parse(key.slice(PREFIX.length));
      queryClient.setQueryData(queryKey, record.data, {
        updatedAt: record.dataUpdatedAt,
      });
    } catch {
      storage.delete(key);
    }
  }
}

export function startQueryPersistence(): () => void {
  return queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== "updated") return;
    const query = event.query;
    if (query.state.status !== "success" || query.state.data === undefined) return;
    try {
      storage.set(
        PREFIX + JSON.stringify(query.queryKey),
        JSON.stringify({
          v: PERSIST_VERSION,
          data: query.state.data,
          dataUpdatedAt: query.state.dataUpdatedAt,
        } satisfies PersistedQuery),
      );
    } catch {
      // A value too large or non-serializable is simply not persisted.
    }
  });
}

/** Wipe persisted queries on sign-out so the next user never sees stale data. */
export function clearPersistedQueries(): void {
  for (const key of storage.getAllKeys()) {
    if (key.startsWith(PREFIX)) storage.delete(key);
  }
  queryClient.clear();
}
