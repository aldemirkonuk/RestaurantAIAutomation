import { MMKV } from "react-native-mmkv";

/** General app storage: query cache, UI prefs, freshness stamps. */
export const storage = new MMKV({ id: "wineops" });

/** Outbox storage kept separate so clearing cache never drops queued actions. */
export const outboxStorage = new MMKV({ id: "wineops-outbox" });
