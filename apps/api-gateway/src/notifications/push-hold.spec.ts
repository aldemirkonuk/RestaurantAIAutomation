import { pushHolds, teamPushHolds } from "./push-hold";

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

/**
 * F-1340, the founder's F-540 ruling (2026-10-11): a push the team sends one
 * another may arrive inside quiet hours, because work overloads; Push off is
 * still honoured, and every push sent inside someone's window is logged.
 */
describe("teamPushHolds — team pushes may arrive in quiet hours, and say so (F-1340)", () => {
  const prefs = [
    {
      user_id: "quiet",
      push_enabled: true,
      quiet_hours_enabled: true,
      quiet_hours_start: "22:00",
      quiet_hours_end: "08:00",
    },
    {
      user_id: "off",
      push_enabled: false,
      quiet_hours_enabled: true,
      quiet_hours_start: "22:00",
      quiet_hours_end: "08:00",
    },
    { user_id: "awake", push_enabled: true, quiet_hours_enabled: false },
  ];
  const sb = {
    from(table: string) {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        maybeSingle: () =>
          Promise.resolve({
            data: { timezone: "UTC", country: "GB" },
            error: null,
          }),
        then: (ok: any, bad: any) =>
          Promise.resolve(
            table === "notification_preferences"
              ? { data: prefs, error: null }
              : { data: [], error: null },
          ).then(ok, bad),
      };
      return chain;
    },
  };
  const threeUtc = new Date("2026-10-10T03:00:00Z");

  it("[REVERT-FAILS] holds only Push off, pushes the person in quiet hours, and logs who, what and when", async () => {
    const notes: string[] = [];
    const held = await teamPushHolds(
      sb,
      "h1",
      ["quiet", "off", "awake"],
      { what: "team_broadcast", by: "manager-1" },
      { warn: () => undefined, note: (l) => notes.push(l) },
      threeUtc,
    );
    expect([...held.entries()]).toEqual([["off", "push_off"]]);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("TEAM_PUSH_IN_QUIET_HOURS");
    expect(notes[0]).toContain("to=quiet");
    expect(notes[0]).toContain("by=manager-1");
    expect(notes[0]).toContain("what=team_broadcast");
    expect(notes[0]).toContain("at=2026-10-10T03:00:00.000Z");
    expect(notes[0]).toContain("sent during quiet hours");
  });

  it("[REVERT-FAILS] F-1463: files one /logs row naming the sender, the house and who was in quiet hours", async () => {
    const rows: Array<{ table: string; row: any }> = [];
    const logged = {
      from(table: string) {
        const chain: any = sb.from(table);
        chain.insert = (row: any) => {
          rows.push({ table, row });
          return Promise.resolve({ error: null });
        };
        return chain;
      },
    };
    const warns: string[] = [];
    await teamPushHolds(
      logged,
      "h1",
      ["quiet", "off", "awake"],
      { what: "shift_offer", by: "manager-1" },
      { warn: (l) => warns.push(l), note: () => undefined },
      threeUtc,
    );
    expect(warns).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0].table).toBe("system_audit_log");
    expect(rows[0].row).toMatchObject({
      actor_type: "user",
      actor_id: "manager-1",
      action: "message_sent_in_quiet_hours",
      restaurant_id: "h1",
      changes: {
        subject: "A shift offer was sent to 1 person inside their quiet hours",
        what: "shift_offer",
        recipients: ["quiet"],
      },
    });
  });

  it("F-1463: nobody in quiet hours files no row; a row that fails is said, and the hold still stands", async () => {
    const tries: string[] = [];
    const failing = {
      from(table: string) {
        const chain: any = sb.from(table);
        chain.insert = () => {
          tries.push(table);
          return Promise.resolve({ error: { message: "denied" } });
        };
        return chain;
      },
    };
    const noon = new Date("2026-10-10T12:00:00Z");
    await teamPushHolds(
      failing,
      "h1",
      ["quiet", "awake"],
      { what: "team_broadcast", by: "manager-1" },
      { warn: () => undefined, note: () => undefined },
      noon,
    );
    expect(tries).toEqual([]);
    const warns: string[] = [];
    const held = await teamPushHolds(
      failing,
      "h1",
      ["quiet", "off"],
      { what: "team_broadcast", by: "manager-1" },
      { warn: (l) => warns.push(l), note: () => undefined },
      threeUtc,
    );
    expect(tries).toEqual(["system_audit_log"]);
    expect(warns[0]).toContain("TEAM_PUSH_QUIET_HOURS_UNLOGGED");
    expect([...held.entries()]).toEqual([["off", "push_off"]]);
  });

  it("leaves the house rule as it was: pushHolds still holds the same person for quiet hours", async () => {
    const held = await pushHolds(
      sb,
      "h1",
      ["quiet", "off", "awake"],
      () => undefined,
      threeUtc,
    );
    expect(held.get("quiet")).toBe("quiet_hours");
    expect(held.get("off")).toBe("push_off");
    expect(held.has("awake")).toBe(false);
  });
});
