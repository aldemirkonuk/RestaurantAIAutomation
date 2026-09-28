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

/**
 * A settings-audit double that REMEMBERS what it was asked to file.
 *
 * Not a no-op: `updateFeatureFlags` now files who changed which flag, and a
 * stub that swallowed the call would let the audit write regress silently while
 * every one of these tests stayed green. The tests below that care assert on
 * `filed`.
 */
function recordingAudit() {
  const filed: any[] = [];
  return {
    filed,
    record: async (change: any) => {
      filed.push(change);
      return { recorded: true, reason: null };
    },
  } as any;
}

/**
 * A double whose READ and whose WRITE answer differently.
 *
 * `makeDb` returns one result for both, which would let the audit test pass
 * with `readFlagsForAudit` deleted — before and after would be identical and
 * the diff empty either way. This one makes the before-state observable.
 */
function twoStateDb(before: Record<string, boolean>, after: Record<string, boolean>) {
  const chain: Record<string, (...args: any[]) => any> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.upsert = () => chain;
  chain.maybeSingle = async () => ({ data: before, error: null });
  chain.single = async () => ({ data: after, error: null });
  return { client: { from: () => chain } } as any;
}

describe("SettingsService — feature flags (OD-86)", () => {
  describe("autonomous send default", () => {
    it("is OFF when the restaurant has no settings row", async () => {
      const { databaseService } = makeDb({ data: null, error: null });
      const service = new SettingsService(databaseService, recordingAudit());

      const flags = await service.getFeatureFlags("rest-1");

      expect(flags.enable_ai_autonomous_send).toBe(false);
    });

    it("is OFF when the stored value is null", async () => {
      const { databaseService } = makeDb({
        data: { enable_ai_negotiation: true, enable_ai_autonomous_send: null },
        error: null,
      });
      const service = new SettingsService(databaseService, recordingAudit());

      const flags = await service.getFeatureFlags("rest-1");

      expect(flags.enable_ai_autonomous_send).toBe(false);
    });

    it("is ON only when the stored value is exactly true", async () => {
      const { databaseService } = makeDb({
        data: { enable_ai_negotiation: false, enable_ai_autonomous_send: true },
        error: null,
      });
      const service = new SettingsService(databaseService, recordingAudit());

      const flags = await service.getFeatureFlags("rest-1");

      expect(flags.enable_ai_autonomous_send).toBe(true);
      expect(flags.enable_ai_negotiation).toBe(false);
    });

    it("surfaces a read failure instead of returning a default that looks configured", async () => {
      const { databaseService } = makeDb({
        data: null,
        error: { message: "connection reset", code: "08006" },
      });
      const service = new SettingsService(databaseService, recordingAudit());

      await expect(service.getFeatureFlags("rest-1")).rejects.toThrow();
    });
  });

  describe("reads target the reserved settings row", () => {
    it("filters on restaurant_id AND the settings flag_name", async () => {
      const { calls, databaseService } = makeDb({ data: null, error: null });
      const service = new SettingsService(databaseService, recordingAudit());

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
      const service = new SettingsService(databaseService, recordingAudit());

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
      const service = new SettingsService(databaseService, recordingAudit());

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

    it("files WHO granted autonomous sending, with the value it had before", async () => {
      // The most consequential switch in the product: it lets an AI-written
      // reply leave for a vendor with nobody having read it. Until this pass it
      // could be granted with no record of who granted it — `restaurant_feature_flags`
      // has `created_at` and no update column (baseline:5097-5105).
      // The before-read and the write must answer DIFFERENTLY, or the test
      // would pass with the read-before-write removed entirely.
      const databaseService = twoStateDb(
        { enable_ai_negotiation: false, enable_ai_autonomous_send: false },
        { enable_ai_negotiation: false, enable_ai_autonomous_send: true },
      );
      const audit = recordingAudit();
      const service = new SettingsService(databaseService, audit);

      await service.updateFeatureFlags(
        "rest-1",
        { enable_ai_autonomous_send: true },
        "public-users-id-7",
      );

      expect(audit.filed).toHaveLength(1);
      expect(audit.filed[0]).toMatchObject({
        restaurantId: "rest-1",
        // public.users.user_id, straight from the JWT. An auth.users id would
        // insert cleanly and never resolve to a person.
        actorUserId: "public-users-id-7",
        action: "feature_flag_changed",
        register: "features",
        entityType: "restaurant_feature_flag",
      });
      // The read-before-write is what makes `from` real rather than null.
      expect(audit.filed[0].fields.enable_ai_autonomous_send).toEqual({
        from: false,
        to: true,
      });
    });

    it("files nothing when the submitted value is what was already there", async () => {
      const { databaseService } = makeDb({
        data: { enable_ai_negotiation: true, enable_ai_autonomous_send: false },
        error: null,
      });
      const audit = recordingAudit();
      const service = new SettingsService(databaseService, audit);

      await service.updateFeatureFlags(
        "rest-1",
        { enable_ai_negotiation: true },
        "public-users-id-7",
      );

      // A row per SAVE rather than per CHANGE would fill the register with
      // people opening a form and pressing the button.
      expect(audit.filed[0].fields).toEqual({});
    });

    it("rejects an update that contains no writable flag at all", async () => {
      const { databaseService } = makeDb({ data: null, error: null });
      const service = new SettingsService(databaseService, recordingAudit());

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
      const service = new SettingsService(databaseService, recordingAudit());

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
      const service = new SettingsService(databaseService, recordingAudit());

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
      const service = new SettingsService(databaseService, recordingAudit());

      await expect(
        service.isFeatureEnabled("rest-1", "enable_ai_autonomous_send"),
      ).resolves.toEqual({ enabled: true, active: true });
    });
  });
});
