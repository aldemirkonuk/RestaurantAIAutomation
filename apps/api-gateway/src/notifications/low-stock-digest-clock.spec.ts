import {
  LOW_STOCK_DIGEST_FALLBACK_ZONE,
  digestClockFor,
  digestHourOf,
  digestAlreadySentOn,
  hourTick,
  houseWallAt,
  isDigestDue,
  isDigestDueFromReading,
  type WallReading,
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

/**
 * The sweep's rule, reduced to its two pure halves and driven over a run of
 * ticks: send on a due tick unless the last send is already on (or after)
 * that house-local date. Returns, per tick, whether it SENDS. `skip` lists
 * tick indexes that are never evaluated (a missed or failed tick).
 */
function sends(
  readings: WallReading[],
  hour: number,
  skip: Set<number> = new Set(),
): boolean[] {
  let last: string | null = null;
  return readings.map((cur, i) => {
    if (skip.has(i)) return false;
    if (!isDigestDueFromReading(cur, hour)) return false;
    if (digestAlreadySentOn(last, cur.dateKey)) return false;
    last = cur.dateKey;
    return true;
  });
}

function readingsFor(ticks: Date[], zone: string): WallReading[] {
  return ticks.map((t) => houseWallAt(t, zone));
}

describe("isDigestDue — due from the house's hour until local midnight", () => {
  it("is false before the hour and true from it to 23:00, in the house's zone", () => {
    const zone = "Europe/Istanbul"; // UTC+3
    for (let h = 0; h < 24; h++) {
      const t = iso(`2026-09-26T${String(h).padStart(2, "0")}:00:00Z`);
      // 09:00Z = 12:00 local; 20:00Z = 23:00 local; 21:00Z = 00:00 next day.
      expect(isDigestDue(t, zone, 12)).toBe(h >= 9 && h <= 20);
    }
  });

  it("digestAlreadySentOn: null never covers; the same or a later date covers", () => {
    expect(digestAlreadySentOn(null, "2026-09-26")).toBe(false);
    expect(digestAlreadySentOn("2026-09-25", "2026-09-26")).toBe(false);
    expect(digestAlreadySentOn("2026-09-26", "2026-09-26")).toBe(true);
    expect(digestAlreadySentOn("2026-09-27", "2026-09-26")).toBe(true);
  });
});

describe("the send rule — DST and half-hour zones", () => {
  it("NY spring-forward 2026-03-08: hour 1 sends at 06:00Z, hours 2/3 send at 07:00Z", () => {
    const zone = "America/New_York";
    const ticks = [5, 6, 7, 8, 9].map((h) => iso(`2026-03-08T0${h}:00:00Z`));
    const r = readingsFor(ticks, zone);
    expect(sends(r, 1)).toEqual([false, true, false, false, false]);
    expect(sends(r, 2)).toEqual([false, false, true, false, false]);
    expect(sends(r, 3)).toEqual([false, false, true, false, false]);
  });

  it("NY fall-back 2026-11-01: hour 1 sends at 05:00Z and not again in the repeated hour at 06:00Z; hour 2 sends only at 07:00Z", () => {
    const zone = "America/New_York";
    const r = readingsFor(
      [5, 6, 7].map((h) => iso(`2026-11-01T0${h}:00:00Z`)),
      zone,
    );
    expect(isDigestDue(iso("2026-11-01T06:00:00Z"), zone, 1)).toBe(true);
    expect(sends(r, 1)).toEqual([true, false, false]);
    expect(sends(r, 2)).toEqual([false, false, true]);
  });

  it("Europe/Istanbul (non-US house), hour 12: exactly one send over 24 ticks of 2026-09-26, at 09:00Z", () => {
    const zone = "Europe/Istanbul";
    const ticks = Array.from({ length: 24 }, (_, h) =>
      iso(`2026-09-26T${String(h).padStart(2, "0")}:00:00Z`),
    );
    const s = sends(readingsFor(ticks, zone), 12);
    expect(ticks.filter((_, i) => s[i]).map((t) => t.toISOString())).toEqual([
      "2026-09-26T09:00:00.000Z",
    ]);
  });

  it("London spring-forward 2026-03-29 hour 1 sends at 01:00Z", () => {
    const zone = "Europe/London";
    const r = readingsFor(
      [0, 1, 2].map((h) => iso(`2026-03-29T0${h}:00:00Z`)),
      zone,
    );
    expect(sends(r, 1)).toEqual([false, true, false]);
  });

  it("London fall-back 2026-10-25 hour 1 sends at 00:00Z, not again at 01:00Z", () => {
    const zone = "Europe/London";
    const r = readingsFor(
      [0, 1].map((h) => iso(`2026-10-25T0${h}:00:00Z`)),
      zone,
    );
    expect(sends(r, 1)).toEqual([true, false]);
  });

  it("Asia/Kolkata (UTC+5:30) hour 12 sends only at 07:00Z (12:30 local)", () => {
    const zone = "Asia/Kolkata";
    const ticks = Array.from({ length: 24 }, (_, h) =>
      iso(`2026-09-26T${String(h).padStart(2, "0")}:00:00Z`),
    );
    const s = sends(readingsFor(ticks, zone), 12);
    s.forEach((sent, h) => expect(sent).toBe(h === 7));
  });

  it("catch-up: with the 09:00Z tick missed, the Istanbul hour-12 house is sent at 10:00Z instead", () => {
    const zone = "Europe/Istanbul";
    const ticks = Array.from({ length: 24 }, (_, h) =>
      iso(`2026-09-26T${String(h).padStart(2, "0")}:00:00Z`),
    );
    const s = sends(readingsFor(ticks, zone), 12, new Set([9]));
    expect(ticks.filter((_, i) => s[i]).map((t) => t.toISOString())).toEqual([
      "2026-09-26T10:00:00.000Z",
    ]);
  });
});

describe("the send rule — full-year property test", () => {
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
  const readingsByZone = new Map<string, WallReading[]>();
  function readingsOf(zone: string): WallReading[] {
    let r = readingsByZone.get(zone);
    if (!r) {
      r = new Array(tickCount + 1);
      for (let i = 0; i <= tickCount; i++) {
        r[i] = houseWallAt(new Date(start + i * H), zone);
      }
      readingsByZone.set(zone, r);
    }
    return r;
  }

  function sentDates(
    r: WallReading[],
    hour: number,
    skip?: Set<number>,
  ): Map<string, number> {
    const out = new Map<string, number>();
    sends(r, hour, skip).forEach((sent, i) => {
      if (sent) out.set(r[i].dateKey, (out.get(r[i].dateKey) ?? 0) + 1);
    });
    return out;
  }

  function eachFullDate(fn: (dateKey: string) => void) {
    for (
      let d = Date.UTC(2026, 0, 2);
      d <= Date.UTC(2026, 11, 31);
      d += 24 * H
    ) {
      fn(new Date(d).toISOString().slice(0, 10));
    }
  }

  // Named for the CLAIMS grep: "exactly once".
  it("sends exactly once per house-local (date, hour) target across a full year, in every zone", () => {
    for (const zone of zones) {
      const r = readingsOf(zone);
      for (let hour = 0; hour < 24; hour++) {
        const got = sentDates(r, hour);
        eachFullDate((dateKey) => expect(got.get(dateKey)).toBe(1));
      }
    }
  }, 30_000);

  it("catch-up: with every date's first due tick missed, each hour 0-22 is still sent exactly once that date, in every zone", () => {
    for (const zone of zones) {
      const r = readingsOf(zone);
      for (let hour = 0; hour <= 22; hour++) {
        // Skip the first due tick of every local date.
        const skip = new Set<number>();
        let seen: string | null = null;
        r.forEach((cur, i) => {
          if (isDigestDueFromReading(cur, hour) && cur.dateKey !== seen) {
            seen = cur.dateKey;
            skip.add(i);
          }
        });
        const got = sentDates(r, hour, skip);
        eachFullDate((dateKey) => expect(got.get(dateKey)).toBe(1));
      }
    }
  }, 30_000);
});
