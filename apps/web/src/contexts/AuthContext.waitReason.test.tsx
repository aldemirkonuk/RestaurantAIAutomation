import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render } from "@testing-library/react";

/**
 * AuthProvider says why the boot read is waiting (r22, 2026-11-13), so the
 * loading screens can say it in words, and a wait for a dropped connection
 * ends when the browser comes back online. The harness is the r20
 * busySessionRead test's.
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
function Probe() {
  ctx = useAuth();
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
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const goOnline = () =>
  act(async () => {
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
  });

describe("sessionWait: why the boot read is waiting", () => {
  it("is null before any failure, names a rate limit and its wait, and clears when the person loads", async () => {
    meAnswers(tooMany(40), ok);
    mount();
    expect(ctx?.sessionWait).toBeNull();
    await flush();
    expect(ctx?.sessionWait).toEqual({ reason: "busy", delayMs: 40_250 });
    expect(ctx?.loading).toBe(true);
    await advance(40_250);
    await flush();
    expect(ctx?.loading).toBe(false);
    expect(ctx?.user?.userId).toBe("owner-1");
    expect(ctx?.sessionWait).toBeNull();
  });

  it("follows the latest failure: a 503, then no response", async () => {
    meAnswers(status(503), offline, ok);
    mount();
    await flush();
    expect(ctx?.sessionWait).toEqual({ reason: "server", delayMs: 1_000 });
    await advance(1_000);
    await flush();
    expect(ctx?.sessionWait).toEqual({ reason: "offline", delayMs: 2_000 });
  });

  it("clears when the load ends on a failure that is not temporary", async () => {
    meAnswers(status(503), status(403));
    mount();
    await flush();
    expect(ctx?.sessionWait?.reason).toBe("server");
    await advance(1_000);
    await flush();
    expect(ctx?.loading).toBe(false);
    expect(ctx?.sessionWait).toBeNull();
  });
});

describe("a wait for a dropped connection ends when the browser is back online", () => {
  it("asks again at once on 'online' instead of sitting out the backoff", async () => {
    meAnswers(offline, offline, offline, ok);
    mount();
    await flush();
    await advance(1_000);
    await advance(2_000);
    expect(meReads()).toBe(3);
    expect(ctx?.sessionWait).toEqual({ reason: "offline", delayMs: 4_000 });
    await advance(500);
    expect(meReads()).toBe(3);
    await goOnline();
    await flush();
    expect(meReads()).toBe(4);
    expect(ctx?.loading).toBe(false);
    expect(ctx?.user?.userId).toBe("owner-1");
    // The woken wait's timer is gone: nothing reads again at the old 4 s mark.
    await advance(10_000);
    expect(meReads()).toBe(4);
  });

  it("a rate limit is not mended by 'online': it waits its full Retry-After", async () => {
    meAnswers(tooMany(20), ok);
    mount();
    await flush();
    await goOnline();
    await advance(1_000);
    expect(meReads()).toBe(1);
    expect(ctx?.loading).toBe(true);
    await advance(19_250);
    await flush();
    expect(meReads()).toBe(2);
  });

  it("a server error is not mended by 'online' either", async () => {
    meAnswers(status(502), ok);
    mount();
    await flush();
    await goOnline();
    expect(meReads()).toBe(1);
    await advance(1_000);
    expect(meReads()).toBe(2);
  });

  it("unmounting mid-wait stops the reads and leaves no 'online' listener behind", async () => {
    const removed = vi.spyOn(window, "removeEventListener");
    meAnswers(offline, ok);
    const view = mount();
    await flush();
    expect(meReads()).toBe(1);
    view.unmount();
    expect(removed.mock.calls.some(([type]) => type === "online")).toBe(true);
    await goOnline();
    await advance(60_000);
    expect(meReads()).toBe(1);
  });
});
