import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * A stored session whose /auth/me read is refused for a reason that is not
 * authentication (a 429 above all) waits and asks again. It never lands on
 * /login and never loses its tokens (onboarding lane, 2026-11-11).
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
import { ProtectedRoute } from "../components/ProtectedRoute";

const U = "11111111-1111-4111-8111-111111111111";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function jwt(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${b64({ alg: "HS256" })}.${b64(claims)}.sig`;
}

const me = {
  data: {
    user: { userId: U, email: "p@house.test", restaurantId: A, role: "owner", emailVerified: true },
  },
};
const tooMany = (retryAfter?: string) => ({
  isAxiosError: true,
  response: { status: 429, headers: retryAfter ? { "retry-after": retryAfter } : {} },
});

let ctx: AuthContextType | null = null;
function Probe() {
  ctx = useAuth();
  return null;
}

function renderApp() {
  return render(
    <MemoryRouter initialEntries={["/inventory"]}>
      <AuthProvider>
        <Probe />
        <Routes>
          <Route path="/login" element={<p>the login page</p>} />
          <Route
            path="/inventory"
            element={
              <ProtectedRoute>
                <p>the inventory page</p>
              </ProtectedRoute>
            }
          />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  ctx = null;
  localStorage.setItem("accessToken", jwt({ sub: U, restaurantId: A }));
  localStorage.setItem("refreshToken", "refresh-1");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a busy gateway keeps the session", () => {
  it("a 429 waits Retry-After, says so, asks again and opens the page; /login is never shown", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let calls = 0;
    h.instance.get.mockImplementation(async (url: string) => {
      if (url !== "/api/v1/auth/me") return { data: [] };
      calls += 1;
      if (calls === 1) throw tooMany("5");
      return me;
    });

    renderApp();

    expect(await screen.findByText("Mudavym is busy for a moment.")).toBeInTheDocument();
    expect(screen.getByText(/You are still signed in/)).toBeInTheDocument();
    expect(screen.queryByText("the login page")).toBeNull();
    expect(ctx?.loading).toBe(true);
    expect(ctx?.sessionWait?.reason).toBe("busy");
    expect(localStorage.getItem("refreshToken")).toBe("refresh-1");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(await screen.findByText("the inventory page")).toBeInTheDocument();
    expect(calls).toBe(2);
    expect(ctx?.sessionWait).toBeNull();
    expect(screen.queryByText("the login page")).toBeNull();
  });

  it("keeps asking through repeated 429s and 503s, and Try now asks at once", async () => {
    let calls = 0;
    h.instance.get.mockImplementation(async (url: string) => {
      if (url !== "/api/v1/auth/me") return { data: [] };
      calls += 1;
      if (calls === 1) throw tooMany("30");
      if (calls === 2) throw { isAxiosError: true, response: { status: 503 } };
      return me;
    });

    renderApp();

    await screen.findByText("Mudavym is busy for a moment.");
    act(() => screen.getByRole("button", { name: "Try now" }).click());
    await screen.findByText("Mudavym is not answering right now.");
    act(() => screen.getByRole("button", { name: "Try now" }).click());
    expect(await screen.findByText("the inventory page")).toBeInTheDocument();
    expect(calls).toBe(3);
    expect(screen.queryByText("the login page")).toBeNull();
  });

  it("a 401 the refresh could not recover still signs out (unchanged)", async () => {
    localStorage.removeItem("refreshToken");
    h.instance.get.mockImplementation(async (url: string) =>
      url === "/api/v1/auth/me" ? Promise.reject({ response: { status: 401 } }) : { data: [] },
    );

    renderApp();

    expect(await screen.findByText("the login page")).toBeInTheDocument();
    expect(localStorage.getItem("accessToken")).toBeNull();
  });

  it("Sign out leaves an endless wait for /login", async () => {
    h.instance.get.mockRejectedValue({ isAxiosError: true, response: { status: 503 } });
    h.instance.post.mockResolvedValue({ data: {} });
    renderApp();
    await screen.findByText("Mudavym is not answering right now.");
    await act(async () => screen.getByRole("button", { name: "Sign out" }).click());
    expect(await screen.findByText("the login page")).toBeInTheDocument();
    expect(localStorage.getItem("refreshToken")).toBeNull();
    expect(h.instance.get).toHaveBeenCalledTimes(1);
  });

  it("stops asking once the tokens were removed in another tab", async () => {
    let calls = 0;
    h.instance.get.mockImplementation(async (url: string) => {
      if (url !== "/api/v1/auth/me") return { data: [] };
      calls += 1;
      throw tooMany("30");
    });

    renderApp();
    await screen.findByText("Mudavym is busy for a moment.");
    localStorage.clear();
    act(() => screen.getByRole("button", { name: "Try now" }).click());

    expect(await screen.findByText("the login page")).toBeInTheDocument();
    await waitFor(() => expect(ctx?.loading).toBe(false));
    expect(calls).toBe(1);
  });
});
