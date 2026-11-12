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

async function bootPage() {
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
  await waitFor(() => expect(loading).toBe(false));
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

  it("an expired token: one refresh, and the read under the new token is shared (2 reads, not 6)", async () => {
    const OLD = jwt({ userId: U, restaurantId: A, v: "old" });
    const NEW = jwt({ userId: U, restaurantId: A, v: "new" });
    localStorage.setItem("accessToken", OLD);
    localStorage.setItem("refreshToken", "r");
    h.globalPost.mockImplementation(async (url: string) =>
      url.endsWith("/api/v1/auth/refresh")
        ? { data: { accessToken: NEW, refreshToken: "r2" } }
        : { data: {} },
    );
    h.instance.get.mockImplementation(
      async (
        url: string,
        config?: { headers?: Record<string, string> },
      ) => {
        if (url !== "/api/v1/auth/me") return { data: [] };
        // authStore names its token; AuthContext's interceptor stamps the
        // stored one (mocked away here, so read it the same way).
        const sent =
          config?.headers?.Authorization?.replace("Bearer ", "") ??
          localStorage.getItem("accessToken");
        if (sent !== NEW) return Promise.reject({ response: { status: 401 } });
        return {
          data: {
            user: { userId: U, email: "owner@example.test", name: "Owner", role: "owner", restaurantId: A },
          },
        };
      },
    );

    const user = await bootPage();

    await waitFor(() => expect(user()?.userId).toBe(U));
    expect(meCalls()).toHaveLength(2);
    expect(
      h.globalPost.mock.calls.filter(([url]) =>
        String(url).endsWith("/api/v1/auth/refresh"),
      ),
    ).toHaveLength(1);
    expect(localStorage.getItem("accessToken")).toBe(NEW);
  });

  it("a 429 is not asked again by the second client; the session is kept", async () => {
    localStorage.setItem("accessToken", jwt({ userId: U, restaurantId: A }));
    localStorage.setItem("refreshToken", "r");
    h.instance.get.mockImplementation(async (url: string) =>
      url === "/api/v1/auth/me"
        ? Promise.reject({ response: { status: 429 } })
        : { data: [] },
    );

    await bootPage();

    expect(meCalls()).toHaveLength(1);
    expect(localStorage.getItem("refreshToken")).toBe("r");
  });
});
