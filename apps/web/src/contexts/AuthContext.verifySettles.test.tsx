import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, waitFor } from "@testing-library/react";

/**
 * r104 (DD-r102-4 step 2): after the code or link verifies, `signInWithSession`
 * resolves only once `/auth/me` has put the now-verified person in context, so
 * the page that follows (/get-started) reads `emailVerified: true` with no
 * page load. The old tree waited 1.5 s and reloaded.
 */

const h = vi.hoisted(() => {
  const instance = {
    defaults: { headers: { common: {} as Record<string, string> } },
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
    get: vi.fn(),
    post: vi.fn(),
  };
  const isAxiosError = (e: unknown) =>
    Boolean((e as { isAxiosError?: boolean } | null)?.isAxiosError);
  return { instance, globalPost: vi.fn(), isAxiosError };
});

vi.mock("axios", () => ({
  default: {
    create: () => h.instance,
    post: h.globalPost,
    isAxiosError: h.isAxiosError,
  },
  create: () => h.instance,
  post: h.globalPost,
  isAxiosError: h.isAxiosError,
}));

import { AuthProvider, useAuth, type AuthContextType } from "./AuthContext";

const U = "11111111-1111-4111-8111-111111111111";

function jwt(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o))
      .replace(/=+$/, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  return `${b64({ alg: "HS256" })}.${b64(claims)}.sig`;
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


const ME = "/api/v1/auth/me";
const person = (emailVerified: boolean) => ({
  data: {
    user: {
      userId: U,
      email: "new@house.test",
      restaurantId: null,
      role: null,
      emailVerified,
    },
  },
});

describe("signInWithSession settles the verified person in place (r104)", () => {
  const realLocation = window.location;
  const reload = vi.fn();
  const assign = vi.fn();
  const replace = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.clearAllMocks();
    // jsdom cannot spy on location's own methods; swap in a stand-in.
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        href: realLocation.href,
        origin: realLocation.origin,
        pathname: realLocation.pathname,
        search: realLocation.search,
        hash: realLocation.hash,
        reload,
        assign,
        replace,
      },
    });
  });
  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: realLocation,
    });
  });

  it("an unverified person turns verified only after /auth/me answers, with no reload", async () => {
    // The tab already holds a session: the mount read says unverified.
    localStorage.setItem("accessToken", jwt({ sub: U, restaurantId: null }));
    localStorage.setItem("refreshToken", "r0");
    let answerSecondRead!: (v: ReturnType<typeof person>) => void;
    let meReads = 0;
    h.instance.get.mockImplementation((url: string) => {
      if (url !== ME) return Promise.resolve({ data: [] });
      meReads += 1;
      return meReads === 1
        ? Promise.resolve(person(false))
        : new Promise((resolve) => (answerSecondRead = resolve));
    });
    const auth = await mount();
    expect(auth().user?.emailVerified).toBe(false);

    let settled = false;
    let pending!: Promise<void>;
    await act(async () => {
      pending = auth()
        .signInWithSession({
          accessToken: jwt({ sub: U, restaurantId: null }),
          refreshToken: "r",
        })
        .then(() => {
          settled = true;
        });
      // Let every already-resolved promise run: only the open /auth/me read
      // can still hold the call back.
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });
    expect(meReads).toBe(2);
    expect(settled).toBe(false);
    expect(auth().user?.emailVerified).toBe(false);

    await act(async () => {
      answerSecondRead(person(true));
      await pending;
    });
    expect(settled).toBe(true);
    expect(auth().user?.emailVerified).toBe(true);
    expect(localStorage.getItem("refreshToken")).toBe("r");
    expect(reload).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});
