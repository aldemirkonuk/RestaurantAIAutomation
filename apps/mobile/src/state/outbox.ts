import { create } from "zustand";
import { api, ApiError } from "@/api/client";
import { GRACE_MS } from "@/design/motion";
import { outboxStorage } from "@/lib/mmkv";
import { queryClient } from "@/lib/queryClient";

/**
 * Durable outbox — the engine under every mutation in the app.
 *
 * Actions hit disk before the network, so a killed app or dead wifi never
 * loses work. Vendor-visible actions hold for a grace window (Ledger Fold's
 * countdown) during which Undo simply deletes the entry — the network call
 * has not happened yet, making undo perfectly safe. Each entry's id doubles
 * as its Idempotency-Key so replays after flaky sends cannot double-fire.
 */

export type OutboxStatus = "holding" | "pending" | "inflight" | "failed";

export interface OutboxEntry {
  id: string;
  path: string;
  method: "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  label: string;
  createdAt: number;
  /** Epoch ms before which this entry must not dispatch. 0 = immediate. */
  holdUntil: number;
  attempts: number;
  status: OutboxStatus;
  lastError?: string;
  /** Query keys to invalidate after success. */
  invalidate?: unknown[][];
  /** Feed item to restore if the entry is undone or permanently fails. */
  feedItemId?: string;
}

interface OutboxState {
  entries: OutboxEntry[];
  enqueue: (input: {
    path: string;
    method?: OutboxEntry["method"];
    body?: unknown;
    label: string;
    /** Vendor-visible actions pass GRACE_MS; instant ones pass 0. */
    graceMs?: number;
    invalidate?: unknown[][];
    feedItemId?: string;
  }) => string;
  undo: (id: string) => boolean;
  dismissFailed: (id: string) => void;
  retryFailed: (id: string) => void;
  flush: () => void;
  hydrate: () => void;
}

const STORE_KEY = "outbox:v1";

function persist(entries: OutboxEntry[]) {
  outboxStorage.set(STORE_KEY, JSON.stringify(entries));
}

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

let dispatchTimer: ReturnType<typeof setTimeout> | null = null;

export const useOutbox = create<OutboxState>((set, get) => ({
  entries: [],

  hydrate: () => {
    try {
      const raw = outboxStorage.getString(STORE_KEY);
      if (!raw) return;
      const entries = (JSON.parse(raw) as OutboxEntry[]).map((e) => ({
        ...e,
        // Anything mid-flight when the app died goes back to pending;
        // idempotency keys make the re-send safe.
        status: e.status === "inflight" ? ("pending" as const) : e.status,
      }));
      set({ entries });
      scheduleDispatch(0);
    } catch {
      outboxStorage.delete(STORE_KEY);
    }
  },

  enqueue: (input) => {
    const graceMs = input.graceMs ?? 0;
    const entry: OutboxEntry = {
      id: makeId(),
      path: input.path,
      method: input.method ?? "POST",
      body: input.body,
      label: input.label,
      createdAt: Date.now(),
      holdUntil: graceMs > 0 ? Date.now() + graceMs : 0,
      attempts: 0,
      status: graceMs > 0 ? "holding" : "pending",
      invalidate: input.invalidate,
      feedItemId: input.feedItemId,
    };
    const entries = [...get().entries, entry];
    set({ entries });
    persist(entries);
    scheduleDispatch(graceMs > 0 ? graceMs + 50 : 0);
    return entry.id;
  },

  undo: (id) => {
    const entry = get().entries.find((e) => e.id === id);
    if (!entry || entry.status !== "holding") return false;
    const entries = get().entries.filter((e) => e.id !== id);
    set({ entries });
    persist(entries);
    return true;
  },

  dismissFailed: (id) => {
    const entries = get().entries.filter((e) => e.id !== id);
    set({ entries });
    persist(entries);
  },

  retryFailed: (id) => {
    const entries = get().entries.map((e) =>
      e.id === id ? { ...e, status: "pending" as const, attempts: 0 } : e,
    );
    set({ entries });
    persist(entries);
    scheduleDispatch(0);
  },

  flush: () => scheduleDispatch(0),
}));

function scheduleDispatch(delayMs: number) {
  if (dispatchTimer) clearTimeout(dispatchTimer);
  dispatchTimer = setTimeout(runDispatch, delayMs);
}

async function runDispatch() {
  const state = useOutbox.getState();
  const now = Date.now();

  // Promote entries whose grace window has expired.
  const entries = state.entries.map((e) =>
    e.status === "holding" && e.holdUntil <= now
      ? { ...e, status: "pending" as const }
      : e,
  );
  useOutbox.setState({ entries });
  persist(entries);

  const next = entries.find((e) => e.status === "pending");
  if (!next) {
    // Nothing sendable; wake up when the earliest hold expires.
    const holding = entries
      .filter((e) => e.status === "holding")
      .sort((a, b) => a.holdUntil - b.holdUntil)[0];
    if (holding) scheduleDispatch(Math.max(50, holding.holdUntil - now + 50));
    return;
  }

  mark(next.id, { status: "inflight" });
  try {
    await api(next.path, {
      method: next.method,
      body: next.body,
      idempotencyKey: next.id,
    });
    remove(next.id);
    for (const key of next.invalidate ?? []) {
      queryClient.invalidateQueries({ queryKey: key });
    }
    scheduleDispatch(0); // keep draining in order
  } catch (err) {
    const isPermanent =
      err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 429;
    if (isPermanent) {
      // The server said no — surface it, don't retry into the same wall.
      mark(next.id, {
        status: "failed",
        lastError: err instanceof Error ? err.message : "Rejected",
      });
      scheduleDispatch(0);
    } else {
      const attempts = next.attempts + 1;
      mark(next.id, { status: "pending", attempts });
      // Offline or server down: back off, cap at 30s between rounds.
      scheduleDispatch(Math.min(30_000, 2 ** attempts * 1000));
    }
  }
}

function mark(id: string, patch: Partial<OutboxEntry>) {
  const entries = useOutbox
    .getState()
    .entries.map((e) => (e.id === id ? { ...e, ...patch } : e));
  useOutbox.setState({ entries });
  persist(entries);
}

function remove(id: string) {
  const entries = useOutbox.getState().entries.filter((e) => e.id !== id);
  useOutbox.setState({ entries });
  persist(entries);
}

export { GRACE_MS };
