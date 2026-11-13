import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, waitFor } from "@testing-library/react";

/**
 * The known-device token for the login rate limit (QA round 19, #906): kept
 * after a login, sent back for the same email only, and kept across logout
 * (it is a device credential for rate limiting, never a session).
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

import {
  AuthProvider,
  useAuth,
  type AuthContextType,
} from "./AuthContext";

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

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...realLocation, pathname: "/inventory", assign },
  });
});

afterEach(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: realLocation,
  });
});


function Probe({ onReady }: { onReady: (a: AuthContextType) => void }) {
  const auth = useAuth();
  onReady(auth);
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

const KEY = "mudavym.signInDevices";

function answerLogin(token: string | undefined) {
  h.instance.post.mockImplementation(async (url: string) =>
    url === "/api/v1/auth/login"
      ? {
          data: {
            accessToken: jwt({ sub: U, restaurantId: A }),
            refreshToken: "r",
            ...(token ? { signInDevice: token } : {}),
          },
        }
      : { data: {} },
  );
  h.instance.get.mockImplementation(async (url: string) =>
    url === "/api/v1/auth/me"
      ? {
          data: {
            user: {
              userId: U,
              email: "owner@x.com",
              restaurantId: A,
              role: "owner",
              emailVerified: true,
            },
          },
        }
      : { data: [] },
  );
}

const loginCalls = () =>
  h.instance.post.mock.calls.filter((c) => c[0] === "/api/v1/auth/login");

describe("sign-in device token", () => {
  it("is stored after login, sent next time for the same email only, and survives logout", async () => {
    answerLogin("tok-owner");
    const auth = await mount();

    await act(async () => {
      await auth().login(" Owner@X.com", "pw");
    });
    expect(loginCalls()[0][1]).not.toHaveProperty("signInDevice");
    expect(JSON.parse(localStorage.getItem(KEY) as string)).toEqual({
      "owner@x.com": "tok-owner",
    });

    await act(async () => {
      await auth().login("owner@x.com", "pw");
    });
    expect(loginCalls()[1][1]).toMatchObject({ signInDevice: "tok-owner" });

    await act(async () => {
      await auth().login("other@x.com", "pw");
    });
    expect(loginCalls()[2][1]).not.toHaveProperty("signInDevice");

    await act(async () => {
      await auth().logout();
    });
    expect(JSON.parse(localStorage.getItem(KEY) as string)).toMatchObject({
      "owner@x.com": "tok-owner",
    });
  });

  it("keeps the newest five", async () => {
    answerLogin("t");
    const auth = await mount();
    for (let i = 0; i < 7; i++) {
      await act(async () => {
        await auth().login(`u${i}@x.com`, "pw");
      });
    }
    expect(Object.keys(JSON.parse(localStorage.getItem(KEY) as string))).toEqual(
      ["u2", "u3", "u4", "u5", "u6"].map((u) => `${u}@x.com`),
    );
  });
});
