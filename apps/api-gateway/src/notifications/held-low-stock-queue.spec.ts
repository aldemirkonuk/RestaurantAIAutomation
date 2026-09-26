import { LowStockAlertsService } from "./low-stock-alerts.service";

/**
 * The held low-stock queue tells the truth about who has been told
 * (held-queue lane, 2026-09-26; founder round 8 item 51 — the queue is built
 * into the Mudavym /notifications page before the cutover).
 *
 * A held crossing is a wine that dropped below par and that NOBODY has been
 * told about yet. Four ways the queue lied before this file, each pinned here:
 *
 *   1. the instant path returned `Boolean(persisted)`, true for every answer
 *      `persistForRestaurant` gives (it resolves `{ inserted: 0 }`, never
 *      falsy) — a failed inbox write was stamped "alerted" and left the queue;
 *   2. the digest told the house and left the hold in place;
 *   3. a wine back above par kept its hold (recovery reset only the level);
 *   4. the read listed rows in cases 2 and 3 for data written before the fix.
 *
 * And the digest time it reports is null when the preferences cannot be
 * read — never the defaults.
 */

type Row = Record<string, any>;

function makeHarness(
  opts: {
    alertStateRows?: Row[];
    prefsRows?: Row[] | null;
    prefsError?: string;
    persistReturns?: any;
  } = {},
) {
  const upserts: Row[] = [];
  const updates: Array<{ table: string; patch: Row }> = [];

  const makeChain = (table: string): any => {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      neq: () => chain,
      not: () => chain,
      in: () => chain,
      order: () => chain,
      limit: () => chain,
      update: (patch: Row) => {
        updates.push({ table, patch: { ...patch } });
        return chain;
      },
      maybeSingle: () => Promise.resolve({ data: { alert_count: 0 } }),
      upsert: (row: Row) => {
        if (table === "inventory_alert_state") upserts.push({ ...row });
        return Promise.resolve({ error: null });
      },
      then: (resolve: any) =>
        resolve(
          table === "notification_preferences"
            ? opts.prefsError
              ? { data: null, error: { message: opts.prefsError } }
              : { data: opts.prefsRows ?? [], error: null }
            : { data: opts.alertStateRows ?? [], error: null },
        ),
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
  return { service, upserts, updates, notifications };
}

const row = (over: Partial<Row> = {}) => ({
  inventoryId: (over.inventoryId ?? "inv-1") as string,
  wineId: (over.wineId ?? "wine-1") as string,
  wineName: (over.wineName ?? "Tsantali Rapsani") as string,
  currentStock: (over.currentStock ?? 2) as number,
  threshold: (over.threshold ?? 5) as number,
  severity: (over.severity ?? "critical") as "low" | "critical",
});

const ledgerFor = (upserts: Row[], id: string) =>
  [...upserts].reverse().find((u) => u.inventory_id === id);

describe("the instant path counts an inbox row, not an answer", () => {
  it("[REVERT-FAILS] an instant alert whose inbox write came back `inserted: 0` is HELD, not alerted", async () => {
    const { service, upserts } = makeHarness({
      persistReturns: { inserted: 0, ids: [] },
    });
    await service.evaluateRestaurant("r1", [row()], "House");
    const last = ledgerFor(upserts, "inv-1")!;
    expect(last.last_alerted_at).toBeUndefined();
    expect(last.last_held_at).toEqual(expect.any(String));
  });

  it("[REVERT-FAILS] a failed inbox write is held with no reason, not as the house's own settings", async () => {
    const { service, upserts } = makeHarness({
      persistReturns: { inserted: 0, ids: [] },
    });
    await service.evaluateRestaurant("r1", [row()], "House");
    expect(ledgerFor(upserts, "inv-1")!.last_held_reason).toBeNull();
  });

  it("a written inbox row still ends the hold", async () => {
    const { service, upserts } = makeHarness();
    await service.evaluateRestaurant("r1", [row()], "House");
    const last = ledgerFor(upserts, "inv-1")!;
    expect(last.last_alerted_at).toEqual(expect.any(String));
    expect(last.last_held_at).toBeNull();
  });
});

describe("the digest ends the holds it answered", () => {
  it("[REVERT-FAILS] a digest that wrote its inbox row clears every covered hold", async () => {
    const { service, upserts } = makeHarness();
    await service.sendDigest("r1", [
      row({ inventoryId: "a", severity: "low" }),
      row({ inventoryId: "b" }),
    ]);
    for (const id of ["a", "b"]) {
      const last = ledgerFor(upserts, id)!;
      expect(last.last_digest_at).toEqual(expect.any(String));
      expect(last.last_held_at).toBeNull();
      expect(last.last_held_reason).toBeNull();
    }
  });

  it("[REVERT-FAILS] a digest that wrote no inbox row (deduped or failed) leaves the holds and stamps no digest", async () => {
    const { service, upserts } = makeHarness({
      persistReturns: { inserted: 0, ids: [] },
    });
    await service.sendDigest("r1", [row({ inventoryId: "a" })]);
    expect(ledgerFor(upserts, "a")).toBeUndefined();
  });
});

describe("a wine back above par is not held", () => {
  it("[REVERT-FAILS] the real-time recovery path clears the hold with the level", async () => {
    const { service, updates } = makeHarness();
    // No low rows come back for this item, so it is a recovery.
    (service as any).getLowStockForRestaurant = jest.fn().mockResolvedValue([]);
    await service.evaluateInventoryItems("r1", ["inv-9"]);
    const patch = updates.find(
      (u) =>
        u.table === "inventory_alert_state" &&
        u.patch.last_alert_level === "ok",
    )?.patch;
    expect(patch).toBeDefined();
    expect(patch).toMatchObject({ last_held_at: null, last_held_reason: null });
  });

  it("[REVERT-FAILS] the sweep's reconciliation clears the hold with the level", async () => {
    const { service, updates } = makeHarness({
      alertStateRows: [{ restaurant_id: "r1", inventory_id: "inv-9" }],
    });
    await (service as any).reconcileRecoveries(new Map());
    const patch = updates.find(
      (u) =>
        u.table === "inventory_alert_state" &&
        u.patch.last_alert_level === "ok",
    )?.patch;
    expect(patch).toMatchObject({ last_held_at: null, last_held_reason: null });
  });
});

describe("listHeldCrossings", () => {
  const HELD_AT = "2026-09-26T10:00:00.000Z";

  it("[REVERT-FAILS] skips a recovered wine and one the digest already covered (rows written before the writer fix)", async () => {
    const { service } = makeHarness({
      alertStateRows: [
        {
          inventory_id: "waiting",
          wine_name: "Waiting",
          last_alert_level: "critical",
          last_held_at: HELD_AT,
          last_held_reason: "prefs",
          last_digest_at: "2026-09-25T16:00:00.000Z", // older digest
        },
        {
          inventory_id: "recovered",
          wine_name: "Recovered",
          last_alert_level: "ok",
          last_held_at: HELD_AT,
          last_held_reason: "prefs",
          last_digest_at: null,
        },
        {
          inventory_id: "covered",
          wine_name: "Covered",
          last_alert_level: "low",
          last_held_at: HELD_AT,
          last_held_reason: "instant_cooldown",
          last_digest_at: "2026-09-26T16:00:00.000Z", // after the hold
        },
      ],
    });
    const view = await service.listHeldCrossings("r1");
    expect(view.held.map((h) => h.inventory_id)).toEqual(["waiting"]);
    expect(view.summary).toEqual({
      count: 1,
      critical: 1,
      oldest_held_at: HELD_AT,
    });
  });

  it("reports when the digest will tell them, by the hour the cron keeps", async () => {
    const { service } = makeHarness({
      prefsRows: [
        {
          low_stock_enabled: true,
          digest_frequency: "daily",
          digest_time: "17:30",
        },
      ],
    });
    const view = await service.listHeldCrossings("r1");
    expect(view.digest).toEqual({
      low_stock_enabled: true,
      frequency: "daily",
      hour: 17,
      timezone: "America/New_York",
    });
  });

  it("says the digest is off when no member takes it", async () => {
    const { service } = makeHarness({
      prefsRows: [{ low_stock_enabled: true, digest_frequency: "off" }],
    });
    const view = await service.listHeldCrossings("r1");
    expect(view.digest?.frequency).toBe("off");
  });

  it("[REVERT-FAILS] an unreadable preferences read is `digest: null`, never the 12:00 defaults", async () => {
    const { service } = makeHarness({ prefsError: "boom" });
    const view = await service.listHeldCrossings("r1");
    expect(view.digest).toBeNull();
  });

  it("the senders still fall back to the defaults when preferences are unreadable", async () => {
    const { service, notifications } = makeHarness({ prefsError: "boom" });
    await service.evaluateRestaurant("r1", [row()], "House");
    // Defaults: instant-first on, so the crossing alerts immediately.
    expect(notifications.persistForRestaurant).toHaveBeenCalledTimes(1);
  });
});
