import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render } from "@testing-library/react";

/**
 * A busy session read is not a sign-out (r20, 2026-11-13).
 *
 * The gateway rate-limits `/auth/me`. On a 429 the boot load used to end with
 * the tokens kept but no person, so ProtectedRoute sent a signed-in owner to
 * /login on about the sixth reload in a minute. A temporary failure (429,
 * 408, 5xx, no response) now keeps `loading` true and asks again; 401 and 403
 * keep their old outcomes.
 */

const h = vi.hoisted(() => {
  const instance = {
    defaults: { headers: { common: {} as Record<string, string> } },
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
    get: vi.fn(),
    post: vi.fn(),
  };
  return { instance, globalPost: vi.fn() };
});

vi.mock("axios", () => ({
  default: { create: () => h.instance, post: h.globalPost },
  create: () => h.instance,
  post: h.globalPost,
}));

import { AuthProvider, useAuth, type AuthContextType } from "./AuthContext";
import { useAuthStore } from "../stores";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER = {
  userId: "owner-1",
  email: "owner@house.test",
  name: "Owner",
  role: "owner",
  restaurantId: A,
  emailVerified: true,
};

type Answer = { data: unknown } | { fail: unknown };
const tooMany = (retryAfter?: number): Answer => ({
  fail: {
    response: {
      status: 429,
      headers: {},
      data: retryAfter === undefined ? {} : { retryAfter },
    },
  },
});
const status = (s: number): Answer => ({ fail: { response: { status: s, headers: {}, data: {} } } });
const offline: Answer = { fail: new Error("Network Error") };
const ok: Answer = { data: { user: OWNER } };

/** /auth/me answers in this order; every other read answers an empty list. */
function meAnswers(...answers: Answer[]) {
  const queue = [...answers];
  h.instance.get.mockImplementation(async (url: string) => {
    if (url !== "/api/v1/auth/me") return { data: [] };
    const next = queue.shift() ?? ok;
    if ("fail" in next) throw next.fail;
    return { data: next.data };
  });
}

const meReads = () =>
  h.instance.get.mock.calls.filter(([url]) => url === "/api/v1/auth/me").length;

let ctx: AuthContextType | null = null;
const loadingSeen: boolean[] = [];
function Probe() {
  ctx = useAuth();
  loadingSeen.push(ctx.loading);
  return null;
}

async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function mount() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}

const realLocation = window.location;
let href = "";

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  sessionStorage.clear();
  h.instance.get.mockReset();
  h.instance.post.mockReset();
  h.globalPost.mockReset();
  useAuthStore.setState({ user: null, activeRestaurantId: null });
  localStorage.setItem("accessToken", "boot-token");
  localStorage.setItem("refreshToken", "boot-refresh");
  ctx = null;
  loadingSeen.length = 0;
  href = "";
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      ...realLocation,
      pathname: "/reports",
      get href() {
        return href;
      },
      set href(v: string) {
        href = v;
      },
      reload: vi.fn(),
      assign: vi.fn(),
    },
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: realLocation,
  });
});

describe("a temporary /auth/me failure keeps the session loading and asks again", () => {
  it("a 429 waits the gateway's retryAfter, then the person loads — never a moment of 'no one, done loading'", async () => {
    meAnswers(tooMany(7), ok);
    mount();
    await flush();
    expect(meReads()).toBe(1);
    expect(ctx?.loading).toBe(true);
    expect(ctx?.user).toBeNull();

    await advance(7_249);
    expect(meReads()).toBe(1);
    expect(ctx?.loading).toBe(true);

    await advance(1);
    await flush();
    expect(meReads()).toBe(2);
    expect(ctx?.loading).toBe(false);
    expect(ctx?.user?.userId).toBe("owner-1");
    expect(ctx?.isAuthenticated).toBe(true);
    // ProtectedRoute redirects on `!loading && !user`; that state never rendered.
    const firstDone = loadingSeen.indexOf(false);
    expect(firstDone).toBeGreaterThan(-1);
    expect(loadingSeen.slice(0, firstDone).every((l) => l === true)).toBe(true);
    expect(localStorage.getItem("accessToken")).toBe("boot-token");
    expect(localStorage.getItem("refreshToken")).toBe("boot-refresh");
    expect(href).toBe("");
  });

  it("keeps asking through repeated 429s and 5xx with backoff, then loads", async () => {
    meAnswers(tooMany(), status(503), offline, ok);
    mount();
    await flush();
    expect(meReads()).toBe(1);
    await advance(1_000); // after the 429 with no retryAfter: 1 s
    expect(meReads()).toBe(2);
    await advance(1_999); // after the 503: 2 s
    expect(meReads()).toBe(2);
    await advance(1);
    expect(meReads()).toBe(3);
    expect(ctx?.loading).toBe(true);
    await advance(4_000); // after the dropped connection: 4 s
    await flush();
    expect(meReads()).toBe(4);
    expect(ctx?.loading).toBe(false);
    expect(ctx?.user?.userId).toBe("owner-1");
  });

  it("a 403 is not temporary: one read, the load ends, the tokens stay", async () => {
    meAnswers(status(403));
    mount();
    await flush();
    await advance(60_000);
    expect(meReads()).toBe(1);
    expect(ctx?.loading).toBe(false);
    expect(ctx?.user).toBeNull();
    expect(localStorage.getItem("accessToken")).toBe("boot-token");
  });

  it("a 401 with no refresh token left still leaves the dead session (ADR 0344), with no retry", async () => {
    localStorage.removeItem("refreshToken");
    meAnswers(status(401));
    mount();
    await flush();
    await advance(60_000);
    expect(meReads()).toBe(1);
    expect(ctx?.loading).toBe(false);
    expect(localStorage.getItem("accessToken")).toBeNull();
  });

  it("signed out in another tab while waiting: stops asking and ends the load", async () => {
    meAnswers(tooMany(5), ok);
    mount();
    await flush();
    localStorage.removeItem("accessToken");
    await advance(10_000);
    expect(meReads()).toBe(1);
    expect(ctx?.loading).toBe(false);
    expect(ctx?.user).toBeNull();
  });

  it("unmounting while waiting cancels the next read", async () => {
    meAnswers(tooMany(5), ok);
    const view = mount();
    await flush();
    view.unmount();
    await advance(10_000);
    expect(meReads()).toBe(1);
  });
});
