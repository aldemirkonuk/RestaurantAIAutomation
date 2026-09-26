import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * ADR 0164, item 2/3. Before this fix, `loadUser`'s catch block treated ANY
 * error from `GET /auth/me` other than a successfully-recovered 401 as
 * "clear both tokens and redirect to /login" — a 503 (the gateway could not
 * read the session), a rate limit, or a dropped connection all did that,
 * exactly the failure `AuthContext.tsx`'s own `/auth/me` load had already
 * been fixed for. ADR 0164 claimed this was fixed "on both web clients"; it
 * was fixed on one. It also refreshed through its own fourth, independent
 * implementation instead of the one, single-flight `doRefresh` every other
 * caller uses, so it could not honour `houseAccessEnded` and could race a
 * refresh AuthContext started at the same moment.
 */

const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock("axios", () => ({
  default: {
    create: () => ({
      get: h.get,
      post: h.post,
      defaults: { headers: { common: {} as Record<string, string> } },
    }),
  },
}));

const refresh = vi.hoisted(() => ({ doRefresh: vi.fn() }));
vi.mock("../lib/sessionRefresh", () => ({ doRefresh: refresh.doRefresh }));

import { useAuthStore } from "./authStore";

const USER = { userId: "u1", email: "a@b.com", name: "A", role: "owner", restaurantId: "house-A" };

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  useAuthStore.setState({
    user: null,
    loading: true,
    error: null,
    activeRestaurantId: null,
    availableRestaurants: [],
    accessToken: null,
    refreshToken: null,
  });
});

describe("authStore.loadUser — a 503 (or any non-401) keeps the session", () => {
  it("does not clear tokens or redirect when /auth/me fails with 503", async () => {
    localStorage.setItem("accessToken", "a");
    localStorage.setItem("refreshToken", "r");
    h.get.mockRejectedValue({ response: { status: 503 } });

    await useAuthStore.getState().loadUser();

    expect(localStorage.getItem("accessToken")).toBe("a");
    expect(localStorage.getItem("refreshToken")).toBe("r");
    expect(refresh.doRefresh).not.toHaveBeenCalled();
    expect(useAuthStore.getState().loading).toBe(false);
  });

  it("does not clear tokens on a network error (no status at all)", async () => {
    localStorage.setItem("accessToken", "a");
    localStorage.setItem("refreshToken", "r");
    h.get.mockRejectedValue(new Error("Network Error"));

    await useAuthStore.getState().loadUser();

    expect(localStorage.getItem("accessToken")).toBe("a");
    expect(localStorage.getItem("refreshToken")).toBe("r");
  });
});

describe("authStore.loadUser — 401 goes through the one shared doRefresh", () => {
  it("applies the retried user data when doRefresh recovers a token", async () => {
    localStorage.setItem("accessToken", "expired");
    localStorage.setItem("refreshToken", "r");
    h.get
      .mockRejectedValueOnce({ response: { status: 401 } })
      .mockResolvedValueOnce({ data: { user: USER, availableRestaurants: ["house-A"] } });
    refresh.doRefresh.mockImplementation(async () => {
      localStorage.setItem("refreshToken", "r"); // unchanged, as a real rotation-less refresh would leave it
      return "new-access";
    });

    await useAuthStore.getState().loadUser();

    expect(refresh.doRefresh).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().user).toEqual(USER);
    expect(useAuthStore.getState().loading).toBe(false);
  });

  it("signs out only when doRefresh actually removed the refresh token (genuine 401)", async () => {
    localStorage.setItem("accessToken", "expired");
    localStorage.setItem("refreshToken", "r");
    h.get.mockRejectedValue({ response: { status: 401 } });
    refresh.doRefresh.mockImplementation(async () => {
      localStorage.removeItem("accessToken");
      localStorage.removeItem("refreshToken");
      return null;
    });

    await useAuthStore.getState().loadUser();

    expect(localStorage.getItem("refreshToken")).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it("keeps the session when doRefresh returns null for a houseAccessEnded redirect (refresh token still present)", async () => {
    localStorage.setItem("accessToken", "expired");
    localStorage.setItem("refreshToken", "r");
    h.get.mockRejectedValue({ response: { status: 401 } });
    refresh.doRefresh.mockImplementation(async () => {
      // Mirrors what the real doRefresh does on houseAccessEnded: stores a
      // fresh no-house pair and navigates away, returning null.
      localStorage.setItem("refreshToken", "new-no-house-refresh");
      return null;
    });

    await useAuthStore.getState().loadUser();

    expect(localStorage.getItem("refreshToken")).toBe("new-no-house-refresh");
    // Not forced into a full sign-out: the chooser redirect (inside
    // doRefresh, exercised separately in sessionRefresh.test.ts) is what
    // handles this case, not a second, conflicting one here.
    expect(useAuthStore.getState().loading).toBe(false);
  });

  it("keeps the session when doRefresh returns null for a 503 while refreshing", async () => {
    localStorage.setItem("accessToken", "expired");
    localStorage.setItem("refreshToken", "r");
    h.get.mockRejectedValue({ response: { status: 401 } });
    refresh.doRefresh.mockResolvedValue(null); // refreshToken left untouched, as the real 503 path does

    await useAuthStore.getState().loadUser();

    expect(localStorage.getItem("refreshToken")).toBe("r");
    expect(useAuthStore.getState().loading).toBe(false);
  });
});
