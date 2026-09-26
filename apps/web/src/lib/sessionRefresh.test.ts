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
