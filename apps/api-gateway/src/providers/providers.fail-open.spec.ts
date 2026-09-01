import { ConflictException, ServiceUnavailableException } from "@nestjs/common";
import { ProvidersService } from "./providers.service";

/**
 * The duplicate-provider guard must FAIL CLOSED.
 *
 * `maybeSingle()` returns `data: null` for BOTH "no row matched" and "the query
 * failed", because supabase-js resolves with `{ data, error }` rather than
 * throwing. The guard destructured only `data`, so a failed lookup read as "no
 * duplicate exists" and the insert proceeded — a guard that waves work through
 * precisely when it cannot do its job.
 *
 * Damage measured in production before fixing (2026-09-01): **zero**. All four
 * name-duplicate provider rows carry `catalogue_vendor_id = NULL`, and no two
 * providers share a `catalogue_vendor_id` — which is the only key this guard
 * checks — so the duplicates that exist came in through the manual-add path four
 * months ago and are unrelated. Fixed now because "it has not corrupted anything
 * yet" is the same absence-as-health reasoning the guard itself commits.
 */

function makeDb(opts: { dupeCheckFails?: boolean; existing?: any } = {}) {
  const inserted: any[] = [];

  const supabase: any = {
    from(table: string) {
      const q: any = {
        select: () => q,
        eq: () => q,
        is: () => q,
        single: async () =>
          table === "vendor_catalogue"
            ? { data: { id: "vend-1", name: "Breakthru", type: "distributor" }, error: null }
            : { data: null, error: null },
        maybeSingle: async () =>
          opts.dupeCheckFails
            ? {
                data: null,
                error: { code: "57014", message: "statement timeout", details: null },
              }
            : { data: opts.existing ?? null, error: null },
        insert: () => ({
          select: () => ({
            single: async () => {
              inserted.push(true);
              return { data: { id: "new-1", name: "Breakthru" }, error: null };
            },
          }),
        }),
        // Post-insert bookkeeping the happy path performs; a resolved thenable
        // so `await` on the builder yields the {data,error} shape.
        update: () => q,
        then: (res: any) => res({ data: null, error: null }),
      };
      return q;
    },
  };

  return { supabase, inserted };
}

// ProvidersService gained a required ProcurementService dependency when
// `createRetroactiveOrder` stopped hand-rolling its own insert. Nothing under
// test here touches it, so the stub throws rather than returning undefined —
// a silent stub would let a future call to it pass this suite unnoticed, which
// is the same fail-open shape these tests exist to close.
const unusedProcurement = new Proxy(
  {},
  {
    get(_t, prop) {
      throw new Error(
        `providers.fail-open.spec: ProcurementService.${String(prop)} was called; ` +
          `these tests cover createProvider only and must not reach the order path.`,
      );
    },
  },
) as any;

const svc = (supabase: any) =>
  new ProvidersService(
    { supabase } as any,
    { track: async () => undefined } as any,
    unusedProcurement,
  );

const DTO: any = { catalogue_vendor_id: "vend-1" };

describe("provider dedup guard fails closed", () => {
  it("refuses to add when the duplicate check itself failed", async () => {
    // BEFORE THE FIX this resolved successfully and INSERTED the duplicate —
    // the error was discarded and `null` was read as "nothing found".
    const { supabase, inserted } = makeDb({ dupeCheckFails: true });

    await expect(svc(supabase).createProvider(DTO, "r-1", "u-1")).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(inserted).toHaveLength(0);
  });

  it("still rejects a genuine duplicate with 409, not 503", async () => {
    // The two failure modes must stay distinguishable to the caller: "already
    // yours" is the user's problem, "we could not check" is ours.
    const { supabase, inserted } = makeDb({
      existing: { id: "p-1", name: "Breakthru" },
    });

    await expect(svc(supabase).createProvider(DTO, "r-1", "u-1")).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(inserted).toHaveLength(0);
  });

  it("still adds when the check genuinely finds nothing", async () => {
    // The control that stops the fix becoming a permanent refusal: an empty
    // result is not an error, and the happy path must survive.
    const { supabase, inserted } = makeDb({});
    await expect(
      svc(supabase).createProvider(DTO, "r-1", "u-1"),
    ).resolves.toBeDefined();
    expect(inserted).toHaveLength(1);
  });
});
