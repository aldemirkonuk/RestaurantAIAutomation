import { pushHolds } from "./push-hold";

/**
 * F-868: Settings says a quiet-hours window is read in UTC until the house
 * has a time zone. The push rule skipped quiet hours entirely when the house
 * had no zone (a US house: many zones, no country fallback), so a manager's
 * 22:00-08:00 window let a 03:00 push through. One rule now: the house's
 * zone, else its country's only zone, else UTC.
 */
describe("pushHolds reads quiet hours with no house time zone (F-868)", () => {
  function fakeSupabase(house: Record<string, any> | null, houseError = false) {
    return {
      from(table: string) {
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          in: () => chain,
          maybeSingle: () =>
            Promise.resolve(
              houseError
                ? { data: null, error: { message: "down" } }
                : { data: house, error: null },
            ),
          then: (ok: any, bad: any) =>
            Promise.resolve(
              table === "notification_preferences"
                ? {
                    data: [
                      {
                        user_id: "u1",
                        push_enabled: true,
                        quiet_hours_enabled: true,
                        quiet_hours_start: "22:00",
                        quiet_hours_end: "08:00",
                      },
                    ],
                    error: null,
                  }
                : { data: [], error: null },
            ).then(ok, bad),
        };
        return chain;
      },
    };
  }

  const threeUtc = new Date("2026-10-10T03:00:00Z");
  const noonUtc = new Date("2026-10-10T12:00:00Z");

  it("[REVERT-FAILS] a US house with no time zone holds the push inside the window, read in UTC", async () => {
    const held = await pushHolds(
      fakeSupabase({ timezone: null, country: "US" }),
      "h1",
      ["u1"],
      () => undefined,
      threeUtc,
    );
    expect(held.get("u1")).toBe("quiet_hours");
  });

  it("the same house is pushed outside the window", async () => {
    const held = await pushHolds(
      fakeSupabase({ timezone: null, country: "US" }),
      "h1",
      ["u1"],
      () => undefined,
      noonUtc,
    );
    expect(held.has("u1")).toBe(false);
  });

  it("a house row that cannot be read does not judge quiet hours, and says so", async () => {
    const warn = jest.fn();
    const held = await pushHolds(
      fakeSupabase(null, true),
      "h1",
      ["u1"],
      warn,
      threeUtc,
    );
    expect(held.has("u1")).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("PUSH_HOUSE_ZONE_UNREAD"),
    );
  });
});
