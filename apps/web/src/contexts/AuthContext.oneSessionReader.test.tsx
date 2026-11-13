import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, waitFor } from "@testing-library/react";

/**
 * One reader of the session (r19, 2026-11-13).
 *
 * `/auth/me` was read twice on every page load: once by AuthProvider's boot
 * load and once by the auth store's own `loadUser`, which ran at import time.
 * AuthProvider is now the only reader and the store is its copy, so:
 *
 *  - a page load reads `/auth/me` once, and importing the store reads nothing;
 *  - the copy follows sign-in (password, Google, a passkey or e-mail-code
 *    session pair, a dev-bypass token stored after the store loaded) and
 *    sign-out;
 *  - a dead session at boot still takes ADR 0344's one reaction, which the
 *    store's load used to make.
 */

const h = vi.hoisted(() => {
  // A token is on the device before any module loads, as on a reload, so a
  // read made at import time would be counted below.
  localStorage.setItem("accessToken", "boot-token");
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
import { AUTH_STORAGE_KEY } from "../lib/deadSession";

const meReads = () =>
  h.instance.get.mock.calls.filter(([url]) => url === "/api/v1/auth/me").length;
const ME_READS_AT_IMPORT = meReads();

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function jwt(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o))
      .replace(/=+$/, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  return `${b64({ alg: "HS256" })}.${b64(claims)}.sig`;
}

const person = (userId: string) => ({
  userId,
  email: `${userId}@house.test`,
  name: userId,
  role: "owner",
  restaurantId: A,
  emailVerified: true,
});

function answerMeWith(userId: string) {
  h.instance.get.mockImplementation(async (url: string) =>
    url === "/api/v1/auth/me" ? { data: { user: person(userId) } } : { data: [] },
  );
}

function Probe({ onReady }: { onReady: (a: AuthContextType) => void }) {
  onReady(useAuth());
  return null;
}

async function mount() {
  let ctx: AuthContextType | null = null;
  render(
    <AuthProvider>
      <Probe onReady={(a) => (ctx = a)} />
    </AuthProvider>,
  );
  await waitFor(() => expect(ctx?.loading).toBe(false));
  return () => ctx as unknown as AuthContextType;
}

let href = "";
let pathname = "/inventory";
const reload = vi.fn();
const realLocation = window.location;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  h.instance.get.mockReset();
  h.instance.post.mockReset();
  h.globalPost.mockReset();
  reload.mockReset();
  useAuthStore.setState({ user: null, activeRestaurantId: null });
  href = "";
  pathname = "/inventory";
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      ...realLocation,
      get pathname() {
        return pathname;
      },
      get href() {
        return href;
      },
      set href(v: string) {
        href = v;
      },
      reload,
      assign: vi.fn(),
    },
  });
});

afterEach(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: realLocation,
  });
});

describe("one read of /auth/me per page load", () => {
  it("importing the auth store reads nothing, with a token already on the device", () => {
    expect(ME_READS_AT_IMPORT).toBe(0);
  });

  it("a load with a stored token reads /auth/me exactly once", async () => {
    localStorage.setItem("accessToken", jwt({ sub: "p1", restaurantId: A }));
    answerMeWith("p1");
    await mount();
    expect(meReads()).toBe(1);
  });
});

describe("the auth store follows AuthProvider's session", () => {
  it("a token stored after the store loaded (the dev bypass, a reload) reaches the store", async () => {
    localStorage.setItem("accessToken", jwt({ sub: "p1", restaurantId: A }));
    answerMeWith("p1");
    await mount();
    await waitFor(() => expect(useAuthStore.getState().user?.userId).toBe("p1"));
  });

  it("a password sign-in reaches the store", async () => {
    const auth = await mount();
    expect(useAuthStore.getState().user).toBeNull();
    h.instance.post.mockResolvedValue({
      data: { accessToken: jwt({ sub: "p2", restaurantId: A }), refreshToken: "r" },
    });
    answerMeWith("p2");
    await act(async () => {
      await auth().login("p2@house.test", "pw");
    });
    expect(useAuthStore.getState().user?.userId).toBe("p2");
  });

  it("a Google return reaches the store", async () => {
    const auth = await mount();
    h.instance.post.mockResolvedValue({
      data: { accessToken: jwt({ sub: "p3", restaurantId: A }), refreshToken: "r" },
    });
    answerMeWith("p3");
    await act(async () => {
      await auth().loginWithGoogle(jwt({ email: "p3@house.test" }));
    });
    expect(useAuthStore.getState().user?.userId).toBe("p3");
  });

  it("a passkey or e-mail-code session pair reaches the store", async () => {
    const auth = await mount();
    answerMeWith("p4");
    await act(async () => {
      await auth().signInWithSession({
        accessToken: jwt({ sub: "p4", restaurantId: A }),
        refreshToken: "r",
      });
    });
    expect(useAuthStore.getState().user?.userId).toBe("p4");
  });

  it("a sign-out leaves no one in the store for the next person", async () => {
    localStorage.setItem("accessToken", jwt({ sub: "p5", restaurantId: A }));
    answerMeWith("p5");
    const auth = await mount();
    await waitFor(() => expect(useAuthStore.getState().user?.userId).toBe("p5"));
    h.instance.post.mockResolvedValue({ data: {} });
    await act(async () => {
      await auth().logout();
    });
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().activeRestaurantId).toBeNull();
  });

  it("while the first load runs, the store keeps what it rehydrated", async () => {
    localStorage.setItem("accessToken", jwt({ sub: "p6", restaurantId: A }));
    useAuthStore.setState({ user: { ...person("p6"), role: "owner" } });
    let answer: (v: unknown) => void = () => {};
    h.instance.get.mockImplementation((url: string) =>
      url === "/api/v1/auth/me"
        ? new Promise((r) => (answer = r))
        : Promise.resolve({ data: [] }),
    );
    render(
      <AuthProvider>
        <span />
      </AuthProvider>,
    );
    await waitFor(() => expect(meReads()).toBe(1));
    expect(useAuthStore.getState().user?.userId).toBe("p6");
    await act(async () => answer({ data: { user: person("p6") } }));
  });
});

describe("a dead session at boot takes ADR 0344's one reaction", () => {
  const deadSession = () => {
    // The shared refresh already ran for this 401 and removed the refused
    // refresh token (see AuthContext.houses.test.tsx for why the catch sees
    // the state it left).
    localStorage.setItem("accessToken", "expired");
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ state: { user: person("gone") } }));
    h.instance.get.mockImplementation(async (url: string) =>
      url === "/api/v1/auth/me"
        ? Promise.reject({ response: { status: 401 } })
        : { data: [] },
    );
  };

  it.each(["/", "/story", "/register"])(
    "clears the session and the stored person, and reloads %s",
    async (page) => {
      pathname = page;
      href = page;
      deadSession();
      await mount();
      expect(localStorage.getItem("accessToken")).toBeNull();
      expect(useAuthStore.getState().user).toBeNull();
      expect(reload).toHaveBeenCalledTimes(1);
      expect(href).toBe(page);
    },
  );

  it("sends a private page to /login", async () => {
    pathname = "/inventory";
    deadSession();
    await mount();
    expect(href).toBe("/login");
    expect(reload).not.toHaveBeenCalled();
  });

  it("a session the shared refresh kept is not left (no reload, no /login)", async () => {
    localStorage.setItem("accessToken", "stale");
    localStorage.setItem("refreshToken", "kept");
    h.instance.get.mockImplementation(async (url: string) =>
      url === "/api/v1/auth/me"
        ? Promise.reject({ response: { status: 401 } })
        : { data: [] },
    );
    await mount();
    expect(reload).not.toHaveBeenCalled();
    expect(href).toBe("");
    expect(localStorage.getItem("refreshToken")).toBe("kept");
  });

  it("after the reload, a boot with no token asks nothing, so the reload cannot repeat", async () => {
    pathname = "/";
    await mount();
    expect(meReads()).toBe(0);
    expect(reload).not.toHaveBeenCalled();
  });
});
