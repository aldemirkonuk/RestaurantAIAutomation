import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The auth store is a copy of the session that AuthProvider writes
 * (contexts/AuthContext.tsx). It used to run its own `loadUser` at import
 * time, which read `/auth/me` a second time on every page load (r18,
 * 2026-11-13). The boot read, the refresh rules and the dead-session reaction
 * it carried are tested where they now live: `AuthContext.oneSessionReader`,
 * `AuthContext.houses` and `deadSession`.
 */

const net = vi.hoisted(() => ({ create: vi.fn(), get: vi.fn(), post: vi.fn() }));
vi.mock("axios", () => ({
  default: { create: net.create, get: net.get, post: net.post },
  create: net.create,
  get: net.get,
  post: net.post,
}));
const fetchSpy = vi.hoisted(() => {
  // A token is on the device before the store loads, as on a reload.
  localStorage.setItem("accessToken", "boot-token");
  return vi.fn();
});
vi.stubGlobal("fetch", fetchSpy);

import { useAuthStore } from "./authStore";
import { AUTH_STORAGE_KEY } from "../lib/deadSession";

const HOUSE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PERSON = {
  userId: "u1",
  email: "a@b.com",
  name: "A",
  role: "owner" as const,
  restaurantId: HOUSE,
};

beforeEach(() => {
  localStorage.clear();
  useAuthStore.setState({ user: null, activeRestaurantId: null });
});

describe("the auth store does no network work of its own", () => {
  it("importing it with a stored token asks nothing", () => {
    // The module above was imported once; a boot read would have fired then.
    expect(net.get).not.toHaveBeenCalled();
    expect(net.post).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect("loadUser" in useAuthStore.getState()).toBe(false);
  });
});

describe("followSession", () => {
  it("takes the signed-in person's ids, and only those fields", () => {
    useAuthStore.getState().followSession({
      ...PERSON,
      // AuthContext's person carries more; the copy keeps what readers use.
      ...({ emailVerified: true, studioRoles: [] } as object),
    });
    expect(useAuthStore.getState().user).toEqual(PERSON);
  });

  it("a sign-out leaves nothing of the last person, not even the house", () => {
    useAuthStore.getState().followSession(PERSON);
    useAuthStore.getState().setActiveRestaurantId(HOUSE);
    useAuthStore.getState().followSession(null);
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().activeRestaurantId).toBeNull();
    const persisted = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) ?? "{}");
    expect(persisted.state?.user ?? null).toBeNull();
    expect(persisted.state?.activeRestaurantId ?? null).toBeNull();
  });
});

describe("setActiveRestaurantId", () => {
  it("takes a house id and remembers it", () => {
    useAuthStore.getState().setActiveRestaurantId(HOUSE);
    expect(useAuthStore.getState().activeRestaurantId).toBe(HOUSE);
    expect(localStorage.getItem("activeRestaurantId")).toBe(HOUSE);
  });

  it("ignores anything that is not a house id", () => {
    useAuthStore.getState().setActiveRestaurantId("house-A");
    expect(useAuthStore.getState().activeRestaurantId).toBeNull();
    expect(localStorage.getItem("activeRestaurantId")).toBeNull();
  });
});

it("persists under the key the dead-session reaction clears", () => {
  expect(useAuthStore.persist.getOptions().name).toBe(AUTH_STORAGE_KEY);
});
