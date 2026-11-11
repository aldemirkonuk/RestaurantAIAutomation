/**
 * Test support: the shared mailbox reader (gap G2) over a fake Gmail watch
 * and a fake intake that records in memory and publishes to `published`.
 * Shared by the specs that drive the Gmail push and force-fetch routes; no
 * product code imports it.
 */
import { SharedMailboxReaderService } from "../shared-mailbox-reader.service";

export interface FakeWatchOptions {
  /** The stored cursor; null means the door has never read. */
  cursor?: string | null;
  /** Make `history.list` answer 404 (Gmail dropped the cursor). */
  expired?: boolean;
  /** Message ids whose fetch throws (a transient Gmail failure). */
  failing?: string[];
  /** The door's last finished read (the resync floor). */
  lastReadAt?: string | null;
  /** Make the date listing say the window was too large to list. */
  truncated?: boolean;
  /** Called on every fetch, before it answers (to act mid-read). */
  onFetch?: (id: string) => Promise<void> | void;
}

export function fakeWatch(messages: any[], o: FakeWatchOptions = {}) {
  const advanced: Array<[string | null, boolean, string | null]> = [];
  const listedAfter: number[] = [];
  const watch: any = {
    isReady: () => true,
    readCursor: async () => ({
      cursor: o.cursor === undefined ? "1" : o.cursor,
      lastReadAt: o.lastReadAt ?? null,
    }),
    advanceCursor: async (h: string | null, stored: boolean, e: string | null = null) =>
      void advanced.push([h, stored, e]),
    historySince: async () =>
      o.expired
        ? { entries: [], latest: null, expired: true }
        : {
            entries: messages.map((m, i) => ({
              historyId: String(10 + i),
              messageIds: [m.id],
            })),
            latest: String(10 + messages.length),
            expired: false,
          },
    inboxIdsSince: async (after: number) => {
      listedAfter.push(after);
      return { ids: messages.map((m) => m.id), truncated: !!o.truncated };
    },
    currentHistoryId: async () => "99",
    fetchMessage: async (id: string) => {
      await o.onFetch?.(id);
      if (o.failing?.includes(id)) throw new Error(`gmail 500 on ${id}`);
      return messages.find((m) => m.id === id) ?? null;
    },
    getAttachment: async () => null,
  };
  return { watch, advanced, listedAfter };
}

export function fakeIntake(published: any[], refuse = false) {
  const recorded: any[] = [];
  return {
    recorded,
    intake: {
      recordAndPublish: async (a: any) => {
        if (refuse) throw new Error("mail_intake insert refused");
        recorded.push(a);
        published.push(a.event);
        return { id: `in-${recorded.length}`, fresh: true, status: "received", published: true };
      },
    } as any,
  };
}

export function reader(
  watch: any,
  intake: any,
  db: any,
  ownAddress = "house@mudavym.example",
) {
  return new SharedMailboxReaderService(
    watch,
    intake,
    { getSenderEmail: () => ownAddress } as any,
    { get: () => undefined } as any,
    db,
  );
}
