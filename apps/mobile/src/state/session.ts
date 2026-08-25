import * as SecureStore from "expo-secure-store";
import { create } from "zustand";
import { API_URL } from "@/config";

const ACCESS_KEY = "wineops_access_token";
const REFRESH_KEY = "wineops_refresh_token";

export interface SessionUser {
  id: string;
  email: string;
  name?: string;
  restaurantId?: string;
  role?: string;
}

interface SessionState {
  status: "booting" | "signedOut" | "locked" | "signedIn";
  user: SessionUser | null;
  accessToken: string | null;
  /** Restore tokens from SecureStore at launch; lands in "locked" if found. */
  hydrate: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
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
    };
  } catch {
    return null;
  }
}

export const useSession = create<SessionState>((set, get) => ({
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
        if (user) set({ user });
      }
    } catch {
      set({ status: "signedOut" });
    }
  },

  signIn: async (email, password) => {
    const res = await fetch(`${API_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.message ?? "Sign-in failed. Check your email and password.");
    }
    const { accessToken, refreshToken } = await res.json();
    await Promise.all([
      SecureStore.setItemAsync(ACCESS_KEY, accessToken),
      SecureStore.setItemAsync(REFRESH_KEY, refreshToken),
    ]);
    const user = await fetchMe(accessToken);
    set({ accessToken, user, status: "signedIn" });
  },

  unlock: () => {
    if (get().status === "locked") set({ status: "signedIn" });
  },

  signOut: async () => {
    const token = get().accessToken;
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
    set({ status: "signedOut", user: null, accessToken: null });
  },

  setAccessToken: (token) => {
    set({ accessToken: token });
    SecureStore.setItemAsync(ACCESS_KEY, token).catch(() => {});
  },
}));

/** Refresh flow used by the API client on 401. Returns the new token or null. */
export async function refreshAccessToken(): Promise<string | null> {
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
    if (!access) return null;
    useSession.getState().setAccessToken(access);
    if (nextRefresh) {
      await SecureStore.setItemAsync(REFRESH_KEY, nextRefresh);
    }
    return access;
  } catch {
    return null;
  }
}
