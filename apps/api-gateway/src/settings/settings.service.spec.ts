import { BadRequestException } from "@nestjs/common";
import { SettingsService } from "./settings.service";
import { SETTINGS_ROW_FLAG_NAME } from "./feature-flag-registry";

/**
 * OD-86. Two things are being pinned here.
 *
 * 1. `enable_ai_autonomous_send` decides whether AI email reaches a vendor with
 *    no human approval. Every path that cannot produce a definite answer — no
 *    settings row, a read error — must resolve to OFF. A test that only checks
 *    the happy path would not have caught the real bug, which was that the
 *    column being SELECTed did not exist.
 * 2. The service must write ONLY flags that are backed by a real column and a
 *    real gate. It used to forward all 22 DTO keys to Postgres, none of which
 *    were columns; the write failed and the user was told "Failed to save".
 */

type Result = { data: unknown; error: unknown };

/** Minimal PostgREST chain double that records the filters it was given. */
function makeDb(result: Result) {
  const calls = {
    from: [] as string[],
    select: [] as string[],
    eq: [] as Array<[string, unknown]>,
    upsert: [] as unknown[],
    upsertOptions: [] as unknown[],
  };
  const chain: Record<string, (...args: any[]) => any> = {};
  chain.select = (cols: string) => {
    calls.select.push(cols);
    return chain;
  };
  chain.eq = (col: string, val: unknown) => {
    calls.eq.push([col, val]);
    return chain;
  };
  chain.upsert = (row: unknown, options?: unknown) => {
    calls.upsert.push(row);
    calls.upsertOptions.push(options);
    return chain;
  };
  chain.maybeSingle = async () => result;
  chain.single = async () => result;

  const client = {
    from: (table: string) => {
      calls.from.push(table);
      return chain;
    },
  };
  return { calls, databaseService: { client } as any };
}

describe("SettingsService — feature flags (OD-86)", () => {
  describe("autonomous send default", () => {
    it("is OFF when the restaurant has no settings row", async () => {
      const { databaseService } = makeDb({ data: null, error: null });
      const service = new SettingsService(databaseService);

      const flags = await service.getFeatureFlags("rest-1");

      expect(flags.enable_ai_autonomous_send).toBe(false);
    });

    it("is OFF when the stored value is null", async () => {
      const { databaseService } = makeDb({
        data: { enable_ai_negotiation: true, enable_ai_autonomous_send: null },
        error: null,
      });
      const service = new SettingsService(databaseService);

      const flags = await service.getFeatureFlags("rest-1");

      expect(flags.enable_ai_autonomous_send).toBe(false);
    });

    it("is ON only when the stored value is exactly true", async () => {
      const { databaseService } = makeDb({
        data: { enable_ai_negotiation: false, enable_ai_autonomous_send: true },
        error: null,
      });
      const service = new SettingsService(databaseService);

      const flags = await service.getFeatureFlags("rest-1");

      expect(flags.enable_ai_autonomous_send).toBe(true);
      expect(flags.enable_ai_negotiation).toBe(false);
    });

    it("surfaces a read failure instead of returning a default that looks configured", async () => {
      const { databaseService } = makeDb({
        data: null,
        error: { message: "connection reset", code: "08006" },
      });
      const service = new SettingsService(databaseService);

      await expect(service.getFeatureFlags("rest-1")).rejects.toThrow();
    });
  });

  describe("reads target the reserved settings row", () => {
    it("filters on restaurant_id AND the settings flag_name", async () => {
      const { calls, databaseService } = makeDb({ data: null, error: null });
      const service = new SettingsService(databaseService);

      await service.getFeatureFlags("rest-1");

      expect(calls.eq).toContainEqual(["restaurant_id", "rest-1"]);
      expect(calls.eq).toContainEqual(["flag_name", SETTINGS_ROW_FLAG_NAME]);
    });
  });

  describe("writes", () => {
    it("persists enable_ai_negotiation — the one wired toggle", async () => {
      const { calls, databaseService } = makeDb({
        data: { enable_ai_negotiation: false, enable_ai_autonomous_send: false },
        error: null,
      });
      const service = new SettingsService(databaseService);

      const updated = await service.updateFeatureFlags("rest-1", {
        enable_ai_negotiation: false,
      });

      expect(calls.upsert[0]).toEqual({
        restaurant_id: "rest-1",
        flag_name: SETTINGS_ROW_FLAG_NAME,
        enable_ai_negotiation: false,
      });
      expect(updated.enable_ai_negotiation).toBe(false);
    });

    it("never writes a key that has no column and no gate", async () => {
      const { calls, databaseService } = makeDb({
        data: { enable_ai_negotiation: true, enable_ai_autonomous_send: false },
        error: null,
      });
      const service = new SettingsService(databaseService);

      await service.updateFeatureFlags("rest-1", {
        enable_ai_autonomous_send: true,
        // Not a column, not a gate — the shape of every one of the 21 dead
        // switches. It must not reach Postgres.
        enable_quickbooks_sync: true,
      } as any);

      expect(calls.upsert[0]).toEqual({
        restaurant_id: "rest-1",
        flag_name: SETTINGS_ROW_FLAG_NAME,
        enable_ai_autonomous_send: true,
      });
    });

    it("rejects an update that contains no writable flag at all", async () => {
      const { databaseService } = makeDb({ data: null, error: null });
      const service = new SettingsService(databaseService);

      await expect(
        service.updateFeatureFlags("rest-1", {
          enable_staff_training_simulator: true,
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("raises rather than reporting success when the write fails", async () => {
      const { databaseService } = makeDb({
        data: null,
        error: { message: "permission denied", code: "42501" },
      });
      const service = new SettingsService(databaseService);

      await expect(
        service.updateFeatureFlags("rest-1", {
          enable_ai_autonomous_send: true,
        }),
      ).rejects.toThrow();
    });
  });

  describe("isFeatureEnabled", () => {
    it("reports a flag nothing gates on as inactive rather than enabled", async () => {
      const { databaseService } = makeDb({ data: null, error: null });
      const service = new SettingsService(databaseService);

      // The old implementation called a `get_restaurant_feature_flag` RPC that
      // exists in no applied migration, then returned TRUE on the error. Every
      // dead flag answered "enabled".
      await expect(
        service.isFeatureEnabled("rest-1", "enable_staff_training_simulator"),
      ).resolves.toEqual({ enabled: false, active: false });
    });

    it("answers from the settings row for an active flag", async () => {
      const { databaseService } = makeDb({
        data: { enable_ai_negotiation: true, enable_ai_autonomous_send: true },
        error: null,
      });
      const service = new SettingsService(databaseService);

      await expect(
        service.isFeatureEnabled("rest-1", "enable_ai_autonomous_send"),
      ).resolves.toEqual({ enabled: true, active: true });
    });
  });
});
