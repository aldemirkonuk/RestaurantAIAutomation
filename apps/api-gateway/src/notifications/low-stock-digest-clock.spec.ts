import {
  LOW_STOCK_DIGEST_FALLBACK_ZONE,
  digestClockFor,
  digestHourOf,
  hourTick,
  houseWallAt,
  isDigestTick,
  isDigestTickFromReadings,
} from "./low-stock-digest-clock";

const H = 3_600_000;

function iso(s: string): Date {
  return new Date(s);
}

describe("hourTick", () => {
  it("rounds cron jitter to the nearest UTC hour", () => {
    expect(hourTick(iso("2026-06-01T12:00:02Z")).toISOString()).toBe(
      "2026-06-01T12:00:00.000Z",
    );
    expect(hourTick(iso("2026-06-01T11:59:58Z")).toISOString()).toBe(
      "2026-06-01T12:00:00.000Z",
    );
  });
});

describe("digestClockFor", () => {
  it("uses the house's own zone when it resolves", () => {
    expect(digestClockFor({ timezone: "Europe/Istanbul" })).toEqual({
      zone: "Europe/Istanbul",
      source: "house",
      recorded: "Europe/Istanbul",
    });
  });

  for (const raw of [null, "", "   ", "Mars/Base"]) {
    it(`falls back to ${LOW_STOCK_DIGEST_FALLBACK_ZONE} for ${JSON.stringify(raw)}`, () => {
      const clock = digestClockFor({ timezone: raw as any });
      expect(clock.zone).toBe(LOW_STOCK_DIGEST_FALLBACK_ZONE);
      expect(clock.source).toBe("fallback");
      expect(clock.recorded).toBe(raw);
    });
  }

  it("falls back for a missing house", () => {
    expect(digestClockFor(null)).toEqual({
      zone: LOW_STOCK_DIGEST_FALLBACK_ZONE,
      source: "fallback",
      recorded: null,
    });
    expect(digestClockFor(undefined)).toEqual({
      zone: LOW_STOCK_DIGEST_FALLBACK_ZONE,
      source: "fallback",
      recorded: null,
    });
  });

  // #435's common/house-frame.ts (country -> zone, only when the country
  // keeps exactly one) is NOT wired into digestClockFor in this lane: #435
  // is still open on origin/main (checked via `gh pr view 435` before this
  // lane started), so a country like "TR" does not yet resolve to
  // Europe/Istanbul here. Both a single-zone country and a multi-zone one
  // fall back the same way until that follow-up lands.
  it("does not yet use the country step (follow-up owed once #435 merges)", () => {
    expect(digestClockFor({ timezone: null, country: "TR" }).source).toBe(
      "fallback",
    );
    expect(digestClockFor({ timezone: null, country: "US" }).source).toBe(
      "fallback",
    );
  });
});

describe("digestHourOf", () => {
  it("parses HH:MM", () => {
    expect(digestHourOf("12:00")).toBe(12);
    expect(digestHourOf("07:30")).toBe(7);
  });
  it("defaults null/empty to 12 (the existing default, not a new one)", () => {
    expect(digestHourOf(null)).toBe(12);
    expect(digestHourOf(undefined)).toBe(12);
    expect(digestHourOf("")).toBe(12);
  });
  it("returns null for unreadable values", () => {
    expect(digestHourOf("24:00")).toBeNull();
    expect(digestHourOf("abc")).toBeNull();
  });
});

describe("isDigestTick — DST and half-hour zones", () => {
  it("NY spring-forward 2026-03-08: hour 1 fires only at 06:00Z, hours 2/3 fire only at 07:00Z", () => {
    const zone = "America/New_York";
    const ticks = [5, 6, 7, 8, 9].map((h) => iso(`2026-03-08T0${h}:00:00Z`));
    const fires = (hour: number) =>
      ticks.map((t) => isDigestTick(t, zone, hour));
    expect(fires(1)).toEqual([false, true, false, false, false]);
    expect(fires(2)).toEqual([false, false, true, false, false]);
    expect(fires(3)).toEqual([false, false, true, false, false]);
  });

  it("NY fall-back 2026-11-01: hour 1 fires at 05:00Z not 06:00Z; hour 2 fires only at 07:00Z", () => {
    const zone = "America/New_York";
    const t5 = iso("2026-11-01T05:00:00Z");
    const t6 = iso("2026-11-01T06:00:00Z");
    const t7 = iso("2026-11-01T07:00:00Z");
    expect(isDigestTick(t5, zone, 1)).toBe(true);
    expect(isDigestTick(t6, zone, 1)).toBe(false);
    expect(isDigestTick(t5, zone, 2)).toBe(false);
    expect(isDigestTick(t6, zone, 2)).toBe(false);
    expect(isDigestTick(t7, zone, 2)).toBe(true);
  });

  it("Europe/Istanbul (non-US house), hour 12: exactly one fire over 24 ticks of 2026-09-26, at 09:00Z", () => {
    const zone = "Europe/Istanbul";
    const fires: string[] = [];
    for (let h = 0; h < 24; h++) {
      const t = iso(`2026-09-26T${String(h).padStart(2, "0")}:00:00Z`);
      if (isDigestTick(t, zone, 12)) fires.push(t.toISOString());
    }
    expect(fires).toEqual(["2026-09-26T09:00:00.000Z"]);
  });

  it("London spring-forward 2026-03-29 hour 1 fires only at 01:00Z", () => {
    const zone = "Europe/London";
    expect(isDigestTick(iso("2026-03-29T00:00:00Z"), zone, 1)).toBe(false);
    expect(isDigestTick(iso("2026-03-29T01:00:00Z"), zone, 1)).toBe(true);
    expect(isDigestTick(iso("2026-03-29T02:00:00Z"), zone, 1)).toBe(false);
  });

  it("London fall-back 2026-10-25 hour 1 fires at 00:00Z, not at 01:00Z", () => {
    const zone = "Europe/London";
    expect(isDigestTick(iso("2026-10-25T00:00:00Z"), zone, 1)).toBe(true);
    expect(isDigestTick(iso("2026-10-25T01:00:00Z"), zone, 1)).toBe(false);
  });

  it("Asia/Kolkata (UTC+5:30) hour 12 fires only at 07:00Z (12:30 local)", () => {
    const zone = "Asia/Kolkata";
    for (let h = 0; h < 24; h++) {
      const t = iso(`2026-09-26T${String(h).padStart(2, "0")}:00:00Z`);
      expect(isDigestTick(t, zone, 12)).toBe(h === 7);
    }
  });
});

describe("isDigestTick — full-year property test", () => {
  // Named for the CLAIMS grep: "exactly once".
  it("fires exactly once per house-local (date, hour) target across a full year, in every zone", () => {
    const zones = [
      "UTC",
      "America/New_York",
      "America/Los_Angeles",
      "Europe/Istanbul",
      "Europe/London",
      "Asia/Kolkata",
      "Asia/Kathmandu",
      "Australia/Lord_Howe",
      "Australia/Adelaide",
      "America/Santiago",
      "Pacific/Chatham",
    ];

    const start = Date.UTC(2026, 0, 1, 0, 0, 0);
    const end = Date.UTC(2027, 0, 2, 0, 0, 0);
    const tickCount = (end - start) / H;

    // One houseWallAt reading per tick per zone, reused for all 24 hours —
    // this is what keeps 11 zones x 8760+ ticks fast in CI.
    for (const zone of zones) {
      const readings: { dateKey: string; minutes: number }[] = new Array(
        tickCount + 1,
      );
      for (let i = 0; i <= tickCount; i++) {
        readings[i] = houseWallAt(new Date(start + i * H), zone);
      }

      for (let hour = 0; hour < 24; hour++) {
        const firedDates = new Map<string, number>();
        for (let i = 1; i <= tickCount; i++) {
          const cur = readings[i];
          const prev = readings[i - 1];
          // The real function, not a reimplementation — readings are
          // precomputed once per tick per zone above and reused across all
          // 24 hours, which is what keeps this fast.
          if (isDigestTickFromReadings(cur, prev, hour)) {
            firedDates.set(cur.dateKey, (firedDates.get(cur.dateKey) ?? 0) + 1);
          }
        }
        // Every local date fully inside the sampled year must have fired
        // exactly once for this hour.
        for (
          let d = Date.UTC(2026, 0, 2);
          d <= Date.UTC(2026, 11, 31);
          d += 24 * H
        ) {
          const dateKey = new Date(d).toISOString().slice(0, 10);
          expect(firedDates.get(dateKey)).toBe(1);
        }
      }
    }
  }, 30_000);
});
