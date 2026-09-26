import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, waitFor } from "@testing-library/react";

/**
 * AuthContext and the session's house (ADR 0164).
 *
 *  - A refresh that says the house ended stores the no-house session, forgets
 *    that house on this device, notes it for the chooser and sends the person
 *    there; it does not retry the request.
 *  - Only a refused refresh token (401) signs the person out; a 503 or a
 *    dropped connection keeps the session.
 *  - Sign-in sends this device's memory of the houses people used on it.
 *  - A refused switch stays in the current house: nothing is relabelled.
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
  doRefresh,
  type AuthContextType,
} from "./AuthContext";
import {
  HOUSE_ENDED_KEY,
  indexEmail,
  lastHouseFor,
  rememberHouse,
} from "../lib/houseMemory";

const U = "11111111-1111-4111-8111-111111111111";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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

describe("doRefresh (ADR 0164, R5)", () => {
  it("when the house ended: stores the no-house session, forgets the house, notes it, and opens the chooser", async () => {
    localStorage.setItem("refreshToken", "old-refresh");
    localStorage.setItem("activeRestaurantId", A);
    rememberHouse(U, A);
    const noHouse = jwt({ sub: U, restaurantId: null });
    h.globalPost.mockResolvedValue({
      data: {
        accessToken: noHouse,
        refreshToken: "new-refresh",
        houseAccessEnded: { restaurantId: A },
      },
    });

    await expect(doRefresh()).resolves.toBeNull();

    expect(localStorage.getItem("accessToken")).toBe(noHouse);
    expect(localStorage.getItem("refreshToken")).toBe("new-refresh");
    expect(localStorage.getItem("activeRestaurantId")).toBeNull();
    expect(lastHouseFor(U)).toBeNull();
    expect(sessionStorage.getItem(HOUSE_ENDED_KEY)).toBe(A);
    expect(assign).toHaveBeenCalledWith("/choose-house");
  });

  it("an ordinary refresh returns the new token and remembers its house", async () => {
    localStorage.setItem("refreshToken", "old-refresh");
    const inB = jwt({ sub: U, restaurantId: B });
    h.globalPost.mockResolvedValue({
      data: { accessToken: inB, refreshToken: "r2" },
    });

    await expect(doRefresh()).resolves.toBe(inB);
    expect(lastHouseFor(U)?.houseId).toBe(B);
    expect(assign).not.toHaveBeenCalled();
  });

  it("keeps the session when the refresh answers 503", async () => {
    localStorage.setItem("accessToken", "a");
    localStorage.setItem("refreshToken", "r");
    h.globalPost.mockRejectedValue({ response: { status: 503 } });

    await expect(doRefresh()).resolves.toBeNull();
    expect(localStorage.getItem("accessToken")).toBe("a");
    expect(localStorage.getItem("refreshToken")).toBe("r");
  });

  it("signs out when the refresh token itself is refused (401)", async () => {
    localStorage.setItem("accessToken", "a");
    localStorage.setItem("refreshToken", "r");
    h.globalPost.mockRejectedValue({ response: { status: 401 } });

    await expect(doRefresh()).resolves.toBeNull();
    expect(localStorage.getItem("accessToken")).toBeNull();
    expect(localStorage.getItem("refreshToken")).toBeNull();
  });
});

describe("loadUser on mount (ADR 0164, item 2/3, round 2) — a 401 does not undo what the shared refresh already decided", () => {
  // This mock axios instance's `interceptors.response.use` is a bare
  // `vi.fn()` (see `h` above) — it never actually runs, so `get()` rejecting
  // here is exactly what reaches `loadUser`'s own catch AFTER the real
  // interceptor (registered on this same instance in production) has
  // already awaited `doRefresh()` for this exact 401 and settled localStorage
  // accordingly. This isolates the catch block's own decision, independent
  // of how the 401 arrived.
  it("keeps the session when the shared refresh already kept it (houseAccessEnded, or a transient 503 while refreshing)", async () => {
    localStorage.setItem("accessToken", "stale-access-token");
    localStorage.setItem("refreshToken", "kept-by-doRefresh");
    h.instance.get.mockImplementation(async (url: string) =>
      url === "/api/v1/auth/me"
        ? Promise.reject({ response: { status: 401 } })
        : { data: [] },
    );

    await mount();

    expect(localStorage.getItem("refreshToken")).toBe("kept-by-doRefresh");
    expect(localStorage.getItem("accessToken")).toBe("stale-access-token");
  });

  it("signs out when the session was genuinely ended (no refresh token survived the shared refresh)", async () => {
    localStorage.setItem("accessToken", "stale-access-token");
    // No refreshToken: either there never was one, or `doRefresh` already
    // removed it because IT was the one that was refused.
    h.instance.get.mockImplementation(async (url: string) =>
      url === "/api/v1/auth/me"
        ? Promise.reject({ response: { status: 401 } })
        : { data: [] },
    );

    await mount();

    expect(localStorage.getItem("accessToken")).toBeNull();
    expect(localStorage.getItem("refreshToken")).toBeNull();
  });
});

function Probe({ onReady }: { onReady: (a: AuthContextType) => void }) {
  onReady(useAuth());
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

describe("sign-in and switching (ADR 0164, R1, R3, R6)", () => {
  it("sends this device's house memory with the sign-in, and a session in no house has no house", async () => {
    // The device only knows to associate this email with U once it has seen
    // that pairing before (item 8, 2026-09-19) — normally written by
    // `storeSession` decoding the token's own email claim; done directly
    // here since this test drives `rememberHouse` on its own.
    indexEmail("p@house.test", U);
    rememberHouse(U, A, 1234);
    const noHouse = jwt({ sub: U, restaurantId: null });
    h.instance.post.mockResolvedValue({
      data: {
        accessToken: noHouse,
        refreshToken: "r",
        chooseHouse: { houses: [] },
      },
    });
    h.instance.get.mockImplementation(async (url: string) =>
      url === "/api/v1/auth/me"
        ? {
            data: {
              user: {
                userId: U,
                email: "p@house.test",
                restaurantId: null,
                role: null,
                emailVerified: true,
              },
            },
          }
        : { data: [] },
    );
    const auth = await mount();

    await act(async () => {
      await auth().login("p@house.test", "pw");
    });

    expect(h.instance.post).toHaveBeenCalledWith("/api/v1/auth/login", {
      email: "p@house.test",
      password: "pw",
      lastHouses: [{ userId: U, houseId: A, usedAt: 1234 }],
    });
    expect(auth().user).toMatchObject({ restaurantId: "", role: null });
    expect(localStorage.getItem("activeRestaurantId")).toBeNull();
  });

  it("a refused switch returns false and changes nothing", async () => {
    const inA = jwt({ sub: U, restaurantId: A });
    localStorage.setItem("accessToken", inA);
    h.instance.get.mockImplementation(async (url: string) =>
      url === "/api/v1/auth/me"
        ? {
            data: {
              user: {
                userId: U,
                email: "p@house.test",
                restaurantId: A,
                role: "owner",
                emailVerified: true,
              },
            },
          }
        : {
            data: [
              { id: A, name: "Moda" },
              { id: B, name: "Kadikoy" },
            ],
          },
    );
    const auth = await mount();
    await waitFor(() => expect(auth().activeRestaurantId).toBe(A));

    h.instance.post.mockRejectedValue({ response: { status: 403 } });
    let ok: boolean | undefined;
    await act(async () => {
      ok = await auth().setActiveRestaurantId(B);
    });

    expect(ok).toBe(false);
    expect(auth().activeRestaurantId).toBe(A);
    expect(localStorage.getItem("activeRestaurantId")).toBe(A);
    expect(localStorage.getItem("accessToken")).toBe(inA);
  });

  it("a switch the server grants moves the session, and the role is the one in that house", async () => {
    localStorage.setItem("accessToken", jwt({ sub: U, restaurantId: A }));
    let meRole = "owner";
    let meHouse = A;
    h.instance.get.mockImplementation(async (url: string) =>
      url === "/api/v1/auth/me"
        ? {
            data: {
              user: {
                userId: U,
                email: "p@house.test",
                restaurantId: meHouse,
                role: meRole,
                emailVerified: true,
              },
            },
          }
        : {
            data: [
              { id: A, name: "Moda" },
              { id: B, name: "Kadikoy" },
            ],
          },
    );
    const auth = await mount();
    await waitFor(() => expect(auth().activeRestaurantId).toBe(A));

    const inB = jwt({ sub: U, restaurantId: B });
    h.instance.post.mockResolvedValue({
      data: { accessToken: inB, refreshToken: "r", restaurantId: B },
    });
    meRole = "staff";
    meHouse = B;
    let ok: boolean | undefined;
    await act(async () => {
      ok = await auth().setActiveRestaurantId(B);
    });

    expect(ok).toBe(true);
    await waitFor(() => expect(auth().activeRestaurantId).toBe(B));
    expect(auth().user).toMatchObject({ restaurantId: B, role: "staff" });
    expect(lastHouseFor(U)?.houseId).toBe(B);
  });
});
