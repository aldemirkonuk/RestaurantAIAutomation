import { LowStockAlertsService } from "./low-stock-alerts.service";
import { hourTick } from "./low-stock-digest-clock";

/**
 * Table-keyed Supabase stub, separate from `low-stock-alerts.service.spec.ts`'s
 * `makeDbMock` because that one returns the SAME rows for every table
 * (`v_low_stock_items`, `restaurants`, `notification_preferences`,
 * `inventory_alert_state`), which cannot express "an Istanbul house and an LA
 * house with different digest hours" or "restaurants has no zone but
 * inventory_alert_state has a last_digest_at". This mock varies by table AND
 * (for `restaurants` / `notification_preferences` / `inventory_alert_state`)
 * by the restaurant_id in the query.
 */
function makeDigestDbMock(opts: {
  lowStockRows: any[];
  restaurantsRows: Array<{
    id: string;
    name: string;
    timezone: string | null;
    country?: string | null;
  }>;
  prefsByRestaurant: Record<string, any[]>;
  /** Seed `inventory_alert_state.last_digest_at`, per restaurant. */
  initialLastDigestAt?: Record<string, string>;
  /** Force the `last_digest_at` read itself to error (network/DB failure). */
  lastDigestAtReadError?: boolean;
  /**
   * Force the `restaurants` read itself to error (network/DB failure) —
   * exercised by getRestaurantHouses' `ok` flag, distinct from a house that
   * genuinely has no timezone recorded (`timezone: null` with no error).
   */
  restaurantsReadError?: boolean;
  /** Force every `inventory_alert_state` upsert (the digest stamp) to error. */
  upsertError?: boolean;
}) {
  const lastDigestAt: Record<string, string> = {
    ...(opts.initialLastDigestAt ?? {}),
  };
  const upsertRows: any[] = [];

  function chainFor(table: string): any {
    const chain: any = {
      _eqs: [] as Array<[string, any]>,
      _in: undefined as string[] | undefined,
      select: () => chain,
      eq: (col: string, val: any) => {
        chain._eqs.push([col, val]);
        return chain;
      },
      in: (_col: string, vals: any[]) => {
        chain._in = vals;
        return chain;
      },
      not: () => chain,
      order: () => chain,
      limit: () => chain,
      neq: () => chain,
      update: () => chain,
      upsert: (row: any) => {
        if (opts.upsertError) {
          return Promise.resolve({ error: { message: "write failed" } });
        }
        upsertRows.push(row);
        if (table === "inventory_alert_state" && row.last_digest_at) {
          lastDigestAt[row.restaurant_id] = row.last_digest_at;
        }
        return Promise.resolve({ error: null });
      },
      maybeSingle: () => {
        if (table === "inventory_alert_state") {
          if (opts.lastDigestAtReadError) {
            return Promise.resolve({
              data: null,
              error: { message: "fetch failed" },
            });
          }
          const rid = chain._eqs.find(([c]: any) => c === "restaurant_id")?.[1];
          const at = rid ? lastDigestAt[rid] : undefined;
          return Promise.resolve({
            data: at ? { last_digest_at: at } : null,
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
      then: (resolve: any) => {
        if (table === "v_low_stock_items") {
          return resolve({ data: opts.lowStockRows, error: null });
        }
        if (table === "restaurants") {
          if (opts.restaurantsReadError) {
            return resolve({
              data: null,
              error: { message: "fetch failed" },
            });
          }
          const ids = chain._in as string[] | undefined;
          const rows = ids
            ? opts.restaurantsRows.filter((r) => ids.includes(r.id))
            : opts.restaurantsRows;
          return resolve({ data: rows, error: null });
        }
        if (table === "notification_preferences") {
          const rid = chain._eqs.find(([c]: any) => c === "restaurant_id")?.[1];
          return resolve({
            data: opts.prefsByRestaurant[rid] ?? [],
            error: null,
          });
        }
        if (table === "notifications") {
          return resolve({ data: [], error: null });
        }
        return resolve({ data: [], error: null });
      },
    };
    return chain;
  }

  return {
    mock: {
      supabase: { from: (t: string) => chainFor(t) },
      getRestaurantMemberIds: jest.fn().mockResolvedValue(["user-1"]),
    } as any,
    upsertRows,
    lastDigestAt,
  };
}

function makeLowStockRow(over: Partial<any> = {}) {
  return {
    id: over.id ?? "inv-1",
    restaurant_id: over.restaurant_id,
    wine_id: over.wine_id ?? "wine-1",
    wine_name: over.wine_name ?? "Opus One 2019",
    stock_live: over.stock_live ?? 5,
    threshold_min: over.threshold_min ?? 8,
  };
}

function dailyPrefs(hour: string) {
  return [
    {
      low_stock_enabled: true,
      instant_first_alert: true,
      critical_immediate: true,
      digest_frequency: "daily",
      digest_time: hour,
    },
  ];
}

describe("LowStockAlertsService digest sweep — each house's own clock", () => {
  let notifications: { persistForRestaurant: jest.Mock };
  let gmail: { sendLowStockDigest: jest.Mock };
  let recipientResolver: { resolveRecipients: jest.Mock };
  let config: { get: jest.Mock };

  beforeEach(() => {
    notifications = {
      persistForRestaurant: jest
        .fn()
        .mockResolvedValue({ inserted: 1, ids: ["n1"] }),
    };
    gmail = {
      sendLowStockDigest: jest.fn().mockResolvedValue({ success: true }),
    };
    recipientResolver = {
      resolveRecipients: jest.fn().mockResolvedValue({ emails: ["mgr@x.com"] }),
    };
    config = { get: jest.fn().mockReturnValue("") };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /**
   * Runs the sweep with the system clock set to `iso`, as the cron would in
   * production — `sendDigest` and `upsertState` read `new Date()`. Only Date
   * is faked; promises and timers run for real.
   */
  async function runAt(svc: LowStockAlertsService, iso: string) {
    jest.useFakeTimers({
      doNotFake: [
        "nextTick",
        "setImmediate",
        "setTimeout",
        "setInterval",
        "clearTimeout",
        "clearInterval",
        "queueMicrotask",
      ],
      now: new Date(iso),
    });
    await svc.runDigestSweepAt(new Date(iso));
  }

  function build(db: any) {
    return new LowStockAlertsService(
      db,
      notifications as any,
      config as any,
      gmail as any,
      recipientResolver as any,
    );
  }

  it("a. an Istanbul house and an LA house, both hour 12: each fires only on its own tick", async () => {
    const { mock } = makeDigestDbMock({
      lowStockRows: [
        makeLowStockRow({ id: "inv-ist", restaurant_id: "ist" }),
        makeLowStockRow({ id: "inv-la", restaurant_id: "la" }),
      ],
      restaurantsRows: [
        { id: "ist", name: "Istanbul House", timezone: "Europe/Istanbul" },
        { id: "la", name: "LA House", timezone: "America/Los_Angeles" },
      ],
      prefsByRestaurant: {
        ist: dailyPrefs("12:00"),
        la: dailyPrefs("12:00"),
      },
    });
    const svc = build(mock);

    await svc.runDigestSweepAt(new Date("2026-09-26T09:00:00Z"));
    expect(gmail.sendLowStockDigest).toHaveBeenCalledTimes(1);
    expect(notifications.persistForRestaurant.mock.calls[0][0]).toBe("ist");

    gmail.sendLowStockDigest.mockClear();
    notifications.persistForRestaurant.mockClear();

    await svc.runDigestSweepAt(new Date("2026-09-26T19:00:00Z"));
    expect(gmail.sendLowStockDigest).toHaveBeenCalledTimes(1);
    expect(notifications.persistForRestaurant.mock.calls[0][0]).toBe("la");
  });

  it("b. an LA house with hour 20 gets groupKey keyed on the HOUSE date, not the UTC date", async () => {
    const { mock } = makeDigestDbMock({
      lowStockRows: [makeLowStockRow({ restaurant_id: "la" })],
      restaurantsRows: [
        { id: "la", name: "LA House", timezone: "America/Los_Angeles" },
      ],
      prefsByRestaurant: { la: dailyPrefs("20:00") },
    });
    const svc = build(mock);

    // 2026-09-27T03:00Z = 2026-09-26T20:00 PDT (UTC-7).
    await svc.runDigestSweepAt(new Date("2026-09-27T03:00:00Z"));

    expect(notifications.persistForRestaurant).toHaveBeenCalledTimes(1);
    const payload = notifications.persistForRestaurant.mock.calls[0][1];
    expect(payload.groupKey).toBe("low_stock_digest:2026-09-26");
  });

  it("c. NY fall-back 2026-11-01, hour 1: sweeping both 05:00Z and 06:00Z sends exactly once", async () => {
    const { mock } = makeDigestDbMock({
      lowStockRows: [makeLowStockRow({ restaurant_id: "ny" })],
      restaurantsRows: [
        { id: "ny", name: "NY House", timezone: "America/New_York" },
      ],
      prefsByRestaurant: { ny: dailyPrefs("01:00") },
    });
    const svc = build(mock);

    await svc.runDigestSweepAt(new Date("2026-11-01T05:00:00Z"));
    await svc.runDigestSweepAt(new Date("2026-11-01T06:00:00Z"));

    expect(gmail.sendLowStockDigest).toHaveBeenCalledTimes(1);
  });

  it("d. NY spring-forward 2026-03-08, hour 2: sweeping 05:00Z through 09:00Z sends exactly once, at the 07:00Z sweep", async () => {
    const { mock } = makeDigestDbMock({
      lowStockRows: [makeLowStockRow({ restaurant_id: "ny" })],
      restaurantsRows: [
        { id: "ny", name: "NY House", timezone: "America/New_York" },
      ],
      prefsByRestaurant: { ny: dailyPrefs("02:00") },
    });
    const svc = build(mock);

    for (const h of [5, 6, 7, 8, 9]) {
      await svc.runDigestSweepAt(new Date(`2026-03-08T0${h}:00:00Z`));
    }

    expect(gmail.sendLowStockDigest).toHaveBeenCalledTimes(1);
  });

  describe("e. durable gate on last_digest_at", () => {
    it("a last_digest_at on the SAME house date suppresses a second send at the same tick", async () => {
      const tick = hourTick(new Date());
      const zone = "America/New_York";
      const hour = Math.floor(
        Number(
          new Intl.DateTimeFormat("en-US", {
            timeZone: zone,
            hour: "2-digit",
            hour12: false,
          }).format(tick),
        ) % 24,
      );
      const { mock } = makeDigestDbMock({
        lowStockRows: [makeLowStockRow({ restaurant_id: "ny" })],
        restaurantsRows: [{ id: "ny", name: "NY House", timezone: zone }],
        prefsByRestaurant: {
          ny: dailyPrefs(`${String(hour).padStart(2, "0")}:00`),
        },
      });
      const svc = build(mock);

      await svc.runDigestSweepAt(tick);
      expect(gmail.sendLowStockDigest).toHaveBeenCalledTimes(1);

      await svc.runDigestSweepAt(tick);
      expect(gmail.sendLowStockDigest).toHaveBeenCalledTimes(1); // unchanged
    });

    it("a last_digest_at on a PREVIOUS house date still sends", async () => {
      const { mock } = makeDigestDbMock({
        lowStockRows: [makeLowStockRow({ restaurant_id: "ny" })],
        restaurantsRows: [
          { id: "ny", name: "NY House", timezone: "America/New_York" },
        ],
        prefsByRestaurant: { ny: dailyPrefs("12:00") },
        initialLastDigestAt: { ny: "2026-09-01T16:00:00.000Z" }, // 2026-09-01 12:00 EDT
      });
      const svc = build(mock);

      // 2026-09-26T16:00Z = 2026-09-26 12:00 EDT — a later house date.
      await svc.runDigestSweepAt(new Date("2026-09-26T16:00:00Z"));
      expect(gmail.sendLowStockDigest).toHaveBeenCalledTimes(1);
    });

    it("a read error on last_digest_at SKIPS the send (never risks a double) and warns", async () => {
      const { mock } = makeDigestDbMock({
        lowStockRows: [makeLowStockRow({ restaurant_id: "ny" })],
        restaurantsRows: [
          { id: "ny", name: "NY House", timezone: "America/New_York" },
        ],
        prefsByRestaurant: { ny: dailyPrefs("12:00") },
        lastDigestAtReadError: true,
      });
      const svc = build(mock);
      const warnSpy = jest.spyOn((svc as any).logger, "warn");

      await svc.runDigestSweepAt(new Date("2026-09-26T16:00:00Z"));

      expect(gmail.sendLowStockDigest).not.toHaveBeenCalled();
      expect(notifications.persistForRestaurant).not.toHaveBeenCalled();
      expect(
        warnSpy.mock.calls.some((c) =>
          String(c[0]).includes("LOW_STOCK_DIGEST_DEDUPE_UNREADABLE"),
        ),
      ).toBe(true);
    });
  });

  it("f. a zoneless house is sent on UTC hour 12, and warns LOW_STOCK_DIGEST_TIMEZONE_UNKNOWN once, on that tick only", async () => {
    const { mock } = makeDigestDbMock({
      lowStockRows: [makeLowStockRow({ restaurant_id: "zoneless" })],
      restaurantsRows: [
        { id: "zoneless", name: "No-Zone House", timezone: null },
      ],
      prefsByRestaurant: { zoneless: dailyPrefs("12:00") },
    });
    const svc = build(mock);
    const warnSpy = jest.spyOn((svc as any).logger, "warn");

    // Not the tick — no warn, no send.
    await svc.runDigestSweepAt(new Date("2026-09-26T11:00:00Z"));
    expect(gmail.sendLowStockDigest).not.toHaveBeenCalled();
    expect(
      warnSpy.mock.calls.some((c) =>
        String(c[0]).includes("LOW_STOCK_DIGEST_TIMEZONE_UNKNOWN"),
      ),
    ).toBe(false);

    // The tick — one warn, one send.
    await svc.runDigestSweepAt(new Date("2026-09-26T12:00:00Z"));
    expect(gmail.sendLowStockDigest).toHaveBeenCalledTimes(1);
    const unknownWarns = warnSpy.mock.calls.filter((c) =>
      String(c[0]).includes("LOW_STOCK_DIGEST_TIMEZONE_UNKNOWN"),
    );
    expect(unknownWarns).toHaveLength(1);
    // The log must not claim /notifications states the fallback: no page
    // copy says so yet (item 61's page line is owed by the #486 lane).
    expect(String(unknownWarns[0][0])).not.toMatch(/page/i);
  });

  it("h. a read error on restaurants (house timezone/country) skips that house's tick and warns, rather than defaulting to UTC", async () => {
    const { mock } = makeDigestDbMock({
      lowStockRows: [makeLowStockRow({ restaurant_id: "ny" })],
      restaurantsRows: [
        { id: "ny", name: "NY House", timezone: "America/New_York" },
      ],
      prefsByRestaurant: { ny: dailyPrefs("12:00") },
      restaurantsReadError: true,
    });
    const svc = build(mock);
    const warnSpy = jest.spyOn((svc as any).logger, "warn");

    // 16:00Z is noon in New York (EDT, UTC-4) — the house's own hour, had
    // the read succeeded. It must NOT fall through to the UTC fallback
    // clock (which would also fire at a different hour) or send silently.
    await svc.runDigestSweepAt(new Date("2026-09-26T16:00:00Z"));

    expect(gmail.sendLowStockDigest).not.toHaveBeenCalled();
    const unreadable = warnSpy.mock.calls.filter((c) =>
      String(c[0]).includes("LOW_STOCK_DIGEST_HOUSE_UNREADABLE"),
    );
    expect(unreadable).toHaveLength(1);
    // The warn must say a later tick catches it up (spec i measures that).
    expect(String(unreadable[0][0])).toContain(
      "a later tick today catches it up",
    );
    // And it must never be confused with "no timezone recorded" — that is a
    // different fact (a genuinely zoneless house) from "could not be read".
    expect(
      warnSpy.mock.calls.some((c) =>
        String(c[0]).includes("LOW_STOCK_DIGEST_TIMEZONE_UNKNOWN"),
      ),
    ).toBe(false);
  });

  // i, j, k and l pin SAME-DAY CATCH-UP (founder item 70, 2026-09-27,
  // "Catch up same day (Recommended)"). Before it, i and j pinned the
  // opposite: a crossing tick that was not evaluated lost that house's day
  // (TD-2026-09-27-LOW-STOCK-DIGEST-NO-CATCH-UP, now resolved).
  it("i. catch-up: a restaurants read failure at the house's hour is made up by the next tick, sent exactly once that day", async () => {
    const opts = {
      lowStockRows: [makeLowStockRow({ restaurant_id: "ny" })],
      restaurantsRows: [
        { id: "ny", name: "NY House", timezone: "America/New_York" },
      ],
      prefsByRestaurant: { ny: dailyPrefs("12:00") },
      restaurantsReadError: true,
    };
    const { mock } = makeDigestDbMock(opts);
    const svc = build(mock);

    // 16:00Z = 12:00 EDT, the house's hour — the read fails.
    await svc.runDigestSweepAt(new Date("2026-09-26T16:00:00Z"));
    expect(gmail.sendLowStockDigest).not.toHaveBeenCalled();

    // The read works again for every later tick that local day
    // (17:00Z = 13:00 EDT through 03:00Z = 23:00 EDT).
    opts.restaurantsReadError = false;
    for (
      let t = Date.parse("2026-09-26T17:00:00Z");
      t <= Date.parse("2026-09-27T03:00:00Z");
      t += 3_600_000
    ) {
      await svc.runDigestSweepAt(new Date(t));
    }
    expect(gmail.sendLowStockDigest).toHaveBeenCalledTimes(1);
    expect(notifications.persistForRestaurant.mock.calls[0][1].groupKey).toBe(
      "low_stock_digest:2026-09-26",
    );

    // The next local day's hour sends again, once.
    await svc.runDigestSweepAt(new Date("2026-09-27T16:00:00Z"));
    await svc.runDigestSweepAt(new Date("2026-09-27T17:00:00Z"));
    expect(gmail.sendLowStockDigest).toHaveBeenCalledTimes(2);
    expect(notifications.persistForRestaurant.mock.calls[1][1].groupKey).toBe(
      "low_stock_digest:2026-09-27",
    );
  });

  it("j. catch-up: a cron run at 10:31Z is judged as 11:00Z — the hour-10 house is caught up by it, and each house is sent exactly once that day", async () => {
    const { mock } = makeDigestDbMock({
      lowStockRows: [
        makeLowStockRow({ id: "inv-10", restaurant_id: "h10" }),
        makeLowStockRow({ id: "inv-11", restaurant_id: "h11" }),
      ],
      restaurantsRows: [
        { id: "h10", name: "Ten House", timezone: "UTC" },
        { id: "h11", name: "Eleven House", timezone: "UTC" },
      ],
      prefsByRestaurant: {
        h10: dailyPrefs("10:00"),
        h11: dailyPrefs("11:00"),
      },
    });
    const svc = build(mock);

    // The 10:00Z run fired 31 minutes late, then the 11:00Z run on time.
    // The system clock is set to each run's instant, as in production, so
    // the last_digest_at stamp is written at a realistic time.
    await runAt(svc, "2026-09-26T10:31:00Z");
    expect(
      notifications.persistForRestaurant.mock.calls.map((c) => c[0]).sort(),
    ).toEqual(["h10", "h11"]);
    await runAt(svc, "2026-09-26T11:00:00Z");
    // Every later tick that day.
    for (let h = 12; h <= 23; h++) {
      await runAt(svc, `2026-09-26T${h}:00:00Z`);
    }

    const sentFor = notifications.persistForRestaurant.mock.calls
      .map((c) => c[0])
      .sort();
    expect(sentFor).toEqual(["h10", "h11"]); // each once
    expect(gmail.sendLowStockDigest).toHaveBeenCalledTimes(2);
  });

  it("k. a failed dedupe read SKIPS that tick and never double-sends; the next readable tick sends once", async () => {
    const opts = {
      lowStockRows: [makeLowStockRow({ restaurant_id: "ny" })],
      restaurantsRows: [
        { id: "ny", name: "NY House", timezone: "America/New_York" },
      ],
      prefsByRestaurant: { ny: dailyPrefs("12:00") },
      // Already sent today at 12:00 EDT by another replica / a prior run.
      initialLastDigestAt: { ny: "2026-09-26T16:00:00.000Z" },
      lastDigestAtReadError: true,
    };
    const { mock } = makeDigestDbMock(opts);
    const svc = build(mock);
    const warnSpy = jest.spyOn((svc as any).logger, "warn");

    // 13:00 and 14:00 EDT: the house is due, the dedupe read fails. Sending
    // here would be the second digest of the day, so it must skip.
    await svc.runDigestSweepAt(new Date("2026-09-26T17:00:00Z"));
    await svc.runDigestSweepAt(new Date("2026-09-26T18:00:00Z"));
    expect(gmail.sendLowStockDigest).not.toHaveBeenCalled();
    expect(notifications.persistForRestaurant).not.toHaveBeenCalled();
    const unreadable = warnSpy.mock.calls.filter((c) =>
      String(c[0]).includes("LOW_STOCK_DIGEST_DEDUPE_UNREADABLE"),
    );
    expect(unreadable).toHaveLength(2);
    expect(String(unreadable[0][0])).toContain("skipping this tick");

    // The read works again: today's stamp is seen, still no send today.
    opts.lastDigestAtReadError = false;
    await svc.runDigestSweepAt(new Date("2026-09-26T19:00:00Z"));
    expect(gmail.sendLowStockDigest).not.toHaveBeenCalled();

    // Next day: the read fails at the hour, then works — sent once, late.
    opts.lastDigestAtReadError = true;
    await svc.runDigestSweepAt(new Date("2026-09-27T16:00:00Z"));
    expect(gmail.sendLowStockDigest).not.toHaveBeenCalled();
    opts.lastDigestAtReadError = false;
    await svc.runDigestSweepAt(new Date("2026-09-27T17:00:00Z"));
    await svc.runDigestSweepAt(new Date("2026-09-27T18:00:00Z"));
    expect(gmail.sendLowStockDigest).toHaveBeenCalledTimes(1);
    expect(notifications.persistForRestaurant.mock.calls[0][1].groupKey).toBe(
      "low_stock_digest:2026-09-27",
    );
  });

  it("l. restart: a gateway down across the house's hour sends on its first tick after restart, and a second restart that day does not send again", async () => {
    const { mock, lastDigestAt } = makeDigestDbMock({
      lowStockRows: [makeLowStockRow({ restaurant_id: "ist" })],
      restaurantsRows: [
        { id: "ist", name: "Istanbul House", timezone: "Europe/Istanbul" },
      ],
      prefsByRestaurant: { ist: dailyPrefs("12:00") },
      // Yesterday's digest, 2026-09-25 12:00 Istanbul.
      initialLastDigestAt: { ist: "2026-09-25T09:00:00.000Z" },
    });

    // Down from 08:00Z to 12:00Z (11:00-15:00 Istanbul) — the 09:00Z tick
    // at the house's hour never ran. A fresh process starts at 12:00Z.
    const first = build(mock);
    await runAt(first, "2026-09-26T12:00:00Z");
    await runAt(first, "2026-09-26T13:00:00Z");
    expect(gmail.sendLowStockDigest).toHaveBeenCalledTimes(1);
    expect(notifications.persistForRestaurant.mock.calls[0][1].groupKey).toBe(
      "low_stock_digest:2026-09-26",
    );
    expect(lastDigestAt.ist).toBe("2026-09-26T12:00:00.000Z");

    // Another restart the same day: the new process has no memory of the
    // send; only last_digest_at stops a second one.
    const second = build(mock);
    for (let h = 14; h <= 20; h++) {
      await runAt(second, `2026-09-26T${h}:00:00Z`);
    }
    expect(gmail.sendLowStockDigest).toHaveBeenCalledTimes(1);
  });

  it("m. an unwritten last_digest_at stamp warns, and this process still does not send again that day", async () => {
    const { mock } = makeDigestDbMock({
      lowStockRows: [makeLowStockRow({ restaurant_id: "ny" })],
      restaurantsRows: [
        { id: "ny", name: "NY House", timezone: "America/New_York" },
      ],
      prefsByRestaurant: { ny: dailyPrefs("12:00") },
      upsertError: true,
    });
    const svc = build(mock);
    const warnSpy = jest.spyOn((svc as any).logger, "warn");

    for (
      let t = Date.parse("2026-09-26T16:00:00Z");
      t <= Date.parse("2026-09-27T03:00:00Z");
      t += 3_600_000
    ) {
      await svc.runDigestSweepAt(new Date(t));
    }
    expect(gmail.sendLowStockDigest).toHaveBeenCalledTimes(1);
    expect(
      warnSpy.mock.calls.filter((c) =>
        String(c[0]).includes("LOW_STOCK_DIGEST_STAMP_UNWRITTEN"),
      ),
    ).toHaveLength(1);
  });

  describe("n. the house's zone changes mid-day", () => {
    // "Today" is always the house-local date in the zone the house has at
    // the tick. Both fences (last_digest_at and the in-process one) hold an
    // instant and are re-read in that zone, so each date of the NEW zone gets
    // at most one digest. Counted in the OLD zone, a change can put two on
    // one date. Reachable once a house's zone can be edited (#435).
    it("forward (UTC -> Pacific/Kiritimati, hour 9): two sends on one UTC date, one per Kiritimati date", async () => {
      const house = { id: "kir", name: "Moving House", timezone: "UTC" };
      const { mock } = makeDigestDbMock({
        lowStockRows: [makeLowStockRow({ restaurant_id: "kir" })],
        restaurantsRows: [house],
        prefsByRestaurant: { kir: dailyPrefs("09:00") },
      });
      const svc = build(mock);

      await runAt(svc, "2026-09-26T09:00:00Z");
      house.timezone = "Pacific/Kiritimati";
      for (let h = 10; h <= 23; h++) {
        await runAt(svc, `2026-09-26T${String(h).padStart(2, "0")}:00:00Z`);
      }
      for (let h = 0; h <= 9; h++) {
        await runAt(svc, `2026-09-27T${String(h).padStart(2, "0")}:00:00Z`);
      }

      expect(
        notifications.persistForRestaurant.mock.calls.map((c) => c[1].groupKey),
      ).toEqual(["low_stock_digest:2026-09-26", "low_stock_digest:2026-09-27"]);
      // The second send is 19:00Z, 09:00 on 2026-09-27 in Kiritimati.
      expect(gmail.sendLowStockDigest).toHaveBeenCalledTimes(2);
    });

    it("backward (Pacific/Kiritimati -> UTC, hour 9): the new zone's next date is still sent, by this process too", async () => {
      const house = {
        id: "kir",
        name: "Moving House",
        timezone: "Pacific/Kiritimati",
      };
      const { mock, lastDigestAt } = makeDigestDbMock({
        lowStockRows: [makeLowStockRow({ restaurant_id: "kir" })],
        restaurantsRows: [house],
        prefsByRestaurant: { kir: dailyPrefs("09:00") },
      });
      const svc = build(mock);

      // 19:00Z on the 25th is 09:00 on 2026-09-26 in Kiritimati.
      await runAt(svc, "2026-09-25T19:00:00Z");
      house.timezone = "UTC";
      for (let h = 20; h <= 23; h++) {
        await runAt(svc, `2026-09-25T${h}:00:00Z`);
      }
      for (let h = 0; h <= 23; h++) {
        await runAt(svc, `2026-09-26T${String(h).padStart(2, "0")}:00:00Z`);
      }

      // UTC 2026-09-25 is covered by the 19:00Z send; UTC 2026-09-26 is sent
      // at its own 09:00Z. Both sends fall on Kiritimati date 2026-09-26.
      expect(
        notifications.persistForRestaurant.mock.calls.map((c) => c[1].groupKey),
      ).toEqual(["low_stock_digest:2026-09-26", "low_stock_digest:2026-09-26"]);
      expect(gmail.sendLowStockDigest).toHaveBeenCalledTimes(2);
      expect(lastDigestAt.kir).toBe("2026-09-26T09:00:00.000Z");
    });
  });

  it("j2. a late run before local midnight and the on-time run for the same tick send an hour-0 house exactly once", async () => {
    const { mock, lastDigestAt } = makeDigestDbMock({
      lowStockRows: [makeLowStockRow({ restaurant_id: "h0" })],
      restaurantsRows: [{ id: "h0", name: "Midnight House", timezone: "UTC" }],
      prefsByRestaurant: { h0: dailyPrefs("00:00") },
    });
    const svc = build(mock);

    // 23:31Z on the 26th is judged as the 00:00Z tick of the 27th.
    await runAt(svc, "2026-09-26T23:31:00Z");
    await runAt(svc, "2026-09-27T00:00:00Z");

    expect(gmail.sendLowStockDigest).toHaveBeenCalledTimes(1);
    expect(notifications.persistForRestaurant.mock.calls[0][1].groupKey).toBe(
      "low_stock_digest:2026-09-27",
    );
    // The stamp is the tick, on the date the digest belongs to.
    expect(lastDigestAt.h0).toBe("2026-09-27T00:00:00.000Z");
  });

  describe("g. regressions — no send when preferences say not to", () => {
    it("digest_frequency off gives no send", async () => {
      const { mock } = makeDigestDbMock({
        lowStockRows: [makeLowStockRow({ restaurant_id: "ny" })],
        restaurantsRows: [
          { id: "ny", name: "NY House", timezone: "America/New_York" },
        ],
        prefsByRestaurant: {
          ny: [
            {
              low_stock_enabled: true,
              digest_frequency: "off",
              digest_time: "12:00",
            },
          ],
        },
      });
      const svc = build(mock);
      await svc.runDigestSweepAt(new Date("2026-09-26T16:00:00Z"));
      expect(gmail.sendLowStockDigest).not.toHaveBeenCalled();
    });

    it("low_stock_enabled false for every member gives no send", async () => {
      const { mock } = makeDigestDbMock({
        lowStockRows: [makeLowStockRow({ restaurant_id: "ny" })],
        restaurantsRows: [
          { id: "ny", name: "NY House", timezone: "America/New_York" },
        ],
        prefsByRestaurant: {
          ny: [
            {
              low_stock_enabled: false,
              digest_frequency: "daily",
              digest_time: "12:00",
            },
          ],
        },
      });
      const svc = build(mock);
      await svc.runDigestSweepAt(new Date("2026-09-26T16:00:00Z"));
      expect(gmail.sendLowStockDigest).not.toHaveBeenCalled();
    });
  });
});
