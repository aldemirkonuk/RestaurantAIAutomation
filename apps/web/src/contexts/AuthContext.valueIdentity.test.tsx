/**
 * The session value a page reads through `useAuth()` changes identity only when
 * the session changes (r41 onboarding gap 10). The provider re-renders whenever
 * its own parent does; a new object each time made every consumer (the shell,
 * the rail, GetStarted) draw again for nothing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { useState } from "react";
import { render, waitFor, act } from "@testing-library/react";

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


let renders = 0;
const Consumer = React.memo(function Consumer() {
  const auth = useAuth();
  renders += 1;
  return <p data-testid="who">{auth.loading ? "loading" : (auth.user?.email ?? "nobody")}</p>;
});

let poke: () => void = () => {};
function Parent() {
  const [, setN] = useState(0);
  poke = () => setN((n) => n + 1);
  return (
    <AuthProvider>
      <Consumer />
    </AuthProvider>
  );
}

describe("AuthContext - the value keeps its identity", () => {
  it("a parent drawing again does not draw a consumer again", async () => {
    roleRead = async () => ({ data: { role: "manager" } });
    renders = 0;
    const view = render(<Parent />);
    await waitFor(() => expect(view.getByTestId("who").textContent).toBe("a@example.com"));
    // Let the role read and the branch read settle before counting.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    const settled = renders;
    for (let i = 0; i < 3; i += 1) act(() => poke());
    expect(renders).toBe(settled);
  });

  it("a real change in the session still reaches the consumer", async () => {
    const d = deferred<{ data: unknown }>();
    roleRead = () => d.promise;
    renders = 0;
    const view = render(<Parent />);
    await waitFor(() => expect(view.getByTestId("who").textContent).toBe("a@example.com"));
    const before = renders;
    d.resolve({ data: { role: "staff" } });
    await waitFor(() => expect(renders).toBeGreaterThan(before));
  });
});
