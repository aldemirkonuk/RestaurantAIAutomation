import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * The shared API client and the session's house (ADR 0164): a 403
 * HOUSE_REQUIRED sends the person to the chooser; a refresh that says the house
 * ended does too, and does not sign them out; only a refused refresh token
 * (401) signs out, and it says so over the page instead of reloading to /login
 * (F-335: the reload threw away every typed form).
 */

const h = vi.hoisted(() => {
  const handlers: { onError?: (e: unknown) => Promise<unknown> } = {};
  const instance: any = vi.fn();
  instance.interceptors = {
    request: { use: vi.fn() },
    response: {
      use: vi.fn((_ok: unknown, onError: (e: unknown) => Promise<unknown>) => {
        handlers.onError = onError;
      }),
    },
  };
  return { instance, handlers, globalPost: vi.fn() };
});

vi.mock("axios", () => ({
  default: {
    create: () => h.instance,
    post: h.globalPost,
    isAxiosError: () => false,
  },
  create: () => h.instance,
  post: h.globalPost,
}));

import "./client";
import { HOUSE_ENDED_KEY } from "../../lib/houseMemory";
import { SESSION_ENDED_EVENT, SESSION_ENDED_WORDS } from "../../lib/sessionEnded";
import { ROLE_RECHECK_EVENT } from "../../lib/roleRecheck";

const U = "11111111-1111-4111-8111-111111111111";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function jwt(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o))
      .replace(/=+$/, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  return `${b64({ alg: "HS256" })}.${b64(claims)}.sig`;
}

const assign = vi.fn();
const realLocation = window.location;
let href = "/inventory";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
  href = "/inventory";
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      pathname: "/inventory",
      assign,
      get href() {
        return href;
      },
      set href(v: string) {
        href = v;
      },
    },
  });
});

afterEach(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: realLocation,
  });
});

const fail = (status: number, data?: unknown) => ({
  config: { headers: {} },
  response: { status, data },
});

describe("apiClient and the session house", () => {
  it("sends a 403 HOUSE_REQUIRED to the chooser", async () => {
    await expect(
      h.handlers.onError!(fail(403, { code: "HOUSE_REQUIRED" })),
    ).rejects.toBeDefined();
    expect(assign).toHaveBeenCalledWith("/choose-house");
  });

  it("a 401 whose refresh says the house ended goes to the chooser, not to /login, and keeps the session", async () => {
    localStorage.setItem("refreshToken", "r");
    const noHouse = jwt({ sub: U, restaurantId: null });
    h.globalPost.mockResolvedValue({
      data: {
        accessToken: noHouse,
        refreshToken: "r2",
        houseAccessEnded: { restaurantId: A },
      },
    });

    await expect(
      h.handlers.onError!(fail(401, { code: "HOUSE_ACCESS_ENDED" })),
    ).rejects.toBeDefined();

    expect(assign).toHaveBeenCalledWith("/choose-house");
    expect(href).toBe("/inventory");
    expect(localStorage.getItem("accessToken")).toBe(noHouse);
    expect(sessionStorage.getItem(HOUSE_ENDED_KEY)).toBe(A);
  });

  it("a 401 whose refresh answers 503 keeps the session and stays on the page", async () => {
    localStorage.setItem("accessToken", "a");
    localStorage.setItem("refreshToken", "r");
    h.globalPost.mockRejectedValue({ response: { status: 503 } });

    await expect(h.handlers.onError!(fail(401))).rejects.toBeDefined();

    expect(localStorage.getItem("refreshToken")).toBe("r");
    expect(href).toBe("/inventory");
  });

  it("a 401 whose refresh token is refused signs out and says so, without reloading the page", async () => {
    localStorage.setItem("accessToken", "a");
    localStorage.setItem("refreshToken", "r");
    localStorage.setItem("activeRestaurantId", A);
    h.globalPost.mockRejectedValue({
      response: {
        status: 401,
        data: { code: "SESSION_ENDED", message: "Your password was changed. Sign in again." },
      },
    });
    const heard: string[] = [];
    const listen = (e: Event) => heard.push((e as CustomEvent).detail.message);
    window.addEventListener(SESSION_ENDED_EVENT, listen);

    await expect(h.handlers.onError!(fail(401))).rejects.toBeDefined();
    window.removeEventListener(SESSION_ENDED_EVENT, listen);

    expect(localStorage.getItem("refreshToken")).toBeNull();
    expect(localStorage.getItem("accessToken")).toBeNull();
    expect(localStorage.getItem("activeRestaurantId")).toBeNull();
    // The page stays: what was typed is still there.
    expect(href).toBe("/inventory");
    expect(assign).not.toHaveBeenCalled();
    expect(heard).toEqual(["Your password was changed. Sign in again."]);
  });

  it("a refused refresh with no reason of its own says the plain sentence", async () => {
    localStorage.setItem("refreshToken", "r");
    h.globalPost.mockRejectedValue({ response: { status: 401 } });
    const heard: string[] = [];
    const listen = (e: Event) => heard.push((e as CustomEvent).detail.message);
    window.addEventListener(SESSION_ENDED_EVENT, listen);

    await expect(h.handlers.onError!(fail(401))).rejects.toBeDefined();
    window.removeEventListener(SESSION_ENDED_EVENT, listen);

    expect(heard).toEqual([SESSION_ENDED_WORDS]);
    expect(href).toBe("/inventory");
  });
});

describe("apiClient refreshes through the one shared refresh (F-610)", () => {
  it("a 401 joins a refresh already in flight instead of starting a second one", async () => {
    localStorage.setItem("accessToken", "a");
    localStorage.setItem("refreshToken", "r");
    let answer!: (v: unknown) => void;
    h.globalPost.mockReturnValue(
      new Promise((ok) => {
        answer = ok;
      }),
    );
    h.instance.mockResolvedValue({ data: "retried" });
    const { doRefresh } = await import("../../lib/sessionRefresh");

    const elsewhere = doRefresh();
    const retried = h.handlers.onError!(fail(401));
    answer({ data: { accessToken: "a2", refreshToken: "r2" } });

    await expect(elsewhere).resolves.toBe("a2");
    await expect(retried).resolves.toEqual({ data: "retried" });
    expect(h.globalPost).toHaveBeenCalledTimes(1);
    expect(h.instance).toHaveBeenCalledWith(
      expect.objectContaining({ headers: { Authorization: "Bearer a2" } }),
    );
  });
});

describe("a role refusal asks the session to read its role again (F-930)", () => {
  it("a plain 403 asks; HOUSE_REQUIRED does not", async () => {
    const heard = vi.fn();
    window.addEventListener(ROLE_RECHECK_EVENT, heard);
    try {
      await h.handlers.onError!({
        response: { status: 403, data: { message: "Only owners can perform this action" } },
        config: { url: "/team/members/m1" },
      }).catch(() => {});
      expect(heard).toHaveBeenCalledTimes(1);
      await h.handlers.onError!({
        response: { status: 403, data: { code: "HOUSE_REQUIRED" } },
        config: { url: "/inventory" },
      }).catch(() => {});
      expect(heard).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(ROLE_RECHECK_EVENT, heard);
    }
  });
});
