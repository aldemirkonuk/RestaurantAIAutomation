import * as SecureStore from "expo-secure-store";
import { create } from "zustand";
import { clearPersistedQueries } from "@/lib/queryClient";
import { useFeedLocal } from "./feedLocal";
import { API_URL } from "@/config";
import {
  EMAIL_INDEX_KEY,
  LAST_HOUSE_KEY,
  forget,
  hintFor,
  indexEmail,
  parseEmailIndex,
  parseMemory,
  remember,
  type EmailIndex,
  type HouseMemory,
} from "@/auth/houseChoice";

const ACCESS_KEY = "wineops_access_token";
const REFRESH_KEY = "wineops_refresh_token";
/**
 * The last `/auth/me` answer for the saved session (F-404). A cold start with
 * no signal, or one whose re-read fails, falls back to it instead of running
 * the whole shift with no user — no house, so every tab looked empty and every
 * action refused. Written beside the tokens and deleted with them.
 */
const USER_KEY = "wineops_session_user";

export interface SessionUser {
  id: string;
  email: string;
  name?: string;
  /** The session's house, from `/auth/me`; undefined for a session in none. */
  restaurantId?: string;
  /** The role IN THAT HOUSE (ADR 0164), not the account-wide `users.role`. */
  role?: string;
  /**
   * From the `users.email_verified` column via `/auth/me`, never decoded from
   * the JWT — a token minted before verification still says false (OD-79,
   * `auth.service.ts:1588-1594`). `undefined` means "not asked yet"; only
   * `false` means "asked, and no".
   */
  emailVerified?: boolean;
}

interface SessionState {
  generation: number;
  status: "booting" | "signedOut" | "locked" | "signedIn";
  user: SessionUser | null;
  accessToken: string | null;
  /** Restore tokens from SecureStore at launch; lands in "locked" if found. */
  hydrate: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  /**
   * Adopt tokens minted by something other than `POST /auth/login`.
   *
   * `join`, `register/restaurant` and `verify-email` all return the same
   * `{ accessToken, refreshToken }` pair as login does, and before this
   * existed there was no way to accept it — so the phone could only ever
   * *sign in*, never *sign up*. Lands in `signedIn`, not `locked`: the user
   * proved who they are seconds ago by typing a password they just chose, and
   * demanding Face ID on top of that is a gate against nobody.
   *
   * `expectedGeneration` is the generation read BEFORE the request that minted
   * these tokens was sent, and it is required: a sign-out (or another sign-in)
   * since then means the tokens are dropped and this answers false. Screens do
   * not call this directly; they go through `requestThenAdopt`, which reads the
   * generation at the right moment (audit of PR #436, round 2, 2026-09-27).
   */
  adoptTokens: (
    accessToken: string,
    refreshToken: string | undefined,
    expectedGeneration: number,
  ) => Promise<boolean>;
  /** Re-read `/auth/me` — used after verifying an email or accepting an invite. */
  refreshUser: () => Promise<void>;
  /**
   * Move the session into one of the person's houses, or choose one when it
   * names none (ADR 0164). True when the server issued it; false, with nothing
   * changed, when it refused.
   */
  chooseHouse: (houseId: string) => Promise<boolean>;
  /** Biometric gate passed — session becomes usable. */
  unlock: () => void;
  signOut: () => Promise<void>;
  /** Swap in a refreshed access token (called by the API client). */
  setAccessToken: (token: string) => void;
}

/**
 * Token writes and deletes run one at a time, in call order (audit of PR
 * #436, 2026-09-27). `signOut` bumps the generation synchronously and then
 * queues its delete, so a write that started before it is overwritten by the
 * delete, and a write that starts after it sees the new generation and does
 * nothing. Without the queue a sign-in or house switch resolving after sign-out
 * could leave valid tokens in SecureStore for the next launch to find.
 */
let tokenQueue: Promise<unknown> = Promise.resolve();
function onTokenQueue<T>(job: () => Promise<T>): Promise<T> {
  const run = tokenQueue.then(job, job);
  tokenQueue = run.catch(() => undefined);
  return run;
}

/** Persist tokens only while the session is still `generation`; true if written. */
function persistTokens(
  currentGeneration: () => number,
  generation: number,
  accessToken: string,
  refreshToken?: string,
): Promise<boolean> {
  return onTokenQueue(async () => {
    if (currentGeneration() !== generation) return false;
    await Promise.all([
      SecureStore.setItemAsync(ACCESS_KEY, accessToken),
      refreshToken
        ? SecureStore.setItemAsync(REFRESH_KEY, refreshToken)
        : Promise.resolve(),
    ]);
    return true;
  });
}

/** Persist the session's user only while the session is still `generation`. */
function persistUser(
  currentGeneration: () => number,
  generation: number,
  user: SessionUser | null,
): Promise<void> {
  return onTokenQueue(async () => {
    if (!user?.id || currentGeneration() !== generation) return;
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
  }).catch(() => undefined);
}

async function readLastUser(): Promise<SessionUser | null> {
  try {
    const u = JSON.parse((await SecureStore.getItemAsync(USER_KEY)) ?? "null");
    return u && typeof u.id === "string" && typeof u.email === "string"
      ? (u as SessionUser)
      : null;
  } catch {
    return null;
  }
}

/**
 * `/auth/me`, telling a lapsed token ("expired": the server answered 401)
 * apart from no answer at all (null: offline, timeout, a 5xx). Only the first
 * is worth a refresh.
 */
async function readMe(accessToken: string): Promise<SessionUser | "expired" | null> {
  try {
    const res = await fetch(`${API_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 401) return "expired";
    if (!res.ok) return null;
    const body = await res.json();
    const u = body.user ?? body;
    return {
      id: u.id ?? u.userId,
      email: u.email,
      name: u.name ?? u.firstName ?? undefined,
      restaurantId: u.restaurantId ?? u.restaurant_id ?? undefined,
      role: u.role ?? undefined,
      emailVerified: u.emailVerified ?? u.email_verified ?? undefined,
    };
  } catch {
    return null;
  }
}

async function fetchMe(accessToken: string): Promise<SessionUser | null> {
  const me = await readMe(accessToken);
  return me === "expired" ? null : me;
}

/**
 * Requests that must still go out under the session being signed out — today
 * only the push device's unregister (F-406). Each gets a `send` that carries
 * the outgoing session's token and refreshes it once on a 401, so a phone
 * idle past the 15-minute token still reaches the server. `/auth/logout` goes
 * last, with whichever token is newest, so it is the one blacklisted.
 */
export type SignOutSend = (path: string, method: "POST" | "DELETE") => Promise<Response>;
const signOutRequests = new Set<(send: SignOutSend) => Promise<void>>();
export function beforeSignOutRequest(job: (send: SignOutSend) => Promise<void>): () => void {
  signOutRequests.add(job);
  return () => signOutRequests.delete(job);
}

/**
 * Work that follows a fresh session — sign-in, or tokens adopted on a house
 * switch or a link. Today only the push device's re-register (F-801): every
 * sign-out unregisters it, so without this the Settings switch read ON while
 * the phone got nothing. Fire-and-forget; sign-in never waits on it.
 */
const signedInJobs = new Set<() => Promise<void>>();
export function afterSignIn(job: () => Promise<void>): () => void {
  signedInJobs.add(job);
  return () => signedInJobs.delete(job);
}
function announceSignedIn() {
  for (const job of signedInJobs) void job().catch(() => {});
}

function sayGoodbye(access: string | null, refresh: string | null): Promise<void> {
  let token = access;
  let canRefresh = !!refresh;
  const send: SignOutSend = async (path, method) => {
    const call = (t: string | null) =>
      fetch(`${API_URL}${path}`, {
        method,
        headers: t ? { Authorization: `Bearer ${t}` } : {},
      });
    let res = await call(token);
    if (res.status === 401 && canRefresh) {
      canRefresh = false;
      const r = await fetch(`${API_URL}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: refresh }),
      });
      const fresh: string | undefined = r.ok ? (await r.json())?.accessToken : undefined;
      if (fresh) {
        token = fresh;
        res = await call(token);
      }
    }
    return res;
  };
  return Promise.allSettled([...signOutRequests].map((job) => job(send)))
    .then(() => (token ? send("/auth/logout", "POST") : undefined))
    .then(
      () => undefined,
      () => undefined,
    );
}

async function readMemory(): Promise<HouseMemory> {
  try {
    return parseMemory(await SecureStore.getItemAsync(LAST_HOUSE_KEY));
  } catch {
    return {};
  }
}

async function writeMemory(mem: HouseMemory): Promise<void> {
  try {
    await SecureStore.setItemAsync(LAST_HOUSE_KEY, JSON.stringify(mem));
  } catch {
    /* remember nothing; the person chooses next time */
  }
}

async function readEmailIndex(): Promise<EmailIndex> {
  try {
    return parseEmailIndex(await SecureStore.getItemAsync(EMAIL_INDEX_KEY));
  } catch {
    return {};
  }
}

async function writeEmailIndex(index: EmailIndex): Promise<void> {
  try {
    await SecureStore.setItemAsync(EMAIL_INDEX_KEY, JSON.stringify(index));
  } catch {
    /* the next sign-in for this email just sends no hint */
  }
}

/**
 * Record that this person's session on this phone is in their current house,
 * and that this phone has seen their email sign in as them — so their NEXT
 * sign-in attempt can be given back only their own hint (parity fix, round 3,
 * 2026-09-19; mirrors the web's `storeSession` indexing the email alongside
 * the house, item 8).
 */
async function rememberSessionHouse(user: SessionUser | null): Promise<void> {
  if (!user?.id || !user.restaurantId) return;
  await writeMemory(remember(await readMemory(), user.id, user.restaurantId, Date.now()));
  if (user.email) {
    await writeEmailIndex(indexEmail(await readEmailIndex(), user.email, user.id));
  }
}

export const useSession = create<SessionState>((set, get) => ({
  generation: 0,
  status: "booting",
  user: null,
  accessToken: null,

  hydrate: async () => {
    const generation = get().generation;
    try {
      const [access, refresh] = await Promise.all([
        SecureStore.getItemAsync(ACCESS_KEY),
        SecureStore.getItemAsync(REFRESH_KEY),
      ]);
      if (get().generation !== generation) return;
      if (!access && !refresh) {
        set({ status: "signedOut" });
        return;
      }
      // Tokens exist — require the biometric gate before showing data.
      set({ accessToken: access ?? null, status: "locked" });
      // Profile can load behind the gate; stale is fine offline. The access
      // token lives 15 minutes, so a cold start on the next shift finds it
      // lapsed: refresh it and read again (F-404). With no answer at all the
      // last known user stands in, so the house's tabs and queued work still
      // run; the API client refreshes once the signal is back. A refresh that
      // gets no answer (no signal, a timeout, a 503, a 429) is that same "no
      // answer", never a sign-out (F-336, F-881).
      let me = access ? await readMe(access) : "expired";
      if (me === "expired" && refresh) {
        const fresh = await refreshAccessToken().catch((err) => {
          if (err instanceof RefreshNotReached) return null;
          throw err;
        });
        me = fresh ? await readMe(fresh) : null;
      }
      if (get().generation !== generation) return;
      if (me && me !== "expired") {
        set({ user: me });
        await persistUser(() => get().generation, generation, me);
        // Opening the app is a real use of this house on this phone, same
        // as signing in (item 6, 2026-09-19) — otherwise a phone someone
        // opens daily without ever re-authenticating never touches its
        // "last used" time, and looks like it has not been used in a week.
        await rememberSessionHouse(me);
      } else if (!get().user) {
        const last = await readLastUser();
        if (last && get().generation === generation && !get().user) set({ user: last });
      }
    } catch {
      if (get().generation === generation) set({ status: "signedOut" });
    }
  },

  signIn: async (email, password) => {
    const generation = get().generation + 1;
    set({ generation });
    // `lastHouses`: this phone's memory of the house THIS email used on it.
    // The server lands a person with several houses in the one this phone
    // used within seven days, or answers with a session in no house, and the
    // Today tab then sends them to the chooser (ADR 0164). Only the entry for
    // the email being submitted is ever sent, never any other account this
    // phone remembers (parity fix, round 3, 2026-09-19; item 8 on the web).
    const [mem, index] = await Promise.all([readMemory(), readEmailIndex()]);
    const hint = hintFor(mem, index, email);
    const res = await fetch(`${API_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        lastHouses: hint ? [hint] : [],
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(
        body?.message ?? "Sign-in failed. Check your email and password.",
      );
    }
    const { accessToken, refreshToken } = await res.json();
    const current = () => get().generation;
    if (!(await persistTokens(current, generation, accessToken, refreshToken))) return;
    const user = await fetchMe(accessToken);
    if (get().generation !== generation) return;
    clearPersistedQueries();
    useFeedLocal.setState({ hidden: {}, clearedThisSession: 0 });
    await rememberSessionHouse(user);
    await persistUser(current, generation, user);
    set({ accessToken, user, status: "signedIn" });
    announceSignedIn();
  },

  adoptTokens: async (accessToken, refreshToken, expectedGeneration) => {
    // Every caller fetched these tokens under the generation it passes; a
    // sign-out or sign-in since then means the tokens are dropped.
    if (get().generation !== expectedGeneration) return false;
    const generation = get().generation + 1;
    set({ generation });
    const current = () => get().generation;
    if (!(await persistTokens(current, generation, accessToken, refreshToken))) {
      return false;
    }
    const user = await fetchMe(accessToken);
    if (get().generation !== generation) return false;
    clearPersistedQueries();
    useFeedLocal.setState({ hidden: {}, clearedThisSession: 0 });
    await rememberSessionHouse(user);
    await persistUser(current, generation, user);
    set({ accessToken, user, status: "signedIn" });
    announceSignedIn();
    return true;
  },

  refreshUser: async () => {
    const token = get().accessToken;
    if (!token) return;
    const generation = get().generation;
    const user = await fetchMe(token);
    if (user && get().accessToken === token) {
      set({ user });
      await persistUser(() => get().generation, generation, user);
    }
  },

  chooseHouse: async (houseId) => {
    const token = get().accessToken;
    if (!token) return false;
    // Captured BEFORE the fetch: `adoptTokens` bumps the generation only after
    // the response, so without this a sign-out during the switch would be
    // bumped past and the switched session would come back.
    const generation = get().generation;
    try {
      const res = await fetch(`${API_URL}/auth/switch-restaurant`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ restaurantId: houseId }),
      });
      if (!res.ok) return false;
      const body = await res.json();
      if (!body?.accessToken || body.restaurantId !== houseId) return false;
      return await get().adoptTokens(
        body.accessToken,
        body.refreshToken,
        generation,
      );
    } catch {
      return false;
    }
  },

  unlock: () => {
    if (get().status === "locked") set({ status: "signedIn" });
  },

  signOut: async () => {
    const token = get().accessToken;
    set({
      generation: get().generation + 1,
      status: "signedOut",
      user: null,
      accessToken: null,
    });
    clearPersistedQueries();
    useFeedLocal.setState({ hidden: {}, clearedThisSession: 0 });
    await onTokenQueue(async () => {
      // Read before the delete: the goodbye requests may need one refresh.
      let refresh: string | null = null;
      try {
        refresh = (await SecureStore.getItemAsync(REFRESH_KEY)) ?? null;
      } catch {
        /* the goodbye goes out with the access token alone */
      }
      await Promise.all([
        SecureStore.deleteItemAsync(ACCESS_KEY),
        SecureStore.deleteItemAsync(REFRESH_KEY),
        SecureStore.deleteItemAsync(USER_KEY),
      ]);
      // Best-effort server goodbye (push device, then logout); local teardown
      // always wins and never waits for it.
      void sayGoodbye(token, refresh);
    });
  },

  setAccessToken: (token) => {
    const generation = get().generation;
    set({ accessToken: token });
    persistTokens(() => get().generation, generation, token).catch(() => {});
  },
}));

export type AdoptOutcome = "adopted" | "superseded" | "noTokens";

/**
 * Send a request that answers with a token pair (`verify-email`, `join`,
 * `register/restaurant`) and adopt the pair, unless the session moved on while
 * the request was in flight. The generation is read BEFORE `request` starts,
 * so a sign-out pressed during it makes the answer `superseded`: nothing is
 * written to SecureStore and the session stays signed out (audit of PR #436,
 * round 2, 2026-09-27). `noTokens` means the server answered without a pair.
 */
export async function requestThenAdopt<
  T extends { accessToken?: string; refreshToken?: string },
>(request: () => Promise<T>): Promise<{ result: T; outcome: AdoptOutcome }> {
  const generation = useSession.getState().generation;
  const result = await request();
  if (!result.accessToken) return { result, outcome: "noTokens" };
  const adopted = await useSession
    .getState()
    .adoptTokens(result.accessToken, result.refreshToken, generation);
  return { result, outcome: adopted ? "adopted" : "superseded" };
}

/**
 * The refresh could not be answered (no signal, a timeout, a 503 or a 429).
 * The sign-in is not refused, so the phone must keep it (F-336): only a 401
 * from /auth/refresh means "sign in again". The web made the same split
 * (lib/sessionRefresh.ts, ADR 0164).
 */
export class RefreshNotReached extends Error {
  constructor(public readonly status: number | null) {
    super("The sign-in could not be renewed right now.");
  }
}

/** How long a refresh may take before it counts as not reached. */
const REFRESH_TIMEOUT_MS = 15_000;

/**
 * Refresh flow used by the API client on 401. Returns the new token, or null
 * when the refresh token was refused (or the account changed meanwhile).
 * Throws RefreshNotReached when the gateway could not be reached or answered
 * anything but a refusal: the caller keeps the session and tries later.
 */
export async function refreshAccessToken(): Promise<string | null> {
  const generation = useSession.getState().generation;
  const refreshToken = await SecureStore.getItemAsync(REFRESH_KEY).catch(
    () => null,
  );
  if (!refreshToken) return null;
  let res: Response;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS);
  try {
    res = await fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
      signal: controller.signal,
    });
  } catch {
    throw new RefreshNotReached(null);
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401) return null;
  if (!res.ok) throw new RefreshNotReached(res.status);
  // A body cut off by the signal is not a refusal either.
  const body = await res.json().catch(() => {
    throw new RefreshNotReached(res.status);
  });
  try {
    const access: string | undefined = body.accessToken;
    const nextRefresh: string | undefined = body.refreshToken;
    if (!access || useSession.getState().generation !== generation) return null;
    const current = () => useSession.getState().generation;
    if (!(await persistTokens(current, generation, access, nextRefresh))) return null;
    if (current() !== generation) return null;
    useSession.setState({ accessToken: access });
    // The person is no longer a member of the house this session was in (ADR
    // 0164): the new session names none. Forget it on this phone and re-read
    // who they are, so the Today tab sends them to the chooser. That house's
    // orders, calendar and feed leave this phone too, as at sign-out (F-1349):
    // their query keys name no house, so they would stay on screen.
    const ended: string | undefined = body.houseAccessEnded?.restaurantId;
    if (ended) {
      clearPersistedQueries();
      useFeedLocal.setState({ hidden: {}, clearedThisSession: 0 });
      const me = useSession.getState().user;
      if (me?.id) await writeMemory(forget(await readMemory(), me.id, ended));
      await useSession.getState().refreshUser();
    } else {
      // An ordinary refresh, still in the same house: touch this phone's
      // "last used" for it, exactly as sign-in and hydrate do (item 6,
      // 2026-09-19). Refresh tokens outlive a week of ordinary use, so
      // without this a phone in daily use could still look untouched long
      // enough for the seven-day window (ADR 0164, F2) to lapse under it.
      await rememberSessionHouse(useSession.getState().user);
    }
    return access;
  } catch {
    return null;
  }
}
