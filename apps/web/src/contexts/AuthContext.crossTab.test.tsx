import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
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
const H2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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
      : url === "/api/v1/auth/me/role"
        ? { data: { role: "owner" } }
        : { data: [{ id: H1, name: "Moda" }, { id: H2, name: "Harbor" }] },
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

  it("another tab signing out drops this house's role and any move it made first", async () => {
    const { token, ctx } = await mountSignedIn();
    await waitFor(() => expect(ctx().activeRole).toBe("owner"));
    // The other tab moved to another house, then signed out there.
    act(() => otherTabWrites("activeRestaurantId", H1, H2));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    act(() => otherTabWrites("accessToken", token, null));
    await waitFor(() => expect(ctx().user).toBeNull());
    expect(ctx().activeRole).toBeNull();
    expect(screen.queryByRole("alertdialog")).toBeNull();
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

  it("after this tab's session ended, someone else signing in from another tab starts this tab over (F-1141)", async () => {
    await mountSignedIn();
    // This tab's refresh was refused: it removed the tokens itself, which
    // fires no event here, and kept the person on screen.
    act(() => {
      localStorage.removeItem("accessToken");
      localStorage.removeItem("refreshToken");
    });
    act(() =>
      otherTabWrites("accessToken", null, jwt({ sub: U2, restaurantId: H1 })),
    );
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("after this tab's session ended, the same person signing in from another tab keeps this page", async () => {
    const { ctx } = await mountSignedIn();
    act(() => {
      localStorage.removeItem("accessToken");
      localStorage.removeItem("refreshToken");
    });
    act(() =>
      otherTabWrites("accessToken", null, jwt({ sub: U1, restaurantId: H1, iat: 3 })),
    );
    expect(reload).not.toHaveBeenCalled();
    expect(ctx().user?.userId).toBe(U1);
  });

  it("forgetting an ended session clears this tab's person and reads without signing out", async () => {
    const { ctx } = await mountSignedIn();
    act(() => ctx().forgetEndedSession?.());
    await waitFor(() => expect(ctx().user).toBeNull());
    expect(queryClient.getQueryData(["reports", H1])).toBeUndefined();
    expect(h.instance.post).not.toHaveBeenCalledWith(
      expect.stringContaining("/auth/logout"),
      expect.anything(),
    );
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
