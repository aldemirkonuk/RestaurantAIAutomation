/**
 * The sweep waits for the export (ADR 0118 D16, decided 2026-09-05).
 *
 * D12-D15 gave a mirrored reply a window and a tombstone. D16 gave the house a
 * way to keep its own copy first — and a copy the sweep does not CHECK is a
 * promise rather than a mechanism. These are the five things that would make the
 * promise silently empty:
 *
 *   1. AN UNEXPORTED REPLY IS HELD, NOT DELETED. With an armed archive, a reply
 *      past its window whose copy has not reached the house's own cloud stays.
 *   2. AND THE HOLD IS SAID IN WORDS AND IN A COUNT. `held_for_export` on the
 *      sweep row, and a sentence naming why.
 *   3. AN EXPORTED REPLY GOES. Holding a reply whose copy is verified would
 *      make the archive a reason never to delete anything.
 *   4. A SWEEP THAT CANNOT CONSULT THE ARCHIVE DOES NOT DELETE. "I could not
 *      check whether a copy exists" and "no copy is needed" are two different
 *      facts, and only one of them permits an irreversible deletion. This is
 *      the absence-reported-as-health shape arriving at a deletion, so it is
 *      proved with the service absent AND with the read failing.
 *   5. A REVOCATION EXPORTS AND THEN DELETES ANYWAY. D15 is the founder's own
 *      answer about a person withdrawing consent, and holding that deletion
 *      would leave their mail here after they revoked. The run says what did
 *      and did not reach the house's copy rather than implying everything did.
 *
 * `archive_mode` and `held_for_export` are NULL when no archive was evaluated
 * and 0 when one was and nothing was held. The two are never collapsed, here or
 * in the column comments.
 *
 * No test here reaches a network, a mailbox or a live database.
 */

import { RawMailRetentionService } from "./raw-mail-retention.service";
import type { DatabaseService } from "../../database/database.service";
import type { HouseMailArchiveService } from "../archive/house-mail-archive.service";

const HOUSE = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa";
const GRANT = "eeeeeeee-0000-4000-8000-eeeeeeeeeeee";
const OLD_ONE = "11111111-0000-4000-8000-111111111111";
const OLD_TWO = "22222222-0000-4000-8000-222222222222";

const DAY = 24 * 60 * 60 * 1000;
const longAgo = new Date(Date.now() - 400 * DAY).toISOString();

type Rows = Record<string, unknown>[] | { error: { message: string } };

interface Recorded {
  inserts: Array<{ table: string; body: Record<string, unknown> }>;
  updates: Array<{ table: string; body: Record<string, unknown> }>;
  updated: string[][];
}

function build(rows: Record<string, Rows>) {
  const rec: Recorded = { inserts: [], updates: [], updated: [] };

  const chain = (table: string, payload: Rows) => {
    const failed = !Array.isArray(payload);
    const data = Array.isArray(payload) ? payload : null;
    const error = failed
      ? (payload as { error: { message: string } }).error
      : null;
    const self: Record<string, unknown> = {};
    const pass = () => self;
    self.select = pass;
    self.eq = pass;
    self.is = pass;
    self.not = pass;
    self.order = pass;
    self.limit = pass;
    // The real client's `update(...).in(ids).select("id")` returns ONLY the
    // rows it changed, and `deleted` is that length — so the stub has to
    // narrow too, or every test would read as "everything was deleted".
    let narrowed: string[] | null = null;
    self.in = (_col: string, ids: string[]) => {
      rec.updated.push(ids);
      narrowed = ids;
      return self;
    };
    self.insert = (body: Record<string, unknown>) => {
      rec.inserts.push({ table, body });
      return self;
    };
    self.upsert = (body: Record<string, unknown>) => {
      rec.inserts.push({ table, body });
      return self;
    };
    self.update = (body: Record<string, unknown>) => {
      rec.updates.push({ table, body });
      return self;
    };
    self.single = () => Promise.resolve({ data: data?.[0] ?? null, error });
    self.maybeSingle = () => Promise.resolve({ data: data?.[0] ?? null, error });
    self.then = (resolve: (v: unknown) => unknown) => {
      const rows =
        narrowed === null
          ? data
          : (data ?? []).filter((r) =>
              (narrowed as string[]).includes(String(r.id)),
            );
      return Promise.resolve({ data: rows, error }).then(resolve);
    };
    return self;
  };

  const db = {
    supabase: {
      from: (table: string) => chain(table, rows[table] ?? []),
      storage: {
        from: () => ({
          remove: () => Promise.resolve({ data: null, error: null }),
        }),
      },
    },
  } as unknown as DatabaseService;

  return { rec, db };
}

/**
 * An archive stub. `exported` is which conversations have a verified copy;
 * `throws` makes the record unreadable, which must be a refusal and not a
 * silently empty set.
 */
function archive(opts: {
  mode?: "own_cloud" | "mudavym_archive" | "none";
  armed?: boolean;
  exported?: string[];
  throwsOnExported?: string;
  onExport?: (ids: string[]) => {
    considered: number;
    exported: number;
    failed: number;
  };
}) {
  const exportCalls: string[][] = [];
  const service = {
    settingsFor: async (restaurantId: string) => ({
      restaurantId,
      mode: opts.mode ?? "own_cloud",
      chosen: true,
      armed: opts.armed ?? true,
      armedAt: opts.armed === false ? null : "2026-09-05T00:00:00.000Z",
      refusedBecause: null,
      chosenBy: null,
      chosenAt: null,
      connectionId: GRANT,
      driveFolderId: "folder-house",
      driveFolderPath: "Mudavym mail archive/Sim Meyhouse",
      price: { minorUnits: null, currency: null, unit: null, decision: null },
      says: "armed",
    }),
    exportedAmong: async (ids: string[]) => {
      if (opts.throwsOnExported) throw new Error(opts.throwsOnExported);
      return new Set(ids.filter((id) => (opts.exported ?? []).includes(id)));
    },
    runExport: async (p: { conversationIds?: string[] }) => {
      const ids = p.conversationIds ?? [];
      exportCalls.push(ids);
      const counts = opts.onExport?.(ids) ?? {
        considered: ids.length,
        exported: ids.length,
        failed: 0,
      };
      return {
        restaurantId: HOUSE,
        trigger: "revocation" as const,
        mode: "own_cloud" as const,
        armed: true,
        outcomes: [],
        error: null,
        says: "ran",
        ...counts,
      };
    },
    disclosureFor: async () => ({
      mode: "own_cloud",
      chosen: true,
      armed: true,
      says: "armed",
      intro: "",
      options: { ownCloud: "", mudavym: "", none: "" },
      paidTierRefusal: null,
      jurisdictionNote: null,
      layout: "",
    }),
  } as unknown as HouseMailArchiveService;
  return { service, exportCalls };
}

const WINDOW = [{ figure_days: 92, derived_at: "2026-09-05T00:00:00.000Z" }];
const TWO_EXPIRED = [
  { id: OLD_ONE, received_at: longAgo, created_at: longAgo },
  { id: OLD_TWO, received_at: longAgo, created_at: longAgo },
];

describe("the window sweep, with an armed archive", () => {
  it("HOLDS a reply whose copy has not reached the house's own cloud", async () => {
    const { rec, db } = build({
      house_mail_retention_windows: WINDOW,
      procurement_conversations: TWO_EXPIRED,
      conversation_attachments: [],
    });
    // Only OLD_ONE was exported.
    const arch = archive({ exported: [OLD_ONE] });
    const service = new RawMailRetentionService(db, undefined, arch.service);

    const run = await service.sweepHouse(HOUSE);

    expect(run.considered).toBe(2);
    expect(run.deleted).toBe(1);
    expect(run.heldForExport).toBe(1);
    expect(run.archiveMode).toBe("own_cloud");
    // The tombstone update reached exactly the exported one.
    expect(rec.updated).toContainEqual([OLD_ONE]);
    expect(rec.updated).not.toContainEqual(
      expect.arrayContaining([OLD_TWO]),
    );
    // And the sentence names the hold and its reason.
    expect(run.says).toMatch(/1 more was past the window and was NOT deleted/);
    expect(run.says).toMatch(/no verified copy there yet/);
    // The count is on the row too, not only in prose.
    const sweep = rec.inserts.find(
      (i) => i.table === "house_mail_retention_sweeps",
    );
    expect(sweep!.body.held_for_export).toBe(1);
    expect(sweep!.body.archive_mode).toBe("own_cloud");
  });

  it("DELETES when every expired reply has a verified copy, and says so", async () => {
    const { rec, db } = build({
      house_mail_retention_windows: WINDOW,
      procurement_conversations: TWO_EXPIRED,
      conversation_attachments: [],
    });
    const arch = archive({ exported: [OLD_ONE, OLD_TWO] });
    const service = new RawMailRetentionService(db, undefined, arch.service);

    const run = await service.sweepHouse(HOUSE);

    expect(run.deleted).toBe(2);
    expect(run.heldForExport).toBe(0);
    expect(run.says).toMatch(
      /Every expired reply had a verified copy in this house's own cloud before it went/,
    );
    const sweep = rec.inserts.find(
      (i) => i.table === "house_mail_retention_sweeps",
    );
    // 0, not NULL. The archive WAS evaluated and held nothing.
    expect(sweep!.body.held_for_export).toBe(0);
  });

  it("holds EVERYTHING when the export record cannot be read", async () => {
    const { rec, db } = build({
      house_mail_retention_windows: WINDOW,
      procurement_conversations: TWO_EXPIRED,
      conversation_attachments: [],
    });
    const arch = archive({ throwsOnExported: "statement timeout" });
    const service = new RawMailRetentionService(db, undefined, arch.service);

    const run = await service.sweepHouse(HOUSE);

    expect(run.deleted).toBe(0);
    expect(run.heldForExport).toBe(2);
    expect(rec.updates).toHaveLength(0);
    expect(run.says).toMatch(/could not be read/);
    expect(run.says).toMatch(/All 2 expired replies are held/);
    // Recorded, not passed over.
    expect(
      rec.inserts.some((i) => i.table === "house_mail_retention_sweeps"),
    ).toBe(true);
  });
});

describe("the window sweep, with no archive", () => {
  it("behaves exactly as D12-D15 decided when the house chose none", async () => {
    const { rec, db } = build({
      house_mail_retention_windows: WINDOW,
      procurement_conversations: TWO_EXPIRED,
      conversation_attachments: [],
    });
    const arch = archive({ mode: "none", armed: true });
    const service = new RawMailRetentionService(db, undefined, arch.service);

    const run = await service.sweepHouse(HOUSE);

    expect(run.deleted).toBe(2);
    expect(run.heldForExport).toBe(0);
    expect(run.archiveMode).toBe("none");
    const sweep = rec.inserts.find(
      (i) => i.table === "house_mail_retention_sweeps",
    );
    expect(sweep!.body.archive_mode).toBe("none");
  });

  it("deletes on the window when the paid archive is chosen and NOT armed", async () => {
    // The house asked for the Mudavym archive; OD-23 is open so it never armed.
    // Deleting is the honest outcome: the person consented to the window, and
    // the choice screen already told the house the archive is not running.
    const { db } = build({
      house_mail_retention_windows: WINDOW,
      procurement_conversations: TWO_EXPIRED,
      conversation_attachments: [],
    });
    const arch = archive({ mode: "mudavym_archive", armed: false });
    const service = new RawMailRetentionService(db, undefined, arch.service);

    const run = await service.sweepHouse(HOUSE);

    expect(run.deleted).toBe(2);
    expect(run.archiveMode).toBe("mudavym_archive");
    expect(run.heldForExport).toBe(0);
  });
});

describe("a sweep that cannot consult the archive does not delete", () => {
  it("REFUSES when the archive service is not in the injector", async () => {
    const { rec, db } = build({
      house_mail_retention_windows: WINDOW,
      procurement_conversations: TWO_EXPIRED,
      conversation_attachments: [],
    });
    const service = new RawMailRetentionService(db);

    const run = await service.sweepHouse(HOUSE);

    expect(run.deleted).toBe(0);
    expect(rec.updates).toHaveLength(0);
    expect(run.archiveMode).toBeNull();
    // NULL, not 0: nothing was evaluated, so nothing was held either.
    expect(run.heldForExport).toBeNull();
    expect(run.says).toMatch(
      /a sweep that cannot tell whether a copy exists must not delete the only one/,
    );
    const sweep = rec.inserts.find(
      (i) => i.table === "house_mail_retention_sweeps",
    );
    expect(sweep!.body.archive_mode).toBeNull();
    expect(sweep!.body.held_for_export).toBeNull();
  });

  it("REFUSES when the archive setting itself cannot be read", async () => {
    const { rec, db } = build({
      house_mail_retention_windows: WINDOW,
      procurement_conversations: TWO_EXPIRED,
      conversation_attachments: [],
    });
    const broken = {
      settingsFor: async () => {
        throw new Error("connection reset");
      },
    } as unknown as HouseMailArchiveService;
    const service = new RawMailRetentionService(db, undefined, broken);

    const run = await service.sweepHouse(HOUSE);

    expect(run.deleted).toBe(0);
    expect(rec.updates).toHaveLength(0);
    expect(run.says).toMatch(/connection reset/);
    expect(run.says).toMatch(/No mail was deleted/);
  });
});

describe("a revocation exports and then deletes anyway", () => {
  it("runs one last export and still deletes, saying what reached the copy", async () => {
    const { rec, db } = build({
      procurement_conversations: [
        { id: OLD_ONE, restaurant_id: HOUSE },
        { id: OLD_TWO, restaurant_id: HOUSE },
      ],
      conversation_attachments: [],
    });
    const arch = archive({});
    const service = new RawMailRetentionService(db, undefined, arch.service);

    const run = await service.sweepForRevokedGrant({
      connectionId: GRANT,
      restaurantId: HOUSE,
      ownerUserId: null,
    });

    // The export ran over exactly the rows about to go.
    expect(arch.exportCalls).toEqual([[OLD_ONE, OLD_TWO]]);
    // And the deletion happened regardless of the export's outcome.
    expect(run.deleted).toBe(2);
    expect(run.says).toMatch(/one last export ran and wrote all 2/);
    expect(rec.updated).toContainEqual([OLD_ONE, OLD_TWO]);
  });

  it("deletes even when the last export FAILED, and says which replies never reached the copy", async () => {
    const { db } = build({
      procurement_conversations: [
        { id: OLD_ONE, restaurant_id: HOUSE },
        { id: OLD_TWO, restaurant_id: HOUSE },
      ],
      conversation_attachments: [],
    });
    const arch = archive({
      onExport: () => ({ considered: 2, exported: 1, failed: 1 }),
    });
    const service = new RawMailRetentionService(db, undefined, arch.service);

    const run = await service.sweepForRevokedGrant({
      connectionId: GRANT,
      restaurantId: HOUSE,
      ownerUserId: null,
    });

    expect(run.deleted).toBe(2);
    expect(run.says).toMatch(/wrote 1 of 2/);
    expect(run.says).toMatch(
      /without ever reaching the house's own cloud, because a revocation does not wait/,
    );
  });

  it("says the archive could not be checked rather than implying there was none", async () => {
    const { db } = build({
      procurement_conversations: [{ id: OLD_ONE, restaurant_id: HOUSE }],
      conversation_attachments: [],
    });
    const service = new RawMailRetentionService(db);

    const run = await service.sweepForRevokedGrant({
      connectionId: GRANT,
      restaurantId: HOUSE,
      ownerUserId: null,
    });

    expect(run.deleted).toBe(1);
    expect(run.says).toMatch(
      /Whether this house keeps its own copy could not be checked/,
    );
  });
});
