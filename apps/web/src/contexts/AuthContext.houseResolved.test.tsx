import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, act } from "@testing-library/react";

/**
 * `houseResolved` - false from boot until the session's houses have been read.
 * A page that reads `activeRestaurantId === null` before this is true would
 * say "no restaurant is active" about a house that simply has not loaded yet.
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

const U = "11111111-1111-4111-8111-111111111111";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function jwt(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${b64({ alg: "HS256" })}.${b64(claims)}.sig`;
}

let seen: AuthContextType[] = [];
function Probe() {
  seen.push(useAuth());
  return null;
}
const last = () => seen[seen.length - 1];

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
  seen = [];
});

describe("houseResolved", () => {
  it("is false while the branch read is in flight, then true once it has answered", async () => {
    localStorage.setItem("accessToken", jwt({ sub: U, restaurantId: A }));
    let release: (v: unknown) => void = () => {};
    const branches = new Promise((r) => (release = r));
    h.instance.get.mockImplementation((url: string) => {
      if (url.includes("/auth/me/role")) return Promise.resolve({ data: { role: "owner" } });
      if (url.includes("/auth/me"))
        return Promise.resolve({ data: { user: { id: U, email: "a@example.test", restaurantId: A } } });
      return branches;
    });

    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(last().loading).toBe(false));
    // The user is loaded, the houses are not: null here means "not read yet".
    expect(last().activeRestaurantId).toBeNull();
    expect(last().houseResolved).toBe(false);

    await act(async () => release({ data: [{ id: A, name: "H", city: null, chain_id: null, chain_name: null }] }));
    await waitFor(() => expect(last().houseResolved).toBe(true));
    expect(last().activeRestaurantId).toBe(A);
  });

  it("is true once the branch read has failed, so the page may then say the read failed", async () => {
    localStorage.setItem("accessToken", jwt({ sub: U, restaurantId: null }));
    h.instance.get.mockImplementation((url: string) => {
      if (url.includes("/auth/me") && !url.includes("role"))
        return Promise.resolve({ data: { user: { id: U, email: "a@example.test" } } });
      return Promise.reject(new Error("offline"));
    });
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(last().houseResolved).toBe(true));
    expect(last().activeRestaurantId).toBeNull();
  });

  it("is true for a visitor with no session at all", async () => {
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(last().loading).toBe(false));
    expect(last().houseResolved).toBe(true);
  });
});
