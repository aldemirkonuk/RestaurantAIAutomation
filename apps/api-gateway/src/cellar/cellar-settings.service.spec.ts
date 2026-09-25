import { Test } from "@nestjs/testing";
import { DatabaseService } from "../database/database.service";
import { CellarSettingsService } from "./cellar-settings.service";
import { DEFAULT_GAZETTEER_MEASURES } from "./dto/hold-ceremony";

/**
 * ADR 0160 sec110 items 2 and 6 — the order-hold ceremony and the gazetteer
 * measures, both on `restaurant_cellar_settings` (migration 20260922230000).
 *
 * The failure this file guards against is the same one
 * `cellar-registers.service.spec.ts` names: a table that does not exist yet
 * on this database must read as UNREADABLE, never as "this house chose the
 * default" — those are different facts, and only the first is honest before
 * the migration has run anywhere.
 */

const RID = "550e8400-e29b-41d4-a716-446655440000";

interface StoredRow {
  hold_ceremony: string;
  gazetteer_measures: string[] | null;
  set_by: string | null;
  set_at: string | null;
}

/**
 * A minimal stateful fake: `read()`'s `maybeSingle()` answers from `row`,
 * `write()`'s `upsert()` replaces it — so a write-then-read in the same test
 * exercises the real round trip, not two independently stubbed calls.
 */
function makeClient(opts: {
  row?: StoredRow | null;
  missingTable?: boolean;
  /** A TRANSIENT read failure, told apart from `missingTable` — the read
   * fails but, unlike a missing relation, an upsert against this same table
   * would otherwise succeed. Lets a test prove write() refuses BEFORE it
   * ever reaches the upsert, rather than merely reaching the same error
   * message by a different, still-writing path. */
  readError?: { code?: string; message: string };
  upsertError?: { code?: string; message: string };
}) {
  let row = opts.row ?? null;
  const missing = opts.missingTable ?? false;
  let upsertCalls = 0;

  return {
    upsertCallCount: () => upsertCalls,
    from: (table: string) => {
      expect(table).toBe("restaurant_cellar_settings");
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              if (missing) {
                return { data: null, error: { code: "42P01", message: 'relation "restaurant_cellar_settings" does not exist' } };
              }
              if (opts.readError) {
                return { data: null, error: opts.readError };
              }
              return { data: row, error: null };
            },
          }),
        }),
        upsert: async (next: Record<string, unknown>) => {
          upsertCalls += 1;
          if (missing) return { error: { code: "42P01", message: "relation does not exist" } };
          if (opts.upsertError) return { error: opts.upsertError };
          row = {
            hold_ceremony: next.hold_ceremony as string,
            gazetteer_measures: next.gazetteer_measures as string[] | null,
            set_by: next.set_by as string | null,
            set_at: next.set_at as string | null,
          };
          return { error: null };
        },
      };
    },
  };
}

async function serviceWith(client: ReturnType<typeof makeClient>): Promise<CellarSettingsService> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      CellarSettingsService,
      { provide: DatabaseService, useValue: { getClient: () => client } },
    ],
  }).compile();
  return moduleRef.get(CellarSettingsService);
}

describe("CellarSettingsService.read", () => {
  it("reports an ABSENT table as unreadable, never as an unconfigured house's default", async () => {
    const service = await serviceWith(makeClient({ missingTable: true }));

    const out = await service.read(RID);
    expect(out.readable).toBe(false);
    expect(out.readError).toContain("migration has not been applied");
    // The shape still hands back the page's own safe defaults, so a caller
    // that ignores `readable` renders the same thing an unconfigured house
    // would — never blank, never a thrown render.
    expect(out.holdCeremony).toBe("hold");
    expect(out.gazetteerMeasures).toEqual(DEFAULT_GAZETTEER_MEASURES);
    expect(out.holdCeremonyConfigured).toBe(false);
    expect(out.gazetteerMeasuresConfigured).toBe(false);
  });

  it("defaults an unconfigured house (table exists, no row) without claiming it was configured", async () => {
    const service = await serviceWith(makeClient({ row: null }));

    const out = await service.read(RID);
    expect(out.readable).toBe(true);
    expect(out.holdCeremony).toBe("hold");
    expect(out.gazetteerMeasures).toEqual(DEFAULT_GAZETTEER_MEASURES);
    expect(out.holdCeremonyConfigured).toBe(false);
    expect(out.gazetteerMeasuresConfigured).toBe(false);
  });

  it("returns a configured house's own stored choices", async () => {
    const service = await serviceWith(
      makeClient({
        row: {
          hold_ceremony: "auto",
          gazetteer_measures: ["bottles", "registers"],
          set_by: "user-1",
          set_at: "2026-09-17T00:00:00Z",
        },
      }),
    );

    const out = await service.read(RID);
    expect(out.holdCeremony).toBe("auto");
    expect(out.holdCeremonyConfigured).toBe(true);
    expect(out.gazetteerMeasures).toEqual(["bottles", "registers"]);
    expect(out.gazetteerMeasuresConfigured).toBe(true);
    expect(out.setBy).toBe("user-1");
  });

  it("drops a measure id it does not recognise rather than crashing or trusting a future client's vocabulary", async () => {
    const service = await serviceWith(
      makeClient({
        row: {
          hold_ceremony: "hold",
          gazetteer_measures: ["bottles", "some-future-measure"],
          set_by: null,
          set_at: null,
        },
      }),
    );

    const out = await service.read(RID);
    expect(out.gazetteerMeasures).toEqual(["bottles"]);
  });

  it("distinguishes an EMPTY chosen set ('show none') from never having configured one", async () => {
    const service = await serviceWith(
      makeClient({
        row: { hold_ceremony: "hold", gazetteer_measures: [], set_by: "user-1", set_at: "2026-09-17T00:00:00Z" },
      }),
    );

    const out = await service.read(RID);
    expect(out.gazetteerMeasuresConfigured).toBe(true);
    expect(out.gazetteerMeasures).toEqual([]);
  });
});

describe("CellarSettingsService.write", () => {
  it("writes one field and leaves the other's stored choice untouched (a PATCH, not a full replace)", async () => {
    const service = await serviceWith(
      makeClient({
        row: { hold_ceremony: "hold", gazetteer_measures: ["bottles", "titles"], set_by: "user-1", set_at: "2026-09-16T00:00:00Z" },
      }),
    );

    const out = await service.write(RID, { holdCeremony: "auto" }, "user-2", "owner");
    expect(out.holdCeremony).toBe("auto");
    // gazetteerMeasures was not in this write's DTO, so the prior choice survives.
    expect(out.gazetteerMeasures).toEqual(["bottles", "titles"]);
    expect(out.setBy).toBe("user-2");
  });

  it("writes an unconfigured house's first choice against the page's own defaults", async () => {
    const service = await serviceWith(makeClient({ row: null }));

    const out = await service.write(RID, { gazetteerMeasures: ["registers"] }, "user-1", "staff");
    expect(out.gazetteerMeasures).toEqual(["registers"]);
    // holdCeremony was not sent and this house never configured it, so the
    // default ('hold') is written explicitly rather than left null.
    expect(out.holdCeremony).toBe("hold");
    expect(out.holdCeremonyConfigured).toBe(true);
  });

  it("refuses the write when the BEFORE read fails — never proceeds on the unread-default shape", async () => {
    // A transient read failure, not a missing table: an upsert here would
    // otherwise SUCCEED. Before this fix, write() proceeded on `before`'s
    // unread-default shape (holdCeremony: 'hold', gazetteerMeasures: null)
    // and upserted THAT over whatever the house had actually stored — a
    // write meant to change only the ceremony silently wiped the measures
    // list on nothing more than a flaky read. This pins that the write now
    // never reaches the database at all in that case.
    const client = makeClient({
      row: { hold_ceremony: "auto", gazetteer_measures: ["bottles", "par"], set_by: "user-1", set_at: "2026-09-16T00:00:00Z" },
      readError: { message: "ECONNREFUSED" },
    });
    const service = await serviceWith(client);

    await expect(service.write(RID, { holdCeremony: "auto" }, "user-2", "owner")).rejects.toThrow(
      /could not be read.*ECONNREFUSED/,
    );
    expect(client.upsertCallCount()).toBe(0);
  });

  it("throws, naming the missing migration, when the table does not exist yet", async () => {
    const service = await serviceWith(makeClient({ missingTable: true }));

    await expect(service.write(RID, { holdCeremony: "auto" }, "user-1", "owner")).rejects.toThrow(
      /migration has not been applied/,
    );
  });

  it("throws the database's own message on any other write failure", async () => {
    const service = await serviceWith(
      makeClient({ row: null, upsertError: { code: "23505", message: "duplicate key" } }),
    );

    await expect(service.write(RID, { holdCeremony: "auto" }, "user-1", "owner")).rejects.toThrow(
      /duplicate key/,
    );
  });
});

describe("CellarSettingsService.write — the order-hold ceremony is owner/manager only", () => {
  // ADR 0160 sec110 item 6, answered 2026-09-18: "owners and managers" may
  // change it; staff see it but cannot. Cellar confirmer's own open question
  // ("any signed-in member can switch this house to 'auto' — one click
  // spends money — should only owners and managers be able to?") answered.
  it.each(["owner", "manager", "admin", "OWNER", "Manager"])(
    "allows a %s to change the ceremony",
    async (role) => {
      const service = await serviceWith(makeClient({ row: null }));
      const out = await service.write(RID, { holdCeremony: "auto" }, "user-1", role);
      expect(out.holdCeremony).toBe("auto");
    },
  );

  it("refuses staff, naming who may change it, and writes nothing", async () => {
    const client = makeClient({
      row: { hold_ceremony: "hold", gazetteer_measures: ["bottles"], set_by: "user-1", set_at: "2026-09-16T00:00:00Z" },
    });
    const service = await serviceWith(client);

    await expect(service.write(RID, { holdCeremony: "auto" }, "user-2", "staff")).rejects.toThrow(
      /owner or a manager/,
    );
    expect(client.upsertCallCount()).toBe(0);
  });

  it("refuses a null/absent role — fails closed, never open by default", async () => {
    const service = await serviceWith(makeClient({ row: null }));

    await expect(service.write(RID, { holdCeremony: "auto" }, "user-1", null)).rejects.toThrow(
      /owner or a manager/,
    );
  });

  it("does NOT gate a gazetteerMeasures-only write — the founder restricted the ceremony, not the tiles", async () => {
    const service = await serviceWith(makeClient({ row: null }));

    const out = await service.write(RID, { gazetteerMeasures: ["bottles", "registers"] }, "user-1", "staff");
    expect(out.gazetteerMeasures).toEqual(["bottles", "registers"]);
  });

  it("still gates a write that sends BOTH fields, even though one of them is unrestricted", async () => {
    const client = makeClient({ row: null });
    const service = await serviceWith(client);

    await expect(
      service.write(RID, { holdCeremony: "auto", gazetteerMeasures: ["bottles"] }, "user-1", "staff"),
    ).rejects.toThrow(/owner or a manager/);
    expect(client.upsertCallCount()).toBe(0);
  });
});
