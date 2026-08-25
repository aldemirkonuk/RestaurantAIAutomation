import { MMKV } from "react-native-mmkv";

/**
 * Resilient sync key-value storage.
 *
 * react-native-mmkv 3.x needs the New Architecture (TurboModules). The app
 * requests it (app.json newArchEnabled), but a given runtime — Expo Go, a
 * dev client built before the flag, an old-arch export — may not have it on,
 * and constructing MMKV there throws at import time, taking every screen that
 * transitively imports storage down with it.
 *
 * So we construct MMKV defensively and fall back to an in-memory store with
 * the same tiny surface. On a proper new-arch build you get real, persisted
 * MMKV; anywhere else the app still boots and runs — it just loses
 * cross-launch persistence until the native module is available. The warning
 * makes that degradation visible rather than silent.
 */
export interface KVStore {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  delete(key: string): void;
  getAllKeys(): string[];
}

class MemoryStore implements KVStore {
  private map = new Map<string, string>();
  getString(key: string) {
    return this.map.get(key);
  }
  set(key: string, value: string) {
    this.map.set(key, value);
  }
  delete(key: string) {
    this.map.delete(key);
  }
  getAllKeys() {
    return [...this.map.keys()];
  }
}

function makeStore(id: string): KVStore {
  try {
    return new MMKV({ id });
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.warn(
      `[storage] MMKV unavailable (${e?.message ?? "unknown"}). ` +
        `Falling back to in-memory storage — data won't persist across ` +
        `launches until the New Architecture is enabled in a dev/prod build.`,
    );
    return new MemoryStore();
  }
}

/** General app storage: query cache, UI prefs, freshness stamps. */
export const storage: KVStore = makeStore("wineops");

/** Outbox storage kept separate so clearing cache never drops queued actions. */
export const outboxStorage: KVStore = makeStore("wineops-outbox");
