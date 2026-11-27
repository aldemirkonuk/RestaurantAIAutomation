import { menuDueState } from "./menu-due-state";

const MADE = "2026-10-01T12:00:00Z";
const day = (n: number) => new Date(Date.parse(MADE) + n * 86_400_000);

describe("menuDueState (menu r104 g1)", () => {
  it("says nothing without a cadence, with none, or with no moment it was made current", () => {
    expect(menuDueState(null, MADE, day(400), "UTC")).toBeNull();
    expect(menuDueState(undefined, MADE, day(400), "UTC")).toBeNull();
    expect(menuDueState("none", MADE, day(400), "UTC")).toBeNull();
    expect(menuDueState("monthly", null, day(400), "UTC")).toBeNull();
    expect(menuDueState("monthly", "not a date", day(400), "UTC")).toBeNull();
  });

  it("is ok before 1x, due at exactly 1x, still due before 1.5x, overdue at 1.5x", () => {
    expect(menuDueState("monthly", MADE, day(29), "UTC")?.state).toBe("ok");
    expect(menuDueState("monthly", MADE, day(30), "UTC")?.state).toBe("due");
    expect(menuDueState("monthly", MADE, day(44), "UTC")?.state).toBe("due");
    expect(menuDueState("monthly", MADE, day(45), "UTC")?.state).toBe("overdue");
    expect(menuDueState("weekly", MADE, day(7), "UTC")?.state).toBe("due");
    expect(menuDueState("weekly", MADE, day(11), "UTC")?.state).toBe("overdue");
    expect(menuDueState("quarterly", MADE, day(91), "UTC")?.state).toBe("due");
    expect(menuDueState("yearly", MADE, day(365), "UTC")?.state).toBe("due");
    expect(menuDueState("yearly", MADE, day(548), "UTC")?.state).toBe("overdue");
  });

  it("names the cadence and the days it has been", () => {
    expect(menuDueState("monthly", MADE, day(35), "UTC")).toEqual({ state: "due", cadence: "monthly", daysSince: 35 });
  });

  it("counts on the house's day, not the server's: a house ahead of UTC crosses midnight first", () => {
    // 23:30 UTC on day 29 is already day 30 in Istanbul (UTC+3): due there, ok in UTC.
    const lateUtc = new Date("2026-10-30T23:30:00Z");
    expect(menuDueState("monthly", "2026-10-01T12:00:00Z", lateUtc, "UTC")?.state).toBe("ok");
    expect(menuDueState("monthly", "2026-10-01T12:00:00Z", lateUtc, "Europe/Istanbul")?.state).toBe("due");
  });

  it("reads a zone it cannot use as UTC rather than throwing", () => {
    expect(menuDueState("monthly", MADE, day(30), "Not/AZone")?.state).toBe("due");
  });
});
