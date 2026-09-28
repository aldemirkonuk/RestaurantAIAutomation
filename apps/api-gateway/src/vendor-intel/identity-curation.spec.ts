import { join } from "path";
import { ForbiddenException } from "@nestjs/common";
import { IdentityService } from "./identity.service";
import { IdentityCurationController } from "./identity-curation.controller";
import { ServiceKeyGuard } from "../auth/guards/service-key.guard";
import { IS_PUBLIC_KEY } from "../auth/decorators/public.decorator";

/**
 * A house names a bottle the library does not have, and Mudavym curates it.
 *
 * The founder, 2026-09-05 (batch 48): *"Provisional on the item, curated into
 * the library."* Three things have to be true for that sentence to hold, and
 * each is asserted here rather than described: the assertion is provisional and
 * queued, promotion RE-POINTS the item, and promotion KEEPS the house's original
 * assertion as provenance.
 */

interface Recorded {
  inserts: Array<{ table: string; payload: any }>;
  updates: Array<{ table: string; patch: any; filters: Array<[string, any]> }>;
}

function makeService(opts: {
  identity?: any;
  identityAfter?: any;
  identityError?: any;
  existing?: any;
  libraryRow?: any;
  libraryError?: any;
  queueRows?: any[];
  queueError?: any;
  updateError?: any;
  repointRows?: any[];
  repointError?: any;
  insertError?: any;
}) {
  const rec: Recorded = { inserts: [], updates: [] };
  let identityReads = 0;

  const build = (table: string) => {
    const filters: Array<[string, any]> = [];
    let mode: "select" | "update" = "select";
    let patch: any = null;

    const b: any = {
      select: (_cols?: any, opts?: any) =>
        opts?.head ? { in: () => Promise.resolve({ count: 0, error: null }) } : b,
      order: () => b,
      limit: () => b,
      in: () => b,
      upsert: (payload: any) => {
        rec.inserts.push({ table, payload });
        return Promise.resolve({ data: null, error: null });
      },
      eq: (col: string, val: any) => {
        filters.push([col, val]);
        return b;
      },
      update: (p: any) => {
        mode = "update";
        patch = p;
        return b;
      },
      insert: (payload: any) => {
        rec.inserts.push({ table, payload });
        return {
          select: () => ({
            single: async () => ({
              data: opts.insertError ? null : { id: "new-library-row", standing: "provisional", curation_state: "queued" },
              error: opts.insertError ?? null,
            }),
          }),
        };
      },
      maybeSingle: async () => {
        if (table === "master_wine_library") {
          return { data: opts.libraryRow ?? null, error: opts.libraryError ?? null };
        }
        if (filters.some(([c]) => c === "identity_key")) {
          return { data: opts.existing ?? null, error: null };
        }
        identityReads += 1;
        // The second read of the identity is the one `promote` does AFTER the
        // update, so it must see the promoted row.
        const row =
          identityReads > 1 && opts.identityAfter ? opts.identityAfter : opts.identity;
        return { data: row ?? null, error: opts.identityError ?? null };
      },
      then: (resolve: any) => {
        if (mode === "update") {
          rec.updates.push({ table, patch, filters });
          if (table === "restaurant_inventory") {
            return resolve({
              data: opts.repointRows ?? [],
              error: opts.repointError ?? null,
            });
          }
          return resolve({ data: null, error: opts.updateError ?? null });
        }
        if (table === "beverage_identities") {
          return resolve({ data: opts.queueRows ?? [], error: opts.queueError ?? null });
        }
        return resolve({ data: [], error: null });
      },
    };
    return b;
  };

  const databaseService = { supabase: { from: (t: string) => build(t) } } as any;
  return { svc: new IdentityService(databaseService), rec };
}

const PROVISIONAL = {
  id: "ident-1",
  producer_normalised: "sim meyhouse",
  name_normalised: "ev sarabi",
  vintage_text: "unstated",
  size_ml: 750,
  pack: 1,
  display_label: "Ev Şarabı",
  standing: "provisional",
  curation_state: "queued",
  master_wine_id: null,
  asserted_for_restaurant_id: "house-1",
  assertion_note: null,
};

describe("a house's assertion is provisional and queued", () => {
  it("records the house and queues it for curation", async () => {
    const { svc, rec } = makeService({});
    const out = await svc.assertIdentity({
      subject: { producer: "Sim Meyhouse", name: "Ev Sarabi", sizeMl: 750, pack: 1 },
      userId: "user-1",
      restaurantId: "house-1",
    });
    expect(out.created).toBe(true);
    const written = rec.inserts.find((i) => i.table === "beverage_identities")!;
    expect(written.payload.asserted_for_restaurant_id).toBe("house-1");
    expect(written.payload.curation_state).toBe("queued");
    expect(written.payload.assertion_method).toBe("person");
    expect(written.payload.asserted_by).toBe("user-1");
  });

  it("queues nothing when no house asserted it", async () => {
    const { svc, rec } = makeService({});
    await svc.assertIdentity({
      subject: { producer: "Sazerac", name: "Fireball", sizeMl: 750, pack: 1 },
      userId: "user-1",
      restaurantId: null,
    });
    const written = rec.inserts.find((i) => i.table === "beverage_identities")!;
    expect(written.payload.asserted_for_restaurant_id).toBeNull();
    expect(written.payload.curation_state).toBe("none");
  });

  it("does not re-attribute an identity somebody already asserted", async () => {
    const { svc, rec } = makeService({
      existing: { id: "ident-0", standing: "library", curation_state: "promoted" },
    });
    const out = await svc.assertIdentity({
      subject: { producer: "Krug", name: "Grande Cuvee", sizeMl: 750, pack: 1 },
      userId: "user-2",
      restaurantId: "house-2",
    });
    expect(out.created).toBe(false);
    expect(out.id).toBe("ident-0");
    expect(out.standing).toBe("library");
    expect(rec.inserts.filter((i) => i.table === "beverage_identities")).toHaveLength(0);
  });
});

describe("the curation queue", () => {
  it("reads oldest first and says whether the page was complete", async () => {
    const { svc } = makeService({ queueRows: [PROVISIONAL] });
    const out = await svc.curationQueue(50);
    expect(out.items).toHaveLength(1);
    expect(out.complete).toBe(true);
  });

  it("says a full page is a floor", async () => {
    const { svc } = makeService({ queueRows: [PROVISIONAL, PROVISIONAL] });
    const out = await svc.curationQueue(2);
    expect(out.complete).toBe(false);
    expect(out.limit).toBe(2);
  });

  it("FAILS on a read error rather than reporting an empty queue", async () => {
    const { svc } = makeService({ queueError: { message: "relation missing" } });
    await expect(svc.curationQueue()).rejects.toThrow(
      /could not be read \(relation missing\)\. This is a failure, not an empty queue/,
    );
  });
});

describe("promotion", () => {
  const PROMOTED = { ...PROVISIONAL, standing: "library", curation_state: "promoted", master_wine_id: "lib-1" };

  it("creates a library row, links it, and RE-POINTS the items", async () => {
    const { svc, rec } = makeService({
      identity: PROVISIONAL,
      identityAfter: PROMOTED,
      repointRows: [{ id: "inv-1" }, { id: "inv-2" }],
    });
    const out = await svc.promote({ identityId: "ident-1", note: "checked" });

    expect(out.libraryRowCreated).toBe(true);
    expect(out.masterWineId).toBe("new-library-row");
    expect(out.itemsRepointed).toBe(2);
    expect(out.standing).toBe("library");

    const repoint = rec.updates.find((u) => u.table === "restaurant_inventory")!;
    expect(repoint.patch).toEqual({ master_wine_id: "new-library-row" });
    expect(repoint.filters).toEqual([["identity_id", "ident-1"]]);
  });

  it("KEEPS the house's original assertion — the founder's provenance rule", async () => {
    const { svc, rec } = makeService({
      identity: PROVISIONAL,
      identityAfter: PROMOTED,
      repointRows: [],
    });
    await svc.promote({ identityId: "ident-1" });
    const link = rec.updates.find((u) => u.table === "beverage_identities")!;
    expect(Object.keys(link.patch)).not.toContain("asserted_for_restaurant_id");
    expect(Object.keys(link.patch)).not.toContain("asserted_by");
    expect(link.patch.curation_state).toBe("promoted");
  });

  it("reports zero items re-pointed rather than implying it moved something", async () => {
    const { svc } = makeService({
      identity: PROVISIONAL,
      identityAfter: PROMOTED,
      repointRows: [],
    });
    expect((await svc.promote({ identityId: "ident-1" })).itemsRepointed).toBe(0);
  });

  it("attaches to an existing shared library row when one is named", async () => {
    const { svc, rec } = makeService({
      identity: PROVISIONAL,
      identityAfter: PROMOTED,
      libraryRow: { id: "lib-9", provisional_for_restaurant_id: null },
      repointRows: [{ id: "inv-1" }],
    });
    const out = await svc.promote({ identityId: "ident-1", masterWineId: "lib-9" });
    expect(out.libraryRowCreated).toBe(false);
    expect(out.masterWineId).toBe("lib-9");
    expect(rec.inserts.filter((i) => i.table === "master_wine_library")).toHaveLength(0);
  });

  it("refuses to promote onto another venue's provisional row (ADR 0130)", async () => {
    const { svc } = makeService({
      identity: PROVISIONAL,
      libraryRow: { id: "lib-9", provisional_for_restaurant_id: "house-2" },
    });
    await expect(
      svc.promote({ identityId: "ident-1", masterWineId: "lib-9" }),
    ).rejects.toThrow(/one venue's provisional wine/);
  });

  it("refuses to promote something already promoted", async () => {
    const { svc } = makeService({ identity: PROMOTED });
    await expect(svc.promote({ identityId: "ident-1" })).rejects.toThrow(
      /already promoted onto lib-1/,
    );
  });

  it("says the identity was promoted when only the re-point failed", async () => {
    const { svc } = makeService({
      identity: PROVISIONAL,
      identityAfter: PROMOTED,
      repointError: { message: "deadlock" },
    });
    await expect(svc.promote({ identityId: "ident-1" })).rejects.toThrow(
      /promoted onto new-library-row but the house items could not be re-pointed/,
    );
  });

  it("names the orphaned library row when the link fails after creating one", async () => {
    const { svc } = makeService({
      identity: PROVISIONAL,
      updateError: { message: "constraint"},
    });
    await expect(svc.promote({ identityId: "ident-1" })).rejects.toThrow(
      /A library row \(new-library-row\) WAS created and is now unreferenced/,
    );
  });
});

describe("declining", () => {
  it("keeps the identity and records the reason the house will read", async () => {
    const { svc, rec } = makeService({ identity: PROVISIONAL });
    const out = await svc.decline({
      identityId: "ident-1",
      reason: "this is a blend the house makes, not a trade item",
    });
    expect(out.curationState).toBe("declined");
    expect(out.standing).toBe("provisional");
    const upd = rec.updates.find((u) => u.table === "beverage_identities")!;
    expect(upd.patch.curation_note).toBe(
      "this is a blend the house makes, not a trade item",
    );
    // NOT deleted, and NOT stripped of its house.
    expect(Object.keys(upd.patch)).not.toContain("asserted_for_restaurant_id");
  });

  it("refuses a decline with no reason", async () => {
    const { svc } = makeService({ identity: PROVISIONAL });
    await expect(
      svc.decline({ identityId: "ident-1", reason: "   " }),
    ).rejects.toThrow(/A decline states its reason/);
  });

  it("refuses to decline something already in the library", async () => {
    const { svc } = makeService({
      identity: { ...PROVISIONAL, curation_state: "promoted" },
    });
    await expect(
      svc.decline({ identityId: "ident-1", reason: "no" }),
    ).rejects.toThrow(/already in the library/);
  });
});

describe("the curation routes are gated by the service key, not by a role", () => {
  const routes = ["queue", "promote", "decline"] as const;

  it("marks every route @Public so ServiceKeyGuard is what decides", () => {
    for (const r of routes) {
      const isPublic = Reflect.getMetadata(
        IS_PUBLIC_KEY,
        (IdentityCurationController.prototype as any)[r],
      );
      expect(isPublic).toBe(true);
    }
  });

  it("puts ServiceKeyGuard on every route", () => {
    for (const r of routes) {
      const guards =
        Reflect.getMetadata(
          "__guards__",
          (IdentityCurationController.prototype as any)[r],
        ) ?? [];
      expect(guards).toContain(ServiceKeyGuard);
    }
  });

  it("carries NO class-level guard, so no RolesGuard can refuse a service key", () => {
    const classGuards =
      Reflect.getMetadata("__guards__", IdentityCurationController) ?? [];
    expect(classGuards).toHaveLength(0);
  });
});

describe("Q4 — two ways in, and neither invents anything", () => {
  const OLD = process.env.LWIN_FILE_PATH;
  afterEach(() => {
    if (OLD === undefined) delete process.env.LWIN_FILE_PATH;
    else process.env.LWIN_FILE_PATH = OLD;
  });

  it("says the LWIN file is ABSENT with the reason, not that no wine matched", async () => {
    delete process.env.LWIN_FILE_PATH;
    const { svc } = makeService({});
    const out = await svc.lwinSearch("margaux");
    expect(out.available).toBe(false);
    expect(out.hits).toHaveLength(0);
    expect(out.rowsInFile).toBeNull();
    expect(out.note).toContain("LWIN_FILE_PATH is unset");
    expect(out.note).toContain("This is not an empty search result");
    expect(out.attribution).toContain("CC BY 4.0");
  });

  it("says a file it cannot read is a FAILURE, naming the path", async () => {
    process.env.LWIN_FILE_PATH = "/no/such/lwin/file.csv";
    const { svc } = makeService({});
    const out = await svc.lwinSearch("margaux");
    expect(out.available).toBe(false);
    expect(out.filePath).toBe("/no/such/lwin/file.csv");
    expect(out.note).toContain("This is a failure, not an empty search");
  });

  it("searches the recorded file when there is one", async () => {
    process.env.LWIN_FILE_PATH = join(
      __dirname,
      "__fixtures__",
      "lwin-database.synthetic.csv",
    );
    const { svc } = makeService({});
    const out = await svc.lwinSearch("grande maison");
    expect(out.available).toBe(true);
    expect(out.rowsInFile).toBe(5);
    expect(out.hits.map((h) => h.lwin)).toEqual(["9900003"]);
  });

  it("refuses an LWIN that is not seven digits rather than storing it", async () => {
    const { svc } = makeService({});
    await expect(
      svc.confirmFromLwin({
        lwin: "10170922020",
        displayName: "x",
        producer: "y",
        userId: "u1",
      }),
    ).rejects.toThrow(/An LWIN-7 is seven digits/);
  });

  it("records an LWIN confirmation as `source`, never as a house's provisional", async () => {
    const { svc, rec } = makeService({});
    await svc.confirmFromLwin({
      lwin: "9900001",
      displayName: "Probe Estate Grand Vin",
      producer: "Probe Estate",
      vintage: 2015,
      sizeMl: 750,
      pack: 1,
      userId: "u1",
    });
    const identity = rec.inserts.find((i) => i.table === "beverage_identities")!;
    expect(identity.payload.asserted_for_restaurant_id).toBeNull();
    expect(identity.payload.curation_state).toBe("none");
    const key = rec.inserts.find((i) => i.table === "beverage_identity_keys")!;
    expect(key.payload.key_namespace).toBe("lwin");
    expect(key.payload.key_value).toBe("9900001");
    expect(key.payload.note).toContain("CC BY 4.0");
  });

  it("counts confirmed identities for a sweep, and calls zero a real zero", async () => {
    const { svc } = makeService({});
    const out = await svc.confirmedIdentityCount("house-1");
    expect(out.confirmed).toBe(0);
    expect(out.note).toContain("That is a real zero");
  });
});
