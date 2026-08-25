import { create } from "zustand";

/**
 * Optimistic view-state for the decision feed. Items hide the moment their
 * action enters the outbox; undo unhides; a permanent server rejection
 * unhides with a warning. Also tracks how many decisions this session
 * cleared, which Feed Zero reports.
 */
interface FeedLocalState {
  /** feedItemId -> outbox entry id */
  hidden: Record<string, string>;
  clearedThisSession: number;
  hide: (feedItemId: string, entryId: string) => void;
  unhide: (feedItemId: string) => void;
  markCleared: () => void;
}

export const useFeedLocal = create<FeedLocalState>((set) => ({
  hidden: {},
  clearedThisSession: 0,

  hide: (feedItemId, entryId) =>
    set((s) => ({ hidden: { ...s.hidden, [feedItemId]: entryId } })),

  unhide: (feedItemId) =>
    set((s) => {
      const next = { ...s.hidden };
      delete next[feedItemId];
      return { hidden: next };
    }),

  markCleared: () =>
    set((s) => ({ clearedThisSession: s.clearedThisSession + 1 })),
}));
