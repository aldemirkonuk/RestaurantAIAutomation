import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * The shared API client and the session's house (ADR 0164): a 403
 * HOUSE_REQUIRED sends the person to the chooser; a refresh that says the house
 * ended does too, and does not sign them out; only a refused refresh token
 * (401) sends them to /login.
 */

const h = vi.hoisted(() => {
  const handlers: {
    onError?: (e: unknown) => Promise<unknown>;
    onRequest?: (c: any) => any;
  } = {};
  const instance: any = vi.fn();
  instance.interceptors = {
    request: {
      use: vi.fn((onRequest: (c: any) => any) => {
        handlers.onRequest = onRequest;
      }),
    },
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
let pathname = "/inventory";
let sets: string[] = [];

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
  href = "/inventory";
  pathname = "/inventory";
  sets = [];
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      get pathname() {
        return pathname;
      },
      assign,
      get href() {
        return href;
      },
      set href(v: string) {
        href = v;
        sets.push(v);
      },
      search: "",
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

  it("a 401 whose refresh token is refused signs out to /login", async () => {
    localStorage.setItem("accessToken", "a");
    localStorage.setItem("refreshToken", "r");
    h.globalPost.mockRejectedValue({ response: { status: 401 } });

    await expect(h.handlers.onError!(fail(401))).rejects.toBeDefined();

    expect(localStorage.getItem("refreshToken")).toBeNull();
    expect(href).toBe("/login");
  });

  const deadSession = () => {
    localStorage.setItem("accessToken", "a");
    localStorage.setItem("refreshToken", "r");
    h.globalPost.mockRejectedValue({ response: { status: 401 } });
  };
  const sentFrom = (path: string) => ({ ...fail(401), config: { headers: {}, _sentFrom: path } });

  it.each(["/", "/story", "/register", "/register/"])(
    "a refused refresh token on the public page %s ends the session and reloads that page",
    async (page) => {
      pathname = page;
      href = page;
      deadSession();

      await expect(h.handlers.onError!(sentFrom(page))).rejects.toBeDefined();

      expect(localStorage.getItem("accessToken")).toBeNull();
      expect(localStorage.getItem("refreshToken")).toBeNull();
      // A reload, not a stay: the app boots with no session, so `/` draws the
      // landing rather than a dashboard still holding the old person.
      expect(sets).toEqual([page]);
    },
  );

  it("a request sent from a private page goes to /login even if the person has since moved to /", async () => {
    pathname = "/";
    href = "/";
    deadSession();

    await expect(h.handlers.onError!(sentFrom("/inventory"))).rejects.toBeDefined();

    expect(sets).toEqual(["/login"]);
  });

  it("a request sent from / goes to /login if the person has since moved to a private page", async () => {
    pathname = "/inventory";
    href = "/inventory";
    deadSession();

    await expect(h.handlers.onError!(sentFrom("/"))).rejects.toBeDefined();

    expect(sets).toEqual(["/login"]);
  });

  it("stamps each request with the page it was sent from", () => {
    pathname = "/story";
    const config = h.handlers.onRequest!({ headers: {} });
    expect(config._sentFrom).toBe("/story");
  });
});
