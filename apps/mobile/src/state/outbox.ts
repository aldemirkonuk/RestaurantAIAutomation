import { create } from "zustand";
import { useSession } from "./session";
import { api, ApiError } from "@/api/client";
import {
  alreadyDeliveredRefusal,
  alreadyDeliveredWords,
} from "@/api/delivered-once";
import { GRACE_MS } from "@/design/motion";
import { holdsHouseMoney, withoutReceiptMoney } from "@/lib/receiptMoney";
import { outboxStorage } from "@/lib/mmkv";
import { queryClient } from "@/lib/queryClient";
import type { FeedItem } from "@/api/types";
import { countsMatchRequest } from "@/components/today/countsMatchRequest";

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
  actorUserId?: string;
  restaurantId?: string;
  path: string;
  method: "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  label: string;
  createdAt: number;
  /** Epoch ms before which this entry must not dispatch. 0 = immediate. */
  holdUntil: number;
  attempts: number;
  /**
   * Server errors (5xx) only, apart from `attempts` (F-798): a receipt that
   * waited out a dead signal must not be parked by the first 5xx after it.
   * Optional so entries saved before this field read as 0.
   */
  serverAttempts?: number;
  status: OutboxStatus;
  lastError?: string;
  /**
   * True when the entry failed because the house had ALREADY done it — a 409
   * carrying the earlier delivery, not a rejection. `lastError` then holds what
   * already happened, so a screen must not head it "didn't go through".
   */
  alreadyDone?: boolean;
  /**
   * True once a receipt refused for carrying money was re-sent with the count
   * alone (F-806). It is re-sent once; a second refusal parks it.
   */
  moneyStripped?: boolean;
  /**
   * The house's sentence when a manager's price was refused (F-949) and the
   * count went through alone. The entry then stays on Today, done and
   * dismiss-only, so the manager reads why the price was not taken.
   */
  priceRefused?: string;
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
  }) => string | null;
  undo: (id: string) => boolean;
  dismissFailed: (id: string) => void;
  /** Null when sent again; the sentence to show when it is not (F-1028). */
  retryFailed: (id: string) => string | null;
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
        status:
          !e.actorUserId || !e.restaurantId
            ? ("failed" as const)
            : e.status === "inflight"
              ? ("pending" as const)
              : e.status,
        ...(!e.actorUserId || !e.restaurantId
          ? {
              lastError:
                "Saved by an older app without an account and branch. Review the original action before submitting it again.",
            }
          : {}),
      }));
      set({ entries });
      scheduleDispatch(0);
    } catch {
      outboxStorage.delete(STORE_KEY);
    }
  },

  enqueue: (input) => {
    const session = useSession.getState();
    // Null, never a throw: every caller is a press handler, and a throw there
    // dropped the press with no word to the person (F-404). Callers say
    // NOT_SAVED_WORDS instead.
    if (
      session.status !== "signedIn" ||
      !session.user?.id ||
      !session.user.restaurantId
    ) {
      return null;
    }
    const graceMs = input.graceMs ?? 0;
    const entry: OutboxEntry = {
      id: makeId(),
      actorUserId: session.user.id,
      restaurantId: session.user.restaurantId,
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
    // THE SECOND-RECEIPT GUARD HOLDS ON TRY AGAIN TOO (F-1028). While this
    // entry was parked a newer count for the same order may have been taken
    // (the order screen, or a card from before F-1028b); sending the old one
    // as well would book the same bottles twice, or write the older count
    // over the newer one.
    const parked = get().entries.find((e) => e.id === id);
    if (
      parked?.path.endsWith("/verify-receipt") &&
      get().entries.some(
        (e) =>
          e.id !== id &&
          e.status !== "failed" &&
          e.path === parked.path &&
          e.actorUserId === parked.actorUserId &&
          e.restaurantId === parked.restaurantId,
      )
    ) {
      return RECEIPT_WAITING_WORDS;
    }
    // A parked receipt goes again without its money (F-1180) when the person
    // pressing Try again does not hold the house's money, or when it was
    // already sent once without it: an entry parked before the phone took the
    // billed quantity out with the price would otherwise meet the same
    // refusal on every Try again.
    const stripMoney = (e: OutboxEntry) =>
      (e.moneyStripped && !e.priceRefused) ||
      !holdsHouseMoney(useSession.getState().user?.role);
    const entries = get().entries.map((e) =>
      e.id === id && e.actorUserId && e.restaurantId
        ? {
            ...e,
            status: "pending" as const,
            attempts: 0,
            serverAttempts: 0,
            ...(stripMoney(e)
              ? { body: withoutReceiptMoney(e.path, e.body) ?? e.body }
              : {}),
          }
        : e,
    );
    set({ entries });
    persist(entries);
    scheduleDispatch(0);
    return null;
  },

  flush: () => scheduleDispatch(0),
}));

/** What a press handler tells the person when `enqueue` saved nothing. */
export const NOT_SAVED_WORDS =
  "Not saved. Unlock the app and choose your house, then try again.";

/**
 * The person's work still on this phone (F-407): in the house they are in, and
 * in their other houses, where it waits until that house is opened again.
 * Another account's saved work on a shared phone is never counted here.
 */
export function waitingWork(
  entries: OutboxEntry[],
  user: { id?: string; restaurantId?: string } | null,
): { here: number; otherHouses: number } {
  let here = 0;
  let otherHouses = 0;
  for (const e of entries) {
    if (e.status === "failed" || !user?.id || e.actorUserId !== user.id) continue;
    if (e.restaurantId === user.restaurantId) here += 1;
    else otherHouses += 1;
  }
  return { here, otherHouses };
}

/**
 * Feed items whose action is still waiting on this phone (F-951). The card
 * stays hidden while its entry waits, also after the app restarts: the feed is
 * saved to disk and so is the outbox, but the in-memory "hidden" set is not.
 *
 * A refused receipt keeps its card hidden too while Today shows the refusal in
 * this house (F-1028): the row's Try again is the one place to act on that
 * count. A card back beside it took a second count for the same delivery.
 * Dismissing the row gives the card back.
 */
export function waitingFeedItems(
  entries: OutboxEntry[],
  user: { id?: string; restaurantId?: string } | null,
): Set<string> {
  const ids = new Set<string>();
  for (const e of entries) {
    if (!e.feedItemId || !user?.id || e.actorUserId !== user.id) continue;
    if (e.status !== "failed") ids.add(e.feedItemId);
    else if (
      e.path?.endsWith("/verify-receipt") &&
      e.restaurantId === user.restaurantId
    ) {
      ids.add(e.feedItemId);
    }
  }
  return ids;
}

/**
 * This person's entry for one action in this house that has not gone through
 * and was not refused, or null (F-956, F-951). A screen reads it to show the
 * queued mark and to refuse the same action a second time while it waits: a
 * second receipt for one order would book its bottles twice.
 */
export function waitingFor(
  entries: OutboxEntry[],
  user: { id?: string; restaurantId?: string } | null,
  path: string,
): OutboxEntry | null {
  if (!user?.id || !user.restaurantId) return null;
  return (
    entries.find(
      (e) =>
        e.status !== "failed" &&
        // The delivery mark carries its count in the query (F-1182).
        e.path.split("?")[0] === path &&
        e.actorUserId === user.id &&
        e.restaurantId === user.restaurantId,
    ) ?? null
  );
}

/**
 * True while this person's count for a Today card's order still waits on this
 * phone (F-980), from the receive screen or an earlier tap: "Counts match"
 * would queue a second receipt and book the same bottles twice, so the card
 * says the count waits and takes no second one.
 */
export function receiptWaitingFor(
  item: Pick<FeedItem, "orderId">,
  entries: OutboxEntry[],
  user: { id?: string; restaurantId?: string } | null,
): boolean {
  const request = countsMatchRequest(item);
  return request != null && waitingFor(entries, user, request.path) != null;
}

/** Under an order whose delivery mark waits on this phone (F-956). */
export const DELIVERED_WAITING_WORDS =
  "Marked delivered on this phone. It sends when the phone has signal again.";

/** On the receive screen when this order's count already waits (F-951). */
export const RECEIPT_WAITING_WORDS =
  "A count for this delivery is already saved on this phone and waits to send. A second count is not taken, so the bottles are not booked twice.";

/**
 * What signing out leaves behind on this phone (F-952): every entry of this
 * person's that has not gone through. Waiting ones stay here and send only
 * when they sign in on this phone again; nobody else who signs in sees them.
 * Refused ones (F-1026) are counted apart: they never send on their own, and
 * the warning must not promise that they will.
 */
export function unsentAtSignOut(
  entries: OutboxEntry[],
  user: { id?: string | null; restaurantId?: string | null } | null | undefined,
): { here: number; otherHouses: number; refused: number } {
  const unsent = { here: 0, otherHouses: 0, refused: 0 };
  if (!user?.id) return unsent;
  for (const e of entries) {
    if (e.actorUserId !== user.id || e.alreadyDone) continue;
    if (e.status === "failed") unsent.refused += 1;
    else if (e.restaurantId === user.restaurantId) unsent.here += 1;
    else unsent.otherHouses += 1;
  }
  return unsent;
}

/** The sign-out warning, or null when nothing of theirs is waiting. */
export function signOutWords(u: {
  here: number;
  otherHouses: number;
  refused: number;
}): string | null {
  const waiting = u.here + u.otherHouses;
  if (waiting <= 0 && u.refused <= 0) return null;
  const parts: string[] = [];
  if (waiting > 0) {
    const one = waiting === 1;
    parts.push(
      `${one ? "1 thing you did has" : `${waiting} things you did have`} not been sent yet. ` +
        `${one ? "It stays" : "They stay"} on this phone and ${one ? "sends" : "send"} only when you sign in here again.`,
    );
    if (u.otherHouses > 0)
      parts.push(
        u.otherHouses === waiting
          ? `${one ? "It is" : "They are"} for another of your houses and ${one ? "sends" : "send"} once you open that house.`
          : `${u.otherHouses} of them ${u.otherHouses === 1 ? "is" : "are"} for another of your houses and ${u.otherHouses === 1 ? "sends" : "send"} once you open that house.`,
      );
  }
  if (u.refused > 0) {
    const one = u.refused === 1;
    parts.push(
      `${one ? "1 thing the house refused waits" : `${u.refused} things the house refused wait`} on this phone for you to look at; ` +
        `${one ? "it does" : "they do"} not send on ${one ? "its" : "their"} own.`,
    );
  }
  parts.push("Nobody else who signs in will see any of it.");
  return parts.join(" ");
}

/** The strip's sentence, or null when nothing is waiting. */
export function waitingWords(w: { here: number; otherHouses: number }): string | null {
  const parts: string[] = [];
  if (w.here > 0) parts.push(`${w.here} waiting to send from this phone.`);
  if (w.otherHouses > 0)
    parts.push(
      `${w.otherHouses} saved for another of your houses; ${w.otherHouses === 1 ? "it sends" : "they send"} when you open that house.`,
    );
  return parts.length ? parts.join(" ") : null;
}

function scheduleDispatch(delayMs: number) {
  if (dispatchTimer) clearTimeout(dispatchTimer);
  dispatchTimer = setTimeout(runDispatch, delayMs);
}

/** Server errors in a row before an entry stops holding up the queue (F-590). */
export const MAX_SERVER_ATTEMPTS = 5;
export const SERVER_GAVE_UP_WORDS =
  `We tried ${MAX_SERVER_ATTEMPTS} times and couldn't save it. Try again later, or dismiss it.`;

let dispatching = false;
async function runDispatch() {
  if (dispatching) return;
  const session = useSession.getState();
  if (
    session.status !== "signedIn" ||
    !session.user?.id ||
    !session.user.restaurantId
  )
    return;
  const belongsHere = (e: OutboxEntry) =>
    e.actorUserId === session.user!.id &&
    e.restaurantId === session.user!.restaurantId;
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

  const next = entries.find((e) => e.status === "pending" && belongsHere(e));
  if (!next) {
    // Nothing sendable; wake up when the earliest hold expires.
    const holding = entries
      .filter((e) => e.status === "holding" && belongsHere(e))
      .sort((a, b) => a.holdUntil - b.holdUntil)[0];
    if (holding) scheduleDispatch(Math.max(50, holding.holdUntil - now + 50));
    return;
  }

  dispatching = true;
  mark(next.id, { status: "inflight" });
  try {
    await api(next.path, {
      method: next.method,
      body: next.body,
      idempotencyKey: next.id,
      scope: { userId: next.actorUserId!, restaurantId: next.restaurantId! },
    });
    if (next.priceRefused) {
      // The count went through without the price (F-949). Keep the house's
      // sentence on Today until the manager dismisses it.
      mark(next.id, {
        status: "failed",
        alreadyDone: true,
        lastError: `The count was saved without the price. ${next.priceRefused}`,
      });
    } else {
      remove(next.id);
    }
    for (const key of next.invalidate ?? []) {
      queryClient.invalidateQueries({ queryKey: key });
    }
    scheduleDispatch(0); // keep draining in order
  } catch (err) {
    // A 401 is "sign in again", not "the server said no" (F-337): the entry
    // waits, and the sign-in below resumes it. The web does the same
    // (lib/queue-owner.ts isPermanentRefusal).
    const isPermanent =
      err instanceof ApiError &&
      err.status >= 400 &&
      err.status < 500 &&
      err.status !== 401 &&
      err.status !== 429;
    // A 5xx the server sent. The client's own 503 for a sign-in refresh that
    // got no answer is "offline", not the house failing, so it never counts
    // toward parking (F-882; api/client.ts marks it).
    const serverError =
      err instanceof ApiError &&
      err.status >= 500 &&
      (err.body as { reason?: unknown } | undefined)?.reason !==
        "refresh_not_reached";
    // "STILL BEING SAVED FROM YOUR LAST TRY" IS NOT A REFUSAL (F-950).
    //
    // The gateway answers 409 with reason `still_running` when this same key
    // is still running there: a force-quit mid-send, or a slow first try that
    // passed the 15 s timeout. The first try may yet land, so the entry waits
    // and asks again; the stored answer comes back then. It never parks and
    // never counts as a server error.
    const stillRunning =
      err instanceof ApiError &&
      err.status === 409 &&
      (err.body as { reason?: unknown } | undefined)?.reason === "still_running";
    // A RECEIPT REFUSED FOR ITS PRICE KEEPS ITS COUNT (F-806).
    //
    // Since F-802 the gateway answers 403 to a staff receipt that carries an
    // invoice price, an override, charges or the billed quantity (F-1180),
    // and nothing is written. An entry
    // queued before the phone stopped offering staff those fields would park
    // here with the bottles counted at the door. Send it once more with the
    // money taken out; the count, the rejection and the note go through, and a
    // manager checks the price.
    //
    // A manager's price is refused too, and nothing is written (F-949): a 409
    // when the order's invoice has no currency filed, a 400 when the code names
    // no currency. Sending the same price again could never clear it. The count
    // goes once more without the price, as the refusal itself offers, and the
    // refusal is kept so the manager reads why the price was not taken.
    //
    // Only a refusal OF THE PRICE (F-1025). Any other 400 or 409 on a priced
    // receipt — a colleague checked the delivery meanwhile, the house or
    // account changed, a unit that does not match — keeps the price and parks
    // with the house's sentence: a count-only resend there would be written
    // over the colleague's check, and Try again could never send the price.
    const priceRefusal =
      err instanceof ApiError &&
      (err.status === 400 || err.status === 409) &&
      !stillRunning &&
      alreadyDeliveredRefusal(err) == null &&
      isPriceRefusal(err);
    const countOnly =
      err instanceof ApiError &&
      (err.status === 403 || priceRefusal) &&
      !next.moneyStripped
        ? withoutReceiptMoney(next.path, next.body, {
            billedIsMoney: !priceRefusal,
          })
        : null;
    if (stillRunning) {
      const attempts = next.attempts + 1;
      mark(next.id, { status: "pending", attempts });
      scheduleDispatch(Math.min(30_000, 2 ** attempts * 1000));
    } else if (countOnly) {
      mark(next.id, {
        status: "pending",
        body: countOnly,
        moneyStripped: true,
        attempts: 0,
        ...(priceRefusal && err instanceof Error
          ? { priceRefused: err.message }
          : {}),
      });
      scheduleDispatch(0);
    } else if (isPermanent) {
      // ALREADY DELIVERED IS NOT "didn't go through".
      //
      // Founder, 2026-09-05 (batch 46): the refusal is a 409 so a screen can
      // show the earlier delivery instead of an error. On this app that matters
      // most, because a delivery is marked at the truck door and the entry may
      // sit in this queue for minutes: by the time it dispatches a colleague may
      // have booked the same truck in. The receiver then read "Marked delivered
      // didn't go through" under an order that HAD gone through. Now the line
      // says who took it in and when. The retry rule is unchanged — a 4xx is
      // permanent — and that is exactly why 409 is the right status: the request
      // was well-formed, so repeating it could never change the answer.
      const refused = alreadyDeliveredRefusal(err);
      // The server said no — surface it, don't retry into the same wall.
      mark(next.id, {
        status: "failed",
        lastError: refused
          ? alreadyDeliveredWords(refused)
          : next.moneyStripped
            ? `This count was sent again without the invoice price and was still refused. ${err instanceof Error ? err.message : ""}`.trim()
            : err instanceof Error
              ? err.message
              : "Rejected",
        alreadyDone: refused != null,
      });
      scheduleDispatch(0);
    } else if (
      serverError &&
      (next.serverAttempts ?? 0) + 1 >= MAX_SERVER_ATTEMPTS
    ) {
      // F-590: the house keeps answering with a server error. Retrying it
      // forever held every later entry behind it with no word to the person;
      // park it as failed (the feed shows it with Try again / dismiss) and let
      // the rest of the queue go. Offline (no answer at all) still waits.
      mark(next.id, {
        status: "failed",
        attempts: next.attempts + 1,
        serverAttempts: (next.serverAttempts ?? 0) + 1,
        lastError: SERVER_GAVE_UP_WORDS,
      });
      scheduleDispatch(0);
    } else {
      const attempts = next.attempts + 1;
      // Only a 5xx counts toward parking (F-798); offline misses still back off.
      const serverAttempts = (next.serverAttempts ?? 0) + (serverError ? 1 : 0);
      mark(next.id, { status: "pending", attempts, serverAttempts });
      // Offline or server down: back off, cap at 30s between rounds.
      scheduleDispatch(Math.min(30_000, 2 ** attempts * 1000));
    }
  } finally {
    dispatching = false;
  }
}

/**
 * The house's sentences that refuse a receipt's price and nothing else
 * (F-1025). The gateway's own checks say so with `receipt_price_refused`; the
 * wire check on the currency code answers a plain 400, read by its sentences,
 * and only when every sentence in it is about the currency.
 */
const CURRENCY_SENTENCE =
  /submitted with no currency|names no currency|^invoiceCurrency must be/;
export function isPriceRefusal(err: ApiError): boolean {
  const body = err.body as { reason?: unknown; message?: unknown } | undefined;
  if (body?.reason === "receipt_price_refused") return true;
  if (err.status !== 400 || body?.reason != null) return false;
  const said = Array.isArray(body?.message) ? body.message : [body?.message];
  return (
    said.length > 0 &&
    said.every((m) => typeof m === "string" && CURRENCY_SENTENCE.test(m))
  );
}

// Unlock/sign-in resumes only the queue belonging to the now-active principal.
useSession.subscribe(() => scheduleDispatch(0));

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
