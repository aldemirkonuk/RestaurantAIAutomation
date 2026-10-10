import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * F-212: signing out in one tab signs out every open tab. Tabs share
 * localStorage, not memory; another tab learns of the change only from the
 * `storage` event, which never fires in the tab that made it.
 */

const h = vi.hoisted(() => {
  const instance = {
    defaults: { headers: { common: {} as Record<string, string> } },
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  };
  return { instance };
});

vi.mock("axios", () => ({
  default: { create: () => h.instance, post: vi.fn() },
  create: () => h.instance,
  post: vi.fn(),
}));

import { AuthProvider, useAuth, type AuthContextType } from "./AuthContext";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const H1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

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

/** What another tab's write looks like to this one. */
function otherTabWrites(key: string | null, oldValue: string | null, newValue: string | null) {
  if (key) {
    if (newValue === null) localStorage.removeItem(key);
    else localStorage.setItem(key, newValue);
  } else {
    localStorage.clear();
  }
  window.dispatchEvent(
    new StorageEvent("storage", { key, oldValue, newValue }),
  );
}

const reload = vi.fn();
let queryClient: QueryClient;

async function mountSignedIn() {
  const token = jwt({ sub: U1, restaurantId: H1 });
  localStorage.setItem("accessToken", token);
  localStorage.setItem("refreshToken", "r");
  h.instance.get.mockImplementation(async (url: string) =>
    url === "/api/v1/auth/me"
      ? {
          data: {
            user: { userId: U1, email: "o@house.test", restaurantId: H1, role: "owner", emailVerified: true },
          },
        }
      : { data: [{ id: H1, name: "Moda" }] },
  );
  queryClient = new QueryClient();
  queryClient.setQueryData(["reports", H1], { takings: 4200 });
  let ctx: AuthContextType | null = null;
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Probe onReady={(a) => (ctx = a)} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(ctx?.user?.userId).toBe(U1));
  return { token, ctx: () => ctx! };
}

describe("F-212 — sign-out follows every tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.stubGlobal("location", { ...window.location, reload });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("another tab signing out clears this tab's person and house reads", async () => {
    const { token, ctx } = await mountSignedIn();
    act(() => {
      localStorage.removeItem("refreshToken");
      otherTabWrites("accessToken", token, null);
    });
    await waitFor(() => expect(ctx().user).toBeNull());
    expect(ctx().isAuthenticated).toBe(false);
    expect(queryClient.getQueryData(["reports", H1])).toBeUndefined();
    expect(reload).not.toHaveBeenCalled();
  });

  it("a full clear in another tab signs this tab out too", async () => {
    const { ctx } = await mountSignedIn();
    act(() => otherTabWrites(null, null, null));
    await waitFor(() => expect(ctx().user).toBeNull());
  });

  it("someone else signing in from another tab starts this tab over", async () => {
    const { token } = await mountSignedIn();
    act(() =>
      otherTabWrites("accessToken", token, jwt({ sub: U2, restaurantId: H1 })),
    );
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("a refresh of the same person's token in another tab changes nothing", async () => {
    const { token, ctx } = await mountSignedIn();
    act(() =>
      otherTabWrites("accessToken", token, jwt({ sub: U1, restaurantId: H1, iat: 2 })),
    );
    act(() => otherTabWrites("activeRestaurantId", null, H1));
    expect(reload).not.toHaveBeenCalled();
    expect(ctx().user?.userId).toBe(U1);
    expect(queryClient.getQueryData(["reports", H1])).toEqual({ takings: 4200 });
  });
});
