/**
 * Where the role read stands (`activeRoleState`). `activeRole` is null while
 * `/auth/me/role` is in flight and also when it failed or named no role; a page
 * that must tell "still asking" from "not told" (the reports registers) reads
 * the state beside it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const mockApi = vi.hoisted(() => ({
  post: vi.fn(),
  get: vi.fn(),
  defaults: { headers: { common: {} as Record<string, string> } },
  interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
}));

vi.mock("axios", () => ({
  default: {
    create: vi.fn(() => mockApi),
    post: vi.fn(),
    isAxiosError: vi.fn(() => false),
  },
}));
vi.mock("../lib/error-tracking", () => ({
  errorTracking: { setUser: vi.fn() },
}));

import { AuthProvider, useAuth } from "./AuthContext";

const HOUSE = "11111111-1111-4111-8111-111111111111";
const USER = "33333333-3333-4333-8333-333333333333";

function jwt(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${b64({ alg: "HS256" })}.${b64(claims)}.sig`;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let roleRead: () => Promise<{ data: unknown }>;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("accessToken", jwt({ sub: USER, restaurantId: HOUSE }));
  localStorage.setItem("activeRestaurantId", HOUSE);
  mockApi.post.mockReset();
  mockApi.get.mockReset();
  mockApi.get.mockImplementation(async (url: string) => {
    if (url === "/api/v1/auth/me")
      return {
        data: {
          user: { id: USER, email: "a@example.com", role: "manager", restaurantId: HOUSE },
        },
      };
    if (url === "/api/v1/auth/me/role") return roleRead();
    return { data: [] };
  });
});

afterEach(() => {
  localStorage.clear();
});

describe("AuthContext — activeRoleState", () => {
  it("is loading while the role read is in flight, then known with the role", async () => {
    const d = deferred<{ data: unknown }>();
    roleRead = () => d.promise;
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() =>
      expect(mockApi.get.mock.calls.map((c) => c[0])).toContain("/api/v1/auth/me/role"),
    );
    expect(result.current.activeRole).toBeNull();
    expect(result.current.activeRoleState).toBe("loading");

    d.resolve({ data: { role: "staff" } });
    await waitFor(() => expect(result.current.activeRoleState).toBe("known"));
    expect(result.current.activeRole).toBe("staff");
  });

  it("is unknown when the role read fails", async () => {
    const d = deferred<{ data: unknown }>();
    roleRead = () => d.promise;
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() =>
      expect(mockApi.get.mock.calls.map((c) => c[0])).toContain("/api/v1/auth/me/role"),
    );
    d.reject(new Error("network down"));
    await waitFor(() => expect(result.current.activeRoleState).toBe("unknown"));
    expect(result.current.activeRole).toBeNull();
  });

  it("is unknown when the read names no valid role", async () => {
    roleRead = async () => ({ data: { role: "janitor" } });
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.activeRoleState).toBe("unknown"));
    expect(result.current.activeRole).toBeNull();
  });

  it("is unknown with nobody signed in", async () => {
    localStorage.clear();
    roleRead = async () => ({ data: { role: "owner" } });
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.activeRoleState).toBe("unknown");
  });
});
