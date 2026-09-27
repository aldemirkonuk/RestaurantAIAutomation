import { LowStockAlertsService } from "./low-stock-alerts.service";
import { hourTick } from "./low-stock-digest-clock";

/**
 * Table-keyed Supabase stub, separate from `low-stock-alerts.service.spec.ts`'s
 * `makeDbMock` because that one returns the SAME rows for every table
 * (`v_low_stock_items`, `restaurants`, `notification_preferences`,
 * `inventory_alert_state`), which cannot express "an Istanbul house and an LA
 * house with different digest hours" or "restaurants has no zone but the
 * house was already sent today". This mock varies by table AND (for
 * `restaurants` / `notification_preferences` / `low_stock_digest_fence`) by
 * the restaurant_id in the query.
 *
 * `low_stock_digest_fence` (founder item 74) is kept the way PostgREST keeps
 * it: `attempted_at` is stored and returned as `…+00:00`, and the claim's
 * UPDATE matches only when its `attempted_at` filter is that exact string —
 * so a claim that compared a re-formatted instant would never match, and a
 * claim racing a newer row loses, as the WHERE does in Postgres.
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
  /**
   * Seed `low_stock_digest_fence`, per restaurant: the tick of the last
   * attempt (ISO) and, optionally, the house date it was for.
   */
  initialFence?: Record<string, { attempted_at: string; sent_on?: string }>;
  /** Force the batched fence read itself to error (network/DB failure). */
  fenceReadError?: boolean;
  /** Force every fence claim (insert or compare-and-set update) to error. */
  fenceWriteError?: boolean;
  /**
   * What the fence READ returns for a house instead of the stored row —
   * a replica that read the fence before another run claimed it. `null`
   * reads as "no row". The claim still meets the stored row.
   */
  staleFenceRead?: Record<
    string,
    { attempted_at: string; sent_on: string } | null
  >;
  /** Rows the held-queue read (`listHeldCrossings`) returns (spec q). */
  heldRows?: any[];
  /**
   * Force the `restaurants` read itself to error (network/DB failure) —
   * exercised by getRestaurantHouses' `ok` flag, distinct from a house that
   * genuinely has no timezone recorded (`timezone: null` with no error).
   */
  restaurantsReadError?: boolean;
  /** Force every `inventory_alert_state` upsert (the digest stamp) to error. */
  upsertError?: boolean;
  /**
   * Force the `notification_preferences` read itself to error (network/DB
   * failure) — distinct from a house whose members saved no preferences
   * (an empty, successful read, which means the defaults) (spec o).
   */
  prefsReadError?: boolean;
  /**
   * Force the strict member read (`getRestaurantMemberIdsOrThrow`, which
   * `readLowStockPrefs` uses) to throw (spec o).
   */
  memberIdsReadError?: boolean;
}) {
  const lastDigestAt: Record<string, string> = {};
  const upsertRows: any[] = [];
  /** PostgREST's text for a timestamptz: `2026-09-26T09:00:00+00:00`. */
  const pgTs = (iso: string) =>
    new Date(iso).toISOString().replace(/\.000Z$/, "+00:00");
  const fence: Record<string, { sent_on: string; attempted_at: string }> = {};
  for (const [rid, f] of Object.entries(opts.initialFence ?? {})) {
    fence[rid] = {
      sent_on: f.sent_on ?? f.attempted_at.slice(0, 10),
      attempted_at: pgTs(f.attempted_at),
    };
  }
  const fenceClaims: Array<{ restaurant_id: string; sent_on: string }> = [];
  const FENCE = "low_stock_digest_fence";

  function claimInsert(row: any): Promise<any> {
    if (opts.fenceWriteError) {
      return Promise.resolve({
        data: null,
        error: { message: "write failed" },
      });
    }
    if (fence[row.restaurant_id]) {
      return Promise.resolve({
        data: null,
        error: { code: "23505", message: "duplicate key" },
      });
    }
    fence[row.restaurant_id] = {
      sent_on: row.sent_on,
      attempted_at: pgTs(row.attempted_at),
    };
    fenceClaims.push({
      restaurant_id: row.restaurant_id,
      sent_on: row.sent_on,
    });
    return Promise.resolve({
      data: [{ restaurant_id: row.restaurant_id }],
      error: null,
    });
  }

  function claimUpdate(row: any, eqs: Array<[string, any]>): Promise<any> {
    if (opts.fenceWriteError) {
      return Promise.resolve({
        data: null,
        error: { message: "write failed" },
      });
    }
    const rid = eqs.find(([c]) => c === "restaurant_id")?.[1];
    const expected = eqs.find(([c]) => c === "attempted_at")?.[1];
    const cur = rid ? fence[rid] : undefined;
    if (!cur || expected === undefined || cur.attempted_at !== expected) {
      return Promise.resolve({ data: [], error: null });
    }
    fence[rid] = { sent_on: row.sent_on, attempted_at: pgTs(row.attempted_at) };
    fenceClaims.push({ restaurant_id: rid, sent_on: row.sent_on });
    return Promise.resolve({ data: [{ restaurant_id: rid }], error: null });
  }

  function chainFor(table: string): any {
    const chain: any = {
      _eqs: [] as Array<[string, any]>,
      _in: undefined as string[] | undefined,
      // `select` also ends the digest stamp's conditional clear-hold write
      // (`update(row)...or(...).select(...)`, upsertState since #486), and
      // the fence's compare-and-set update.
      select: () =>
        chain._update
          ? table === FENCE
            ? claimUpdate(chain._update, chain._eqs)
            : writeStamp(chain._update)
          : chain,
      insert: (row: any) => ({ select: () => claimInsert(row) }),
      or: () => chain,
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
      update: (row: any) => {
        chain._update = row;
        return chain;
      },
      upsert: (row: any) => {
        const result = writeStamp(row);
        // Awaited bare, or ended with `.select()` (the clear-hold insert).
        return { then: (r: any) => result.then(r), select: () => result };
      },
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
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
          if (opts.prefsReadError) {
            return resolve({ data: null, error: { message: "fetch failed" } });
          }
          const rid = chain._eqs.find(([c]: any) => c === "restaurant_id")?.[1];
          return resolve({
            data: opts.prefsByRestaurant[rid] ?? [],
            error: null,
          });
        }
        if (table === "notifications") {
          return resolve({ data: [], error: null });
        }
        if (table === FENCE) {
          if (opts.fenceReadError) {
            return resolve({ data: null, error: { message: "fetch failed" } });
          }
          const ids = (chain._in as string[] | undefined) ?? [];
          const stale = opts.staleFenceRead;
          const rows = ids.flatMap((rid) => {
            if (stale && rid in stale) {
              const r = stale[rid];
              return r
                ? [
                    {
                      restaurant_id: rid,
                      sent_on: r.sent_on,
                      attempted_at: pgTs(r.attempted_at),
                    },
                  ]
                : [];
            }
            return fence[rid] ? [{ restaurant_id: rid, ...fence[rid] }] : [];
          });
          return resolve({ data: rows, error: null });
        }
        if (table === "inventory_alert_state" && opts.heldRows) {
          return resolve({ data: opts.heldRows, error: null });
        }
        return resolve({ data: [], error: null });
      },
    };
    function writeStamp(row: any): Promise<any> {
      if (opts.upsertError) {
        return Promise.resolve({
          data: null,
          error: { message: "write failed" },
        });
      }
      upsertRows.push(row);
      if (table === "inventory_alert_state" && row.last_digest_at) {
        lastDigestAt[row.restaurant_id] = row.last_digest_at;
      }
      return Promise.resolve({
        data: [{ inventory_id: row.inventory_id }],
        error: null,
      });
    }
    return chain;
  }

  return {
    mock: {
      supabase: { from: (t: string) => chainFor(t) },
      getRestaurantMemberIds: jest.fn().mockResolvedValue(["user-1"]),
      getRestaurantMemberIdsOrThrow: jest.fn(async () => {
        if (opts.memberIdsReadError) throw new Error("fetch failed");
        return ["user-1"];
      }),
    } as any,
    upsertRows,
    lastDigestAt,
    fence,
    fenceClaims,
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

  describe("e. durable gate on the digest fence (founder item 74)", () => {
    it("a fence on the SAME house date suppresses a second send at the same tick", async () => {
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

    it("a fence on a PREVIOUS house date still sends, and the claim moves it to today", async () => {
      const { mock, fence } = makeDigestDbMock({
        lowStockRows: [makeLowStockRow({ restaurant_id: "ny" })],
        restaurantsRows: [
          { id: "ny", name: "NY House", timezone: "America/New_York" },
        ],
        prefsByRestaurant: { ny: dailyPrefs("12:00") },
        initialFence: { ny: { attempted_at: "2026-09-01T16:00:00.000Z" } }, // 2026-09-01 12:00 EDT
      });
      const svc = build(mock);

      // 2026-09-26T16:00Z = 2026-09-26 12:00 EDT — a later house date.
      await svc.runDigestSweepAt(new Date("2026-09-26T16:00:00Z"));
      expect(gmail.sendLowStockDigest).toHaveBeenCalledTimes(1);
      expect(fence.ny).toEqual({
        sent_on: "2026-09-26",
        attempted_at: "2026-09-26T16:00:00+00:00",
      });
    });

    it("a read error on the fence SKIPS the send (never risks a double) and warns", async () => {
      const { mock } = makeDigestDbMock({
        lowStockRows: [makeLowStockRow({ restaurant_id: "ny" })],
        restaurantsRows: [
          { id: "ny", name: "NY House", timezone: "America/New_York" },
        ],
        prefsByRestaurant: { ny: dailyPrefs("12:00") },
        fenceReadError: true,
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
      initialFence: { ny: { attempted_at: "2026-09-26T16:00:00.000Z" } },
      fenceReadError: true,
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

    // The read works again: today's claim is seen, still no send today.
    opts.fenceReadError = false;
    await svc.runDigestSweepAt(new Date("2026-09-26T19:00:00Z"));
    expect(gmail.sendLowStockDigest).not.toHaveBeenCalled();

    // Next day: the read fails at the hour, then works — sent once, late.
    opts.fenceReadError = true;
    await svc.runDigestSweepAt(new Date("2026-09-27T16:00:00Z"));
    expect(gmail.sendLowStockDigest).not.toHaveBeenCalled();
    opts.fenceReadError = false;
    await svc.runDigestSweepAt(new Date("2026-09-27T17:00:00Z"));
    await svc.runDigestSweepAt(new Date("2026-09-27T18:00:00Z"));
    expect(gmail.sendLowStockDigest).toHaveBeenCalledTimes(1);
    expect(notifications.persistForRestaurant.mock.calls[0][1].groupKey).toBe(
      "low_stock_digest:2026-09-27",
    );
  });

  it("l. restart: a gateway down across the house's hour sends on its first tick after restart, and a second restart that day does not send again", async () => {
    const { mock, lastDigestAt, fence } = makeDigestDbMock({
      lowStockRows: [makeLowStockRow({ restaurant_id: "ist" })],
      restaurantsRows: [
        { id: "ist", name: "Istanbul House", timezone: "Europe/Istanbul" },
      ],
      prefsByRestaurant: { ist: dailyPrefs("12:00") },
      // Yesterday's digest, 2026-09-25 12:00 Istanbul.
      initialFence: {
        ist: {
          attempted_at: "2026-09-25T09:00:00.000Z",
          sent_on: "2026-09-25",
        },
      },
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
    expect(fence.ist).toEqual({
      sent_on: "2026-09-26",
      attempted_at: "2026-09-26T12:00:00+00:00",
    });

    // Another restart the same day: the new process has no memory of the
    // send; only the fence stops a second one.
    const second = build(mock);
    for (let h = 14; h <= 20; h++) {
      await runAt(second, `2026-09-26T${h}:00:00Z`);
    }
    expect(gmail.sendLowStockDigest).toHaveBeenCalledTimes(1);
  });

  it("m. an unwritten last_digest_at stamp warns, and the fence still stops a second send that day — by a restarted process too", async () => {
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
      t <= Date.parse("2026-09-26T20:00:00Z");
      t += 3_600_000
    ) {
      await svc.runDigestSweepAt(new Date(t));
    }
    // A restart: before item 74 only this process's memory fenced an
    // unwritten stamp, and a fresh one sent again.
    const restarted = build(mock);
    for (
      let t = Date.parse("2026-09-26T21:00:00Z");
      t <= Date.parse("2026-09-27T03:00:00Z");
      t += 3_600_000
    ) {
      await restarted.runDigestSweepAt(new Date(t));
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
    // the tick. The fence's `attempted_at` is an instant re-read in that
    // zone (founder item 74; before it, last_digest_at and an in-process
    // map did the same), so each date of the NEW zone gets at most one
    // digest. Counted in the OLD zone, a change can put two on
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

    it("backward (Pacific/Kiritimati -> UTC, hour 9): the new zone's next date is still sent, though sent_on already reads that date", async () => {
      const house = {
        id: "kir",
        name: "Moving House",
        timezone: "Pacific/Kiritimati",
      };
      const { mock, lastDigestAt, fenceClaims } = makeDigestDbMock({
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
      // Both claims read "2026-09-26": the compare is on the instant, not
      // on sent_on, or UTC's 26th would have been lost.
      expect(fenceClaims.map((c) => c.sent_on)).toEqual([
        "2026-09-26",
        "2026-09-26",
      ]);
    });
  });

  it("j2. a late run before local midnight and the on-time run for the same tick send an hour-0 house exactly once", async () => {
    const { mock, lastDigestAt, fence } = makeDigestDbMock({
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
    // The FENCE holds the tick, on the date the digest belongs to — that is
    // what stops the on-time run. last_digest_at holds when the rows were
    // read (23:31Z), no longer the tick (founder item 74; spec q).
    expect(fence.h0).toEqual({
      sent_on: "2026-09-27",
      attempted_at: "2026-09-27T00:00:00+00:00",
    });
    expect(lastDigestAt.h0).toBe("2026-09-26T23:31:00.000Z");
  });

  // o. PR #488 audit at 7b2ab8d3f: a failed preferences read used to fall
  // back to the defaults (on, daily, 12:00). Under catch-up every tick from
  // local noon on is then due, so a house set to 18:00 was sent at the first
  // failed tick after noon, and that stamp suppressed its real 18:00 send.
  describe("o. a failed preferences read SKIPS the house's tick — never the 12:00 defaults", () => {
    it("an 18:00 house whose read fails at 13:00 local is not sent early, and is sent once at 18:00", async () => {
      const opts = {
        lowStockRows: [makeLowStockRow({ restaurant_id: "ny" })],
        restaurantsRows: [
          { id: "ny", name: "NY House", timezone: "America/New_York" },
        ],
        prefsByRestaurant: { ny: dailyPrefs("18:00") },
        prefsReadError: true,
      };
      const { mock, lastDigestAt } = makeDigestDbMock(opts);
      const svc = build(mock);
      const warnSpy = jest.spyOn((svc as any).logger, "warn");

      // 17:00Z = 13:00 EDT: past the DEFAULT hour (12), before the house's.
      await svc.runDigestSweepAt(new Date("2026-09-26T17:00:00Z"));
      expect(gmail.sendLowStockDigest).not.toHaveBeenCalled();
      expect(notifications.persistForRestaurant).not.toHaveBeenCalled();
      expect(lastDigestAt.ny).toBeUndefined();
      const skipped = warnSpy.mock.calls.filter((c) =>
        String(c[0]).includes("LOW_STOCK_DIGEST_PREFS_UNREADABLE"),
      );
      expect(skipped).toHaveLength(1);
      expect(String(skipped[0][0])).toContain("restaurant=ny");

      // Readable again: 14:00-17:00 EDT are not due for an 18:00 house.
      opts.prefsReadError = false;
      for (const iso of [
        "2026-09-26T18:00:00Z",
        "2026-09-26T19:00:00Z",
        "2026-09-26T20:00:00Z",
        "2026-09-26T21:00:00Z",
      ]) {
        await svc.runDigestSweepAt(new Date(iso));
      }
      expect(gmail.sendLowStockDigest).not.toHaveBeenCalled();

      // 22:00Z = 18:00 EDT: the house's own hour sends, once.
      await svc.runDigestSweepAt(new Date("2026-09-26T22:00:00Z"));
      await svc.runDigestSweepAt(new Date("2026-09-26T23:00:00Z"));
      expect(gmail.sendLowStockDigest).toHaveBeenCalledTimes(1);
      expect(notifications.persistForRestaurant.mock.calls[0][1].groupKey).toBe(
        "low_stock_digest:2026-09-26",
      );
    });

    it("a house with the digest OFF is never sent while its preferences read fails, on any tick of the day", async () => {
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
        prefsReadError: true,
      });
      const svc = build(mock);
      // 16:00Z (12:00 EDT) through 03:00Z (23:00 EDT).
      for (
        let t = Date.parse("2026-09-26T16:00:00Z");
        t <= Date.parse("2026-09-27T03:00:00Z");
        t += 3_600_000
      ) {
        await svc.runDigestSweepAt(new Date(t));
      }
      expect(gmail.sendLowStockDigest).not.toHaveBeenCalled();
      expect(notifications.persistForRestaurant).not.toHaveBeenCalled();
    });

    it("a failed member read (the strict one) skips the tick too, and the next readable tick catches up", async () => {
      const opts = {
        lowStockRows: [makeLowStockRow({ restaurant_id: "ny" })],
        restaurantsRows: [
          { id: "ny", name: "NY House", timezone: "America/New_York" },
        ],
        prefsByRestaurant: { ny: dailyPrefs("12:00") },
        memberIdsReadError: true,
      };
      const { mock } = makeDigestDbMock(opts);
      const svc = build(mock);
      const warnSpy = jest.spyOn((svc as any).logger, "warn");

      await svc.runDigestSweepAt(new Date("2026-09-26T16:00:00Z"));
      expect(gmail.sendLowStockDigest).not.toHaveBeenCalled();
      expect(
        warnSpy.mock.calls.some((c) =>
          String(c[0]).includes("LOW_STOCK_DIGEST_PREFS_UNREADABLE"),
        ),
      ).toBe(true);

      opts.memberIdsReadError = false;
      await svc.runDigestSweepAt(new Date("2026-09-26T17:00:00Z"));
      await svc.runDigestSweepAt(new Date("2026-09-26T18:00:00Z"));
      expect(gmail.sendLowStockDigest).toHaveBeenCalledTimes(1);
    });
  });

  // p, q and r pin the digest fence (founder item 74, 2026-09-27, verbatim
  // "Own fence column (Recommended)"): `low_stock_digest_fence`, claimed
  // compare-and-set before the email, independent of the inbox row and of
  // last_digest_at.
  describe("p. the fence is claimed compare-and-set before the send; a lost or failed claim never sends", () => {
    const nyHouse = () => ({
      lowStockRows: [makeLowStockRow({ restaurant_id: "ny" })],
      restaurantsRows: [
        { id: "ny", name: "NY House", timezone: "America/New_York" },
      ],
      prefsByRestaurant: { ny: dailyPrefs("12:00") },
    });

    it("a fence write that fails SKIPS the tick and warns; the next tick claims and sends once", async () => {
      const opts: any = { ...nyHouse(), fenceWriteError: true };
      const { mock } = makeDigestDbMock(opts);
      const svc = build(mock);
      const warnSpy = jest.spyOn((svc as any).logger, "warn");

      await svc.runDigestSweepAt(new Date("2026-09-26T16:00:00Z"));
      expect(gmail.sendLowStockDigest).not.toHaveBeenCalled();
      expect(notifications.persistForRestaurant).not.toHaveBeenCalled();
      const unwritten = warnSpy.mock.calls.filter((c) =>
        String(c[0]).includes("LOW_STOCK_DIGEST_FENCE_UNWRITTEN"),
      );
      expect(unwritten).toHaveLength(1);
      expect(String(unwritten[0][0])).toContain("skipping this tick");

      opts.fenceWriteError = false;
      for (const iso of [
        "2026-09-26T17:00:00Z",
        "2026-09-26T18:00:00Z",
        "2026-09-26T19:00:00Z",
      ]) {
        await svc.runDigestSweepAt(new Date(iso));
      }
      expect(gmail.sendLowStockDigest).toHaveBeenCalledTimes(1);
    });

    it("a second replica that read NO row before the first claimed loses the insert (23505) and does not send", async () => {
      const opts: any = nyHouse();
      const { mock, fenceClaims } = makeDigestDbMock(opts);
      const warnSpy = jest.fn();

      await build(mock).runDigestSweepAt(new Date("2026-09-26T16:00:00Z"));
      expect(gmail.sendLowStockDigest).toHaveBeenCalledTimes(1);

      opts.staleFenceRead = { ny: null };
      const replica = build(mock);
      jest.spyOn((replica as any).logger, "warn").mockImplementation(warnSpy);
      await replica.runDigestSweepAt(new Date("2026-09-26T16:00:00Z"));
      expect(gmail.sendLowStockDigest).toHaveBeenCalledTimes(1);
      expect(fenceClaims).toHaveLength(1);
      // Lost, not failed: no FENCE_UNWRITTEN warn for a claim another run holds.
      expect(
        warnSpy.mock.calls.some((c) =>
          String(c[0]).includes("LOW_STOCK_DIGEST_FENCE_UNWRITTEN"),
        ),
      ).toBe(false);
    });

    it("a second replica that read YESTERDAY's row before the first claimed loses the compare-and-set and does not send", async () => {
      const yesterday = {
        attempted_at: "2026-09-25T16:00:00.000Z",
        sent_on: "2026-09-25",
      };
      const opts: any = { ...nyHouse(), initialFence: { ny: yesterday } };
      const { mock, fenceClaims, fence } = makeDigestDbMock(opts);

      await build(mock).runDigestSweepAt(new Date("2026-09-26T16:00:00Z"));
      expect(gmail.sendLowStockDigest).toHaveBeenCalledTimes(1);

      opts.staleFenceRead = { ny: yesterday };
      await build(mock).runDigestSweepAt(new Date("2026-09-26T17:00:00Z"));
      expect(gmail.sendLowStockDigest).toHaveBeenCalledTimes(1);
      expect(fenceClaims).toHaveLength(1);
      expect(fence.ny.attempted_at).toBe("2026-09-26T16:00:00+00:00");
    });

    it("two replicas running the same tick at once send exactly once", async () => {
      const { mock, fenceClaims } = makeDigestDbMock(nyHouse());
      await Promise.all([
        build(mock).runDigestSweepAt(new Date("2026-09-26T16:00:00Z")),
        build(mock).runDigestSweepAt(new Date("2026-09-26T16:00:00Z")),
      ]);
      expect(gmail.sendLowStockDigest).toHaveBeenCalledTimes(1);
      expect(fenceClaims).toHaveLength(1);
    });
  });

  it("q. a hold written after a late run read its rows but before its tick stays on the held band", async () => {
    // The 10:00Z run fires 31 minutes late and is judged as the 11:00Z
    // tick. Before item 74, last_digest_at was stamped with that tick
    // (11:00Z), and listHeldCrossings hides a hold that is not after
    // last_digest_at — so a crossing the edge sweep held at 10:40Z, which
    // this digest never told, vanished from the held band.
    const opts: any = {
      lowStockRows: [makeLowStockRow({ id: "inv-1", restaurant_id: "h10" })],
      restaurantsRows: [{ id: "h10", name: "Ten House", timezone: "UTC" }],
      prefsByRestaurant: { h10: dailyPrefs("10:00") },
    };
    const { mock, lastDigestAt, fence } = makeDigestDbMock(opts);
    const svc = build(mock);

    await runAt(svc, "2026-09-26T10:31:00Z");
    expect(gmail.sendLowStockDigest).toHaveBeenCalledTimes(1);
    expect(fence.h10.attempted_at).toBe("2026-09-26T11:00:00+00:00");
    expect(lastDigestAt.h10).toBe("2026-09-26T10:31:00.000Z");

    opts.heldRows = [
      {
        inventory_id: "inv-late",
        wine_name: "Late Wine",
        last_alert_level: "low",
        last_held_at: "2026-09-26T10:40:00.000Z",
        last_held_reason: "instant_cooldown",
        last_digest_at: lastDigestAt.h10,
      },
    ];
    const view = await svc.listHeldCrossings("h10");
    expect(view.held.map((h) => h.inventory_id)).toEqual(["inv-late"]);
  });

  it("r. a digest that wrote no inbox row is still fenced for the day — a restart or a second replica does not email it again", async () => {
    // TD-2026-09-27-LOW-STOCK-DIGEST-UNTOLD-NOT-FENCED: #486 returns before
    // stamping last_digest_at when the inbox write inserted nothing, after
    // the email was attempted. Only this process's memory fenced the day.
    notifications.persistForRestaurant.mockResolvedValue({
      inserted: 0,
      ids: [],
    });
    const { mock, lastDigestAt } = makeDigestDbMock({
      lowStockRows: [makeLowStockRow({ restaurant_id: "ny" })],
      restaurantsRows: [
        { id: "ny", name: "NY House", timezone: "America/New_York" },
      ],
      prefsByRestaurant: { ny: dailyPrefs("12:00") },
    });

    await build(mock).runDigestSweepAt(new Date("2026-09-26T16:00:00Z"));
    expect(gmail.sendLowStockDigest).toHaveBeenCalledTimes(1);
    expect(lastDigestAt.ny).toBeUndefined();

    const restarted = build(mock);
    const replica = build(mock);
    for (
      let t = Date.parse("2026-09-26T17:00:00Z");
      t <= Date.parse("2026-09-27T03:00:00Z");
      t += 3_600_000
    ) {
      await restarted.runDigestSweepAt(new Date(t));
      await replica.runDigestSweepAt(new Date(t));
    }
    expect(gmail.sendLowStockDigest).toHaveBeenCalledTimes(1);
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
