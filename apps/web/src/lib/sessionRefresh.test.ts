import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * ADR 0164, item 2/3: `doRefresh` is the one place a refresh token is
 * exchanged, shared by the axios interceptor (AuthContext.tsx),
 * `refreshTokenFn`, and `authStore.ts`'s `loadUser`. The functional
 * houseAccessEnded/401/503 behaviour is covered end to end by
 * `contexts/AuthContext.houses.test.tsx` (which imports this same function
 * through AuthContext's re-export); this file covers what only matters once
 * more than one caller can reach it at the same time — the single-flight
 * guarantee that used to be a dead `refreshPromise` variable nothing read.
 */

const h = vi.hoisted(() => ({ post: vi.fn() }));

vi.mock("axios", () => ({
  default: { post: h.post },
  post: h.post,
}));

import { doRefresh, __resetInFlightForTests } from "./sessionRefresh";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
  __resetInFlightForTests();
});

describe("doRefresh — single-flight", () => {
  it("shares one network call and one outcome across concurrent callers", async () => {
    localStorage.setItem("refreshToken", "r1");
    let resolvePost: (v: unknown) => void;
    h.post.mockReturnValue(
      new Promise((resolve) => {
        resolvePost = resolve;
      }),
    );

    const first = doRefresh();
    const second = doRefresh();
    const third = doRefresh();

    resolvePost!({
      data: { accessToken: "new-access", refreshToken: "new-refresh" },
    });

    const [a, b, c] = await Promise.all([first, second, third]);

    expect(h.post).toHaveBeenCalledTimes(1);
    expect(a).toBe("new-access");
    expect(b).toBe("new-access");
    expect(c).toBe("new-access");
  });

  it("starts a fresh request once the in-flight one has settled", async () => {
    localStorage.setItem("refreshToken", "r1");
    h.post.mockResolvedValueOnce({
      data: { accessToken: "access-1", refreshToken: "refresh-2" },
    });
    await expect(doRefresh()).resolves.toBe("access-1");

    h.post.mockResolvedValueOnce({
      data: { accessToken: "access-2", refreshToken: "refresh-3" },
    });
    await expect(doRefresh()).resolves.toBe("access-2");

    expect(h.post).toHaveBeenCalledTimes(2);
  });

  it("a failed refresh does not wedge the single-flight slot for the next caller", async () => {
    localStorage.setItem("refreshToken", "r1");
    h.post.mockRejectedValueOnce({ response: { status: 503 } });
    await expect(doRefresh()).resolves.toBeNull();
    // The 503 kept the refresh token, so a later call can try again rather
    // than being permanently stuck behind the first (rejected) in-flight slot.
    expect(localStorage.getItem("refreshToken")).toBe("r1");

    h.post.mockResolvedValueOnce({
      data: { accessToken: "access-1", refreshToken: "refresh-2" },
    });
    await expect(doRefresh()).resolves.toBe("access-1");
  });
});

describe("doRefresh — the session moved while the refresh was out (F-610)", () => {
  const U = "11111111-1111-4111-8111-111111111111";
  const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const jwt = (claims: Record<string, unknown>) =>
    `h.${btoa(JSON.stringify(claims)).replace(/=+$/, "")}.s`;
  const inA = jwt({ sub: U, restaurantId: A });
  const inB = jwt({ sub: U, restaurantId: B });

  function pending() {
    let settle!: { ok: (v: unknown) => void; fail: (e: unknown) => void };
    h.post.mockReturnValue(
      new Promise((ok, fail) => {
        settle = { ok, fail };
      }),
    );
    return () => settle;
  }

  it("a house switch during the refresh keeps the new house; the old answer is dropped", async () => {
    localStorage.setItem("accessToken", inA);
    localStorage.setItem("refreshToken", "rA");
    localStorage.setItem("activeRestaurantId", A);
    const settle = pending();

    const result = doRefresh();
    // The switch lands while the refresh is out.
    localStorage.setItem("accessToken", inB);
    localStorage.setItem("refreshToken", "rB");
    localStorage.setItem("activeRestaurantId", B);
    settle().ok({
      data: { accessToken: jwt({ sub: U, restaurantId: A, n: 2 }), refreshToken: "rA2" },
    });

    await expect(result).resolves.toBe(inB);
    expect(localStorage.getItem("accessToken")).toBe(inB);
    expect(localStorage.getItem("refreshToken")).toBe("rB");
    expect(localStorage.getItem("activeRestaurantId")).toBe(B);
  });

  it("a refusal of the token held before the switch does not sign the new house out", async () => {
    localStorage.setItem("accessToken", inA);
    localStorage.setItem("refreshToken", "rA");
    const settle = pending();

    const result = doRefresh();
    localStorage.setItem("accessToken", inB);
    localStorage.setItem("refreshToken", "rB");
    localStorage.setItem("activeRestaurantId", B);
    settle().fail({ response: { status: 401 } });

    await expect(result).resolves.toBe(inB);
    expect(localStorage.getItem("refreshToken")).toBe("rB");
    expect(localStorage.getItem("activeRestaurantId")).toBe(B);
  });

  it("a sign-out during the refresh is not undone by its answer", async () => {
    localStorage.setItem("accessToken", inA);
    localStorage.setItem("refreshToken", "rA");
    const settle = pending();

    const result = doRefresh();
    localStorage.clear();
    settle().ok({ data: { accessToken: inA, refreshToken: "rA2" } });

    await expect(result).resolves.toBeNull();
    expect(localStorage.getItem("accessToken")).toBeNull();
    expect(localStorage.getItem("refreshToken")).toBeNull();
  });
});
