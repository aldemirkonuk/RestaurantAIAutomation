import {
  forget,
  hintFor,
  indexEmail,
  orderHouses,
  parseEmailIndex,
  parseMemory,
  readHouseAnswer,
  remember,
} from "@/auth/houseChoice";

/**
 * The phone's memory of the houses people used on it (ADR 0164, R3), and the
 * chooser's order. Pure, so no SecureStore is needed here.
 */

const U = "11111111-1111-4111-8111-111111111111";
const V = "22222222-2222-4222-8222-222222222222";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("houseChoice", () => {
  it("remembers the last house per person", () => {
    let mem = remember({}, U, A, 1000);
    mem = remember(mem, V, B, 2000);
    mem = remember(mem, U, B, 3000);
    expect(mem[U]).toEqual({ houseId: B, usedAt: 3000 });
    expect(mem[V]).toEqual({ houseId: B, usedAt: 2000 });
  });

  it("forgets a house that ended, only for that person and only that house", () => {
    const mem = remember(remember({}, U, A, 1), V, A, 1);
    expect(forget(mem, U, A)[U]).toBeUndefined();
    expect(forget(mem, U, A)[V]).toEqual({ houseId: A, usedAt: 1 });
    expect(forget(mem, U, B)).toBe(mem);
  });

  it("reads nothing from a corrupted or foreign record", () => {
    expect(parseMemory("{nope")).toEqual({});
    expect(parseMemory(JSON.stringify([1, 2]))).toEqual({});
    expect(
      parseMemory(JSON.stringify({ [U]: { houseId: "x", usedAt: 1 } })),
    ).toEqual({});
    expect(parseMemory(null)).toEqual({});
  });

  it("orders the chooser: this phone's last house first, then by name", () => {
    const houses = [
      { id: A, name: "Moda", city: "Istanbul" },
      { id: B, name: "Kadikoy", city: null },
    ];
    expect(orderHouses(houses, {}, U)).toEqual({
      houses: [houses[1], houses[0]],
      lastOpenedId: null,
    });
    expect(orderHouses(houses, remember({}, U, A, 1), U)).toEqual({
      houses: [houses[0], houses[1]],
      lastOpenedId: A,
    });
    expect(
      orderHouses(houses, remember({}, V, A, 1), U).lastOpenedId,
    ).toBeNull();
  });

  describe("hintFor (parity fix, round 3, 2026-09-19 — mirrors the web's item 8)", () => {
    it("gives back only the entry for the email being signed in, never another account's", () => {
      let index = indexEmail({}, "Person@Example.com", U);
      const mem = remember(remember({}, U, A, 1000), V, B, 2000);
      index = indexEmail(index, "other@example.com", V);

      // Case-insensitive, whitespace-trimmed — the same email typed
      // differently still finds this phone's memory of it.
      expect(hintFor(mem, index, " person@example.com ")).toEqual({
        userId: U,
        houseId: A,
        usedAt: 1000,
      });
      expect(hintFor(mem, index, "other@example.com")).toEqual({
        userId: V,
        houseId: B,
        usedAt: 2000,
      });
    });

    it("answers null for an email this phone has never seen, and for none", () => {
      const index = indexEmail({}, "known@example.com", U);
      const mem = remember({}, U, A, 1000);

      expect(hintFor(mem, index, "unknown@example.com")).toBeNull();
      expect(hintFor(mem, index, null)).toBeNull();
      expect(hintFor(mem, index, undefined)).toBeNull();
    });

    it("answers null when the email is indexed but the house memory has since forgotten that person", () => {
      const index = indexEmail({}, "known@example.com", U);
      expect(hintFor({}, index, "known@example.com")).toBeNull();
    });

    it("reads nothing from a corrupted or foreign index", () => {
      expect(parseEmailIndex("{nope")).toEqual({});
      expect(parseEmailIndex(JSON.stringify([1, 2]))).toEqual({});
      expect(parseEmailIndex(JSON.stringify({ abcd1234: "not-a-uuid" }))).toEqual({});
      expect(parseEmailIndex(null)).toEqual({});
    });

    it("indexEmail ignores a missing email or a non-UUID userId, leaving the index untouched", () => {
      const base = indexEmail({}, "known@example.com", U);
      expect(indexEmail(base, null, U)).toBe(base);
      expect(indexEmail(base, "known@example.com", "not-a-uuid")).toBe(base);
    });
  });
});

describe("readHouseAnswer", () => {
  it("reads houses and the memberships waiting to be accepted", () => {
    expect(
      readHouseAnswer({
        houses: [{ id: A, name: "Meyhane", city: "Antalya" }],
        held: [
          { membershipId: "m1", id: B, name: "Kitchenette", city: null, role: "staff" },
        ],
      }),
    ).toEqual({
      houses: [{ id: A, name: "Meyhane", city: "Antalya" }],
      held: [
        { membershipId: "m1", id: B, name: "Kitchenette", city: null, role: "staff" },
      ],
    });
  });

  it("an older gateway that sends no `held` has nothing waiting", () => {
    expect(readHouseAnswer({ houses: [] })).toEqual({ houses: [], held: [] });
  });

  it("an answer that is not the shape is an unread, never an empty list (ADR 0020)", () => {
    expect(readHouseAnswer(null)).toBeNull();
    expect(readHouseAnswer("nope")).toBeNull();
    expect(readHouseAnswer({})).toBeNull();
    expect(readHouseAnswer({ houses: "x" })).toBeNull();
  });

  it("drops a held row that names no membership to accept", () => {
    const read = readHouseAnswer({
      houses: [],
      held: [{ id: B, name: "Kitchenette" }],
    });
    expect(read?.held).toEqual([]);
  });
});
