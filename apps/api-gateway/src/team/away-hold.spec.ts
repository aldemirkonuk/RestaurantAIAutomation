/**
 * The rules of "a message to someone Away waits for them" (ADR 0218, the
 * founder's round-2 answer 3), as pure functions. The services that read and
 * write the hold table are tested in `away-release.service.spec.ts`,
 * `notes.service.spec.ts` and `team.controller.broadcast.spec.ts`.
 */
import {
  LEFT_BEFORE_RETURN,
  NO_SENDER_ON_RETURN,
  STALE_CLAIM_MS,
  heldDay,
  heldDetail,
  isClaimable,
  releaseVerdict,
  splitForAway,
} from "./away-hold";

describe("splitForAway — who it reaches now, who it waits for", () => {
  const people = [
    { id: "m1", user_id: "u1" },
    { id: "m2", user_id: "u2" },
    { id: "m3", user_id: null },
    { id: "m4", user_id: "u4" },
  ];

  it("holds exactly the people who are Away today, with their last day, and drops nobody", () => {
    const away = new Map([
      ["u2", "2026-09-28"],
      ["u4", "2026-10-02"],
    ]);
    const { now, held } = splitForAway(people, (p) => p.user_id, away);
    expect(now.map((p) => p.id)).toEqual(["m1", "m3"]);
    expect(held.map((h) => [h.person.id, h.until])).toEqual([
      ["m2", "2026-09-28"],
      ["m4", "2026-10-02"],
    ]);
    expect(now.length + held.length).toBe(people.length);
  });

  it("never holds a person with no account: nothing could reach them either way", () => {
    const { now, held } = splitForAway(people, (p) => p.user_id, new Map([["", "2026-09-28"]]));
    expect(held).toEqual([]);
    expect(now).toHaveLength(4);
  });

  it("holds nobody when nobody is Away", () => {
    const { now, held } = splitForAway(people, (p) => p.user_id, new Map());
    expect(held).toEqual([]);
    expect(now).toEqual(people);
  });
});

describe("releaseVerdict — what to do with one held item now", () => {
  const facts = (over: Partial<Record<"members" | "awayToday" | "quietNow", string[]>> = {}) => ({
    members: new Set(over.members ?? ["u1"]),
    awayToday: new Set(over.awayToday ?? []),
    quietNow: new Set(over.quietNow ?? []),
  });

  it("releases a member who is back and awake", () => {
    expect(releaseVerdict("u1", facts())).toBe("release");
  });

  it("keeps waiting while they are Away (a window moved or extended)", () => {
    expect(releaseVerdict("u1", facts({ awayToday: ["u1"] }))).toBe("still_away");
  });

  it("waits out their quiet hours on the day they are back", () => {
    expect(releaseVerdict("u1", facts({ quietNow: ["u1"] }))).toBe("quiet_hours");
  });

  it("asks membership first: a person who left is owed nothing, whatever their dates say", () => {
    expect(releaseVerdict("u1", facts({ members: [], awayToday: ["u1"], quietNow: ["u1"] }))).toBe(
      "not_in_house",
    );
  });

  it("says still Away before quiet hours, so the tally can tell the two apart", () => {
    expect(releaseVerdict("u1", facts({ awayToday: ["u1"], quietNow: ["u1"] }))).toBe("still_away");
  });
});

describe("isClaimable — one release at a time, and a crash does not strand a hold", () => {
  const now = new Date("2026-09-21T12:00:00Z");

  it("takes an unclaimed row", () => {
    expect(isClaimable(null, now)).toBe(true);
  });

  it("leaves a fresh claim to the release that holds it", () => {
    expect(isClaimable(new Date(now.getTime() - 60_000).toISOString(), now)).toBe(false);
    expect(isClaimable(new Date(now.getTime() - STALE_CLAIM_MS).toISOString(), now)).toBe(false);
  });

  it("takes over a claim older than the stale limit", () => {
    expect(isClaimable(new Date(now.getTime() - STALE_CLAIM_MS - 1).toISOString(), now)).toBe(true);
  });

  it("takes over a claim it cannot read as a time", () => {
    expect(isClaimable("not a time", now)).toBe(true);
  });
});

describe("the sentences a sender reads", () => {
  it("names the last Away day as a calendar day, never slid across a time zone", () => {
    expect(heldDay("2026-09-28")).toBe("28 Sep");
    expect(heldDay("2026-01-01")).toBe("1 Jan");
    expect(heldDay("2026-12-09")).toBe("9 Dec");
    expect(heldDay("garbage")).toBe("garbage");
    expect(heldDay("2026-02-30")).toBe("2026-02-30");
  });

  it("says Away until the date, that it waits, and when it arrives", () => {
    expect(heldDetail("2026-09-28")).toBe(
      "Away until 28 Sep. It waits and is delivered when they are back, outside their quiet hours.",
    );
  });

  it("says why a held item was never delivered or never texted", () => {
    expect(LEFT_BEFORE_RETURN).toMatch(/left this house/);
    expect(NO_SENDER_ON_RETURN).toMatch(/no connected sender/);
  });
});
