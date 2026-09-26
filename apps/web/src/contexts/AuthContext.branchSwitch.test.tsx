/**
 * `setActiveRestaurantId`'s branch-switch sequencing — no test covered this
 * anywhere in the tree before this file (round 5 fix pass, ADR 0168 /
 * CLAUDE.md §5b: round 4's must_fix found the code byte-identical to a
 * dropped sibling copy and untested).
 *
 * Two properties, both load-bearing for a person clicking the branch
 * switcher on a real network:
 *
 *   1. A FAILED switch retains the previous branch. Before this lane, a
 *      failed `POST /auth/switch-restaurant` fell through to
 *      `setActiveRestaurantIdState(restaurantId)` anyway (proceeding with
 *      "the X-Restaurant-Id header only") — the UI would show the branch the
 *      person picked while the token backing every subsequent API call still
 *      names the OLD branch, since no new token was minted for the new one.
 *   2. An OLDER, overlapping response cannot replace a LATER selection. Two
 *      switches fired close together race on the network; if the first one's
 *      response lands after the second one's, it must not overwrite what the
 *      person picked second.
 *
 * Both are asserted against the REAL `AuthProvider` — not a mocked
 * `useAuth()` — because the defect these tests exist to catch lives inside
 * the closure `setActiveRestaurantId` itself, not in anything a consumer
 * could see through a stubbed context value.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const mockApi = vi.hoisted(() => ({
  post: vi.fn(),
  get: vi.fn(),
  defaults: { headers: { common: {} as Record<string, string> } },
  interceptors: {
    request: { use: vi.fn() },
    response: { use: vi.fn() },
  },
}));

vi.mock("axios", () => ({
  default: {
    create: vi.fn(() => mockApi),
    post: vi.fn(),
    isAxiosError: vi.fn(() => false),
  },
}));

// Real `@sentry/react` is not initialised in this test environment; stub the
// one call AuthProvider makes so a `user`-keyed effect cannot fail the test
// for a reason unrelated to branch switching.
vi.mock("../lib/error-tracking", () => ({
  errorTracking: { setUser: vi.fn() },
}));

import { AuthProvider, useAuth } from "./AuthContext";

const BRANCH_A = "11111111-1111-4111-8111-111111111111";
const BRANCH_B = "22222222-2222-4222-8222-222222222222";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  localStorage.clear();
  mockApi.post.mockReset();
  mockApi.get.mockReset();
});

afterEach(() => {
  localStorage.clear();
});

describe("AuthContext — setActiveRestaurantId keeps the current branch on failure", () => {
  it("retains the previously-switched branch when the next switch fails", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

    // No accessToken in localStorage, so the mount-time `loadUser` effect
    // short-circuits to `setLoading(false)` with no network call — this test
    // is about switching, not about the session bootstrap.
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.post.mockResolvedValueOnce({
      data: { accessToken: "token-a", refreshToken: "refresh-a" },
    });
    await act(async () => {
      await result.current.setActiveRestaurantId(BRANCH_A);
    });
    expect(result.current.activeRestaurantId).toBe(BRANCH_A);

    mockApi.post.mockRejectedValueOnce(new Error("network down"));
    await act(async () => {
      await result.current.setActiveRestaurantId(BRANCH_B);
    });

    // The must_fix's exact claim: a failed switch keeps the PREVIOUS branch —
    // not BRANCH_B (the one that just failed) and not null (the pre-fix
    // fallthrough set the new id anyway with no new token behind it).
    expect(result.current.activeRestaurantId).toBe(BRANCH_A);
    expect(result.current.error).toMatch(/branch could not be switched/i);
    expect(localStorage.getItem("activeRestaurantId")).toBe(BRANCH_A);
  });

  it("does not let an older switch's late response overwrite a later selection", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));

    const first = deferred<{ data: unknown }>();
    const second = deferred<{ data: unknown }>();
    mockApi.post
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    let pendingA!: Promise<void>;
    let pendingB!: Promise<void>;
    act(() => {
      pendingA = result.current.setActiveRestaurantId(BRANCH_A);
    });
    act(() => {
      pendingB = result.current.setActiveRestaurantId(BRANCH_B);
    });

    // B — the LATER selection — resolves first.
    await act(async () => {
      second.resolve({
        data: { accessToken: "token-b", refreshToken: "refresh-b" },
      });
      await pendingB;
    });
    expect(result.current.activeRestaurantId).toBe(BRANCH_B);

    // A's response arrives late, and it SUCCEEDS — the failure-handling path
    // above is not what is guarding this case. A stale sequence number is.
    await act(async () => {
      first.resolve({
        data: { accessToken: "token-a", refreshToken: "refresh-a" },
      });
      await pendingA;
    });

    // The whole point: the person's actual, later choice (B) must still be
    // what is active — A's late arrival must not win the race just because
    // it finished last on the network.
    expect(result.current.activeRestaurantId).toBe(BRANCH_B);
    expect(localStorage.getItem("activeRestaurantId")).toBe(BRANCH_B);
    expect(localStorage.getItem("accessToken")).toBe("token-b");
  });
});
