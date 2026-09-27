import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  LAST_HOUSE_KEY,
  forgetHouse,
  indexEmail,
  lastHouseFor,
  lastHouseHintFor,
  noteHouseEnded,
  orderForChooser,
  readHouseEnded,
  rememberHouse,
  storeSession,
  tokenHouse,
} from "./houseMemory";

/**
 * The device's memory of the houses people used on it (ADR 0164, R3): per
 * person, the last house and when; sent as a hint at sign-in; kept across
 * sign-out; dropped when the server says the house is no longer theirs.
 */

const U = "11111111-1111-4111-8111-111111111111";
const V = "22222222-2222-4222-8222-222222222222";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** An unsigned JWT with these claims: the page never verifies, the server does. */
function jwt(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o))
      .replace(/=+$/, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  return `${b64({ alg: "HS256" })}.${b64(claims)}.sig`;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => vi.restoreAllMocks());

describe("houseMemory", () => {
  it("remembers the last house per person", () => {
    rememberHouse(U, A, 1000);
    rememberHouse(V, B, 2000);
    rememberHouse(U, B, 3000);

    expect(lastHouseFor(U)).toEqual({ houseId: B, usedAt: 3000 });
    expect(lastHouseFor(V)).toEqual({ houseId: B, usedAt: 2000 });
  });

  describe("lastHouseHintFor (item 8, 2026-09-19)", () => {
    it("sends only the entry for the email being signed in, never another account's", () => {
      indexEmail("Person@Example.com", U);
      rememberHouse(U, A, 1000);
      indexEmail("other@example.com", V);
      rememberHouse(V, B, 2000);

      // Case-insensitive, whitespace-trimmed — the same email typed
      // differently still finds this device's memory of it.
      expect(lastHouseHintFor(" person@example.com ")).toEqual({
        userId: U,
        houseId: A,
        usedAt: 1000,
      });
      expect(lastHouseHintFor("other@example.com")).toEqual({
        userId: V,
        houseId: B,
        usedAt: 2000,
      });
    });

    it("answers null for an email this device has never seen, and for none", () => {
      indexEmail("known@example.com", U);
      rememberHouse(U, A, 1000);

      expect(lastHouseHintFor("unknown@example.com")).toBeNull();
      expect(lastHouseHintFor(null)).toBeNull();
      expect(lastHouseHintFor(undefined)).toBeNull();
    });

    it("storeSession indexes the token's own email claim, so a later lookup by that email finds it", () => {
      storeSession(jwt({ sub: U, email: "person@example.com", restaurantId: A }));

      expect(lastHouseHintFor("person@example.com")).toEqual({
        userId: U,
        houseId: A,
        usedAt: expect.any(Number),
      });
      // A token with no email claim indexes nothing — no crash, no entry.
      expect(() =>
        storeSession(jwt({ sub: V, restaurantId: B })),
      ).not.toThrow();
      expect(lastHouseFor(V)?.houseId).toBe(B);
    });
  });

  it("stores a session and remembers the house its token names, and keeps activeRestaurantId to the token", () => {
    const house = storeSession(jwt({ sub: U, restaurantId: A }), "refresh-1");

    expect(house).toBe(A);
    expect(localStorage.getItem("activeRestaurantId")).toBe(A);
    expect(localStorage.getItem("refreshToken")).toBe("refresh-1");
    expect(lastHouseFor(U)?.houseId).toBe(A);
  });

  it("a session in no house clears activeRestaurantId and remembers nothing new", () => {
    rememberHouse(U, A, 1000);
    localStorage.setItem("activeRestaurantId", A);

    expect(storeSession(jwt({ sub: U, restaurantId: null }))).toBeNull();
    expect(localStorage.getItem("activeRestaurantId")).toBeNull();
    expect(lastHouseFor(U)).toEqual({ houseId: A, usedAt: 1000 });
  });

  it("a house that ended is forgotten for that person and noted for the chooser", () => {
    rememberHouse(U, A, 1000);
    rememberHouse(V, A, 1000);

    expect(noteHouseEnded(jwt({ sub: U, restaurantId: null }), A)).toBe(true);
    expect(lastHouseFor(U)).toBeNull();
    expect(lastHouseFor(V)?.houseId).toBe(A);
    expect(readHouseEnded()).toBe(A);
    expect(noteHouseEnded(jwt({ sub: U }), undefined)).toBe(false);
  });

  it("forgetting a house that is not the remembered one changes nothing", () => {
    rememberHouse(U, A, 1000);
    forgetHouse(U, B);
    expect(lastHouseFor(U)?.houseId).toBe(A);
  });

  it("reads the token house only when it is a house id", () => {
    expect(tokenHouse(jwt({ restaurantId: A }))).toBe(A);
    expect(tokenHouse(jwt({ restaurantId: "" }))).toBeNull();
    expect(tokenHouse("garbage")).toBeNull();
    expect(tokenHouse(null)).toBeNull();
  });

  it("ignores a corrupted memory rather than failing", () => {
    localStorage.setItem(LAST_HOUSE_KEY, "{not json");
    expect(lastHouseFor(U)).toBeNull();
    localStorage.setItem(
      LAST_HOUSE_KEY,
      JSON.stringify({ [U]: { houseId: "x", usedAt: 1 }, junk: 5 }),
    );
    expect(lastHouseFor(U)).toBeNull();
    indexEmail("person@example.com", U);
    expect(lastHouseHintFor("person@example.com")).toBeNull();
  });

  it("remembers nothing, and throws nothing, when storage is blocked", () => {
    // The test setup replaces window.localStorage with a plain object, so the
    // methods are spied on that object, not on Storage.prototype.
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => rememberHouse(U, A)).not.toThrow();
    expect(() => indexEmail("person@example.com", U)).not.toThrow();
    expect(lastHouseHintFor("person@example.com")).toBeNull();
    expect(() => storeSession(jwt({ sub: U, restaurantId: A }))).not.toThrow();
  });

  it("orders the chooser: this device's last house first, then by name", () => {
    const houses = [
      { id: A, name: "Moda", city: "Istanbul" },
      { id: B, name: "Kadıköy", city: "Istanbul" },
      {
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        name: "Beşiktaş",
        city: null,
      },
    ];
    expect(orderForChooser(houses, U)).toEqual({
      houses: [houses[2], houses[1], houses[0]],
      lastOpenedId: null,
    });
    rememberHouse(U, A);
    expect(orderForChooser(houses, U)).toEqual({
      houses: [houses[0], houses[2], houses[1]],
      lastOpenedId: A,
    });
    // Another person's last house marks nothing for this one.
    expect(orderForChooser(houses, V).lastOpenedId).toBeNull();
  });
});
