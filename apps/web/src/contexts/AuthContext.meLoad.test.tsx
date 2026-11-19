import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * The page-load read of `/auth/me` (onboarding, r68).
 *  - One request per load, even though the auth store and AuthContext both
 *    read the signed-in person.
 *  - A 429 or a dropped connection never signs anyone out and never leaves
 *    the route: a calm line, one retry after Retry-After (else 3 s).
 *  - A 401 the refresh could not mend still ends the session.
 */

const h = vi.hoisted(() => {
  const instance = {
    defaults: { headers: { common: {} as Record<string, string> } },
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
    get: vi.fn(),
    post: vi.fn(),
  };
  return { instance };
});

vi.mock("axios", () => ({
  default: { create: () => h.instance, post: vi.fn(), isAxiosError: () => false },
  create: () => h.instance,
  post: vi.fn(),
  isAxiosError: () => false,
}));

import { AuthProvider } from "./AuthContext";
import { ProtectedRoute } from "../components/ProtectedRoute";
import { useAuthStore } from "../stores/authStore";
import { forgetSharedMeRead } from "../lib/authMe";

const U = "11111111-1111-4111-8111-111111111111";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const b64 = (o: unknown) =>
  btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const jwt = (claims: Record<string, unknown>) =>
  `${b64({ alg: "HS256" })}.${b64(claims)}.sig`;

const failure = (status?: number, headers: Record<string, string> = {}) =>
  Object.assign(new Error(status ? `status ${status}` : "Network Error"), {
    isAxiosError: true,
    ...(status ? { response: { status, data: {}, headers } } : {}),
  });
const person = {
  data: {
    user: { userId: U, email: "p@house.test", restaurantId: A, role: "owner", emailVerified: true },
    availableRestaurants: [A],
  },
};
const meCalls = () =>
  h.instance.get.mock.calls.filter(([url]) => url === "/api/v1/auth/me").length;

function Desk() {
  return <p>the desk</p>;
}
function mount() {
  return render(
    <MemoryRouter initialEntries={["/orders"]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<p>sign in page</p>} />
          <Route
            path="/orders"
            element={
              <ProtectedRoute>
                <Desk />
              </ProtectedRoute>
            }
          />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  vi.clearAllMocks();
  forgetSharedMeRead();
  localStorage.setItem("accessToken", jwt({ sub: U, restaurantId: A, role: "owner" }));
  localStorage.setItem("refreshToken", "r");
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("/auth/me on page load", () => {
  it("asks once when the auth store and AuthContext both read the person", async () => {
    h.instance.get.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(person), 50)),
    );
    const storeRead = useAuthStore.getState().loadUser();
    mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
      await storeRead;
    });
    expect(meCalls()).toBe(1);
    expect(screen.getByText("the desk")).toBeTruthy();
  });

  it("on a 429 keeps the route and the tokens, says so, and retries once after Retry-After", async () => {
    h.instance.get
      .mockRejectedValueOnce(failure(429, { "retry-after": "5" }))
      .mockResolvedValueOnce(person);
    mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(screen.getByRole("status").textContent).toMatch(/the house is busy; trying again in 5s/);
    expect(screen.queryByText("sign in page")).toBeNull();
    expect(localStorage.getItem("accessToken")).not.toBeNull();
    expect(localStorage.getItem("refreshToken")).toBe("r");
    expect(meCalls()).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(meCalls()).toBe(2);
    expect(screen.getByText("the desk")).toBeTruthy();
  });

  it("waits three seconds when the 429 names no Retry-After, and treats a dropped connection the same", async () => {
    h.instance.get.mockRejectedValueOnce(failure()).mockResolvedValueOnce(person);
    mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2900);
    });
    expect(meCalls()).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(meCalls()).toBe(2);
    expect(screen.getByText("the desk")).toBeTruthy();
  });

  it("after the one retry is also busy, stays put with a calm line and keeps the session", async () => {
    h.instance.get.mockRejectedValue(failure(429));
    mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(meCalls()).toBe(2);
    expect(screen.getByRole("status").textContent).toMatch(/still busy/);
    expect(screen.queryByText("sign in page")).toBeNull();
    expect(localStorage.getItem("accessToken")).not.toBeNull();
    expect(localStorage.getItem("refreshToken")).toBe("r");
  });

  it("a 401 after the refresh failed ends the session", async () => {
    localStorage.removeItem("refreshToken");
    h.instance.get.mockRejectedValue(failure(401));
    mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(localStorage.getItem("accessToken")).toBeNull();
    expect(screen.getByText("sign in page")).toBeTruthy();
    expect(meCalls()).toBe(1);
  });
});
