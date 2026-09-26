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
   */
  adoptTokens: (accessToken: string, refreshToken?: string) => Promise<void>;
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

async function fetchMe(accessToken: string): Promise<SessionUser | null> {
  try {
    const res = await fetch(`${API_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
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
    try {
      const [access, refresh] = await Promise.all([
        SecureStore.getItemAsync(ACCESS_KEY),
        SecureStore.getItemAsync(REFRESH_KEY),
      ]);
      if (!access && !refresh) {
        set({ status: "signedOut" });
        return;
      }
      // Tokens exist — require the biometric gate before showing data.
      set({ accessToken: access ?? null, status: "locked" });
      // Profile can load behind the gate; stale is fine offline.
      if (access) {
        const user = await fetchMe(access);
        if (user) {
          set({ user });
          // Opening the app is a real use of this house on this phone, same
          // as signing in (item 6, 2026-09-19) — otherwise a phone someone
          // opens daily without ever re-authenticating never touches its
          // "last used" time, and looks like it has not been used in a week.
          await rememberSessionHouse(user);
        }
      }
    } catch {
      set({ status: "signedOut" });
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
    await Promise.all([
      SecureStore.setItemAsync(ACCESS_KEY, accessToken),
      SecureStore.setItemAsync(REFRESH_KEY, refreshToken),
    ]);
    const user = await fetchMe(accessToken);
    if (get().generation !== generation) return;
    clearPersistedQueries();
    useFeedLocal.setState({ hidden: {}, clearedThisSession: 0 });
    await rememberSessionHouse(user);
    set({ accessToken, user, status: "signedIn" });
  },

  adoptTokens: async (accessToken, refreshToken) => {
    const generation = get().generation + 1;
    set({ generation });
    await Promise.all([
      SecureStore.setItemAsync(ACCESS_KEY, accessToken),
      refreshToken
        ? SecureStore.setItemAsync(REFRESH_KEY, refreshToken)
        : Promise.resolve(),
    ]);
    const user = await fetchMe(accessToken);
    if (get().generation !== generation) return;
    clearPersistedQueries();
    useFeedLocal.setState({ hidden: {}, clearedThisSession: 0 });
    await rememberSessionHouse(user);
    set({ accessToken, user, status: "signedIn" });
  },

  refreshUser: async () => {
    const token = get().accessToken;
    if (!token) return;
    const user = await fetchMe(token);
    if (user && get().accessToken === token) set({ user });
  },

  chooseHouse: async (houseId) => {
    const token = get().accessToken;
    if (!token) return false;
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
      await get().adoptTokens(body.accessToken, body.refreshToken);
      return true;
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
    // Best-effort server logout; local teardown always wins.
    if (token) {
      fetch(`${API_URL}/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    await Promise.all([
      SecureStore.deleteItemAsync(ACCESS_KEY),
      SecureStore.deleteItemAsync(REFRESH_KEY),
    ]);
  },

  setAccessToken: (token) => {
    set({ accessToken: token });
    SecureStore.setItemAsync(ACCESS_KEY, token).catch(() => {});
  },
}));

/** Refresh flow used by the API client on 401. Returns the new token or null. */
export async function refreshAccessToken(): Promise<string | null> {
  const generation = useSession.getState().generation;
  try {
    const refreshToken = await SecureStore.getItemAsync(REFRESH_KEY);
    if (!refreshToken) return null;
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return null;
    const body = await res.json();
    const access: string | undefined = body.accessToken;
    const nextRefresh: string | undefined = body.refreshToken;
    if (!access || useSession.getState().generation !== generation) return null;
    useSession.getState().setAccessToken(access);
    if (nextRefresh) {
      await SecureStore.setItemAsync(REFRESH_KEY, nextRefresh);
    }
    // The person is no longer a member of the house this session was in (ADR
    // 0164): the new session names none. Forget it on this phone and re-read
    // who they are, so the Today tab sends them to the chooser.
    const ended: string | undefined = body.houseAccessEnded?.restaurantId;
    if (ended) {
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
