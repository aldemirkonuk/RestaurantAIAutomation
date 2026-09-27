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
    /**
     * Simulates `getRestaurantMemberIds`'s swallowed read failure
     * (database.service.ts `catch { return []; }`) at the strict layer:
     * `getRestaurantMemberIdsOrThrow` throws this message instead of
     * quietly returning `[]`. Omit to keep the harness's normal single
     * member.
     */
    memberIdsError?: string;
    /**
     * What the clear-hold guard's read (`.select("last_held_at")...
     * .maybeSingle()`) sees as the CURRENT `last_held_at`, simulating a
     * concurrent writer (the edge sweep) having touched the row since the
     * digest snapshotted `rows`. Omit to keep the default `{alert_count:0}`
     * shape every other test in this file relies on.
     */
    guardCurrentHeldAt?: string | null;
  } = {},
) {
  const upserts: Row[] = [];
  const updates: Array<{ table: string; patch: Row }> = [];
  const guardedUpdates: Row[] = [];

  const makeChain = (table: string): any => {
    const chain: any = {
      select: () => {
        if (chain.__updated && table === "inventory_alert_state") {
          // Terminal for the guarded clear-hold update. This simulates real
          // Postgres row-filtering, not an injected outcome: it derives
          // "does the WHERE clause match" from whichever comparison the
          // production code actually issued, checked against the row's
          // CURRENT `last_held_at` (`guardCurrentHeldAt`, standing in for
          // whatever the edge sweep last wrote) --
          //   - `.lte("last_held_at", cutoff)` (round-2 fix): matches only
          //     when the current value is AT OR BEFORE that external cutoff;
          //   - `.eq("last_held_at", X)` (round-1's shape): matches iff the
          //     current value equals X -- and because round-1 code always
          //     passes the value it JUST read as X, this is a self-compare
          //     that matches unconditionally, faithfully reproducing why
          //     that guard could never actually block a clobber.
          // Round 1's harness took "does it match" as its own injectable
          // boolean, independent of `guardCurrentHeldAt` -- which is exactly
          // how it let a self-referential guard pass as a real
          // compare-and-swap. This harness computes it instead.
          const currentHeldAt =
            "guardCurrentHeldAt" in opts ? opts.guardCurrentHeldAt : null;
          let matches: boolean;
          if (chain.__eqLastHeldAt !== undefined) {
            matches = currentHeldAt === chain.__eqLastHeldAt;
          } else if (chain.__lte !== undefined) {
            matches = currentHeldAt != null && currentHeldAt <= chain.__lte;
          } else {
            matches = false;
          }
          return Promise.resolve(
            matches
              ? {
                  data: [{ inventory_id: chain.__patch?.inventory_id }],
                  error: null,
                }
              : { data: [], error: null },
          );
        }
        return chain;
      },
      eq: (col: string, val: string) => {
        if (
          chain.__updated &&
          table === "inventory_alert_state" &&
          col === "last_held_at"
        ) {
          chain.__eqLastHeldAt = val;
        }
        return chain;
      },
      neq: () => chain,
      not: () => chain,
      in: () => chain,
      order: () => chain,
      limit: () => chain,
      lte: (col: string, val: string) => {
        if (table === "inventory_alert_state" && col === "last_held_at") {
          chain.__lte = val;
        }
        return chain;
      },
      update: (patch: Row) => {
        updates.push({ table, patch: { ...patch } });
        if (table === "inventory_alert_state") {
          chain.__updated = true;
          chain.__patch = patch;
          guardedUpdates.push({ ...patch });
        }
        return chain;
      },
      maybeSingle: () =>
        Promise.resolve(
          "guardCurrentHeldAt" in opts
            ? { data: { last_held_at: opts.guardCurrentHeldAt } }
            : { data: { alert_count: 0 } },
        ),
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
    getRestaurantMemberIdsOrThrow: opts.memberIdsError
      ? jest.fn().mockRejectedValue(new Error(opts.memberIdsError))
      : jest.fn().mockResolvedValue(["user-1"]),
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
  return { service, upserts, updates, guardedUpdates, notifications };
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

  /**
   * PR #486 round-2 audit, secondary finding (2026-09-26): `recordAlertOutcome`
   * awaited `upsertState` in a loop but never checked its boolean return. If
   * the clear-hold guard skips a write for a wine that WAS actually alerted
   * (a fresher hold raced in, or the guard's own read failed), the row keeps
   * reading "held" on `listHeldCrossings` even though the alert went out --
   * over-reporting a hold, never under-alerting, but exactly the class of
   * fault this file exists to close, on this call site. Fixed by checking
   * the return value and logging when it happens, since there is nothing
   * else to do (the alert already went out and will not be resent).
   */
  it("[REVERT-FAILS] a guard-skipped clear-hold after a delivered alert is logged, not silently swallowed", async () => {
    const { service, upserts, guardedUpdates } = makeHarness({
      // A hold recorded after the instant path's own snapshot (evaluateRestaurant's
      // `nowIso`, captured at real test-run time) -- a genuinely fresh, still-
      // unnotified crossing that must survive this delivered alert's clear-hold.
      guardCurrentHeldAt: "2099-01-01T00:00:00.000Z",
    });
    const warnSpy = jest.spyOn((service as any).logger, "warn");
    await service.evaluateRestaurant("r1", [row()], "House");
    // `evaluateRestaurant` writes the level unconditionally (plain upsert,
    // no `alertedAt`) BEFORE deciding whether to alert -- that row is in
    // `upserts`, but the alertedAt+clearHold write is a separate call that
    // goes through the guarded-update path (a hold currently exists to
    // protect), never through `upsert()`.
    expect(ledgerFor(upserts, "inv-1")?.last_alerted_at).toBeUndefined();
    expect(guardedUpdates).toHaveLength(1);
    expect(
      warnSpy.mock.calls.some((call) =>
        String(call[0]).includes("was skipped after a delivered alert"),
      ),
    ).toBe(true);
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

  /**
   * PR #486 round-1 audit finding 2 (2026-09-26): the digest snapshots
   * `rows` once and then awaits an email send plus N writes per restaurant —
   * minutes, not milliseconds — while the edge sweep runs every 2 minutes
   * and can record a FRESH, unnotified hold on the same wine in that window.
   * The old clear-hold write was a blind, unconditioned `.upsert()`, which
   * would silently clobber that fresher hold and roll `last_alert_level`
   * back to the stale snapshot value.
   *
   * Round 1's fix read the CURRENT `last_held_at` immediately before writing
   * and conditioned the write on THAT SAME just-read value — a compare
   * against itself, which only protects the read-to-write gap (a single
   * round trip), never the multi-minute gap the finding actually named. Both
   * an independent correctness pass and an independent security pass
   * converged on this exact defect at the round-2 audit (2026-09-26): the
   * harness that "proved" the fix let `guardUpdateMatches` be set
   * independently of `guardCurrentHeldAt`, which the production code could
   * never actually produce.
   *
   * Round 2's fix (below) passes `sendDigest`'s OWN pre-slow-work snapshot
   * (`rowsSnapshotAt`, defaulted to sendDigest's entry time when the caller
   * omits it, as these tests do) down as `clearHoldNotAfter`, and the
   * production code's `.lte("last_held_at", cutoff)` is exercised for real
   * here — the harness only supplies `guardCurrentHeldAt` (what the row
   * currently holds) and computes the match from the cutoff the code itself
   * passed in, not from a second, independently-set boolean.
   */
  it("never falls back to a blind upsert when a hold currently exists — it always goes through the guarded update", async () => {
    const { service, upserts, guardedUpdates } = makeHarness({
      // Long before sendDigest's own snapshot (its entry time, "now" at test
      // run) -- an ordinary hold recorded well before the digest ran, with
      // nothing writing in between.
      guardCurrentHeldAt: "2000-01-01T00:00:00.000Z",
    });
    const warnSpy = jest.spyOn((service as any).logger, "warn");
    await service.sendDigest("r1", [row({ inventoryId: "a" })]);
    expect(upserts.find((u) => u.inventory_id === "a")).toBeUndefined();
    expect(guardedUpdates).toHaveLength(1);
    expect(guardedUpdates[0]).toMatchObject({
      inventory_id: "a",
      last_held_at: null,
      last_held_reason: null,
      last_digest_at: expect.any(String),
    });
    // The guard actually MATCHED (not merely "was attempted") -- no
    // "skipped" warning was logged for this row.
    expect(
      warnSpy.mock.calls.some((c) =>
        String(c[0]).includes("clear-hold skipped"),
      ),
    ).toBe(false);
  });

  it("[REVERT-FAILS] a hold that changed after the digest's snapshot is NOT cleared — the guard blocks the clobber", async () => {
    const { service, upserts, guardedUpdates } = makeHarness({
      // After sendDigest's own snapshot (its entry time) -- the edge sweep
      // recorded a FRESH hold during the digest's email send / write loop,
      // so `last_held_at` is now newer than the cutoff the guarded update
      // compares against.
      guardCurrentHeldAt: "2099-01-01T00:00:00.000Z",
    });
    const warnSpy = jest.spyOn((service as any).logger, "warn");
    await service.sendDigest("r1", [row({ inventoryId: "a" })]);
    // No fallback to the blind upsert -- the fresher hold this digest never
    // told anyone about is left exactly as the edge sweep wrote it.
    expect(upserts.find((u) => u.inventory_id === "a")).toBeUndefined();
    expect(guardedUpdates).toHaveLength(1);
    // The guard must have reported NO match (a genuinely skipped write), not
    // merely "an update was issued" -- `guardedUpdates` records the PATCH
    // object regardless of whether Postgres' WHERE clause matched anything,
    // so this is the assertion that actually distinguishes "blocked" from
    // "blindly succeeded". A guard reverted to comparing a value against
    // itself (round 1's shape) always matches and never logs this.
    expect(
      warnSpy.mock.calls.some((c) =>
        String(c[0]).includes("clear-hold skipped"),
      ),
    ).toBe(true);
  });

  it("[REVERT-FAILS] a snapshot passed in by the caller (the real digest sweep), not sendDigest's own entry time, is what the guard compares against", async () => {
    // Simulates the real `runDailyDigest`/`triggerDailyDigest` call shape: the
    // snapshot is taken once, BEFORE this restaurant's (and every other
    // restaurant's) sendDigest call, and handed down explicitly. Chosen so
    // the two possible cutoffs disagree: `guardCurrentHeldAt` (2050) is
    // AFTER real "now" (2026, what sendDigest would default to if it ever
    // ignored its argument) but BEFORE the explicit `rowsSnapshotAt` (2099)
    // passed below -- so only a build that actually threads the parameter
    // through clears the hold; one that silently fell back to its own entry
    // time would leave it in place, and this test would catch that.
    const { service, upserts, guardedUpdates } = makeHarness({
      guardCurrentHeldAt: "2050-01-01T00:00:00.000Z",
    });
    const warnSpy = jest.spyOn((service as any).logger, "warn");
    await service.sendDigest(
      "r1",
      [row({ inventoryId: "a" })],
      "House",
      "2099-01-01T00:00:00.000Z", // rowsSnapshotAt
    );
    expect(upserts.find((u) => u.inventory_id === "a")).toBeUndefined();
    expect(guardedUpdates).toHaveLength(1);
    expect(guardedUpdates[0]).toMatchObject({
      inventory_id: "a",
      last_held_at: null,
    });
    // Confirms the guard actually matched using the PASSED-IN snapshot, not
    // just that an update was attempted (see the previous test's comment).
    expect(
      warnSpy.mock.calls.some((c) =>
        String(c[0]).includes("clear-hold skipped"),
      ),
    ).toBe(false);
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

  /**
   * PR #486 round-1 audit finding 1 (2026-09-26): `getRestaurantMemberIds`
   * (database.service.ts) catches any read failure of
   * `user_restaurant_access` / `users` into `[]` — identical to a house that
   * legitimately has zero members. `readLowStockPrefs` used that swallowing
   * method, so a member-read failure never reached its own try/catch and
   * `digest` came back as the 12:00 defaults instead of `null`. The fix
   * (`getRestaurantMemberIdsOrThrow`) is exercised here directly, not via
   * `getRestaurantMemberIds`'s internals, so this fails loudly again if a
   * future change routes `readLowStockPrefs` back through the swallowing
   * method.
   */
  it("[REVERT-FAILS] a swallowed member-read failure is `digest: null`, never the 12:00 defaults", async () => {
    const { service } = makeHarness({ memberIdsError: "fetch failed" });
    const view = await service.listHeldCrossings("r1");
    expect(view.digest).toBeNull();
  });

  it("a house with zero real members (the read SUCCEEDED with no rows) still gets the 12:00 defaults, not null", async () => {
    const { service } = makeHarness(); // default mock resolves ["user-1"]...
    (service as any).db.getRestaurantMemberIdsOrThrow = jest
      .fn()
      .mockResolvedValue([]); // a real, successful read that found nobody
    const view = await service.listHeldCrossings("r1");
    expect(view.digest).toEqual({
      low_stock_enabled: true,
      frequency: "daily",
      hour: 12,
      timezone: "America/New_York",
    });
  });

  it("the senders still fall back to the defaults when the member read fails", async () => {
    const { service, notifications } = makeHarness({
      memberIdsError: "fetch failed",
    });
    await service.evaluateRestaurant("r1", [row()], "House");
    // getEffectiveLowStockPrefs catches readLowStockPrefs's throw and falls
    // back to DEFAULTS for the sender path — a missed alert is worse than a
    // default one. Only the page-facing read (listHeldCrossings) must show
    // `null` instead.
    expect(notifications.persistForRestaurant).toHaveBeenCalledTimes(1);
  });
});
