import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

/**
 * A page load asks `GET /auth/me` once.
 *
 * Measured on the local stack 2026-11-12: a full load asked it three times.
 * The zustand authStore asked when its module was imported, and AuthContext
 * asked on mount, twice under StrictMode. Production asked twice. Every
 * `/auth/` path was limited to 10 a minute per address, and every device in a
 * house shares one address. So the fourth load in a minute answered 429, and
 * the 429 sent the person to /login.
 *
 * Both boot clients run here as on a real load: the store boots on import and
 * the provider mounts under StrictMode. Both get the same mocked axios
 * instance, so every request either one makes is counted.
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

const meCalls = () =>
  h.instance.get.mock.calls.filter(([url]) => url === "/api/v1/auth/me");

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.resetModules();
});

async function bootPage({ timeout }: { timeout?: number } = {}) {
  // The store boots when it is first imported, as it does in main.tsx's graph.
  await import("../stores/authStore");
  const { AuthProvider, useAuth } = await import("./AuthContext");
  let user: unknown = undefined;
  let loading = true;
  function Probe() {
    const a = useAuth();
    user = a.user;
    loading = a.loading;
    return null;
  }
  render(
    <React.StrictMode>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </React.StrictMode>,
  );
  await waitFor(() => expect(loading).toBe(false), timeout ? { timeout } : undefined);
  return () => user as { userId?: string } | null;
}

describe("a page load asks /auth/me once", () => {
  it("both boot clients, under StrictMode, share one read and both get the person", async () => {
    localStorage.setItem("accessToken", jwt({ userId: U, restaurantId: A }));
    localStorage.setItem("refreshToken", "r");
    h.instance.get.mockImplementation(async (url: string) =>
      url === "/api/v1/auth/me"
        ? {
            data: {
              user: {
                userId: U,
                email: "owner@example.test",
                name: "Owner",
                role: "owner",
                restaurantId: A,
              },
            },
          }
        : { data: [] },
    );

    const user = await bootPage();
    const { useAuthStore } = await import("../stores/authStore");

    await waitFor(() => expect(user()?.userId).toBe(U));
    await waitFor(() =>
      expect(useAuthStore.getState().user?.userId).toBe(U),
    );
    expect(meCalls()).toHaveLength(1);
  });

  it("an expired token: one read by the provider, and the store neither reads nor refreshes on its own", async () => {
    // #1243 removed the store's own boot read, so the expired-token path is
    // the provider's alone: its axios interceptor (mocked away here) refreshes
    // and asks again. What this pins is that nothing else does: one /auth/me,
    // no refresh from outside the interceptor, and the session kept on disk.
    const OLD = jwt({ userId: U, restaurantId: A, v: "old" });
    localStorage.setItem("accessToken", OLD);
    localStorage.setItem("refreshToken", "r");
    h.instance.get.mockImplementation(async (url: string) =>
      url === "/api/v1/auth/me"
        ? Promise.reject({ response: { status: 401 } })
        : { data: [] },
    );

    await bootPage();

    expect(meCalls()).toHaveLength(1);
    expect(
      h.globalPost.mock.calls.filter(([url]) =>
        String(url).endsWith("/api/v1/auth/refresh"),
      ),
    ).toHaveLength(0);
    expect(localStorage.getItem("refreshToken")).toBe("r");
  });

  it("a 429 is not asked again by the second client; the session is kept and waits", async () => {
    localStorage.setItem("accessToken", jwt({ userId: U, restaurantId: A }));
    localStorage.setItem("refreshToken", "r");
    h.instance.get.mockImplementation(async (url: string) =>
      url === "/api/v1/auth/me"
        ? Promise.reject({ response: { status: 429 } })
        : { data: [] },
    );

    // #1092: a 429 no longer ends the load; the provider waits and asks again
    // (lib/sessionWait.ts). Before that first wait ends, the store's read and
    // both StrictMode mounts have made one request between them.
    await import("../stores/authStore");
    const { AuthProvider, useAuth } = await import("./AuthContext");
    let wait: { reason?: string } | null | undefined;
    let loading = false;
    function Probe() {
      const a = useAuth();
      wait = a.sessionWait;
      loading = a.loading;
      return null;
    }
    render(
      <React.StrictMode>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </React.StrictMode>,
    );
    await waitFor(() => expect(wait?.reason).toBe("busy"), { timeout: 900 });

    expect(meCalls()).toHaveLength(1);
    expect(loading).toBe(true);
    expect(localStorage.getItem("refreshToken")).toBe("r");
  });
  it("after the first wait, the next ask reaches the gateway instead of replaying the 429", async () => {
    localStorage.setItem("accessToken", jwt({ userId: U, restaurantId: A }));
    localStorage.setItem("refreshToken", "r");
    let busy = true;
    h.instance.get.mockImplementation(async (url: string) => {
      if (url !== "/api/v1/auth/me") return { data: [] };
      if (busy) {
        busy = false;
        return Promise.reject({ response: { status: 429 } });
      }
      return { data: { user: { userId: U, email: "o@x.test", role: "owner", restaurantId: A } } };
    });

    // The first wait is 1 s. A settled 429 shared for 5 s would make the asks
    // at 1 s and 3 s replays, and the person would wait about 7 s.
    const user = await bootPage({ timeout: 2500 });

    await waitFor(() => expect(user()?.userId).toBe(U));
    expect(meCalls()).toHaveLength(2);
  });
});
