import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";
import { errorTracking } from "../lib/error-tracking";
import { useAuthStore } from "../stores";
import {
  fallbackSignInMethods,
  type SignInMethodsResult,
} from "../lib/identityProviders";
import {
  clearHouseEnded,
  goToChooser,
  lastHouseHintFor,
  storeSession,
  tokenClaims,
  tokenHouse,
} from "../lib/houseMemory";
import { doRefresh } from "../lib/sessionRefresh";

/**
 * Thrown by `login()` for backend auth failures. `code`/`provider` carry the
 * structured fields the API sends for OAuth-only accounts (see
 * auth.service.ts#validateUser) — e.g. `{ code: 'OAUTH_ONLY', provider:
 * 'microsoft' }` — so callers can branch on the real provider instead of
 * pattern-matching the human-readable message text.
 */
export class LoginError extends Error {
  constructor(
    message: string,
    public code?: string,
    public provider?: "google" | "microsoft",
    /** The gateway's HTTP status, when there was a response (401, 429 …). */
    public status?: number,
  ) {
    super(message);
    this.name = "LoginError";
  }
}

const API_URL = import.meta.env.VITE_API_GATEWAY_URL || "http://localhost:4000";
const api = axios.create({
  baseURL: API_URL,
  timeout: 20000,
});

/** Always stamp the latest token — defaults alone race with login / refresh. */
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = localStorage.getItem("accessToken");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  const restaurantId = localStorage.getItem("activeRestaurantId");
  if (restaurantId) {
    config.headers["X-Restaurant-Id"] = restaurantId;
  }
  return config;
});

export interface User {
  userId: string;
  email: string;
  name: string;
  /**
   * The role IN THE SESSION'S HOUSE, from `/auth/me` (ADR 0164): the person's
   * access row there. Null for a session in no house. It is no longer the
   * account-wide `users.role`.
   */
  role: "owner" | "manager" | "staff" | null;
  /** The session's house, from its token; "" for a session in no house. */
  restaurantId: string;
  emailVerified?: boolean;
  studioRoles?: ("developer" | "certified_contributor" | "review_admin")[];
}

export interface RestaurantBranch {
  id: string;
  name: string;
  city: string | null;
  chain_id: string | null; // null = standalone restaurant (D-10)
  chain_name: string | null; // null = standalone; set = chain label for Header grouping
}

interface RegisterRestaurantData {
  name: string;
  email: string;
  password: string;
  restaurantName: string;
  address: string;
  city: string;
  country: string;
  stateProvince?: string;
  postalCode?: string;
  neighborhood?: string;
  phone?: string;
  cuisineType?: string;
  timezone?: string;
  /**
   * The money this house reports in, ISO 4217 alpha-3, from the sign-up form's
   * currency step.
   *
   * Omitted — not defaulted to `USD` — when the manager answered "not yet" or
   * when no default could be worked out from the address's country. The gateway
   * then writes NULL and every screen says "currency not recorded". Until
   * 2026-09-05 the column carried `DEFAULT 'USD'` and this payload never
   * mentioned it, which is how all fourteen production houses came to assert
   * dollars including two in Turkiye and one in London (ADR 0117 Q25).
   */
  currency?: string;
  /**
   * The coordinate of the Google Places selection, when the operator chose one.
   *
   * Omitted — not zeroed, not defaulted — for a hand-typed address. The gateway
   * writes NULL in that case, and `/settings` then says "no coordinate — set the
   * address" rather than pointing the weather overlay at a place nobody named
   * (ADR 0111 slice 1).
   */
  latitude?: number;
  longitude?: number;
  googlePlaceId?: string;
}

interface RegisterAccountData {
  name: string;
  email: string;
  password: string;
}

export interface CreateFirstHouseData {
  restaurantName: string;
  address: string;
  city: string;
  country: string;
  stateProvince?: string;
  postalCode?: string;
  neighborhood?: string;
  restaurantPhone?: string;
  timezone?: string;
  currency?: string;
  latitude?: number;
  longitude?: number;
  googlePlaceId?: string;
}

interface JoinViaInviteData {
  code: string;
  name: string;
  email: string;
  password: string;
}

export interface AuthContextType {
  user: User | null;
  loading: boolean;
  error: string | null;
  clearError: () => void;
  activeRestaurantId: string | null;
  /** Role at the active branch from user_restaurant_access; null if unknown */
  activeRole: "owner" | "manager" | "staff" | null;
  availableRestaurants: RestaurantBranch[];
  /**
   * Move the session into another of the person's houses (or choose one when
   * it names none). Resolves true when the server issued the new session;
   * false, with nothing changed, when it refused. The page never relabels
   * itself on a refusal (ADR 0164, R6).
   */
  setActiveRestaurantId: (restaurantId: string) => Promise<boolean>;
  login: (email: string, password: string) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  registerAccount: (data: RegisterAccountData) => Promise<void>;
  registerAccountWithGoogle: (token: string) => Promise<void>;
  createFirstHouse: (data: CreateFirstHouseData) => Promise<string>;
  registerRestaurant: (data: RegisterRestaurantData) => Promise<void>;
  joinViaInvite: (data: JoinViaInviteData) => Promise<void>;
  loginWithGoogle: (token: string) => Promise<void>;
  loginWithMicrosoft: (token: string) => Promise<void>;
  /**
   * Identity-first sign-in: ask the gateway which methods this address
   * actually has. Never throws — an unreachable gateway resolves to
   * `fallbackSignInMethods()` (marked `assumed`) so the page degrades to the
   * form it had before rather than locking the user out. See ADR 0024.
   */
  resolveSignInMethods: (email: string) => Promise<SignInMethodsResult>;
  logout: () => Promise<void>;
  refreshToken: () => Promise<void>;
  refreshBranches: () => Promise<void>;
  isAuthenticated: boolean;
}

interface RegisterData {
  email: string;
  password: string;
  name: string;
  restaurantId: string;
  role: "owner" | "manager" | "staff";
  phone?: string;
}

/**
 * Exported so tests and Storybook can supply a mock auth value directly,
 * bypassing AuthProvider's network + localStorage bootstrap. Application code
 * should use `useAuth()` / `<AuthProvider>` rather than consuming this.
 */
export const AuthContext = createContext<AuthContextType | undefined>(
  undefined,
);
const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );

// ── 401 Interceptor: auto-refresh with deduplication ───────────────
// The refresh itself lives in `lib/sessionRefresh.ts` — the one
// implementation this interceptor, `refreshTokenFn` below, and
// `stores/authStore.ts`'s `loadUser` all call, so a 401 on this axios
// instance and a concurrent refresh started from a different module share
// one in-flight request and one outcome rather than racing (ADR 0164, item
// 2/3: three separate refresh implementations used to disagree on whether a
// 503 keeps the session, and could double-spend one refresh token).
// Re-exported so existing importers of `doRefresh` from this module (the
// axios interceptor's own tests) keep working unchanged.
export { doRefresh };

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & {
      _retry?: boolean;
    };
    // Only intercept 401s that are NOT the refresh or login calls themselves
    if (
      error.response?.status === 401 &&
      originalRequest &&
      !originalRequest._retry &&
      !originalRequest.url?.includes("/auth/refresh") &&
      !originalRequest.url?.includes("/auth/login")
    ) {
      originalRequest._retry = true;

      // `doRefresh` is single-flight on its own now, shared with every other
      // caller in the app — no local dedup wrapper needed here any more.
      const newToken = await doRefresh();
      if (newToken) {
        originalRequest.headers["Authorization"] = `Bearer ${newToken}`;
        api.defaults.headers.common["Authorization"] = `Bearer ${newToken}`;
        return api(originalRequest);
      }
      if (!localStorage.getItem("refreshToken")) {
        delete api.defaults.headers.common["Authorization"];
      }
    }
    // A session in no house asked for something that belongs to a house (ADR
    // 0164, R4): the person has not chosen one yet.
    if (
      error.response?.status === 403 &&
      (error.response.data as { code?: string } | undefined)?.code ===
        "HOUSE_REQUIRED"
    ) {
      goToChooser();
    }
    return Promise.reject(error);
  },
);

/** `/auth/me`'s person, with the session's house taken from its token. */
function userFrom(
  me: Record<string, unknown>,
  accessToken: string | null,
): User {
  const studioRoles = (() => {
    try {
      const payload = accessToken
        ? JSON.parse(atob(accessToken.split(".")[1]))
        : null;
      return payload?.app_metadata?.roles ?? [];
    } catch {
      return [];
    }
  })();
  return {
    ...(me as unknown as User),
    studioRoles,
    role: (me.role as User["role"]) ?? null,
    restaurantId:
      (typeof me.restaurantId === "string" && me.restaurantId) ||
      tokenHouse(accessToken) ||
      "",
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeRestaurantId, setActiveRestaurantIdState] = useState<
    string | null
  >(null);
  const [availableRestaurants, setAvailableRestaurants] = useState<
    RestaurantBranch[]
  >([]);
  const [activeRole, setActiveRole] = useState<
    "owner" | "manager" | "staff" | null
  >(null);
  const branchFetchSeq = React.useRef(0);

  // Configure axios defaults
  useEffect(() => {
    const token = localStorage.getItem("accessToken");
    if (token) {
      api.defaults.headers.common["Authorization"] = `Bearer ${token}`;
    }
  }, []);

  useEffect(() => {
    if (user) {
      // Only opaque identifiers reach the error tracker. `user.email` and
      // `user.name` are in scope here and are deliberately not passed: an
      // error report needs to be routable to an account, not to a person.
      errorTracking.setUser({
        id: user.userId,
        restaurantId: user.restaurantId,
      });
    } else {
      errorTracking.setUser(null);
    }
  }, [user]);

  // Load user from token on mount
  useEffect(() => {
    const loadUser = async () => {
      const token = localStorage.getItem("accessToken");
      if (!token) {
        setLoading(false);
        return;
      }
      if (token === "demo-token") {
        localStorage.removeItem("accessToken");
        localStorage.removeItem("refreshToken");
        localStorage.removeItem("demoMode");
        setLoading(false);
        return;
      }

      try {
        const response = await api.get("/api/v1/auth/me");
        // Studio roles come from the JWT itself (app_metadata.roles), and the
        // session's house from the token when /auth/me names none.
        setUser(
          userFrom(response.data.user, localStorage.getItem("accessToken")),
        );
      } catch (err) {
        console.error("Failed to load user:", err);
        // Only a 401 means the token is invalid (POS lens, absence-as-health 9).
        //
        // This used to delete BOTH tokens on ANY error from GET /auth/me. A 429
        // after ordinary use — measured live on the lens run — therefore sent
        // five page loads to /login and destroyed the refresh token, so the
        // session could not be recovered even once the limit cleared. A rate
        // limit, a 500, and a dropped connection all say "ask again later";
        // none of them says "you are not who you said you were".
        //
        // 403 is deliberately NOT included: a token that authenticates but is
        // not allowed here is still a valid token, and throwing it away turns
        // a permissions problem into a login problem.
        const status = (err as { response?: { status?: number } })?.response
          ?.status;
        if (status === 401) {
          // ADR 0164, item 2/3 (round 2, 2026-09-19): by the time this catch
          // runs, the response interceptor above has ALREADY awaited
          // `doRefresh()` for this exact 401 — it sits between the request
          // and this catch in the same promise chain, on this same `api`
          // instance. `doRefresh` removes the stored refresh token only on a
          // genuine sign-out (the refresh token itself was rejected); a
          // `houseAccessEnded` refresh stores a fresh, no-house pair and
          // sends the person to the chooser, and a 503 or a dropped
          // connection while refreshing leaves the original pair untouched —
          // both keep a session on disk. This used to delete both tokens
          // whenever the ORIGINAL request 401'd, with no such check, which
          // silently discarded whichever of those two `doRefresh` had just
          // decided to keep — the ordinary way anyone reloads a page after
          // their house access ended, not just the tab-stayed-open case.
          if (!localStorage.getItem("refreshToken")) {
            localStorage.removeItem("accessToken");
            localStorage.removeItem("refreshToken");
          } else {
            console.warn(
              "Keeping the session: the shared refresh kept a session on " +
                "disk (houseAccessEnded, or a transient refresh failure), " +
                "not a sign-out.",
            );
          }
        } else {
          console.warn(
            `Keeping the session: /auth/me failed with ${status ?? "no status (network)"}, ` +
              "which is not an authentication failure.",
          );
        }
      } finally {
        setLoading(false);
      }
    };

    loadUser();
  }, []);

  // Centralized branch fetch — reused by initial load and refreshBranches()
  // IMPORTANT: preserves activeRestaurantId via the validSaved check below.
  // Do NOT reset activeRestaurantId on refresh — the validSaved check handles it correctly.
  const fetchAndSetBranches = useCallback(
    async (fallbackRestaurantId?: string) => {
      const requestId = ++branchFetchSeq.current;
      const resolveJwtRestaurantId = (): string | null => {
        try {
          const token = localStorage.getItem("accessToken");
          if (!token) return null;
          const payload = JSON.parse(atob(token.split(".")[1]));
          const rid = payload?.restaurantId as string | undefined;
          return rid && isUuid(rid) ? rid : null;
        } catch {
          return null;
        }
      };

      const readCachedBranches = (): RestaurantBranch[] => {
        try {
          const raw = localStorage.getItem("availableRestaurants");
          if (!raw) return [];
          const parsed = JSON.parse(raw);
          if (!Array.isArray(parsed)) return [];
          return parsed.filter(
            (b: RestaurantBranch) =>
              b && typeof b.id === "string" && isUuid(b.id),
          );
        } catch {
          return [];
        }
      };

      const applyBranches = (branches: RestaurantBranch[]) => {
        if (requestId !== branchFetchSeq.current) return;
        setAvailableRestaurants(branches);
        localStorage.setItem("availableRestaurants", JSON.stringify(branches));

        // The active house is the one the session's TOKEN names, and nothing
        // else (ADR 0164, R1). This used to take the id saved in localStorage
        // when it was in the list, else `branches[0]` from an unordered query,
        // without asking the server for a token: after signing out and in, a
        // person with several houses could see one house's name while every
        // read came from another (research §1 b). A session in no house has
        // no active house; ProtectedRoute sends it to the chooser.
        const resolvedActive = resolveJwtRestaurantId();

        setActiveRestaurantIdState(resolvedActive);
        if (resolvedActive) {
          localStorage.setItem("activeRestaurantId", resolvedActive);
          api.defaults.headers.common["X-Restaurant-Id"] = resolvedActive;
          useAuthStore.getState().setActiveRestaurantId(resolvedActive);
        } else {
          localStorage.removeItem("activeRestaurantId");
          delete api.defaults.headers.common["X-Restaurant-Id"];
          useAuthStore.setState({ activeRestaurantId: null });
        }
      };

      try {
        const response = await api.get("/api/v1/organizations/branches");
        if (requestId !== branchFetchSeq.current) return;

        const raw = response.data;
        const branches: RestaurantBranch[] = Array.isArray(raw)
          ? raw
          : Array.isArray(raw?.data)
            ? raw.data
            : [];

        if (branches.length > 0) {
          applyBranches(branches);
          return;
        }
      } catch (err) {
        console.warn(
          "Failed to fetch branches, falling back to single restaurant:",
          err,
        );
      }

      if (requestId !== branchFetchSeq.current) return;

      // Prefer a previously fetched multi-location list over inventing a single stub.
      const cached = readCachedBranches();
      if (cached.length > 1) {
        applyBranches(cached);
        return;
      }

      // Fallback when the list could not be read: the token's house, and only
      // that. NEVER a saved id, the first cached branch or the userId: the
      // page must not show a house the session is not in.
      const candidate =
        resolveJwtRestaurantId() ||
        (fallbackRestaurantId && isUuid(fallbackRestaurantId)
          ? fallbackRestaurantId
          : null);

      if (!candidate) {
        applyBranches(cached);
        return;
      }

      const fallbackBranch: RestaurantBranch = cached.find(
        (b) => b.id === candidate,
      ) ?? {
        id: candidate,
        name: "My Restaurant",
        city: null,
        chain_id: null,
        chain_name: null,
      };
      applyBranches([fallbackBranch]);
    },
    [],
  );

  useEffect(() => {
    if (!user) {
      setActiveRole(null);
      return;
    }
    const tid = activeRestaurantId;
    const token = localStorage.getItem("accessToken");
    if (!tid || !token || !isUuid(tid)) {
      setActiveRole(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const { data } = await api.get("/api/v1/auth/me/role", {
          params: { restaurantId: tid },
        });
        if (cancelled) return;
        const r = data.role as string | null | undefined;
        if (r && ["owner", "manager", "staff"].includes(r)) {
          setActiveRole(r as "owner" | "manager" | "staff");
        } else setActiveRole(null);
      } catch {
        if (!cancelled) setActiveRole(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, activeRestaurantId]);

  // Public refresh — can be called after chain/location changes to update the branch switcher
  const refreshBranches = useCallback(async () => {
    if (!user?.userId) return;
    await fetchAndSetBranches(user.restaurantId);
  }, [user, fetchAndSetBranches]);

  // Sync restaurant context when user changes
  useEffect(() => {
    if (!user) {
      setAvailableRestaurants([]);
      setActiveRestaurantIdState(null);
      setActiveRole(null);
      return;
    }

    fetchAndSetBranches(user.restaurantId);
  }, [user, fetchAndSetBranches]);

  const setActiveRestaurantId = useCallback(
    async (restaurantId: string): Promise<boolean> => {
      if (!isUuid(restaurantId)) {
        return false;
      }

      try {
        // Re-issue the session in that house. The server mints it only where
        // the person holds an active membership (ADR 0164).
        const response = await api.post("/api/v1/auth/switch-restaurant", {
          restaurantId,
        });
        const { accessToken, refreshToken } = response.data;
        const house = storeSession(accessToken, refreshToken);
        api.defaults.headers.common["Authorization"] = `Bearer ${accessToken}`;
        if (house !== restaurantId) return false;
        clearHouseEnded();

        setActiveRestaurantIdState(house);
        api.defaults.headers.common["X-Restaurant-Id"] = house;
        // Sync Zustand store so all consumers (Providers, Dashboard, etc.) re-render immediately
        useAuthStore.getState().setActiveRestaurantId(house);

        // The role is the role in THIS house now; `/auth/me` reads it from the
        // new session.
        const me = await api.get("/api/v1/auth/me");
        setUser(userFrom(me.data.user, accessToken));
        return true;
      } catch (err) {
        // A refused switch stays in the current house and says so. This used
        // to relabel the page anyway, "proceeding with X-Restaurant-Id header
        // only", a header the gateway reads nowhere: the page showed the new
        // house while every read still came from the old one (ADR 0164, R6).
        console.warn("switch-restaurant refused; staying in this house", err);
        return false;
      }
    },
    [],
  );

  const login = useCallback(async (email: string, password: string) => {
    try {
      setError(null);
      setLoading(true);
      // `lastHouses` is this device's memory of the house THIS email used on
      // it; the server lands the person by it or asks them to choose (ADR
      // 0164). A pair naming no house means "choose": ProtectedRoute sends
      // the person to /choose-house. Only the entry for the email being
      // submitted is ever sent, never any other account this device
      // remembers (item 8, 2026-09-19).
      const hint = lastHouseHintFor(email);
      const response = await api.post("/api/v1/auth/login", {
        email,
        password,
        lastHouses: hint ? [hint] : [],
      });

      const { accessToken, refreshToken: refresh } = response.data;

      storeSession(accessToken, refresh);
      api.defaults.headers.common["Authorization"] = `Bearer ${accessToken}`;

      const userResponse = await api.get("/api/v1/auth/me");
      setUser(userFrom(userResponse.data.user, accessToken));
    } catch (err: any) {
      // A network-level failure says what the person can do about it, and
      // nothing else. It used to read "Start the API Gateway: cd
      // apps/api-gateway && pnpm start:dev" — a developer instruction that
      // shipped to production and told a customer on mudavym.com to run a
      // terminal command. It was also misleading in the case that actually
      // occurred: the gateway was running fine and the real cause was a
      // CORS-blocked origin, which a browser reports as an indistinguishable
      // network error. Say the honest thing — we could not reach it — and
      // leave the diagnosis to the logs.
      const message =
        err?.code === "ERR_NETWORK" && !err?.response
          ? "We couldn't reach the server. Check your connection and try again — if this keeps happening, it's on our side, not yours."
          : err?.response?.data?.message || err?.message || "Login failed.";
      setError(message);
      // Preserve the structured { code, provider } the backend sends for
      // OAuth-only accounts — callers (Login.tsx) branch on `provider` to
      // decide which sign-in flow to redirect into. Don't make them
      // regex-parse the human-readable `message` for that.
      throw new LoginError(
        message,
        err?.response?.data?.code,
        err?.response?.data?.provider,
        err?.response?.status,
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const register = useCallback(async (data: RegisterData) => {
    try {
      setError(null);
      setLoading(true);
      const response = await api.post("/api/v1/auth/register", data);

      const { accessToken, refreshToken: refresh } = response.data;

      localStorage.setItem("accessToken", accessToken);
      localStorage.setItem("refreshToken", refresh);
      api.defaults.headers.common["Authorization"] = `Bearer ${accessToken}`;

      const userResponse = await api.get("/api/v1/auth/me");
      setUser(userResponse.data.user);
    } catch (err: any) {
      const message = err.response?.data?.message || "Registration failed";
      setError(message);
      throw new Error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const registerRestaurant = useCallback(
    async (data: RegisterRestaurantData) => {
      try {
        setError(null);
        setLoading(true);
        const response = await api.post("/api/v1/auth/register/restaurant", {
          ...data,
          timezone:
            data.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
        const { accessToken, refreshToken: refresh } = response.data;
        storeSession(accessToken, refresh);
        api.defaults.headers.common["Authorization"] = `Bearer ${accessToken}`;
        const userResponse = await api.get("/api/v1/auth/me");
        setUser(userFrom(userResponse.data.user, accessToken));
      } catch (err: any) {
        const message = err.response?.data?.message || "Registration failed";
        setError(message);
        throw new Error(message);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const establishSession = useCallback(async (response: {
    data: { accessToken: string; refreshToken: string };
  }) => {
    const { accessToken, refreshToken: refresh } = response.data;
    localStorage.setItem("accessToken", accessToken);
    localStorage.setItem("refreshToken", refresh);
    api.defaults.headers.common["Authorization"] = `Bearer ${accessToken}`;
    const userResponse = await api.get("/api/v1/auth/me");
    setUser(userResponse.data.user);
  }, []);

  const registerAccount = useCallback(
    async (data: RegisterAccountData) => {
      try {
        setError(null);
        setLoading(true);
        await establishSession(
          await api.post("/api/v1/auth/register/account", data),
        );
      } catch (err: any) {
        const message = err.response?.data?.message || "Registration failed";
        setError(message);
        throw new Error(message);
      } finally {
        setLoading(false);
      }
    },
    [establishSession],
  );

  const registerAccountWithGoogle = useCallback(
    async (token: string) => {
      try {
        setError(null);
        setLoading(true);
        await establishSession(
          await api.post("/api/v1/auth/register/google", { token }),
        );
      } catch (err: any) {
        const message =
          err.response?.data?.message || "Google registration failed";
        setError(message);
        throw new Error(message);
      } finally {
        setLoading(false);
      }
    },
    [establishSession],
  );

  const createFirstHouse = useCallback(
    async (data: CreateFirstHouseData): Promise<string> => {
      const response = await api.post("/api/v1/auth/register/house", data);
      const { restaurantId, accessToken, refreshToken: refresh } = response.data;
      localStorage.setItem("accessToken", accessToken);
      localStorage.setItem("refreshToken", refresh);
      localStorage.setItem("activeRestaurantId", restaurantId);
      api.defaults.headers.common["Authorization"] = `Bearer ${accessToken}`;
      api.defaults.headers.common["X-Restaurant-Id"] = restaurantId;
      setActiveRestaurantIdState(restaurantId);
      useAuthStore.getState().setActiveRestaurantId(restaurantId);
      const userResponse = await api.get("/api/v1/auth/me");
      setUser(userResponse.data.user);
      return restaurantId;
    },
    [],
  );

  const joinViaInvite = useCallback(async (data: JoinViaInviteData) => {
    try {
      setError(null);
      setLoading(true);
      const response = await api.post("/api/v1/auth/join", data);
      const { accessToken, refreshToken: refresh } = response.data;
      storeSession(accessToken, refresh);
      api.defaults.headers.common["Authorization"] = `Bearer ${accessToken}`;
      const userResponse = await api.get("/api/v1/auth/me");
      setUser(userFrom(userResponse.data.user, accessToken));
    } catch (err: any) {
      const message =
        err.response?.data?.message || "Failed to join restaurant";
      setError(message);
      throw new Error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const resolveSignInMethods = useCallback(
    async (email: string): Promise<SignInMethodsResult> => {
      const normalized = email.trim().toLowerCase();
      try {
        const response = await api.post("/api/v1/auth/sign-in-methods", {
          email: normalized,
        });
        const { methods, unavailable, declared, noSignInMethod } =
          response.data;
        // Trust the server's shape, but never let a malformed payload render
        // an empty page: an unusable response is the same situation as an
        // unreachable one.
        if (!Array.isArray(methods)) return fallbackSignInMethods(normalized);
        return {
          email: response.data.email ?? normalized,
          methods,
          unavailable: Array.isArray(unavailable) ? unavailable : [],
          declared: Array.isArray(declared) ? declared : [],
          noSignInMethod: noSignInMethod === true,
        };
      } catch {
        // Deliberately swallowed. A 429, a 500 or a dead gateway must not
        // strand someone on a page that used to work — they get the standard
        // form and the existing "Invalid credentials" path.
        return fallbackSignInMethods(normalized);
      }
    },
    [],
  );

  const loginWithGoogle = useCallback(async (token: string) => {
    try {
      setError(null);
      setLoading(true);
      // Only this device's memory of the email inside Google's own ID token
      // is sent, never any other account it remembers (item 8, 2026-09-19).
      const hint = lastHouseHintFor(tokenClaims(token)?.email);
      const response = await api.post("/api/v1/auth/oauth/google", {
        token,
        lastHouses: hint ? [hint] : [],
      });

      const { accessToken, refreshToken: refresh } = response.data;

      storeSession(accessToken, refresh);
      api.defaults.headers.common["Authorization"] = `Bearer ${accessToken}`;

      const userResponse = await api.get("/api/v1/auth/me");
      setUser(userFrom(userResponse.data.user, accessToken));
    } catch (err: any) {
      const message = err.response?.data?.message || "Google login failed";
      setError(message);
      throw new Error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loginWithMicrosoft = useCallback(async (token: string) => {
    try {
      setError(null);
      setLoading(true);
      // Only this device's memory of the email inside Microsoft's own ID
      // token is sent, never any other account it remembers (item 8,
      // 2026-09-19).
      const hint = lastHouseHintFor(tokenClaims(token)?.email);
      const response = await api.post("/api/v1/auth/oauth/microsoft", {
        token,
        lastHouses: hint ? [hint] : [],
      });

      const { accessToken, refreshToken: refresh } = response.data;

      storeSession(accessToken, refresh);
      api.defaults.headers.common["Authorization"] = `Bearer ${accessToken}`;

      const userResponse = await api.get("/api/v1/auth/me");
      setUser(userFrom(userResponse.data.user, accessToken));
    } catch (err: any) {
      const message = err.response?.data?.message || "Microsoft login failed";
      setError(message);
      throw new Error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post("/api/v1/auth/logout");
    } catch (err) {
      console.error("Logout error:", err);
    } finally {
      localStorage.removeItem("accessToken");
      localStorage.removeItem("refreshToken");
      localStorage.removeItem("demoMode");
      localStorage.removeItem("activeRestaurantId");
      localStorage.removeItem("availableRestaurants");
      // `mudavym.lastHouse.v1` is kept on purpose (ADR 0164, R3): it holds
      // only ids and times, and it is what lets this person go straight back
      // into their house tomorrow.
      clearHouseEnded();
      delete api.defaults.headers.common["Authorization"];
      delete api.defaults.headers.common["X-Restaurant-Id"];
      setUser(null);
      setActiveRole(null);
    }
  }, []);

  // Delegates to the same single-flight `doRefresh` the axios interceptor and
  // `authStore.ts` use (ADR 0164, item 2/3) — this used to be a fourth,
  // independent refresh implementation with its own copy of the
  // houseAccessEnded/503 rules, and could fire its own `POST /auth/refresh`
  // at the same moment the interceptor did.
  //
  // `doRefresh` returns `null` for three different reasons — a genuinely
  // refused refresh token, a kept-session 503, or a houseAccessEnded redirect
  // that already stored a new (no-house) pair and navigated away — and only
  // the first should sign this context out. `doRefresh` removes the stored
  // refresh token itself on (and only on) that first case, so checking for
  // its absence afterward tells the three apart without needing its own copy
  // of the HTTP status logic.
  const refreshTokenFn = useCallback(async () => {
    const hadRefreshToken = !!localStorage.getItem("refreshToken");
    if (!hadRefreshToken) {
      await logout();
      return;
    }
    const accessToken = await doRefresh();
    if (accessToken) {
      api.defaults.headers.common["Authorization"] = `Bearer ${accessToken}`;
      return;
    }
    if (!localStorage.getItem("refreshToken")) {
      await logout();
    }
  }, [logout]);

  const clearError = useCallback(() => setError(null), []);

  const value: AuthContextType = {
    user,
    loading,
    error,
    clearError,
    activeRestaurantId,
    activeRole,
    availableRestaurants,
    setActiveRestaurantId,
    login,
    register,
    registerAccount,
    registerAccountWithGoogle,
    createFirstHouse,
    registerRestaurant,
    joinViaInvite,
    loginWithGoogle,
    loginWithMicrosoft,
    resolveSignInMethods,
    logout,
    refreshToken: refreshTokenFn,
    refreshBranches,
    isAuthenticated: !!user,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
