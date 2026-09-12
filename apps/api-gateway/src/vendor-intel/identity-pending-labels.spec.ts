import { IdentityService } from "./identity.service";

/**
 * The queue names the bottle it proposes (2026-09-11, the /vendor-prices
 * rebuild). A candidate row carries only `identity_id`; a person asked "is this
 * the same bottle?" needs the identity's label and standing on the same page,
 * so `pending()` reads them in one batch. When that second read fails, the
 * queue still comes back and every candidate says its identity is UNREAD with
 * the reason — never a queue that fails, never a label invented.
 */

function makeService(opts: {
  candidates?: any[];
  candidatesError?: any;
  identities?: any[];
  identitiesError?: any;
}) {
  const seen: { inIds: string[][] } = { inIds: [] };
  const build = (table: string) => {
    const b: any = {
      select: () => b,
      eq: () => b,
      or: () => b,
      order: () => b,
      limit: () => b,
      in: (_col: string, ids: string[]) => {
        seen.inIds.push(ids);
        return b;
      },
      then: (resolve: any) => {
        if (table === "beverage_identity_candidates") {
          return resolve({ data: opts.candidates ?? [], error: opts.candidatesError ?? null });
        }
        if (table === "beverage_identities") {
          return resolve({ data: opts.identities ?? [], error: opts.identitiesError ?? null });
        }
        return resolve({ data: [], error: null });
      },
    };
    return b;
  };
  const databaseService = { supabase: { from: (t: string) => build(t) } } as any;
  return { svc: new IdentityService(databaseService), seen };
}

const CAND = (over: Record<string, any> = {}) => ({
  id: "cand-1",
  subject_table: "vendor_price_observations",
  subject_id: "obs-1",
  restaurant_id: "house-1",
  identity_id: "ident-1",
  method: "normalised_key",
  confidence: 0.62,
  evidence: { producer: "agreed", name: "agreed", vintage: "unstated", unstated: ["vintage"] },
  created_at: "2026-09-10T10:00:00.000Z",
  ...over,
});

describe("the identity queue names the bottle it proposes", () => {
  it("attaches display_label and standing, read once for the whole page", async () => {
    const { svc, seen } = makeService({
      candidates: [CAND(), CAND({ id: "cand-2", identity_id: "ident-1" }), CAND({ id: "cand-3", identity_id: "ident-2" })],
      identities: [
        { id: "ident-1", display_label: "Krug Grande Cuvee (750ml)", standing: "library" },
        { id: "ident-2", display_label: "House Red 2023 (750ml)", standing: "provisional" },
      ],
    });
    const items = await svc.pending("house-1", 50);
    expect(seen.inIds).toEqual([["ident-1", "ident-2"]]);
    expect(items[0].identity).toEqual({ unread: false, display_label: "Krug Grande Cuvee (750ml)", standing: "library" });
    expect(items[2].identity.standing).toBe("provisional");
  });

  it("marks an identity UNREAD with the reason when the label read fails, and keeps the queue", async () => {
    const { svc } = makeService({
      candidates: [CAND()],
      identitiesError: { message: "permission denied" },
    });
    const items = await svc.pending("house-1", 50);
    expect(items).toHaveLength(1);
    expect(items[0].identity).toEqual({ unread: true, reason: "permission denied" });
  });

  it("says when the identity row was not found rather than inventing a label", async () => {
    const { svc } = makeService({ candidates: [CAND()], identities: [] });
    const items = await svc.pending("house-1", 50);
    expect(items[0].identity).toEqual({ unread: true, reason: "the identity row was not found" });
  });

  it("does not read labels for an empty queue", async () => {
    const { svc, seen } = makeService({ candidates: [] });
    expect(await svc.pending("house-1", 50)).toEqual([]);
    expect(seen.inIds).toEqual([]);
  });

  it("still reports a failed queue read as a failure, not an empty queue", async () => {
    const { svc } = makeService({ candidatesError: { message: "timeout" } });
    await expect(svc.pending("house-1", 50)).rejects.toThrow(/unknown, not an empty queue/);
  });
});
