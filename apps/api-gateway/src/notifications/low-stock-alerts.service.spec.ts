import { LowStockAlertsService } from "./low-stock-alerts.service";

/**
 * Chainable Supabase stub. Awaiting the chain resolves to `listResult`
 * (used by getAlertState); `.maybeSingle()` resolves to `singleResult`
 * (used by the alert-count read); `.upsert()`/terminal writes resolve OK.
 */
function makeDbMock(
  alertStateRows: any[],
  prefsRows: any[] | null = null,
  opts: { upsertError?: boolean } = {},
) {
  // (D5, 2026-09-19) Recorded, not enforced: existing tests never varied
  // restaurant_id, so making `eq` actually filter would change their fixture
  // semantics. Recording lets a new test assert the filter is REQUESTED
  // without touching what every other test in this file already relies on.
  const eqCalls: Array<[string, any]> = [];
  const makeChain = (table: string): any => {
    const chain: any = {
      select: () => chain,
      eq: (col: string, val: any) => {
        if (table === "notification_preferences") eqCalls.push([col, val]);
        return chain;
      },
      neq: () => chain,
      in: () => chain,
      update: () => chain,
      maybeSingle: () => Promise.resolve({ data: { alert_count: 0 } }),
      upsert: () =>
        Promise.resolve(
          opts.upsertError && table === "inventory_alert_state"
            ? { error: { message: "fetch failed" } }
            : { error: null },
        ),
      then: (resolve: any) =>
        resolve({
          data:
            table === "notification_preferences"
              ? (prefsRows ?? [])
              : alertStateRows,
        }),
    };
    return chain;
  };
  return {
    supabase: { from: (t: string) => makeChain(t) },
    getClient: () => ({ from: (t: string) => makeChain(t) }),
    getRestaurantMemberIds: jest.fn().mockResolvedValue(["user-1"]),
    // Test-only escape hatch, not part of the real DatabaseService shape.
    _eqCallsOnNotificationPreferences: eqCalls,
  } as any;
}

function makeRow(over: Partial<any> = {}) {
  return {
    inventoryId: over.inventoryId ?? "inv-1",
    wineId: over.wineId ?? "wine-1",
    wineName: over.wineName ?? "Opus One 2019",
    currentStock: over.currentStock ?? 5,
    threshold: over.threshold ?? 8,
    severity: (over.severity ?? "low") as "low" | "critical",
  };
}

describe("LowStockAlertsService — edge vs. batch decision", () => {
  let notifications: { persistForRestaurant: jest.Mock };
  let gmail: { sendLowStockDigest: jest.Mock };
  let recipientResolver: { resolveRecipients: jest.Mock };
  let config: { get: jest.Mock };

  beforeEach(() => {
    notifications = {
      persistForRestaurant: jest.fn().mockResolvedValue({ inserted: 1 }),
    };
    gmail = {
      sendLowStockDigest: jest.fn().mockResolvedValue({ success: true }),
    };
    recipientResolver = {
      resolveRecipients: jest.fn().mockResolvedValue({ emails: ["mgr@x.com"] }),
    };
    config = { get: jest.fn().mockReturnValue("") };
  });

  function build(
    alertStateRows: any[],
    prefsRows: any[] | null = null,
    opts: { upsertError?: boolean } = {},
  ) {
    return new LowStockAlertsService(
      makeDbMock(alertStateRows, prefsRows, opts),
      notifications as any,
      config as any,
      gmail as any,
      recipientResolver as any,
    );
  }

  it("fires an INSTANT grouped alert on a NEW crossing (ok → low)", async () => {
    const svc = build([]); // no prior state = first time low
    const { newCrossings } = await svc.evaluateRestaurant(
      "r1",
      [makeRow()],
      "R1",
    );

    expect(newCrossings).toHaveLength(1);
    expect(notifications.persistForRestaurant).toHaveBeenCalledTimes(1);
    const payload = notifications.persistForRestaurant.mock.calls[0][1];
    expect(payload.type).toBe("inventory_low_stock");
    expect(payload.metadata.mode).toBe("instant");
    expect(gmail.sendLowStockDigest).toHaveBeenCalledTimes(1);
    expect(gmail.sendLowStockDigest.mock.calls[0][0].mode).toBe("instant");
  });

  /**
   * B1 residue: `inventoryUrl()` used to read
   * `FRONTEND_URL` raw and fall back to the literal `"#"` dead CTA when
   * unset — the exact class of bug `canonicalOrigin()` exists to close
   * elsewhere in this codebase (ADR 0149 row 28 / template-config.ts).
   */
  describe("inventoryUrl() — the digest's CTA link", () => {
    it("never falls back to the dead '#' href when FRONTEND_URL is unset", async () => {
      config.get.mockReturnValue("");
      const svc = build([]);
      await svc.evaluateRestaurant("r1", [makeRow()], "R1");

      const inventoryUrl = gmail.sendLowStockDigest.mock.calls[0][0].inventoryUrl;
      expect(inventoryUrl).toBe("https://mudavym.com/inventory?filter=low-stock");
      expect(inventoryUrl).not.toContain("#");
    });

    it("routes a comma-separated FRONTEND_URL through canonicalOrigin — never glues the whole allow-list into the href", async () => {
      config.get.mockReturnValue(
        "https://mudavym.com,https://www.mudavym.com",
      );
      const svc = build([]);
      await svc.evaluateRestaurant("r1", [makeRow()], "R1");

      const inventoryUrl = gmail.sendLowStockDigest.mock.calls[0][0].inventoryUrl;
      expect(inventoryUrl).toBe("https://mudavym.com/inventory?filter=low-stock");
      expect(inventoryUrl).not.toContain(",");
    });

    it("uses a single-origin FRONTEND_URL as-is", async () => {
      config.get.mockReturnValue("https://custom.example.com/");
      const svc = build([]);
      await svc.evaluateRestaurant("r1", [makeRow()], "R1");

      const inventoryUrl = gmail.sendLowStockDigest.mock.calls[0][0].inventoryUrl;
      expect(inventoryUrl).toBe("https://custom.example.com/inventory?filter=low-stock");
    });
  });

  it("does NOT re-alert a wine that is merely STILL low (low → low)", async () => {
    const svc = build([{ inventory_id: "inv-1", last_alert_level: "low" }]);
    const { newCrossings } = await svc.evaluateRestaurant(
      "r1",
      [makeRow()],
      "R1",
    );

    expect(newCrossings).toHaveLength(0);
    expect(notifications.persistForRestaurant).not.toHaveBeenCalled();
    expect(gmail.sendLowStockDigest).not.toHaveBeenCalled();
  });

  it("re-alerts on ESCALATION (low → critical)", async () => {
    const svc = build([{ inventory_id: "inv-1", last_alert_level: "low" }]);
    const row = makeRow({
      currentStock: 2,
      threshold: 8,
      severity: "critical",
    });
    const { newCrossings } = await svc.evaluateRestaurant("r1", [row], "R1");

    expect(newCrossings).toHaveLength(1);
    expect(notifications.persistForRestaurant).toHaveBeenCalledTimes(1);
    expect(notifications.persistForRestaurant.mock.calls[0][1].priority).toBe(
      "critical",
    );
  });

  it("GROUPS a simultaneous burst into ONE alert + ONE email", async () => {
    const svc = build([]);
    const rows = [
      makeRow({ inventoryId: "inv-1", wineName: "A", severity: "low" }),
      makeRow({
        inventoryId: "inv-2",
        wineName: "B",
        severity: "critical",
        currentStock: 1,
      }),
      makeRow({ inventoryId: "inv-3", wineName: "C", severity: "low" }),
    ];
    const { newCrossings } = await svc.evaluateRestaurant("r1", rows, "R1");

    expect(newCrossings).toHaveLength(3);
    // One grouped inbox notification, one grouped email — not three each.
    expect(notifications.persistForRestaurant).toHaveBeenCalledTimes(1);
    expect(gmail.sendLowStockDigest).toHaveBeenCalledTimes(1);
    const emailArg = gmail.sendLowStockDigest.mock.calls[0][0];
    expect(emailArg.wines).toHaveLength(3);
    // Any critical in the burst escalates the notification priority.
    expect(notifications.persistForRestaurant.mock.calls[0][1].priority).toBe(
      "critical",
    );
  });

  it("HOLDS a new crossing for the digest when instant-first is off", async () => {
    const svc = build(
      [],
      [
        {
          low_stock_enabled: true,
          instant_first_alert: false,
          critical_immediate: false,
          digest_frequency: "daily",
          digest_time: "12:00",
        },
      ],
    );
    const { newCrossings } = await svc.evaluateRestaurant(
      "r1",
      [makeRow()],
      "R1",
    );

    expect(newCrossings).toHaveLength(1); // still tracked for the digest
    expect(notifications.persistForRestaurant).not.toHaveBeenCalled(); // but not fired now
    expect(gmail.sendLowStockDigest).not.toHaveBeenCalled();
  });

  it("still fires CRITICAL immediately with instant-first off but criticalImmediate on", async () => {
    const svc = build(
      [],
      [
        {
          low_stock_enabled: true,
          instant_first_alert: false,
          critical_immediate: true,
          digest_frequency: "daily",
        },
      ],
    );
    const row = makeRow({
      currentStock: 1,
      threshold: 8,
      severity: "critical",
    });
    const { newCrossings } = await svc.evaluateRestaurant("r1", [row], "R1");

    expect(newCrossings).toHaveLength(1);
    expect(notifications.persistForRestaurant).toHaveBeenCalledTimes(1);
  });

  it("skips entirely when low-stock alerts are disabled", async () => {
    const svc = build([], [{ low_stock_enabled: false }]);
    const { newCrossings } = await svc.evaluateRestaurant(
      "r1",
      [makeRow()],
      "R1",
    );

    expect(newCrossings).toHaveLength(0);
    expect(notifications.persistForRestaurant).not.toHaveBeenCalled();
  });

  it("FAIL-CLOSED: does NOT alert when the state write fails (no re-send storm)", async () => {
    // The exact production bug: inventory_alert_state upsert fails ("fetch
    // failed"), so nothing is recorded — the alert must be held, not sent,
    // otherwise the same wine re-fires every 2-minute sweep.
    const svc = build([], null, { upsertError: true });
    const { newCrossings } = await svc.evaluateRestaurant(
      "r1",
      [makeRow()],
      "R1",
    );

    expect(newCrossings).toHaveLength(1); // still detected
    expect(notifications.persistForRestaurant).not.toHaveBeenCalled(); // but NOT alerted
    expect(gmail.sendLowStockDigest).not.toHaveBeenCalled();
  });

  it("(D5, 2026-09-19) scopes the notification_preferences read to this restaurant", async () => {
    // notification_preferences is per (restaurant_id, user_id) since ADR 0149
    // row 39 -- getEffectiveLowStockPrefs used to read `.in("user_id", …)`
    // with no restaurant_id filter, so a member of two houses had the OTHER
    // house's row mixed into this one's aggregate (e.g. its digest_frequency
    // or enabled flag).
    const db = makeDbMock([], []);
    const svc = new LowStockAlertsService(
      db,
      notifications as any,
      config as any,
      gmail as any,
      recipientResolver as any,
    );
    await svc.evaluateRestaurant("r1", [makeRow()], "R1");

    expect(db._eqCallsOnNotificationPreferences).toContainEqual([
      "restaurant_id",
      "r1",
    ]);
  });
});

/**
 * The title the founder read on production carried a siren emoji in front
 * of "50 wines dropped below par".
 *
 * The emoji was the ONLY severity mark the line carried — which is why it read
 * as load-bearing — but it restated `priority` and `metadata.criticalCount`,
 * and being written into the row it could never be restyled or read aloud.
 * These tests pin the replacement: the severity is now stated in WORDS, and
 * nothing is dropped.
 */
describe("LowStockAlertsService — the stored title is plain, and still says the severity", () => {
  const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

  let notifications: { persistForRestaurant: jest.Mock };
  let gmail: { sendLowStockDigest: jest.Mock };
  let recipientResolver: { resolveRecipients: jest.Mock };
  let config: { get: jest.Mock };

  beforeEach(() => {
    notifications = {
      persistForRestaurant: jest.fn().mockResolvedValue({ inserted: 1 }),
    };
    gmail = { sendLowStockDigest: jest.fn().mockResolvedValue({ success: true }) };
    recipientResolver = {
      resolveRecipients: jest.fn().mockResolvedValue({ emails: ["mgr@x.com"] }),
    };
    config = { get: jest.fn().mockReturnValue("") };
  });

  function build(alertStateRows: any[] = []) {
    return new LowStockAlertsService(
      makeDbMock(alertStateRows),
      notifications as any,
      config as any,
      gmail as any,
      recipientResolver as any,
    );
  }

  it("names one wine's severity in words, with no emoji", async () => {
    await build().evaluateRestaurant(
      "r1",
      [makeRow({ severity: "critical", currentStock: 1 })],
      "R1",
    );
    const { title } = notifications.persistForRestaurant.mock.calls[0][1];
    expect(title).toBe("Critical: Opus One 2019");
    expect(title).not.toMatch(EMOJI);
  });

  it("says how many of a burst were critical, instead of prefixing a siren", async () => {
    await build().evaluateRestaurant(
      "r1",
      [
        makeRow({ inventoryId: "inv-1", wineName: "A", severity: "low" }),
        makeRow({
          inventoryId: "inv-2",
          wineName: "B",
          severity: "critical",
          currentStock: 1,
        }),
        makeRow({ inventoryId: "inv-3", wineName: "C", severity: "low" }),
      ],
      "R1",
    );
    const payload = notifications.persistForRestaurant.mock.calls[0][1];
    // The count the emoji could never carry is now in the sentence itself.
    expect(payload.title).toBe("3 wines dropped below par — 1 critical");
    expect(payload.title).not.toMatch(EMOJI);
    // and the structural facts it restated are untouched
    expect(payload.priority).toBe("critical");
    expect(payload.metadata.criticalCount).toBe(1);
  });

  it("says nothing about criticals when there are none", async () => {
    await build().evaluateRestaurant(
      "r1",
      [
        makeRow({ inventoryId: "inv-1", wineName: "A", severity: "low" }),
        makeRow({ inventoryId: "inv-2", wineName: "B", severity: "low" }),
      ],
      "R1",
    );
    const payload = notifications.persistForRestaurant.mock.calls[0][1];
    expect(payload.title).toBe("2 wines dropped below par");
    expect(payload.priority).toBe("high");
  });

  it("keeps the daily digest's title plain too", async () => {
    await build().sendDigest("r1", [makeRow(), makeRow({ inventoryId: "inv-2" })], "R1");
    const { title } = notifications.persistForRestaurant.mock.calls[0][1];
    expect(title).toBe("Low-stock digest: 2 wines below par");
    expect(title).not.toMatch(EMOJI);
  });
});
