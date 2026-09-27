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

    it("a read error on last_digest_at sends anyway (fails open) and warns", async () => {
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

      expect(gmail.sendLowStockDigest).toHaveBeenCalledTimes(1);
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
    expect(
      warnSpy.mock.calls.some((c) =>
        String(c[0]).includes("LOW_STOCK_DIGEST_HOUSE_UNREADABLE"),
      ),
    ).toBe(true);
    // And it must never be confused with "no timezone recorded" — that is a
    // different fact (a genuinely zoneless house) from "could not be read".
    expect(
      warnSpy.mock.calls.some((c) =>
        String(c[0]).includes("LOW_STOCK_DIGEST_TIMEZONE_UNKNOWN"),
      ),
    ).toBe(false);
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
