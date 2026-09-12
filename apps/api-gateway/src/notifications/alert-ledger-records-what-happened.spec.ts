import { LowStockAlertsService } from "./low-stock-alerts.service";

/**
 * The alert ledger records alerts that HAPPENED (POS lens, absence-as-health 8).
 *
 * `inventory_alert_state` held 7 rows with `last_alerted_at` stamped and
 * `alert_count` bumped; `notifications` held 2 rows covering 3 wines. Four
 * wines were recorded as alerted and were not: `upsertState` stamps inside the
 * crossing loop, before the instant cooldown and before prefs decide whether
 * anything is sent at all.
 *
 * That is this project's cross-cutting fault at its purest — a system reporting
 * on itself reported ABSENCE (no notification) as HEALTH (alerted at 21:04).
 * Anyone auditing "did we tell them?" read the ledger and got yes.
 */

type Row = Record<string, any>;

function makeHarness(
  opts: {
    alertStateRows?: Row[];
    prefsRows?: Row[] | null;
    persistReturns?: any;
  } = {},
) {
  const upserts: Row[] = [];

  const makeChain = (table: string): any => {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      neq: () => chain,
      in: () => chain,
      update: () => chain,
      maybeSingle: () => Promise.resolve({ data: { alert_count: 0 } }),
      upsert: (row: Row) => {
        if (table === "inventory_alert_state") upserts.push({ ...row });
        return Promise.resolve({ error: null });
      },
      then: (resolve: any) =>
        resolve({
          data:
            table === "notification_preferences"
              ? (opts.prefsRows ?? [])
              : (opts.alertStateRows ?? []),
        }),
    };
    return chain;
  };

  const db = {
    supabase: { from: (t: string) => makeChain(t) },
    getClient: () => ({ from: (t: string) => makeChain(t) }),
    getRestaurantMemberIds: jest.fn().mockResolvedValue(["user-1"]),
  } as any;

  const notifications = {
    persistForRestaurant: jest
      .fn()
      .mockResolvedValue(
        "persistReturns" in opts
          ? opts.persistReturns
          : { inserted: 1, ids: ["n1"] },
      ),
  };
  const gmail = {
    sendLowStockDigest: jest.fn().mockResolvedValue({ success: true }),
  };
  const recipientResolver = {
    resolveRecipients: jest.fn().mockResolvedValue({ emails: ["mgr@x.com"] }),
  };
  const config = { get: jest.fn().mockReturnValue("") };

  const service = new LowStockAlertsService(
    db,
    notifications as any,
    config as any,
    gmail as any,
    recipientResolver as any,
  );
  return { service, upserts, notifications };
}

/** `LowStockRow` is not exported, so this mirrors its shape structurally. */
const row = (over: Partial<Row> = {}) => ({
  inventoryId: (over.inventoryId ?? "inv-1") as string,
  wineId: (over.wineId ?? "wine-1") as string,
  wineName: (over.wineName ?? "Tsantali Rapsani") as string,
  currentStock: (over.currentStock ?? 2) as number,
  threshold: (over.threshold ?? 5) as number,
  severity: (over.severity ?? "critical") as "low" | "critical",
});

/** The last ledger write for a given inventory id. */
const ledgerFor = (upserts: Row[], id: string) =>
  [...upserts].reverse().find((u) => u.inventory_id === id);

describe("inventory_alert_state records alerts that actually happened", () => {
  it("stamps last_alerted_at when a notification WAS created", async () => {
    const { service, upserts, notifications } = makeHarness();

    await service.evaluateRestaurant("r1", [row()], "R1");

    expect(notifications.persistForRestaurant).toHaveBeenCalledTimes(1);
    const led = ledgerFor(upserts, "inv-1")!;
    expect(led.last_alerted_at).toBeTruthy();
    expect(led.alert_count).toBe(1);
    expect(led.last_held_at ?? null).toBeNull();
  });

  it("does NOT stamp last_alerted_at when the crossing was held for the digest", async () => {
    // instantFirstAlert off and criticalImmediate off: the crossing is real,
    // the level advances, and nothing is sent.
    const { service, upserts, notifications } = makeHarness({
      prefsRows: [
        {
          restaurant_id: "r1",
          low_stock_enabled: true,
          instant_first_alert: false,
          critical_immediate: false,
        },
      ],
    });

    await service.evaluateRestaurant("r1", [row()], "R1");

    expect(notifications.persistForRestaurant).not.toHaveBeenCalled();
    const led = ledgerFor(upserts, "inv-1")!;
    // The level still advances — that is the dedupe, and it must persist.
    expect(led.last_alert_level).toBe("critical");
    // But nothing was sent, so nothing may claim it was.
    expect(led.last_alerted_at ?? null).toBeNull();
    expect(led.alert_count ?? 0).toBe(0);
  });

  it("records a held crossing as held, with the reason", async () => {
    const { service, upserts } = makeHarness({
      prefsRows: [
        {
          restaurant_id: "r1",
          low_stock_enabled: true,
          instant_first_alert: false,
          critical_immediate: false,
        },
      ],
    });

    await service.evaluateRestaurant("r1", [row()], "R1");

    const led = ledgerFor(upserts, "inv-1")!;
    expect(led.last_held_at).toBeTruthy();
    expect(led.last_held_reason).toBe("prefs");
  });

  it("records the cooldown as a distinct hold reason", async () => {
    const { service, upserts } = makeHarness();

    // First burst alerts; the second is inside the instant cooldown window.
    await service.evaluateRestaurant("r1", [row()], "R1");
    await service.evaluateRestaurant(
      "r1",
      [row({ inventoryId: "inv-2", wineId: "wine-2", wineName: "Akakies" })],
      "R1",
    );

    const led = ledgerFor(upserts, "inv-2")!;
    expect(led.last_alerted_at ?? null).toBeNull();
    expect(led.last_held_reason).toBe("instant_cooldown");
  });

  it("does not stamp an alert when the notification write returned nothing", async () => {
    // persistForRestaurant resolving falsy means no inbox row exists. Recording
    // an alert here is the exact shape of the defect, one layer down.
    const { service, upserts, notifications } = makeHarness({
      persistReturns: null,
    });

    await service.evaluateRestaurant("r1", [row()], "R1");

    expect(notifications.persistForRestaurant).toHaveBeenCalledTimes(1);
    const led = ledgerFor(upserts, "inv-1")!;
    expect(led.last_alerted_at ?? null).toBeNull();
  });
});
