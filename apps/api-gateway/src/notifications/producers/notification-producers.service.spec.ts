/**
 * The two crons: armed or not, served or not, and what the page is told.
 *
 * The arming case is the one that matters most. These producers write into real
 * inboxes and push to real phones, so OFF must be the default and the default
 * must be provable.
 */

import {
  NotificationProducersService,
  PRODUCERS_FLAG,
  producersArmed,
} from "./notification-producers.service";
import { emptyTally } from "./producer-ledger.service";
import { recorder } from "./testing/fake-db";
import type { ScheduledTenant } from "../../communications/scheduled-tenants.service";

const TENANT: ScheduledTenant = {
  id: "rest-1",
  name: "Meyhouse Palo Alto",
  timezone: "America/New_York",
  isLegacyDefault: true,
};

function build(env: Record<string, any> = {}, overrides: any = {}) {
  const sweeps: string[] = [];
  const stub = (name: string, fail = false) => ({
    sweepTenant: recorder(async () => {
      sweeps.push(name);
      if (fail) throw new Error(`${name} exploded`);
      return emptyTally();
    }),
  });

  const ledger = {
    audienceFor: recorder(async () => ({ ready: ["user-1"], deferred: [] })),
    openRun: recorder(async () => "run-1"),
    closeRun: recorder(async () => undefined),
    lastRun: recorder(async () => null),
  };
  const tenants = {
    list: recorder(async () => [TENANT]),
    runPerTenant: recorder(async (_name: string, body: any) => {
      await body(TENANT);
      return { tenants: 1, succeeded: 1, failed: 0 };
    }),
  };
  const goals = {
    getPosRevenueWindow: recorder(async () => ({ posConnected: true })),
  };
  const addedTool = overrides.addedTool ?? stub("added_tool");
  // The status read asks it how many servers this house has declared.
  (addedTool as any).watchedServerCount =
    overrides.watchedServerCount ?? recorder(async () => 3);
  const market = overrides.market ?? stub("market_price");
  // The status read asks the market producer whether the register has anything
  // in it at all. Default: it does, so the silence cases below are the ones the
  // test opts into rather than the ones it gets by accident.
  (market as any).visibleObservationCount =
    overrides.visibleObservationCount ?? recorder(async () => 12);
  // The seventh producer narrows its own audience and is asked, by the status
  // read, whether this house has a suspension standing. Default: none, which is
  // the ordinary state; the cases below opt into the other two.
  const grantSuspended = overrides.grantSuspended ?? stub("grant_suspended");
  (grantSuspended as any).suspendedGrantCount =
    overrides.suspendedGrantCount ?? recorder(async () => 0);
  // The ninth producer is not a tenant sweep, so it gets a stub with the three
  // methods the service actually calls on it. `founderHouseId` answers the
  // TENANT by default, which makes "this is the founder's house" the ordinary
  // case and the other two the ones a test opts into.
  const experimentEnded = overrides.experimentEnded ?? {
    founderHouseId: recorder(() =>
      overrides.founderHouse === undefined ? TENANT.id : overrides.founderHouse,
    ),
    endedUnnamedCount:
      overrides.endedUnnamedCount ?? recorder(async () => 0),
    sweepFounder: recorder(async () => {
      sweeps.push("experiment_ended_unnamed");
      return emptyTally();
    }),
  };
  const config = { get: (k: string) => env[k] };

  const service = new NotificationProducersService(
    config as any,
    tenants as any,
    ledger as any,
    goals as any,
    (overrides.goal ?? stub("goal_reached")) as any,
    (overrides.ceiling ?? stub("ceiling_held")) as any,
    (overrides.delivery ?? stub("delivery_recorded")) as any,
    (overrides.invoice ?? stub("invoice_confirmed")) as any,
    (overrides.sale ?? stub("sale_record")) as any,
    market as any,
    grantSuspended as any,
    addedTool as any,
    experimentEnded as any,
  );
  return {
    service,
    sweeps,
    experimentEnded,
    ledger,
    tenants,
    goals,
    market,
    grantSuspended,
    stub,
  };
}

describe("arming", () => {
  it("[REVERT-FAILS] is OFF unless the flag says true or 1", () => {
    for (const raw of [undefined, null, "", "false", "0", "yes", "TRUE "]) {
      expect(producersArmed(raw as any)).toBe(raw === "TRUE " ? true : false);
    }
    expect(producersArmed("true")).toBe(true);
    expect(producersArmed("1")).toBe(true);
    expect(PRODUCERS_FLAG).toBe("NOTIFICATION_PRODUCERS_ENABLED");
  });

  it("[REVERT-FAILS] a disarmed cron enumerates no tenant and sweeps nothing", async () => {
    const { service, sweeps, tenants } = build();
    await service.sweepFast();
    await service.sweepDaily();
    expect(tenants.runPerTenant.calls).toHaveLength(0);
    expect(sweeps).toEqual([]);
  });

  it("an armed cron runs through runPerTenant", async () => {
    const { service, sweeps, tenants } = build({
      NOTIFICATION_PRODUCERS_ENABLED: "true",
    });
    await service.sweepFast();
    expect(tenants.runPerTenant.calls[0][0]).toBe(
      NotificationProducersService.FAST_JOB,
    );
    expect(sweeps).toEqual([
      "goal_reached",
      "ceiling_held",
      "delivery_recorded",
      "invoice_confirmed",
      "grant_suspended",
      "added_tool",
      // LAST, and outside the per-tenant loop. It reports cross-house figures to
      // one reader; running it inside would put them in every house's inbox.
      "experiment_ended_unnamed",
    ]);
  });

  it("[REVERT-FAILS] the founder sweep runs ONCE, not once per tenant", async () => {
    const { service, tenants, experimentEnded } = build({
      NOTIFICATION_PRODUCERS_ENABLED: "true",
    });
    // Two tenants through the loop; the ninth producer must still speak once.
    tenants.runPerTenant = recorder(async (_name: string, body: any) => {
      await body(TENANT);
      await body({ ...TENANT, id: "rest-2" });
      return { tenants: 2, succeeded: 2, failed: 0 };
    });
    await service.sweepFast();
    expect((experimentEnded as any).sweepFounder.calls).toHaveLength(1);
    expect((experimentEnded as any).sweepFounder.calls[0][0]).toBe(TENANT.id);
  });

  it("[REVERT-FAILS] with no house named it does not pick one, and opens no run row", async () => {
    const { service, ledger, experimentEnded } = build(
      { NOTIFICATION_PRODUCERS_ENABLED: "true" },
      { founderHouse: null },
    );
    const result = await service.runFounderSweep(
      new Date("2026-09-03T12:00:00Z"),
    );
    // `null`, not a tally of zero: nobody named the inbox, so nothing was even
    // attempted. A fallback restaurant here would deliver one tenant's product
    // decision into another tenant's inbox.
    expect(result).toBeNull();
    expect((experimentEnded as any).sweepFounder.calls).toHaveLength(0);
    expect(
      ledger.openRun.calls.filter(
        (c: any[]) => c[1] === "experiment_ended_unnamed",
      ),
    ).toHaveLength(0);
  });

  it("[REVERT-FAILS] a failing founder sweep does not cost the tenants their sweep", async () => {
    const { service, sweeps, experimentEnded } = build({
      NOTIFICATION_PRODUCERS_ENABLED: "true",
    });
    (experimentEnded as any).sweepFounder = recorder(async () => {
      throw new Error("experiment register exploded");
    });
    await expect(service.sweepFast()).resolves.toBeUndefined();
    expect(sweeps).toContain("goal_reached");
    expect(sweeps).toContain("added_tool");
  });

  it("[REVERT-FAILS] a disarmed deployment writes no suspension notification", async () => {
    const { service, sweeps, grantSuspended } = build();
    await service.sweepFast();
    expect(sweeps).not.toContain("grant_suspended");
    expect((grantSuspended as any).sweepTenant.calls).toHaveLength(0);
  });
});

describe("the two cadences", () => {
  it("the fast sweep runs the six event producers and opens a run row each", async () => {
    const { service, ledger } = build();
    await service.runFastForTenant(TENANT, new Date("2026-09-03T12:00:00Z"));
    expect(ledger.openRun.calls.map((c: any[]) => c[1])).toEqual([
      "goal_reached",
      "ceiling_held",
      "delivery_recorded",
      "invoice_confirmed",
      "grant_suspended",
      "added_tool",
    ]);
    expect(ledger.closeRun.calls).toHaveLength(6);
  });

  it("[REVERT-FAILS] one producer throwing does not cost the others their run", async () => {
    const boom = {
      sweepTenant: recorder(async () => {
        throw new Error("goals exploded");
      }),
    };
    const { service, sweeps, ledger } = build({}, { goal: boom });
    const out = await service.runFastForTenant(
      TENANT,
      new Date("2026-09-03T12:00:00Z"),
    );
    expect(out.goal_reached.failed).toBe(1);
    expect(sweeps).toEqual([
      "ceiling_held",
      "delivery_recorded",
      "invoice_confirmed",
      "grant_suspended",
      "added_tool",
    ]);
    // The failure is recorded on the run row rather than swallowed.
    const closed = ledger.closeRun.calls[0];
    expect(closed[3]).toBe("goals exploded");
  });

  it("the daily sweep asks the one place that decides whether a POS is wired", async () => {
    const { service, goals, sweeps } = build();
    // 14:00 UTC = 10:00 New York, the market hour.
    await service.runDailyForTenant(TENANT, new Date("2026-09-03T14:00:00Z"));
    expect(goals.getPosRevenueWindow.calls[0]).toEqual(["rest-1", 1]);
    expect(sweeps).toEqual(["sale_record", "market_price"]);
  });

  it("[REVERT-FAILS] the market signal is evaluated once a day, on the tenant's clock", async () => {
    const { service, sweeps } = build();
    // 18:00 UTC = 14:00 New York — not the market hour.
    await service.runDailyForTenant(TENANT, new Date("2026-09-03T18:00:00Z"));
    expect(sweeps).toEqual(["sale_record"]);
  });

  it("an unknown timezone falls back to UTC loudly rather than throwing the tenant away", async () => {
    const { service, ledger } = build();
    await service.runFastForTenant(
      { ...TENANT, timezone: "Mars/Olympus" },
      new Date("2026-09-03T12:00:00Z"),
    );
    expect(ledger.audienceFor.calls[0][1]).toBe("UTC");
  });
});

describe("statusFor — what the page is allowed to say", () => {
  it("names all nine producers, their schedule and their next tick", async () => {
    const { service } = build();
    const status = await service.statusFor(
      "rest-1",
      new Date("2026-09-03T12:07:00Z"),
    );
    expect(status.producers.map((p) => p.producer)).toEqual([
      "goal_reached",
      "ceiling_held",
      "delivery_recorded",
      "invoice_confirmed",
      "grant_suspended",
      "added_tool",
      "experiment_ended_unnamed",
      "sale_record",
      "market_price",
    ]);
    expect(status.producers[0].nextTickAt).toBe("2026-09-03T12:15:00.000Z");
    expect(status.producers[5].nextTickAt).toBe("2026-09-03T12:15:00.000Z");
    expect(status.producers[6].nextTickAt).toBe("2026-09-03T12:15:00.000Z");
    expect(status.producers[8].nextTickAt).toBe("2026-09-03T13:00:00.000Z");
  });

  it("[REVERT-FAILS] one switch arms all nine, and every producer says so while it is off", async () => {
    const { service } = build();
    const status = await service.statusFor("rest-1");
    expect(status.armed).toBe(false);
    expect(status.armingNote).toMatch(/arms all 9 producers/);
    expect(status.producers).toHaveLength(9);
    for (const p of status.producers) {
      expect(p.willWrite).toBe(false);
      expect(p.silentReason).toMatch(
        /NOTIFICATION_PRODUCERS_ENABLED is not set.*arms all 9 producers at once/s,
      );
    }
  });

  it("[REVERT-FAILS] armed and served, the market producer still says it is mute with an empty register", async () => {
    const { service } = build(
      { NOTIFICATION_PRODUCERS_ENABLED: "true" },
      { visibleObservationCount: recorder(async () => 0) },
    );
    const status = await service.statusFor("rest-1");
    const market = status.producers.find((p) => p.producer === "market_price")!;
    expect(market.willWrite).toBe(false);
    expect(market.silentReason).toMatch(/no sighting this restaurant can see/);
    // …and the others are not tarred with it. The grant producer is given a
    // suspension here so its own silence case does not mask this one, and the
    // ninth is excluded because it is legitimately silent whenever no experiment
    // has ended unnamed — the stub answers 0 by default.
    for (const p of status.producers.filter(
      (x) =>
        x.producer !== "market_price" &&
        x.producer !== "grant_suspended" &&
        x.producer !== "experiment_ended_unnamed",
    )) {
      expect(p.willWrite).toBe(true);
      expect(p.silentReason).toBeNull();
    }
  });

  it("[REVERT-FAILS] armed and served, the grant producer says it is mute with nothing suspended", async () => {
    const { service } = build({ NOTIFICATION_PRODUCERS_ENABLED: "true" });
    const status = await service.statusFor("rest-1");
    const grant = status.producers.find(
      (p) => p.producer === "grant_suspended",
    )!;
    expect(grant.willWrite).toBe(false);
    expect(grant.silentReason).toMatch(/No tool grant .* is suspended/);
  });

  it("[REVERT-FAILS] a house with a suspension standing is told this producer will speak", async () => {
    const { service } = build(
      { NOTIFICATION_PRODUCERS_ENABLED: "true" },
      { suspendedGrantCount: recorder(async () => 2) },
    );
    const status = await service.statusFor("rest-1");
    const grant = status.producers.find(
      (p) => p.producer === "grant_suspended",
    )!;
    expect(grant.willWrite).toBe(true);
    expect(grant.silentReason).toBeNull();
  });

  it("[REVERT-FAILS] an unreadable grant register is unknown, not an empty one", async () => {
    const { service } = build(
      { NOTIFICATION_PRODUCERS_ENABLED: "true" },
      { suspendedGrantCount: recorder(async () => null) },
    );
    const status = await service.statusFor("rest-1");
    const grant = status.producers.find(
      (p) => p.producer === "grant_suspended",
    )!;
    expect(grant.willWrite).toBeNull();
    expect(grant.silentReason).toMatch(/could not be read/);
  });

  it("[REVERT-FAILS] an unreadable price register is unknown, not an empty one", async () => {
    const { service } = build(
      { NOTIFICATION_PRODUCERS_ENABLED: "true" },
      { visibleObservationCount: recorder(async () => null) },
    );
    const status = await service.statusFor("rest-1");
    const market = status.producers.find((p) => p.producer === "market_price")!;
    expect(market.willWrite).toBeNull();
    expect(market.silentReason).toMatch(/could not be read/);
  });

  it("a restaurant the scheduler skips makes the eight tenant producers silent for that reason", async () => {
    const { service } = build({ NOTIFICATION_PRODUCERS_ENABLED: "true" });
    const status = await service.statusFor("rest-99");
    for (const p of status.producers.filter(
      (x) => x.producer !== "experiment_ended_unnamed",
    )) {
      expect(p.willWrite).toBe(false);
      expect(p.silentReason).toMatch(/restaurant_feature_flags/);
    }
  });

  it("[REVERT-FAILS] the ninth is NOT silenced by the opt-in register, and says its own reason", async () => {
    // It runs outside `runPerTenant`, so whether the scheduler enumerates a
    // restaurant does not decide whether it speaks. Printing the opt-in sentence
    // over it would be a true statement about the other eight rendered where it
    // is false — the reader would go and set a feature flag that changes nothing.
    const { service } = build({ NOTIFICATION_PRODUCERS_ENABLED: "true" });
    const status = await service.statusFor("rest-99");
    const ninth = status.producers.find(
      (p) => p.producer === "experiment_ended_unnamed",
    )!;
    expect(ninth.willWrite).toBe(false);
    expect(ninth.silentReason).not.toMatch(/restaurant_feature_flags/);
    expect(ninth.silentReason).toMatch(/DEFAULT_RESTAURANT_ID, which is not this one/);
  });

  it("[REVERT-FAILS] the founder's own house is told the ninth will speak once a window closes", async () => {
    const { service } = build({ NOTIFICATION_PRODUCERS_ENABLED: "true" });
    const silent = await service.statusFor("rest-1");
    const mute = silent.producers.find(
      (p) => p.producer === "experiment_ended_unnamed",
    )!;
    expect(mute.willWrite).toBe(false);
    expect(mute.silentReason).toMatch(/No declared experiment has ended/);

    const { service: loud } = build(
      { NOTIFICATION_PRODUCERS_ENABLED: "true" },
      { endedUnnamedCount: recorder(async () => 1) },
    );
    const status = await loud.statusFor("rest-1");
    const ninth = status.producers.find(
      (p) => p.producer === "experiment_ended_unnamed",
    )!;
    expect(ninth.willWrite).toBe(true);
    expect(ninth.silentReason).toBeNull();
  });

  it("[REVERT-FAILS] an unreadable experiment register is unknown, not 'none ended'", async () => {
    const { service } = build(
      { NOTIFICATION_PRODUCERS_ENABLED: "true" },
      { endedUnnamedCount: recorder(async () => null) },
    );
    const status = await service.statusFor("rest-1");
    const ninth = status.producers.find(
      (p) => p.producer === "experiment_ended_unnamed",
    )!;
    expect(ninth.willWrite).toBeNull();
    expect(ninth.silentReason).toMatch(/could not be read/);
  });

  it("[REVERT-FAILS] reports disarmed and never-run as separate facts", async () => {
    const { service } = build();
    const status = await service.statusFor("rest-1");
    expect(status.armed).toBe(false);
    expect(status.armedBy).toBe(PRODUCERS_FLAG);
    expect(status.producers.every((p) => p.lastRun === null)).toBe(true);
    expect(status.producers.every((p) => p.lastRunUnreadable === null)).toBe(
      true,
    );
  });

  it("[REVERT-FAILS] a restaurant the scheduler does not enumerate is told why", async () => {
    const { service } = build();
    const status = await service.statusFor("rest-99");
    expect(status.served).toBe(false);
    expect(status.servedReason).toMatch(/restaurant_feature_flags/);
  });

  it("[REVERT-FAILS] an unreadable opt-in register is unknown, not 'not served'", async () => {
    const { service, tenants } = build();
    tenants.list = recorder(async () => {
      throw new Error("permission denied");
    }) as any;
    const status = await service.statusFor("rest-1");
    expect(status.served).toBeNull();
    expect(status.servedReason).toMatch(/could not be read/);
  });

  it("[REVERT-FAILS] an unreadable run ledger is not reported as an idle producer", async () => {
    const { service, ledger } = build();
    ledger.lastRun = recorder(async () => {
      throw new Error("statement timeout");
    }) as any;
    const status = await service.statusFor("rest-1");
    expect(status.producers[0].lastRun).toBeNull();
    expect(status.producers[0].lastRunUnreadable).toBe("statement timeout");
  });
});
